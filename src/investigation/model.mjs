// An investigation, as a FOLD over its journal -- rebuilt on every read, stored
// nowhere, so a report, the CLI and Orbit Control cannot tell three stories.
//
// Findings are the one place a fold has to choose: a finding re-derived after a
// reproduction is a NEW record naming the one it `supersedes`. `findings` is the
// current view; `history` keeps every record, the superseded ones included --
// which is how an original failure survives a later attempt that passed.
//
// Which findings are CURRENT is the latest `analysis`'s to say: the keys the
// evidence supported when it last ran, each read as its latest record. A key no
// analysis derives any more (a rule was corrected, a key gained its identity)
// stops being current and stays in the history. A journal written before
// analysis has been recorded shows every unsuperseded record.
//
// `position` is the journal's length: what a decision names as the state it was
// taken against (`expectedRevision`), so a decision taken against a journal
// that has moved since is refused rather than acted on. `lifecycle` is derived:
// cancelled, else what the latest finish or resume says, else active.
//
// A generated test's lifecycle (0.1.0, ADR 0032) is folded from its own kinds. A record
// carrying an `eventId` is folded ONCE however many times it was appended -- a replayed
// write is the same event, never a second milestone -- and every revision and attempt is
// kept: `testsOf` is obligation → its revisions → designs → frozen versions → every
// execution attempt → what each was evaluated as.
//
// A journal of any schema but this engine's is refused -- an older one too -- and kept
// exactly as it is, rather than read with the records it does not know silently dropped.
import { Refused } from "../errors.mjs";
import { JOURNAL_SCHEMA } from "./vocab.mjs";

const of = (records, kind) => records.filter((r) => r.kind === kind);

export function modelOf(journal) {
  const records = deduped(journal);
  const meta = readable(of(records, "created")[0] ?? null);
  const findings = of(records, "finding");
  return { ...evidenceOf(records, meta, findings), ...loopOf(journal, records), ...lifecycleKinds(records) };
}

// Each eventId once, at its first appearance; a record with no eventId is always its own.
export function deduped(records) {
  const seen = new Set();
  return records.filter((r) => !r?.eventId || (!seen.has(r.eventId) && seen.add(r.eventId)));
}

function readable(meta) {
  if (meta && meta.schema !== JOURNAL_SCHEMA) throw new Refused(`investigation ${meta.id} keeps journal schema ${meta.schema ?? "none"}, and this engine reads only schema ${JOURNAL_SCHEMA} — it is kept exactly as it is, never migrated; start a new investigation to look again`);
  return meta;
}

// `position` counts the journal's LINES, replays included: a decision names the journal it read, not the fold.
function loopOf(journal, records) {
  const loop = { position: journal.length, decisions: of(records, "decision"), settled: of(records, "settled"), questions: of(records, "question"), answers: of(records, "answer"), resumed: of(records, "resumed"), completed: of(records, "completed"), receipts: of(records, "receipt"), checkpoints: of(records, "checkpoint") };
  return { ...loop, lifecycle: lifecycleOf(records) };
}

// The latest finish or resume decides, and a cancel outranks both.
function lifecycleOf(records) {
  if (of(records, "cancelled").length) return "cancelled";
  const last = records.filter((r) => r.kind === "completed" || r.kind === "resumed").at(-1);
  return last?.kind === "completed" ? last.lifecycle : "active";
}

function evidenceOf(records, meta, findings) {
  const analyses = of(records, "analysis");
  return {
    meta,
    inputs: of(records, "input"),
    plan: of(records, "plan").at(-1) ?? null,
    actions: of(records, "action"),
    observations: of(records, "observation"),
    checks: of(records, "check"),
    security: of(records, "security"),
    findings: currentOf(findings, analyses.at(-1)),
    history: findings,
    analyses,
    reproductions: of(records, "reproduction"),
    runs: of(records, "run"),
    drafts: of(records, "draft"),
    cancelled: of(records, "cancelled").at(-1) ?? null,
  };
}

// The generated-test kinds, each under the name a fold reads it by.
const LIFECYCLE_KINDS = { bindings: "binding", discoveries: "discovery", obligations: "obligation", designs: "designed", versions: "version", validations: "validated", authorizations: "authorized", preparations: "prepared", starts: "started", captures: "observed", evaluations: "evaluated", assessments: "assessed", publications: "published", cleanups: "cleanup", applicabilities: "applicability" };

const lifecycleKinds = (records) => Object.fromEntries(Object.entries(LIFECYCLE_KINDS).map(([name, kind]) => [name, of(records, kind)]));

function currentOf(findings, latest) {
  if (!latest) return unsuperseded(findings);
  const keys = new Set(latest.keys ?? []);
  return [...new Map(findings.map((f) => [f.key, f])).values()].filter((f) => keys.has(f.key));
}

function unsuperseded(findings) {
  const superseded = new Set(findings.map((f) => f.supersedes).filter(Boolean));
  return findings.filter((f) => !superseded.has(f.id));
}

