// WHAT A RESEARCH MISSION'S EMPLOYEE READS, and how its claims are held to it (Execution, reading Research's frozen
// records through SQL and its object store -- never writing them).
//
// INPUTS. Each pinned revision is given to the attempt read-only in /input, under its label: `S1-<title>.txt` -- the
// text Orbit Web extracted and indexed, page by page -- and, for a file that is not text, the original bytes beside it.
// They are named by a STORE PATH the sandbox provider asks Orbit Web to read (`research-text:<revision>`,
// `research-object:<revision>`), resolved here for the account of the attempt only: a path never names a file.
//
// CLAIMS. A claim of a hand-in cites sources by label and quotes what it rests on. It is SUPPORTED only when every label
// is a source this mission was given and the quote is found in that source's frozen text (spacing and letter case aside);
// the passage found is kept (page, characters) as the citation. A claim resting on a web page is kept as "web, not
// pinned" -- never as verified evidence.
import { Inject, Injectable } from "@nestjs/common";
import type { HandoffClaim } from "@orbit-web/contracts";
import type { AppConfig } from "../../../config/config.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { Db } from "../../../infra/db/db.js";
import { ObjectStore } from "../../../modules/research/sources/object-store.js";
import { ArtifactStore } from "../infrastructure/artifact-store.js";
import type { StagedInput } from "./attempt-inputs.js";
import type { AttemptData, PinnedSource } from "./run-outcomes.port.js";

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv))/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIN_QUOTE = 12;

// A plain file name the sandbox accepts (letters, digits, dots, dashes, underscores): `S1-invoices-q3`.
const fileTitle = (t: string): string => t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D")).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "source";

