// What a SECURITY ASSESSMENT may conclude about each control, and what it may never say (ADR 0040;
// doc §7).
//
// An assessment is a SNAPSHOT: it pins the catalogs it was taken against (id, version, digest), the
// scope it covered (the graph's digest), and for every control in effect, whether it applies here
// and what its evidence came to. The evidence is the results QA's verification already reached --
// read, never re-judged -- each one a verification outcome (src/investigation/verification.mjs) for
// one CONTROL ROLE of one control: the positive (the allowed actor can), the negative (the refused
// actor cannot), the state (nothing else changed).
//
// The conclusions are an ORDERED TABLE (PAIRING), the last row always matching:
//
//   not-applicable · applicability-unknown   from applicability, never guessed
//   not-tested        a control only design or process evidence can settle
//   finding           a negative or state control saw what the property forbids -- an access or a
//                     field it must not reach -- CONFIRMED only when every condition of FINDING
//                     holds, else SUSPECTED, with what is missing
//   inconclusive      the positive control did not pass, so a refusal proves nothing; or the
//                     evidence could not decide
//   verified          every piece of minimum evidence satisfied, on fresh, accepted oracles
//   pending           what it still owes
//
// A finding carries its impact, preconditions, confidence, reproducibility and scope -- never a
// number for its severity, which is a person's call. And no conclusion here is a certification: an
// assessment is evidence about the controls in its scope, nothing more.
import { canonicalJson, sha } from "../../hash.mjs";
import { shapeOf } from "../obligations/shapes.mjs";
import { APPLICABLE, NOT_APPLICABLE, applicabilityOf } from "./applicability.mjs";
import { markOf } from "./catalog.mjs";

export const ASSESSMENT_KIND = "orbit.security-assessment/v1";

export const OBLIGATION_STATES = [
  { id: "generated", doc: "derived from an applicable control; nothing executable exists for it yet" },
  { id: "executable", doc: "a test version exists for it, held to the grammar and to its design" },
  { id: "executed", doc: "a run of it was recorded" },
  { id: "verified", doc: "every piece of minimum evidence it names was satisfied, on a fresh, accepted oracle" },
];

export const OBLIGATION_STATE_IDS = OBLIGATION_STATES.map((s) => s.id);

export const STATEMENT = "Evidence about the controls in this scope, each with what its evidence came to; never a certification of the system.";

const SATISFIED = "SATISFIED";
const CONTRADICTED = "CONTRADICTED";

// ── what one control is owed ───────────────────────────────────────────────

const runtimeOf = (control) => (control.methods ?? []).includes("runtime-test") && (control.shapes ?? []).length > 0;

function obligationOf(entry, control, shape) {
  const row = shapeOf(shape);
  const body = { catalog: entry.catalog, digest: entry.digest, control: control.id, shape, boundary: row.boundary, controls: control.minimumEvidence?.length ? [...control.minimumEvidence] : [...row.controls], templates: [...row.templates], method: "runtime-test", statement: control.summary, labels: [...(control.labels ?? [])] };
  return { id: `tob-${sha(canonicalJson(body)).slice(0, 16)}`, ...body };
}

// The SECURITY OBLIGATIONS an applicable control is owed: one per obligation shape it names, each
// with the controls a verdict needs and the templates its assertions compile from.
export const obligationsOf = (entry, control) => (runtimeOf(control) ? control.shapes.map((shape) => obligationOf(entry, control, shape)) : []);

// ── the evidence, read ─────────────────────────────────────────────────────

const forControl = (results, entry, control) => (Array.isArray(results) ? results : []).filter((r) => r?.catalog === entry.catalog && r?.control === control.id);
// Evidence COUNTS only when it was read back from its owner's record (`source: "owner"`, set by the
// composition root that read it -- never by the result): a result somebody reported is shown and
// never proof, so it can make nothing verified and no finding confirmed.
const counted = (r) => r.source === "owner" && r.outcome === SATISFIED && r.fresh === true && r.authority === "accepted";
const satisfied = (k, role) => k.results.some((r) => r.role === role && counted(r));
const notPositive = (r) => r.role !== "positive";

const leaked = (k) => k.results.filter((r) => notPositive(r) && r.outcome === CONTRADICTED && r.leak);
const contradicted = (k) => k.results.filter((r) => notPositive(r) && r.outcome === CONTRADICTED);
const positiveBroken = (k) => k.needs.includes("positive") && k.results.some((r) => r.role === "positive" && r.outcome === CONTRADICTED);
const undecided = (k) => k.results.filter((r) => r.outcome && ![SATISFIED, CONTRADICTED].includes(r.outcome));
const owed = (k) => k.needs.filter((role) => !satisfied(k, role));