// The next id of a kind: a prefix and a count. It holds only because every
// append that hands out an id reads the journal and writes it under the
// investigation's journal lock (src/investigation/act.mjs withJournal) -- a
// count read outside the lock is how two checks both became chk-1.
const PREFIX = { action: "act", observation: "obs", check: "chk", security: "sec", finding: "fnd", reproduction: "rep", run: "run", draft: "drf", analysis: "anl", input: "inp", settled: "stl", question: "qst", answer: "ans", resumed: "res", completed: "cmp", receipt: "rct", checkpoint: "ckp", binding: "bnl", discovery: "dsc", obligation: "obr", designed: "dsg", version: "ver", validated: "val", authorized: "aut", prepared: "prp", started: "str", observed: "obv", evaluated: "evl", assessed: "asd", published: "pub", cleanup: "cln", applicability: "apl" };
const COUNTED = { action: "actions", observation: "observations", check: "checks", security: "security", finding: "history", reproduction: "reproductions", run: "runs", draft: "drafts", analysis: "analyses", input: "inputs", settled: "settled", question: "questions", answer: "answers", resumed: "resumed", completed: "completed", receipt: "receipts", checkpoint: "checkpoints", ...Object.fromEntries(Object.entries(LIFECYCLE_KINDS).map(([name, kind]) => [kind, name])) };

export const nextId = (model, kind) => `${PREFIX[kind]}-${model[COUNTED[kind]].length + 1}`;

export const observationsOf = (model, actionId) => model.observations.filter((o) => o.action === actionId);
export const layerOf = (model, actionId, layer) => observationsOf(model, actionId).find((o) => o.layer === layer) ?? null;
export const checksOf = (model, actionId) => model.checks.filter((c) => c.action === actionId);
export const actionOf = (model, id) => model.actions.find((a) => a.id === id) ?? null;

// The actions that REACHED an action: back to the navigation that began its
// chain. Reproducing a finding replays exactly this, nothing guessed.
export function chainOf(model, actionId) {
  const upto = model.actions.slice(0, model.actions.findIndex((a) => a.id === actionId) + 1);
  const start = upto.map((a) => a.do).lastIndexOf("goto");
  return upto.slice(Math.max(start, 0)).filter((a) => a.state === "done");
}

// The snapshot the engine stored at the highest journal position -- a settled
// step, a checkpoint or a finish. What a report and a list read instead of
// deriving the loop's state again, which needs a world neither of them has.
export const latestSnapshot = (model) => [...model.settled, ...model.checkpoints, ...model.completed].map((r) => r.snapshot).filter(Boolean).sort((a, b) => b.position - a.position)[0] ?? null;

// ---- a generated test, as one tree --------------------------------------------------------------

// Every test obligation the journal knows, each with every revision it went through (the current
// one last), the designs made for it, their frozen versions and every execution attempt of each.
export const testsOf = (model) => [...new Set(model.obligations.map((o) => o.obligation))].map((id) => testOf(model, id));

function testOf(model, id) {
  const revisions = model.obligations.filter((o) => o.obligation === id);
  return { obligation: id, current: revisions.at(-1), revisions, designs: designsFor(model, id), evaluations: model.evaluations.filter((e) => e.obligation === id) };
}

const designsFor = (model, obligation) => model.designs.filter((d) => d.obligation === obligation).map((d) => ({ ...d, versions: versionsFor(model, d.design) }));

const versionsFor = (model, design) => model.versions.filter((v) => v.design === design).map((v) => ({ ...v, validations: byVersion(model.validations, v.version), authorizations: byVersion(model.authorizations, v.version), executions: executionsFor(model, v.version) }));

const byVersion = (records, version) => records.filter((r) => r.version === version);

const executionsFor = (model, version) => byVersion(model.starts, version).map((s) => ({ ...s, runs: byExecution(model.runs, s.execution), observed: byExecution(model.captures, s.execution), evaluations: byExecution(model.evaluations, s.execution), cleanups: byExecution(model.cleanups, s.execution) }));

const byExecution = (records, execution) => records.filter((r) => r.execution === execution);

// Where ONE result came from, link by link: the requirement refs its bindings name → the bindings →
// the obligation revision → the frozen version → the run → its evidence → the result → the report
// whose assessment counted it. A link the journal does not hold is null -- never guessed.
export function lineageOf(model, resultId) {
  const result = model.evaluations.findLast((e) => e.result === resultId) ?? null;
  const start = model.starts.findLast((s) => s.execution === result?.execution) ?? null;
  const version = model.versions.findLast((v) => v.version === start?.version) ?? null;
  const obligation = obligationBehind(model, version, result);
  return { ...upstream(model, obligation), obligation, version, run: model.runs.findLast((r) => r.execution === result?.execution) ?? null, ...downstream(model, result) };
}

function obligationBehind(model, version, result) {
  const design = model.designs.findLast((d) => d.design === version?.design) ?? null;
  return model.obligations.findLast((o) => o.obligation === (design?.obligation ?? result?.obligation)) ?? null;
}

function upstream(model, obligation) {
  const bindings = model.bindings.filter((b) => (obligation?.bindings ?? []).includes(b.binding));
  return { requirement: [...new Set(bindings.map((b) => b.ref).filter(Boolean))], bindings };
}

function downstream(model, result) {
  const run = model.runs.findLast((r) => r.execution === result?.execution) ?? null;
  const assessed = model.assessments.findLast((a) => (a.results ?? []).includes(result?.result)) ?? null;
  return { evidence: run?.evidence ?? null, result, report: model.publications.findLast((p) => p.assessment === assessed?.assessment) ?? null };
}
