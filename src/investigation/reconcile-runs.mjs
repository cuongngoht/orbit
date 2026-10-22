// RECONCILING a generated test's dispatch that never settled (doc §11; PBI 19): a `started` with no `evaluated` is a
// run whose end nobody recorded -- the host died, the terminal closed, a step was cut off -- and it is READ BACK, never
// sent again. What the dispatch's own room and its worker's receipt show decide, by ordered rows, the first that holds:
//
//   IN_FLIGHT  it was started within its deadline and the time its dispatch is given to end: it may still be running,
//              so nothing is decided yet
//   LATE       the worker left an envelope after all: the host checks it now, held to the very request that was
//              dispatched, exactly as it would have (src/investigation/run-version.mjs lateEvaluated)
//   RUNNING    the worker still runs past every bound: nothing is decided, and nothing new is sent beside it
//   NEVER_RAN  no worker ever ran it (no receipt, never created, never started): an attempt that proved nothing and
//              spent nothing it was granted -- a new attempt may run
//   LOST_READ  the worker is gone and left nothing, and the version could not write: an attempt that proved nothing
//   LOST       the worker is gone and left nothing, and the version had grants to write: what it did is unknown, so it
//              is AMBIGUOUS -- kept for a person, and never resent
//
// A dispatch now KNOWN settles the step that sent it; one that may have written leaves that step unsettled, so the
// investigation stops on it (stop.mjs ambiguous-side-effect) until a person releases it with --human. The dispatch
// port answers what the room holds (`readBack(execution)`: { envelope, records, listed, evidence, worker }); this
// module writes only the lifecycle records the journal already folds.
import { Refused } from "../errors.mjs";
import { current, withJournal } from "./act.mjs";
import { nextId } from "./model.mjs";
import { DISPATCH_SLACK_MS, lateEvaluated } from "./run-version.mjs";
import { unsettled } from "./stop.mjs";
import { eventIdOf } from "./store.mjs";

// A start whose request kept no deadline is given the longest a dispatch may run (src/runtime/sandbox/dispatch.mjs).
const UNKNOWN_DEADLINE_MS = 30 * 60 * 1000;

const NEVER_RAN = ["none", "lost", "unstarted"];

export const RECONCILE = [
  { id: "IN_FLIGHT", when: (x) => x.nowMs < endsBy(x), act: (w, x) => open(x, "IN_FLIGHT", `it was started within its deadline and the time its dispatch is given to end, so it may still be running — reconcile it after ${new Date(endsBy(x)).toISOString()}`) },
  { id: "LATE", when: (x) => Boolean(x.back.envelope), act: (w, x) => late(w, x) },
  { id: "RUNNING", when: (x) => x.back.worker === "running", act: (w, x) => open(x, "RUNNING", "its worker still runs past every bound: nothing is decided and nothing new is sent beside it — the sandbox's supervisor, or a person, stops it") },
  { id: "NEVER_RAN", when: (x) => NEVER_RAN.includes(x.back.worker), act: (w, x) => settled(w, x, "EXECUTION_ERROR", "NEVER_RAN", "no worker ever ran it, so nothing it was granted was spent — an attempt that proved nothing; a new one may run") },
  { id: "LOST_READ", when: (x) => !x.wrote, act: (w, x) => settled(w, x, "EXECUTION_ERROR", "LOST_READ", "its worker is gone and left nothing, and it could not write — an attempt that proved nothing; a new one may run") },
  { id: "LOST", when: () => true, act: (w, x) => settled(w, x, "AMBIGUOUS", "LOST", "its worker is gone and left nothing, and it had grants to write — what it did is unknown: a person reads back and decides, and it is never sent again") },
];

// -> [{ execution, rule, outcome, why, settled? }]: one per dispatch that started and never settled.
export function reconciledRuns(w) {
  if (typeof w.dispatch?.readBack !== "function") throw new Refused("this engine was not given a way to read back a dispatch here — cli/autonomous-qa.mjs binds one");
  return unsettledStarts(current(w)).map((start) => reconciledOne(w, start, w.dispatch.readBack(start.execution)));
}

