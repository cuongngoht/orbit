// A review that finds the change outside its plan's scope, and what a host may do next -- through the REAL task write
// door. Two honest answers, never a silent one: the path is drift (diagnose `fix`, take it out), or the PLAN was too
// narrow (the change needs the path -- a regression test it adds, a file the fix must touch). For the second, a plan is
// sent again while the task diagnoses, naming every path the change needs; the earlier plan stays in the journal, the
// review then holds the change to the new one, and a `retest` verifies the same change under it. And a host that cannot
// go on ends the task with a stop the journal supports -- told which ones it supports -- and leaves nothing running: a
// change nobody will read back now, and the attempt it was made in, are closed as abandoned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, FIELD_SAYS } from "../src/orchestration/dispatch.mjs";
import { contextOf, finish, protocolOf, reconcile, step } from "../src/orchestration/loop.mjs";
import { BUILD, TEST, decided, orchestrationWorld, prepared } from "./fakes/orchestration.mjs";

const NARROW = { kind: "plan", intent: "reject a refund whose amount exceeds what was paid", scope: ["src/RefundValidator.cs"] };

const WHOLE = { kind: "plan", intent: "reject a refund whose amount exceeds what was paid, with its regression test", scope: ["src/RefundValidator.cs", "test/RefundTests.cs"] };

// The change the narrow plan did not name all of: the fix, and the regression test the fix needs.
async function changedBeyond(o, go) {
  await go({ kind: "implement" });
  o.ws.edit("src/RefundValidator.cs");
  o.ws.edit("test/RefundTests.cs");
  return go({ kind: "record-changes" });
}

// Planned too narrowly, changed, built and tested -- then reviewed: the review finds the test outside the plan.
async function reviewedOutside(o) {
  const at = await prepared(o);
  await at.go(NARROW);
  await changedBeyond(o, at.go);
  await at.go({ kind: "check", command: BUILD });
  await at.go({ kind: "check", command: TEST });
  return { ...at, review: await at.go({ kind: "review" }) };
}

test("the protocol and a refusal say what each field is -- a plan's scope is every path the change will touch, the tests it adds included", async (t) => {
  const fields = [...new Set(Object.values(ACTIONS).flatMap((a) => a.fields))].sort();
  assert.deepEqual(Object.keys(FIELD_SAYS).sort(), fields, "one sentence per field an action takes, and none for a field nothing takes");
  const plan = protocolOf().actions.find((a) => a.kind === "plan");
  assert.match(plan.says.scope, /every repository-relative path the change will touch.*the tests it adds included/);
  const o = orchestrationWorld(t);
  const { id } = await prepared(o);
  await assert.rejects(step(o.ports, id, decided(o.ports, id, { kind: "plan" })), /FIELDS_OF_ACTION: a plan step takes intent, scope, and needs intent, scope — intent: the smallest intended change, one sentence; scope: every repository-relative path the change will touch/);
});

test("a review that finds a path outside the plan says so, and the task diagnoses it with a plan among what it may do", async (t) => {
  const o = orchestrationWorld(t);
  const { id, review } = await reviewedOutside(o);
  assert.deepEqual([review.outcome, review.stage, review.failure.class], ["failed", "DIAGNOSING", "SCOPE"]);
  assert.match(review.summary, /1 outside the plan's scope \(test\/RefundTests\.cs\)/);
  assert.match(review.failure.because, /plan again naming every path the change needs/, "the failure names both honest answers");
  assert.match(review.failure.because, /diagnose fix/);
  assert.ok(contextOf(o.ports, id).allowed.includes("plan"), "DIAGNOSING allows a plan");
});

test("a plan too narrow for the change is planned again while diagnosing: the earlier plan kept, the same change retested and reviewed under the new one, and the task completed", async (t) => {
  const o = orchestrationWorld(t);
  const { id, go } = await reviewedOutside(o);
  const replanned = await go(WHOLE, { observed: "the review found the regression test outside the plan's scope", hypothesis: "the plan left out the test the change needs" });
  assert.deepEqual([replanned.outcome, replanned.stage], ["succeeded", "DIAGNOSING"], "a plan moves no stage: the diagnosis decides");
  await go({ kind: "diagnose", then: "retest" }, { observed: "the plan now names the test", hypothesis: "the same change holds under the plan it needs" });
  await go({ kind: "check", command: BUILD });
  assert.equal((await go({ kind: "check", command: TEST })).stage, "REVIEWING");
  const reviewed = await go({ kind: "review" });
  assert.deepEqual([reviewed.outcome, reviewed.lifecycle], ["succeeded", "COMPLETED"]);
  const view = o.w.view(id);
  const plans = view.actions.filter((a) => a.type === "plan");
  assert.deepEqual(plans.map((p) => o.roomOf(id).read(`plans/${p.id}`).scope), [NARROW.scope, WHOLE.scope], "the earlier plan stays in the journal, and its scope in the task's room");
  assert.deepEqual(view.attempts.map((a) => [a.cause, a.outcome]), [["fresh", "failed"], ["retest", "succeeded"]]);
  assert.ok(view.receipts.filter((r) => r.domain === "impact").length >= 3, "each plan and the change published what they reach");
});

test("a plan sent while diagnosing may only name paths inside the repository, as any plan", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await reviewedOutside(o);
  const before = o.w.text(id);
  await assert.rejects(step(o.ports, id, decided(o.ports, id, { ...WHOLE, scope: ["../elsewhere"] })), /ACTION_CHECK: scope paths stay inside the repository/);
  assert.equal(o.w.text(id), before, "nothing written");
});