// Sanitize a staged /input file name so it always matches INPUT_NAME and never collides with an earlier input.
function uniqueInputName(used: Set<string>, raw: string): string {
  const ascii = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"));
  const clean = ascii.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "input";
  const dot = clean.lastIndexOf(".");
  const hasExt = dot > 0 && clean.length - dot <= 16;
  const ext = hasExt ? clean.slice(dot) : "";
  const stem = hasExt ? clean.slice(0, dot) : clean;
  const fit = (suffix: string): string => `${stem.slice(0, Math.max(1, 120 - ext.length - suffix.length))}${suffix}${ext}`;
  let candidate = fit("");
  for (let i = 2; used.has(candidate); i += 1) candidate = fit(`-${i}`);
  used.add(candidate);
  return candidate;
}
const extensionOf = (s: PinnedSource): string => {
  const fromName = s.fileName?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  if (fromName !== undefined) return fromName.toLowerCase();
  const known: Record<string, string> = { "application/pdf": "pdf", "text/html": "html", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx" };
  return known[s.mediaType] ?? "bin";
};

// Text compared as a reader would: Unicode-normalized, one space for any run of spacing, letter case aside.
const norm = (t: string): string => t.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

// Returns a verbatim excerpt from the mission brief when either the claim's quote or the claim text itself appears in
// the brief (at least MIN_QUOTE normalized characters). Prevents fake brief attribution: explicit `basis: "brief"` is
// still verified against the actual brief text.
export function matchBriefExcerpt(
  briefNorm: string,
  claimText: string,
  claimQuote: string | null,
  explicitBrief: boolean,
  noOtherSource: boolean,
): string | null {
  if (briefNorm.length < MIN_QUOTE) return null;
  if (!explicitBrief && !noOtherSource) return null;
  const quoteNorm = claimQuote === null ? "" : norm(claimQuote);
  if (quoteNorm.length >= MIN_QUOTE && briefNorm.includes(quoteNorm)) {
    return (claimQuote ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  }
  const textNorm = norm(claimText);
  if (textNorm.length >= MIN_QUOTE && briefNorm.includes(textNorm)) {
    return claimText.replace(/\s+/g, " ").trim().slice(0, 300);
  }
  return null;
}

export interface ClaimInput {
  text: string;
  sources: string[];
  quote: string | null;
  url: string | null;
  basis?: "source" | "brief" | "web" | "external" | null;
}

export type VerifiedClaim = HandoffClaim;

@Injectable()
export class ResearchInputs {
  private readonly objects: ObjectStore;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(ArtifactStore) private readonly artifacts: ArtifactStore,
  ) {
    this.objects = new ObjectStore(config.data.research);
  }

  // The inputs of an attempt: each pinned source's text, and its original bytes when it is not text.
  inputsOf(orbitId: string, sources: readonly PinnedSource[]): { name: string; storePath: string }[] {
    return sources.flatMap((s) => {
      const base = `${s.label}-${fileTitle(s.title)}`;
      const text = { name: `${base}.txt`, storePath: `research-text:${orbitId}/${s.revisionId}` };
      if (TEXT_TYPES.test(s.mediaType)) return [text];
      // The original's own name, unless it would be the text's (a .txt file whose type is not text): one name, one file.
      const original = `${base}.${extensionOf(s)}`;
      return [text, { name: original === text.name ? `${base}.original.${extensionOf(s)}` : original, storePath: `research-object:${orbitId}/${s.revisionId}` }];
    });
  }

  // What one attempt may read, as the files of its /input (ADR 0061 §9): each granted source (by its mission label), the
  // hand-ins of the parts it supervises (`unit-<key>-<file>`, as before), and what its lead shared of a part it waits for
  // (`from-<key>-summary.md`, and `from-<key>-<file>` when shared in full).
  stagedOf(orbitId: string, data: Pick<AttemptData, "sources" | "handoffs">): StagedInput[] {
    const used = new Set<string>();
    const sources = data.sources.flatMap((s) => this.inputsOf(orbitId, [s]).map((i) => ({ ...i, name: uniqueInputName(used, i.name), origin: s.origin, ref: s.ref, why: s.origin === "mission" ? "a source of the mission" : "a source your lead shared with you" })));
    const handoffs = data.handoffs.flatMap((h): StagedInput[] => {
      const file = (prefix: string, name: string) => uniqueInputName(used, `${prefix}-${h.unitKey}-${name}`);
      if (h.origin === "supervision") return h.artifacts.map((a) => ({ name: file("unit", a.name), storePath: `artifact:${orbitId}/${a.sha256}`, origin: "supervision", ref: null, why: `what "${h.unitKey}" handed in (revision ${h.revision}) for your review` }));
      const why = `"${h.unitKey}"'s accepted hand-in (revision ${h.revision}), shared by your lead`;
      const summary: StagedInput = { name: file("from", "summary.md"), storePath: `handoff-summary:${orbitId}/${h.handoffId}`, origin: "share", ref: h.ref, why: `${why}: its summary` };
      if (h.mode === "summary") return [summary];
      return [summary, ...h.artifacts.map((a) => ({ name: file("from", a.name), storePath: `artifact:${orbitId}/${a.sha256}`, origin: "share" as const, ref: h.ref, why }))];
    });
    return [...sources, ...handoffs];
  }

  // What the sandbox provider asks for an input's bytes: a research revision's text or file, a hand-in's artifact or a
  // hand-in's summary -- of that account only (AttemptInputs holds each to the attempt's grant first).
  async read(storePath: string): Promise<Buffer> {
    const sum = /^handoff-summary:([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(storePath);
    if (sum !== null) {
      const h = await this.db.one("SELECT revision, summary FROM workforce.handoffs WHERE account_id = $1 AND id = $2", [sum[1], sum[2]]);
      if (h === null) throw new Error("the hand-in is not there");
      return Buffer.from(`# Hand-in summary (revision ${Number(h.revision)})\n\n${String(h.summary)}\n`, "utf8");
    }
    const art = /^artifact:([0-9a-f-]{36})\/([0-9a-f]{64})$/.exec(storePath);
    if (art !== null) {
      const bytes = this.artifacts.read(art[1] as string, art[2] as string);
      if (bytes === null) throw new Error("the artifact is missing or does not match its hash");
      return bytes;
    }
    const m = /^research-(text|object):([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(storePath);
    if (m === null || !UUID.test(m[2] as string) || !UUID.test(m[3] as string)) throw new Error("not an input of a research mission");
    const [, kind, orbitId, revisionId] = m as unknown as [string, "text" | "object", string, string];
    const r = await this.db.one("SELECT workspace_id, content_hash FROM research.research_source_revisions WHERE account_id = $1 AND id = $2 AND status = 'indexed'", [orbitId, revisionId]);
    if (r === null) throw new Error("the source revision is not there (or not indexed)");
    if (kind === "object") return this.objects.read(String(r.workspace_id), String(r.content_hash));
    return Buffer.from(await this.textOf(orbitId, revisionId), "utf8");
  }

  // The revision's frozen text, page by page.
  private async textOf(orbitId: string, revisionId: string): Promise<string> {
    const chunks = await this.db.query("SELECT page, text FROM research.research_chunks WHERE account_id = $1 AND revision_id = $2 ORDER BY ordinal", [orbitId, revisionId]);
    let page: number | null = null;
    const out: string[] = [];
    for (const c of chunks) {
      const p = c.page === null ? null : Number(c.page);
      if (p !== null && p !== page) out.push(`\n[page ${p}]\n`);
      page = p;
      out.push(String(c.text));
    }
    return out.join("\n");
  }

  // Each claim held to the pinned research sources the mission was given, distinguishing verbatim mission brief context
  // from external factual claims without awarding either an unearned source-verification badge (`supported: true` is
  // strictly reserved for claims verified verbatim against pinned research sources).
  async verify(orbitId: string, sources: readonly PinnedSource[], claims: readonly ClaimInput[], briefText = ""): Promise<VerifiedClaim[]> {
    const byLabel = new Map(sources.map((s) => [s.label.toUpperCase(), s]));
    const briefNorm = norm(briefText);
    const out: VerifiedClaim[] = [];
    for (const c of claims) {
      const web = c.url === null ? null : { url: c.url, readAt: new Date().toISOString() };
      const rawLabels = [...new Set(c.sources.map((l) => l.trim().toUpperCase()).filter((l) => l.length > 0))];
      const explicitBrief = c.basis === "brief" || rawLabels.includes("BRIEF");
      const labels = rawLabels.filter((l) => l !== "BRIEF");
      const quote = c.quote === null ? "" : norm(c.quote);
      const found: HandoffClaim["sources"] = [];
      for (const label of labels) {
        const s = byLabel.get(label);
        if (s === undefined || quote.length < MIN_QUOTE) continue;
        const passage = await this.find(orbitId, s.revisionId, quote);
        if (passage !== null) found.push({ label, sourceId: s.sourceId, revisionId: s.revisionId, locator: passage.locator, excerpt: passage.excerpt });
      }
      const supported = labels.length > 0 && found.length === labels.length;
      if (supported) {
        out.push({ text: c.text, sources: found, supported: true, basis: "pinned_source", ...(web !== null ? { web } : {}) });
        continue;
      }
      // Check whether the claim or its quote appears verbatim in the mission/assignment brief.
      // Even when verbatim in the brief, `supported` remains false (brief context is not pinned research evidence).
      const briefExcerpt = matchBriefExcerpt(briefNorm, c.text, c.quote, explicitBrief, labels.length === 0 && web === null);
      if (briefExcerpt !== null) {
        out.push({ text: c.text, sources: found, supported: false, basis: "brief", briefExcerpt, ...(web !== null ? { web } : {}) });
        continue;
      }
      if (web !== null) {
        out.push({ text: c.text, sources: found, supported: false, basis: "web", web });
        continue;
      }
      out.push({ text: c.text, sources: found, supported: false, basis: "external" });
    }
    return out;
  }

  // The chunk of a revision whose text holds the quote: its page (or chunk number) and the excerpt.
  private async find(orbitId: string, revisionId: string, quote: string): Promise<{ locator: string; excerpt: string } | null> {
    const chunks = await this.db.query("SELECT ordinal, page, char_start, text FROM research.research_chunks WHERE account_id = $1 AND revision_id = $2 ORDER BY ordinal", [orbitId, revisionId]);
    for (const c of chunks) {
      if (norm(String(c.text)).includes(quote)) return { locator: c.page !== null ? `page ${Number(c.page)}` : `passage ${Number(c.ordinal) + 1}`, excerpt: quote.slice(0, 300) };
    }
    // A quote across two passages.
    const joined = norm(chunks.map((c) => String(c.text)).join(" "));
    return joined.includes(quote) ? { locator: "across passages", excerpt: quote.slice(0, 300) } : null;
  }
}