const unsettledStarts = (model) => model.starts.filter((s) => !model.evaluations.some((e) => e.execution === s.execution));

// Read back OUTSIDE the journal's lock; decided and written inside it, against the journal as it is by then.
const reconciledOne = (w, start, back) => withJournal(w, () => decidedOne(w, start, back));

function decidedOne(w, start, back) {
  const model = current(w);
  if (model.evaluations.some((e) => e.execution === start.execution)) return { execution: start.execution, rule: "SETTLED", outcome: null, why: "it was settled while it was being read back" };
  const x = { start, back, wrote: wroteFor(model, start), request: keptRequest(w, start), nowMs: (w.now ?? w.ctx.now)() };
  return settledStep(w, start, RECONCILE.find((r) => r.when(x)).act(w, x));
}

// The request a start was dispatched with, as it was kept; a start that names none kept none.
const keptRequest = (w, start) => (/^[0-9a-f]{64}$/.test(String(start.request ?? "")) ? w.store.readArtifact(w.id, "dispatches", start.request) : null);

// When a dispatch started at `at` has surely ended, one way or another: its deadline, and the time it is given beyond
// it to make and remove its worker. A start whose time is not known is never taken to have ended.
const endsBy = (x) => ((at) => (Number.isFinite(at) ? at + (Number(x.request?.limits?.deadlineMs) || UNKNOWN_DEADLINE_MS) + DISPATCH_SLACK_MS : Infinity))(Date.parse(x.start.at));

// Whether the attempt had anything to write with: the grants its authorization recorded.
const wroteFor = (model, start) => model.authorizations.some((a) => a.version === start.version && a.attempt === start.attempt && Boolean(a.grant));

const open = (x, rule, why) => ({ execution: x.start.execution, rule, outcome: null, why });

// A late envelope is judged by the very path a live one is, against the request kept for it; with none kept, nothing
// here can hold it to what was dispatched, and it is never taken as it is.
function late(w, x) {
  const judged = x.request ? lateEvaluated(w, x.start, x.back, x.request) : null;
  return judged ? { execution: x.start.execution, rule: "LATE", outcome: judged.outcome, why: judged.why, cause: judged.rule } : settled(w, x, "EXECUTION_ERROR", "LATE_UNJUDGED", "its worker left an envelope, and the request it was dispatched with is not kept — it is never taken as it is");
}

function settled(w, x, outcome, rule, why) {
  w.store.appendOnce(w.id, "evaluated", { id: nextId(current(w), "evaluated"), eventId: eventIdOf("evaluated", x.start.execution, x.start.attempt, rule), attempt: x.start.attempt, execution: x.start.execution, obligation: obligationOf(current(w), x.start), outcome, runner: null, cause: rule });
  return { execution: x.start.execution, rule, outcome, why };
}

// The obligation a start served: the one whose design froze the version it ran.
function obligationOf(model, start) {
  const version = model.versions.find((v) => v.version === start.version);
  return model.designs.find((d) => d.design === version?.design)?.obligation ?? null;
}

// The step that sent a dispatch, settled once the dispatch is KNOWN; AMBIGUOUS, or nothing decided yet, leaves it for
// a person or a later reconcile.
function settledStep(w, start, out) {
  const decision = decisionOf(current(w), start);
  if (!decision || out.outcome === null || out.outcome === "AMBIGUOUS") return out;
  w.store.append(w.id, "settled", { id: nextId(current(w), "settled"), decision: decision.id, state: "reconciled", refs: [], why: `${start.execution}: ${out.rule} — ${out.why}`.slice(0, 300), progress: false });
  return { ...out, settled: decision.id };
}

// The unsettled run-version step that sent a start: the latest one for its version written before the start.
const decisionOf = (model, start) => unsettled(model).filter((d) => d.action?.kind === "run-version" && d.action?.version === start.version).at(-1) ?? null;