// A fix that changes nothing: diagnosed `fix`, a change opened, and nothing to record.
async function stuckInFixing(o) {
  const at = await reviewedOutside(o);
  await at.go({ kind: "diagnose", then: "fix" });
  await at.go({ kind: "implement" });
  const recorded = await at.go({ kind: "record-changes" });
  assert.deepEqual([recorded.outcome, recorded.stage], ["failed", "FIXING"]);
  return at;
}

test("a change opened with nothing to record is told how to go on, and how to end the task when there is nothing to change", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await stuckInFixing(o);
  const c = contextOf(o.ports, id);
  assert.deepEqual(c.allowed, ["record-changes", "gather-context"]);
  assert.match(c.next, /^next: nothing changed since the last recorded change: make the change in the workspace, then record-changes; with nothing to change, end the task with a stop the journal supports \(finish --stop=UNSAFE_CHANGE --because="…"\)/);
  assert.match(await finish(o.ports, id).catch((e) => e.message), /NOT_COMPLETE: .* — keep going, or end it with a stop the journal supports: finish --stop=<UNSAFE_CHANGE>/);
});

test("a stop that is no stop, or one the journal does not support, is refused naming the stops it does support", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await stuckInFixing(o);
  await assert.rejects(finish(o.ports, id, { stop: "SCOPE" }), /STOP: SCOPE is not a stop a host may name — the journal supports UNSAFE_CHANGE now \(a review that found the change outside its plan's scope\)/);
  await assert.rejects(finish(o.ports, id, { stop: "EXECUTION_FAILED" }), /STOP: EXECUTION_FAILED needs an action that could not be carried out, and the journal does not show it — it supports UNSAFE_CHANGE now/);
  assert.equal(o.w.view(id).lifecycle, "EXECUTING", "nothing written");
});

test("a host that cannot go on ends the task with a stop the journal supports, and nothing it left open stays running", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await stuckInFixing(o);
  const out = await finish(o.ports, id, { stop: "UNSAFE_CHANGE", because: "the plan's scope left out the regression test the change needs" });
  const view = o.w.view(id);
  assert.deepEqual([out.state, view.lifecycle, view.stopReason], ["failed", "FAILED", "UNSAFE_CHANGE"]);
  assert.deepEqual(view.actions.filter((a) => a.state === "running"), [], "no action is left running on an ended task");
  const implement = view.actions.filter((a) => a.type === "implement").at(-1);
  assert.deepEqual([implement.state, implement.summary], ["abandoned", "the task ended before the change was read back"]);
  assert.deepEqual(view.attempts.map((a) => [a.cause, a.outcome]), [["fresh", "failed"], ["fix", "abandoned"]], "the attempt it was made in ended abandoned");
  assert.equal(view.attempt.open, false);
  await assert.rejects(reconcile(o.ports, id), /NOTHING_OPEN/, "and nothing is left for reconcile");
});

test("a stop the engine writes itself leaves nothing running either: a spent budget with a change still open", async (t) => {
  const o = orchestrationWorld(t);
  const { id, go } = await prepared(o, { ref: "PBI-482", actions: 6 });
  await go(NARROW);
  assert.equal((await go({ kind: "implement" })).outcome, "open");
  const out = await go({ kind: "record-changes" });
  const view = o.w.view(id);
  assert.deepEqual([out.state, view.lifecycle, view.stopReason], ["stopped", "FAILED", "BUDGET_EXHAUSTED"]);
  assert.deepEqual(view.actions.map((a) => a.state).filter((s) => s === "running"), []);
  assert.deepEqual(view.attempts.map((a) => a.outcome), ["abandoned"]);
});

test("reconcile says how a change still being made is settled, and how a task that cannot go on is ended", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await stuckInFixing(o);
  await assert.rejects(reconcile(o.ports, id), /NOTHING_OPEN: no action of this task is waiting to be settled — act-\d+ implement is a change being made: record-changes reads it back, or finish --stop=<UNSAFE_CHANGE> ends the task with it abandoned/);
});
