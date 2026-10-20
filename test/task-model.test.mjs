// Where a task stands is DERIVED from its journal, by one fold and one state function --
// every row of every table reachable, in the order the tables say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_STATES, LIFECYCLE, TERMINAL, approvalState, modelOf, nextId, repeatsOf, stateOf } from "../src/task/model.mjs";
import { TASK_SCHEMA } from "../src/task/vocab.mjs";

const NOW = "2026-10-06T21:11:00.000Z";

let minute = 3;
const at = () => `2026-10-06T21:${String(minute++).padStart(2, "0")}:00.000Z`;

// A journal as the store writes it, minute by minute.
function journal(...lines) {
  minute = 3;
  return [{ kind: "created", id: "tsk-0123456789ab", project: "repo-a", checkout: "c".repeat(64), objective: "PBI-482 Refund validation", budget: { attempts: 8, actions: 100 }, schema: TASK_SCHEMA }, ...lines].map((l) => ({ at: at(), ...l }));
}

const stateAt = (records, now = NOW) => stateOf(modelOf(records), now);
const lifecycle = (...lines) => stateAt(journal(...lines)).lifecycle;

const ASK = { kind: "approval-requested", id: "apr-1", action: "database.migrate", fingerprint: "f".repeat(16), environment: "dev", reason: "needs schema v82", risk: "DEV data changes" };

test("the lifecycle table is ten rows in a fixed order, and three of them are endings", () => {
  assert.deepEqual(LIFECYCLE.map((r) => r.state), ["CANCELLED", "COMPLETED", "FAILED", "PAUSED", "WAITING_APPROVAL", "BLOCKED", "QUEUED", "PREPARING", "VERIFYING", "EXECUTING"]);
  assert.deepEqual(TERMINAL, ["CANCELLED", "COMPLETED", "FAILED"]);
  assert.deepEqual(APPROVAL_STATES.map((r) => r.state), ["consumed", "rejected", "expired", "granted", "pending"]);
});

test("every lifecycle row is reachable from a journal, and nothing but a journal decides it", () => {
  assert.equal(lifecycle(), "QUEUED");
  assert.equal(lifecycle({ kind: "stage", stage: "CONTEXT" }), "PREPARING");
  assert.equal(lifecycle({ kind: "stage", stage: "IMPLEMENTING" }), "EXECUTING");
  assert.equal(lifecycle({ kind: "attempt-started", id: "att-1", cause: "fresh" }), "EXECUTING", "an attempt with no stage is execution");
  assert.equal(lifecycle({ kind: "stage", stage: "TESTING" }), "VERIFYING");
  assert.equal(lifecycle({ kind: "stage", stage: "REGRESSION" }), "VERIFYING");
  assert.equal(lifecycle({ kind: "stage", stage: "TESTING" }, { kind: "blocked", stop: "ENVIRONMENT_BLOCKED", needs: "environment" }), "BLOCKED");
  assert.equal(lifecycle({ kind: "stage", stage: "TESTING" }, ASK), "WAITING_APPROVAL");
  assert.equal(lifecycle({ kind: "paused", by: "person" }), "PAUSED");
  assert.equal(lifecycle({ kind: "failed", stop: "NO_PROGRESS" }), "FAILED");
  assert.equal(lifecycle({ kind: "completed", summary: "done" }), "COMPLETED");
  assert.equal(lifecycle({ kind: "cancelled", by: "person" }), "CANCELLED");
});

test("the order decides overlaps: an ending outranks everything, a pause outranks a wait, a wait outranks a block", () => {
  const blockedAndWaiting = [{ kind: "blocked", stop: "ENVIRONMENT_BLOCKED", needs: "environment" }, ASK];
  assert.equal(lifecycle(...blockedAndWaiting), "WAITING_APPROVAL");
  assert.equal(lifecycle(...blockedAndWaiting, { kind: "paused", by: "person" }), "PAUSED");
  assert.equal(lifecycle(...blockedAndWaiting, { kind: "paused", by: "person" }, { kind: "cancelled", by: "person" }), "CANCELLED");
});

test("a resume ends a pause and an unblock ends a block -- the latest word stands", () => {
  assert.equal(lifecycle({ kind: "stage", stage: "BUILDING" }, { kind: "paused", by: "person" }, { kind: "resumed", by: "person" }), "EXECUTING");
  assert.equal(lifecycle({ kind: "stage", stage: "BUILDING" }, { kind: "blocked", stop: "ENVIRONMENT_BLOCKED", needs: "environment" }, { kind: "unblocked" }), "EXECUTING");
});