// What a finding must stand on before it is CONFIRMED (doc §7). One that misses any is SUSPECTED,
// and says which -- never dropped, never promoted.
export const FINDING = [
  { id: "ORACLE", holds: (k, r) => r.fresh === true && r.authority === "accepted", needs: "an oracle at the revision it was bound to, from an accepted source" },
  { id: "TARGET", holds: (k, r) => typeof r.target === "string" && r.target.length > 0, needs: "a clear target: the graph node the test acted on" },
  { id: "TEST", holds: (k, r) => r.testValid === true, needs: "a valid test: its case and its compiled predicates held to the grammar and to its design" },
  { id: "IDENTITY", holds: (k, r) => r.identityValid === true, needs: "a valid identity: an approved synthetic principal whose claims were checked" },
  { id: "FIXTURE", holds: (k, r) => r.fixtureValid === true, needs: "a valid fixture: the run's own records, in its own namespace" },
  { id: "OBSERVED", holds: (k, r) => r.outcome === CONTRADICTED, needs: "an observation contrary to the property" },
  { id: "CONTROLS", holds: (k) => !k.needs.includes("positive") || satisfied(k, "positive"), needs: "the positive control passing beside it" },
  { id: "READ_BACK", holds: (k, r) => typeof r.readBack === "string" && r.readBack.length > 0, needs: "an independent read-back receipt" },
  { id: "OWNER", holds: (k, r) => r.source === "owner", needs: "evidence read back from its owner's record — a reported result is never proof" },
];

const IMPACT = {
  access: "an actor reached a resource its permission does not allow",
  field: "an answer carried a field its caller is not allowed to see",
};

function findingOf(k, r) {
  const failed = FINDING.filter((c) => !c.holds(k, r));
  const body = { catalog: k.entry.catalog, digest: k.entry.digest, control: k.control.id, labels: [...(k.control.labels ?? [])], role: r.role, leak: r.leak ?? null, status: failed.length ? "suspected" : "confirmed", impact: IMPACT[r.leak?.kind] ?? "a control saw what the property forbids", preconditions: { identity: r.identity ?? null, fixture: r.fixture ?? null }, confidence: failed.length ? "low" : "high", reproducibility: r.reproducibility ?? "unknown", scope: { target: r.target ?? null, boundary: k.obligations[0]?.boundary ?? null }, evidenceRefs: [...(r.evidenceRefs ?? [])], needs: failed.map((c) => c.needs) };
  return { conclusion: "finding", why: `${body.status}: ${body.impact}`, finding: { id: `fnd-${sha(canonicalJson(body)).slice(0, 16)}`, ...body } };
}

// ── the table ──────────────────────────────────────────────────────────────

export const PAIRING = [
  { id: "NOT_APPLICABLE", when: (k) => k.applicability.state === NOT_APPLICABLE, as: (k) => ({ conclusion: "not-applicable", why: k.applicability.why }) },
  { id: "APPLICABILITY_UNKNOWN", when: (k) => k.applicability.state !== APPLICABLE, as: (k) => ({ conclusion: "applicability-unknown", why: k.applicability.why, gap: k.applicability.settles }) },
  { id: "NOT_RUNTIME", when: (k) => !runtimeOf(k.control), as: (k) => ({ conclusion: "not-tested", why: k.control.unsupported ?? "it is settled by design or process evidence, which a person provides", gap: "design or process evidence" }) },
  { id: "LEAKED", when: (k) => leaked(k).length > 0, as: (k) => findingOf(k, leaked(k)[0]) },
  { id: "POSITIVE_BROKEN", when: (k) => positiveBroken(k), as: () => ({ conclusion: "inconclusive", why: "the positive control did not pass: the allowed actor could not do what the contract lets it, so every refusal beside it proves nothing until it does" }) },
  { id: "CONTRADICTED", when: (k) => contradicted(k).length > 0, as: (k) => findingOf(k, contradicted(k)[0]) },
  { id: "UNDECIDED", when: (k) => undecided(k).length > 0, as: (k) => ({ conclusion: "inconclusive", why: `the ${undecided(k)[0].role} control came to ${undecided(k)[0].outcome}` }) },
  { id: "VERIFIED", when: (k) => owed(k).length === 0, as: () => ({ conclusion: "verified", why: "every piece of minimum evidence was satisfied on a fresh, accepted oracle — within this scope" }) },
  { id: "PENDING", when: () => true, as: (k) => ({ conclusion: "pending", why: `still owes the ${owed(k).join(", ")} control${owed(k).length > 1 ? "s" : ""}`, gap: `${owed(k).join(", ")} evidence on a fresh, accepted oracle` }) },
];

