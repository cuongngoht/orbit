// What a FINISHED engineering task teaches engineering memory (1.8.9), read off the task's own view -- handed in, with
// the checks the checkout declares, by the composition root that saw it finish (cli/autonomous-engineering.mjs,
// cli/automation.mjs), so nothing under src/engineering/ imports a task, an orchestrator or a journal.
//
// The view is evidence the engine derived, never a host's word: the files the change touched (read back from the
// workspace by `record-changes`), and each declared check whose verification row is SATISFIED by a check receipt that
// SUCCEEDED. A check that failed as it did before the change is settled but never a pass, and an action that was only
// reported has no receipt, so neither reaches here. Only a task that COMPLETED on its own proof is observed at all: a
// change nobody verified teaches nothing, whatever it touched.
//
// What comes out goes through the observer's one untrusted door (src/engineering/observe/index.mjs `observed`) like a
// session's: judged, reconciled, `observed` at most, one task being one session. Its operation is `task:<id>`, so a
// second finish of the same task -- a replay, a coordinator finishing after its child -- adds nothing.
import { scopesOf } from "../working-set/fold.mjs";
import { observed } from "./index.mjs";

// A declared check's purpose, as the working set's class of command (src/engineering/working-set/collect.mjs CHECKS).
export const CHECK_CLASS = { build: "build", test: "test", verify: "lint" };

// Where the change was: the directory of each changed file (the working set's own scopes), and a file at the root
// as itself, so a change to a top-level file is still a place a fact can cite.
const placesOf = (paths) => [...new Set([...scopesOf(paths), ...paths.filter((p) => !p.includes("/"))])];

const changedScopes = (view) => placesOf((view?.changes?.paths ?? []).map((p) => p.path));

// Whether a finished task is observed, and why. Ordered; the first that matches decides, and the last always does.
export const TASK_INPUT = [
  { when: (v) => v?.lifecycle !== "COMPLETED", observes: false, say: (v) => `the task ${String(v?.lifecycle ?? "did not finish").toLowerCase()}: a change nobody verified teaches nothing` },
  { when: (v) => changedScopes(v).length === 0, observes: false, say: () => "the change touched no directory a fact could cite" },
  { when: () => true, observes: true, say: () => "a completed task: where it changed, and which declared checks passed after its last change" },
];

export const taskInputOf = (view) => ((row) => ({ observes: row.observes, say: row.say(view) }))(TASK_INPUT.find((r) => r.when(view)));

// -> null when nothing is observed; else the observer's input. `declared`: [{ id, purpose, component, declaredAs }].
export function taskObservation(view, declared = []) {
  if (!taskInputOf(view).observes) return null;
  const scopes = changedScopes(view);
  const checks = passed(view, declared);
  return { operation: `task:${view.task.id}`, scopes, verifiedScopes: scopes, commands: checks.map((c) => ({ class: CHECK_CLASS[c.purpose] ?? "other", ok: true })), verified: checks };
}

// The whole lesson of one finished task, as the receipt to link on it: OBSERVED with what the observer proposed, kept
// and refused, or NOTHING with why. `ctx` is an engineering context with its `gates` (bound by cli/), `declared` the
// checkout's declared checks. The session it counts as is the task's host on the day it ended: two tasks on one
// host and one day are one session, so a day of tasks never makes a fact certain on its own.
export function learnedFrom(ctx, view, declared) {
  const input = taskInputOf(view);
  if (!input.observes) return receiptOf(view, "NOTHING", input.say);
  const observation = taskObservation(view, declared);
  const result = observed(ctx, { ...observation, gates: ctx.gates() }, { host: ctx.eng.host, at: view.task.updatedAt ?? ctx.now() }, { operation: observation.operation, milestone: "TASK_COMPLETED" });
  return receiptOf(view, "OBSERVED", countsOf(result));
}

const receiptOf = (view, outcome, summary) => ({ domain: "learning", ref: `task:${view.task.id}`, outcome, summary: String(summary).slice(0, 240) });

const countsOf = (r) => `${r.candidates.length} candidate(s), ${r.decisions.length} kept (observed at most), ${r.candidates.length - r.decisions.length} refused${r.unknowns.length ? `, ${r.unknowns.length} thing(s) it could not tell` : ""}`;

// The declared checks whose verification is satisfied by a check receipt that succeeded.
function passed(view, declared) {
  const ok = new Set((view.receipts ?? []).filter((r) => r.domain === "check" && r.outcome === "succeeded").map((r) => `check:${r.ref}`));
  const subjects = new Set((view.verification ?? []).filter((v) => v.state === "satisfied" && ok.has(v.evidence)).map((v) => v.subject));
  return declared.filter((c) => subjects.has(c.id)).map(({ id, purpose, component, declaredAs }) => ({ id, purpose, component, declaredAs }));
}