test("attempts are first-class: the current one, what each did, how each ended, and why the next began", () => {
  const records = journal(
    { kind: "attempt-started", id: "att-1", cause: "fresh" },
    { kind: "action-started", id: "act-1", attempt: "att-1", type: "build" },
    { kind: "action-completed", id: "act-1", outcome: "succeeded" },
    { kind: "file-changed", attempt: "att-1", path: "src/RefundService.cs", change: "modified", added: 12, removed: 3 },
    { kind: "attempt-completed", id: "att-1", outcome: "failed", failureSignature: "a1a1a1a1a1a1" },
    { kind: "attempt-started", id: "att-2", cause: "fix" },
    { kind: "attempt-completed", id: "att-2", outcome: "failed", failureSignature: "a1a1a1a1a1a1" },
    { kind: "attempt-started", id: "att-3", cause: "retest" },
  );
  const model = modelOf(records);
  assert.deepEqual(model.attempts.map((a) => [a.id, a.cause, a.completed?.outcome ?? null]), [["att-1", "fresh", "failed"], ["att-2", "fix", "failed"], ["att-3", "retest", null]]);
  assert.equal(model.current.id, "att-3");
  assert.deepEqual([model.attempts[0].actions, model.attempts[0].files.map((f) => f.path)], [["act-1"], ["src/RefundService.cs"]]);
  const state = stateOf(model, NOW);
  assert.deepEqual([state.attempt, state.attempts, state.repeats], ["att-3", 3, 2]);
});

test("repeats count back from the last attempt that ended, on its failure signature -- data, never a conclusion", () => {
  const ended = (sig) => ({ completed: { failureSignature: sig } });
  assert.equal(repeatsOf([]), 0);
  assert.equal(repeatsOf([ended("aaa"), ended("bbb"), ended("bbb"), ended("bbb")]), 3);
  assert.equal(repeatsOf([ended("aaa"), ended(null)]), 0, "an attempt with no signature breaks the run");
  assert.equal(repeatsOf([ended("aaa"), ended("aaa"), { completed: null }]), 2, "the open attempt is not counted");
});

test("an approval's state is read against the clock: requested, granted, consumed, rejected -- and lapsed without any line saying so", () => {
  const records = (...after) => journal({ ...ASK, expires: "2026-10-06T22:00:00.000Z" }, ...after);
  const stateOfAsk = (r, now = NOW) => approvalState(modelOf(r).approvals.get("apr-1"), now);
  assert.equal(stateOfAsk(records()), "pending");
  assert.equal(stateOfAsk(records(), "2026-10-06T22:00:00.000Z"), "expired");
  assert.equal(stateAt(records(), "2026-10-06T23:00:00.000Z").lifecycle, "QUEUED", "a lapsed request is not a wait");
  assert.equal(stateOfAsk(records({ kind: "approval-granted", id: "apr-1", by: "person", seen: 2 })), "granted");
  assert.equal(stateOfAsk(records({ kind: "approval-granted", id: "apr-1", by: "person", seen: 2 }, { kind: "approval-consumed", id: "apr-1", action: "act-1" })), "consumed");
  assert.equal(stateOfAsk(records({ kind: "approval-rejected", id: "apr-1", by: "person", seen: 2 })), "rejected");
  assert.equal(stateOfAsk(records({ kind: "approval-rejected", id: "apr-1", by: "person" }, { kind: "approval-granted", id: "apr-1", by: "person" })), "rejected", "the first decision stands");
  assert.equal(stateOfAsk(records({ kind: "approval-expired", id: "apr-1" })), "expired");
});

test("the stop reason says why a task is not going on, and the two a person causes are derived, never written", () => {
  assert.equal(stateAt(journal({ kind: "cancelled", by: "person" })).stop, "CANCELLED_BY_HUMAN");
  assert.equal(stateAt(journal({ kind: "failed", stop: "BUDGET_EXHAUSTED" })).stop, "BUDGET_EXHAUSTED");
  assert.equal(stateAt(journal({ kind: "blocked", stop: "REQUIREMENT_BLOCKED", needs: "requirement" })).stop, "REQUIREMENT_BLOCKED");
  assert.equal(stateAt(journal(ASK)).stop, "HUMAN_APPROVAL_REQUIRED");
  assert.equal(stateAt(journal({ kind: "completed" })).stop, null);
  assert.equal(stateAt(journal({ kind: "stage", stage: "TESTING" })).stop, null);
});

test("an ended task has no open approval, and what it spent is measured to its end", () => {
  const records = journal(ASK, { kind: "attempt-started", id: "att-1" }, { kind: "action-started", id: "act-1", attempt: "att-1", type: "build" }, { kind: "cancelled", by: "person" });
  const state = stateAt(records, "2026-10-07T09:00:00.000Z");
  assert.deepEqual(state.open, []);
  assert.deepEqual(state.spent, { attempts: 1, actions: 1, minutes: 4 });
  assert.equal(state.ended, true);
});

test("counted ids follow the lines of their kind, and the position is how many lines there are", () => {
  const model = modelOf(journal({ kind: "attempt-started", id: "att-1" }, { kind: "decision", id: "dec-1", observed: "o", hypothesis: "h", nextAction: "n" }));
  assert.deepEqual([nextId(model, "attempt-started"), nextId(model, "decision"), nextId(model, "action-started"), nextId(model, "approval-requested")], ["att-2", "dec-2", "act-1", "apr-1"]);
  assert.equal(model.position, 3);
});