function analysisOf(entry, control, graph, settings, results) {
  const obligations = obligationsOf(entry, control);
  const needs = control.minimumEvidence?.length ? control.minimumEvidence : [...new Set(obligations.flatMap((o) => o.controls))];
  return { entry, control, obligations, needs, applicability: applicabilityOf(control, graph, markOf(settings, entry.catalog, control.id)), results: forControl(results, entry, control) };
}

const STATE_OF = [
  { state: "verified", when: (k, said) => said.conclusion === "verified" },
  { state: "executed", when: (k) => k.results.some((r) => r.outcome) },
  { state: "executable", when: (k) => k.results.some((r) => r.executable === true) },
  { state: "generated", when: () => true },
];

const stateOf = (k, said) => (k.obligations.length ? STATE_OF.find((s) => s.when(k, said)).state : null);

function controlRow(entry, control, graph, settings, results) {
  const k = analysisOf(entry, control, graph, settings, results);
  const row = PAIRING.find((p) => p.when(k));
  const said = row.as(k);
  return { catalog: entry.catalog, control: control.id, group: control.group ?? null, level: control.level ?? null, labels: [...(control.labels ?? [])], applicability: k.applicability, conclusion: said.conclusion, why: said.why, rule: row.id, obligations: k.obligations.map((o) => o.id), obligationState: stateOf(k, said), ...(said.finding ? { finding: said.finding } : {}), ...(said.gap ? { gap: said.gap } : {}) };
}

// ── the snapshot ───────────────────────────────────────────────────────────

const pinOf = (c) => ({ catalog: c.catalog, version: c.version, digest: c.digest, ...(c.filter ? { filter: c.filter } : {}) });

const countsOf = (rows) => rows.reduce((n, r) => ({ ...n, [r.conclusion]: (n[r.conclusion] ?? 0) + 1 }), {});

const gapsOf = (rows) => rows.filter((r) => r.gap).map((r) => ({ catalog: r.catalog, control: r.control, conclusion: r.conclusion, gap: r.gap }));

// `effective` is effectiveCatalogs(); `graph` the System Graph (or null); `settings` the project's
// marks; `results` QA's verification, per control role; `scopeDigest` what the graph was.
export function assessmentOf({ effective, graph = null, settings = {}, results = [], scopeDigest = null }) {
  const rows = effective.catalogs.flatMap((entry) => entry.controls.map((control) => controlRow(entry, control, graph, settings, results)));
  const body = { kind: ASSESSMENT_KIND, catalogs: effective.catalogs.map(pinOf), by: effective.by, scopeDigest, controls: rows, findings: rows.filter((r) => r.finding).map((r) => r.finding), gaps: gapsOf(rows), missing: [...(effective.missing ?? [])], counts: countsOf(rows), statement: STATEMENT };
  return { id: `asm-${sha(canonicalJson(body)).slice(0, 16)}`, ...body };
}

// Every security obligation the catalogs in effect owe this system: what QA designs tests from.
export function obligationsInEffect({ effective, graph = null, settings = {} }) {
  return effective.catalogs.flatMap((entry) => entry.controls.filter((c) => applicabilityOf(c, graph, markOf(settings, entry.catalog, c.id)).state === APPLICABLE).flatMap((c) => obligationsOf(entry, c)));
}

// ── whether a snapshot still stands ────────────────────────────────────────

function movedFrom(pins, effective) {
  const now = new Map(effective.catalogs.map((c) => [c.catalog, c.digest]));
  const gone = pins.filter((p) => now.get(p.catalog) !== p.digest).map((p) => `${p.catalog} ${p.version} (${p.digest.slice(0, 12)}) is no longer the catalog in effect`);
  return [...gone, ...effective.catalogs.filter((c) => !pins.some((p) => p.catalog === c.catalog)).map((c) => `${c.catalog} is in effect and was not assessed`)];
}

// STALE when a catalog it pinned is no longer the one in effect, one in effect was not assessed, or
// the graph it covered moved. An old snapshot keeps its pins: what it said stays what it said.
export function assessmentFreshness(snapshot, effective, scopeDigest = null) {
  const why = [...movedFrom(snapshot.catalogs ?? [], effective), ...(snapshot.scopeDigest !== scopeDigest ? ["the System Graph it covered has moved"] : [])];
  return { state: why.length ? "stale" : "current", why };
}

// An obligation derived from a catalog digest that is no longer in effect is STALE.
export const obligationFreshness = (obligation, effective) => (effective.catalogs.some((c) => c.catalog === obligation.catalog && c.digest === obligation.digest) ? "current" : "stale");
