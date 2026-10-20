// A charter-driven exploration SESSION as one page: what was on the surface,
// what happened on every layer when each control was touched, what contradicted
// itself, and -- the half this page exists for -- every question a browser could
// not answer. That last list is what a person still owes the feature.
//
// It is built from the observations a session wrote as it went, one JSON object
// per line, and not from the ledger: an exploration is NOT a run. It earns no
// verdict and never decides PASS. The cases it leaves behind are judged by
// run-case like every other case, and their verdicts are quoted here, not made.
import { publish } from "./publish-page.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYERS } from "../dsl/verbs.mjs";
import { render } from "./template.mjs";

const TONE = { PASS: "pass", SKIP: "flat", PARTIAL: "warn", FAIL: "fail", REFUSED: "warn", BLOCKED: "warn", INCONCLUSIVE: "warn" };

// The record kinds a session writes, declared once. The page is built by asking
// for each of them, so a kind nothing asks for cannot quietly rot on disk.
export const KINDS = ["charter", "control", "action", "finding", "question", "case"];

// Every reason a person still has to look, as a TABLE. The next reason is a row,
// never a branch -- and nothing here may invent one the session did not observe.
const CHECKS = [
  { kind: "open question",
    rows: (m) => m.questions.map((q) => ({ about: q.about, say: q.ask })) },
  { kind: "contradiction to reproduce",
    rows: (m) => m.findings.map((f) => ({ about: f.on, say: `${f.why} — reproduce it by hand before calling it a product bug` })) },
  { kind: "commits, but called nothing",
    rows: (m) => m.actions.filter((a) => a.quiet).map((a) => ({ about: a.on, say: "it commits and asked the server for nothing — reload before believing anything was saved" })) },
  { kind: "never touched",
    rows: (m) => untouched(m).map((c) => ({ about: c.on, say: "it was on the surface and this session never exercised it" })) },
  { kind: "case not kept",
    rows: (m) => m.cases.filter((c) => !c.kept).map((c) => ({ about: c.id, say: `${c.status} — it is in no screen folder; read the run before trusting anything it claimed` })) },
  { kind: "nothing below the screen",
    rows: (m) => (m.charter.write ? [] : [{ about: m.charter.screen, say: "the session never submitted, so no call and no row was witnessed — only the screen" }]) },
];

export function exploreModel(records, opts = {}) {
  const seen = (kind) => records.filter((r) => r.kind === kind);
  const base = { charter: charterOf(records), controls: seen("control").map(controlRow), actions: seen("action").map(actionRow),
    findings: seen("finding").map(findingRow), questions: seen("question").map(questionRow), cases: seen("case").map(caseRow) };
  const m = { ...base, controls: base.controls.map((c) => ({ ...c, untouched: !base.actions.some((a) => a.on === c.on) })) };
  const manual = CHECKS.flatMap((c) => c.rows(m).map((r) => ({ kind: c.kind, ...r })));
  return { ...m, ...opts, n: m.controls.length, manual, ...calloutOf(m, manual) };
}

// A page with no charter is a file somebody pointed at by mistake: every section
// would render empty and read as "nothing to report", which is a lie.
export const hasCharter = (records) => records.some((r) => r.kind === "charter");
const charterOf = (records) => records.find((r) => r.kind === "charter") ?? {};

const controlRow = (c) => ({ on: c.on ?? "", role: c.role ?? "", opens: c.opens ?? "", to: c.to ?? "", selector: c.selector ?? "" });
const findingRow = (f) => ({ on: f.on ?? "", why: f.why ?? "", evidence: f.evidence ?? "" });
const questionRow = (q) => ({ about: q.about ?? "", ask: q.ask ?? "" });
const untouched = (m) => m.controls.filter((c) => c.untouched);

// What one action did, laid out on every layer the VERB TABLE knows about. The
// layers come from `proves`, so the day a verb rules on a fourth one this page
// grows a row instead of silently dropping what the session saw there.
const actionRow = (a) => ({ on: a.on ?? "", why: a.why ?? "", commits: Boolean(a.commits), layers: LAYERS.map((id) => layerRow(a.saw ?? {}, id)), quiet: quiet(a), broke: broke(a) });

// "not watched" and "watched, and nothing happened there" are different facts,
// and a layer that renders as a blank line lets a reader take either for the
// other -- or for a broken page. So each says which it is, in words.
const layerRow = (saw, id) => ({ id, calls: callsOf(saw[id]), text: textOf(saw[id]), none: saw[id] === undefined, silent: silent(saw[id]) });
const silent = (v) => v !== undefined && (Array.isArray(v) ? v.length === 0 : !v);
const callsOf = (v) => (Array.isArray(v) ? v.map(callRow) : []);
const textOf = (v) => (Array.isArray(v) ? "" : String(v ?? ""));
const callRow = (c) => ({ method: c.method ?? "", url: c.url ?? "", status: c.status ?? 0, tone: ok(c) ? "pass" : "fail" });
const ok = (c) => c.status >= 200 && c.status < 300;

// A control that COMMITS asked the server for nothing. An optimistic render
// looks exactly like a saved record until somebody reloads, and a dead button
// looks like a working one until somebody checks -- this is both.
//
// Which controls commit is NOT inferred from a label here. The map's own word
// list is a guess that prints as advice, and a guess is not allowed to raise a
// contradiction; the session that clicked the control knew what it was, and
// says so. Nothing marked `commits` means nothing here fires, which is correct:
// a session that did not record what it was doing has not found anything.
const quiet = (a) => Boolean(a.commits) && Array.isArray(a.saw?.api) && a.saw.api.length === 0;

// The screen said yes and a call said no. This is the one contradiction a page
// can be sure of while knowing nothing whatever about the product.
const broke = (a) => callsOf(a.saw?.api).some((c) => c.tone === "fail");

const caseRow = (c) => ({ id: c.id ?? "", status: c.status ?? "?", tone: TONE[c.status] ?? "warn", proved: provedOf(c.proved ?? {}), kept: c.status === "PASS" });
const provedOf = (proved) => LAYERS.map((id) => ({ id, n: proved[id] ?? 0 })).filter((p) => p.n);

// The conclusion in one line, because a reader who opens the file and reads one
// sentence must come away with the right answer. "12 controls" is not it while
// nine of them were never touched and two cases did not survive their own run.
function calloutOf(m, manual) {
  const kept = m.cases.filter((c) => c.kept).length;
  const tone = m.findings.length ? "danger" : manual.length ? "" : "ok";
  return { callout: `${m.controls.length} control(s) · ${m.actions.length} acted on · ${m.findings.length} contradiction(s) · ${kept}/${m.cases.length} case(s) kept · ${manual.length} item(s) still need a person`, calloutClass: tone };
}

// One JSON object per line, the way the run log and the map candidates are
// written. A line lost to a session interrupted mid-write costs that line, not
// the whole page.
export const readObservations = (text) => text.trim().split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map(parsed).filter(Boolean);
const parsed = (line) => { try { return JSON.parse(line); } catch { return null; } };

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), "utf8");

export const exploreHtml = (records, opts = {}) => render(read("explore.html"), { ...exploreModel(records, opts), style: read("report.css") });

export function writeExplore(file, records, opts = {}) {
  publish(file, exploreHtml(records, opts));
  return file;
}
