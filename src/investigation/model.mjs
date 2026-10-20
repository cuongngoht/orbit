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
// A journal written by a NEWER engine is refused rather than read with the
// records this one does not know silently dropped.
import { Refused } from "../errors.mjs";
import { JOURNAL_SCHEMA } from "./vocab.mjs";

const of = (records, kind) => records.filter((r) => r.kind === kind);

export function modelOf(records) {
  const meta = readable(of(records, "created")[0] ?? null);
  const findings = of(records, "finding");
  return { ...evidenceOf(records, meta, findings), ...loopOf(records) };
}

function readable(meta) {
  if (meta && meta.schema !== JOURNAL_SCHEMA) throw new Refused(`investigation ${meta.id} was written by a newer engine (journal schema ${meta.schema}; this one reads up to ${JOURNAL_SCHEMA}) — upgrade the plugin to read it`);
  return meta;
}

function loopOf(records) {
  const loop = { position: records.length, decisions: of(records, "decision"), settled: of(records, "settled"), questions: of(records, "question"), answers: of(records, "answer"), resumed: of(records, "resumed"), completed: of(records, "completed"), receipts: of(records, "receipt"), checkpoints: of(records, "checkpoint") };
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
const PREFIX = { action: "act", observation: "obs", check: "chk", security: "sec", finding: "fnd", reproduction: "rep", run: "run", draft: "drf", analysis: "anl", input: "inp", settled: "stl", question: "qst", answer: "ans", resumed: "res", completed: "cmp", receipt: "rct", checkpoint: "ckp" };
const COUNTED = { action: "actions", observation: "observations", check: "checks", security: "security", finding: "history", reproduction: "reproductions", run: "runs", draft: "drafts", analysis: "analyses", input: "inputs", settled: "settled", question: "questions", answer: "answers", resumed: "resumed", completed: "completed", receipt: "receipts", checkpoint: "checkpoints" };

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
