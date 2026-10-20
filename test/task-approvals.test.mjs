// An approval is one person's yes or no to ONE action of ONE task: decided once, spent once,
// only on the action it names, and never on a task that moved under the person deciding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "../src/errors.mjs";
import { STALE_REVISION } from "../src/store/revisioned.mjs";
import { fingerprintOf } from "../src/task/approvals.mjs";
import { JOURNAL } from "../src/task/store.mjs";
import { ASK, MIGRATION, pbi482, taskWorld } from "./task.harness.mjs";

const refusedWith = (code) => (e) => e instanceof Refused && e.code === code;
const refusedAs = (id) => (e) => e instanceof Refused && e.message.startsWith(`${id}:`);

// A task waiting on apr-1, and the revision a person reads it at.
function waiting(t) {
  const w = taskWorld(t);
  const id = pbi482(w);
  w.op(id, "request-approval", ASK);
  return { w, id, rev: w.view(id).revision };
}

test("a request waits for a person, and the task says so: WAITING_APPROVAL, for the reason derived from it", (t) => {
  const { w, id } = waiting(t);
  const view = w.view(id);
  assert.deepEqual([view.lifecycle, view.stopReason, view.stage], ["WAITING_APPROVAL", "HUMAN_APPROVAL_REQUIRED", "REGRESSION"]);
  assert.deepEqual(view.approvals.map((a) => [a.id, a.action, a.environment, a.state, a.open, a.attempt]), [["apr-1", "database.migrate", "dev", "pending", true, "att-3"]]);
  assert.deepEqual([view.attempt.number, view.attempt.limit], [3, 8]);
});

test("Approve once grants exactly one start of exactly that action: a second start is refused, and nothing else was granted", (t) => {
  const { w, id, rev } = waiting(t);
  w.op(id, "approve", { approval: "apr-1", human: true, expected: rev });
  assert.equal(w.view(id).approvals[0].state, "granted");
  const started = w.op(id, "act-start", { ...MIGRATION, approval: "apr-1", mutates: true });
  assert.deepEqual(started.kinds, ["approval-consumed", "action-started"], "spent BEFORE the action it allows");
  assert.throws(() => w.op(id, "act-start", { ...MIGRATION, approval: "apr-1" }), refusedWith("APPROVAL_NOT_GRANTED"));
  assert.deepEqual([w.view(id).approvals[0].state, w.view(id).approvals[0].consumedBy], ["consumed", "act-6"]);
  assert.equal(w.kinds(id).filter((k) => k === "approval-granted").length, 1);
});

test("a decided approval is decided once: a second approve, an approve after a reject, and spending a rejected one are all refused", (t) => {
  const { w, id, rev } = waiting(t);
  w.op(id, "approve", { approval: "apr-1", human: true, expected: rev });
  assert.throws(() => w.op(id, "approve", { approval: "apr-1", human: true, expected: rev + 1 }), refusedWith("APPROVAL_DECIDED"), "a double click grants nothing extra");
  const other = waiting(t);
  other.w.op(other.id, "reject", { approval: "apr-1", human: true, expected: other.rev, reason: "not in the DEV window" });
  assert.throws(() => other.w.op(other.id, "approve", { approval: "apr-1", human: true, expected: other.rev + 1 }), refusedWith("APPROVAL_DECIDED"));
  assert.throws(() => other.w.op(other.id, "act-start", { ...MIGRATION, approval: "apr-1" }), refusedWith("APPROVAL_NOT_GRANTED"));
  assert.deepEqual(other.w.view(other.id).approvals.map((a) => [a.state, a.decision]), [["rejected", "rejected"]], "a rejection stays in the history");
});

test("a person's decision on a task that MATERIALLY moved is refused as stale, and writes nothing", (t) => {
  const { w, id, rev } = waiting(t);
  w.op(id, "act-complete", { action: "act-5", outcome: "succeeded" });
  w.op(id, "attempt-complete", { outcome: "succeeded" });
  const before = w.text(id);
  assert.throws(() => w.op(id, "approve", { approval: "apr-1", human: true, expected: rev }), (e) => refusedWith(STALE_REVISION)(e) && /attempt-completed/.test(e.message));
  assert.equal(w.text(id), before, "a refusal wrote nothing");
  assert.throws(() => w.op(id, "approve", { approval: "apr-1", human: true, expected: rev + 99 }), refusedWith(STALE_REVISION), "a revision from the future is refused too");
});

test("evidence accruing is not a move: a decision, a changed file, a receipt or a finished action after the read leave the decision standing", (t) => {
  const { w, id, rev } = waiting(t);
  w.op(id, "decide", { observed: "regression is half way", hypothesis: "it will pass", nextAction: "wait-for-regression" });
  w.op(id, "link-file", { path: "docs/notes.md", change: "added", added: 3 });
  w.op(id, "link-receipt", { domain: "run", ref: "run-17", outcome: "PASS" });
  w.op(id, "act-complete", { action: "act-5", outcome: "succeeded" });
  assert.deepEqual(w.op(id, "approve", { approval: "apr-1", human: true, expected: rev }).kinds, ["approval-granted"]);
});

test("an approval is bound to its fingerprint: another environment, tool, type or parameter is another action -- key order is not", (t) => {
  const { w, id, rev } = waiting(t);
  w.op(id, "approve", { approval: "apr-1", human: true, expected: rev });
  const variants = [{ ...MIGRATION, environment: "test" }, { ...MIGRATION, tool: "migrator" }, { ...MIGRATION, type: "database.seed" }, { ...MIGRATION, params: { schema: 83 } }];
  for (const v of variants) assert.throws(() => w.op(id, "act-start", { ...v, approval: "apr-1" }), refusedWith("FINGERPRINT_MISMATCH"), JSON.stringify(v));
  assert.equal(fingerprintOf({ ...MIGRATION, params: { b: 1, a: 2 } }), fingerprintOf({ ...MIGRATION, params: { a: 2, b: 1 } }));
  assert.equal(w.view(id).approvals[0].state, "granted", "a refused start spent nothing");
});

test("the parameters an approval is bound to are hashed and never kept", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  const migration = { ...MIGRATION, params: { schema: 82, target: "refunds-db-77" } };
  w.op(id, "request-approval", { ...ASK, ...migration });
  w.op(id, "approve", { approval: "apr-1", human: true, expected: w.view(id).revision });
  w.op(id, "act-start", { ...migration, approval: "apr-1" });
  assert.doesNotMatch(w.text(id), /refunds-db-77|"params"/);
  assert.equal(w.view(id).approvals[0].state, "consumed");
});

test("an approval past its expiry is refused without a word written; `approval expire` records it once", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  w.op(id, "request-approval", { ...ASK, expires: "2026-10-06T22:00:00.000Z" });
  const rev = w.view(id).revision;
  w.tick(120);
  const before = w.text(id);
  assert.throws(() => w.op(id, "approve", { approval: "apr-1", human: true, expected: rev }), refusedWith("APPROVAL_EXPIRED"));
  assert.equal(w.text(id), before);
  assert.equal(w.view(id).lifecycle, "VERIFYING", "a lapsed request is no longer a wait");
  assert.deepEqual(w.op(id, "approval-expire", { approval: "apr-1" }).kinds, ["approval-expired"]);
  assert.throws(() => w.op(id, "approval-expire", { approval: "apr-1" }), refusedAs("NOT_OPEN"));
});

test("one open request per exact action, and an unknown approval is named as unknown", (t) => {
  const { w, id, rev } = waiting(t);
  assert.throws(() => w.op(id, "request-approval", ASK), refusedAs("ALREADY_ASKED"));
  assert.deepEqual(w.op(id, "request-approval", { ...ASK, environment: "test" }).kinds, ["approval-requested"], "another environment is another action");
  assert.throws(() => w.op(id, "approve", { approval: "apr-9", human: true, expected: rev + 1 }), refusedWith("APPROVAL_UNKNOWN"));
});

test("a process killed between spending an approval and starting the action leaves it spent, never spendable again", (t) => {
  const { w, id, rev } = waiting(t);
  w.op(id, "approve", { approval: "apr-1", human: true, expected: rev });
  const file = join(w.tasks.dirOf(id), JOURNAL);
  appendFileSync(file, `${JSON.stringify({ at: w.now(), id: "apr-1", action: "act-6", fingerprint: fingerprintOf(MIGRATION), kind: "approval-consumed" })}\n{"at":"${w.now()}","id":"act-6","atte`);
  const view = w.view(id);
  assert.deepEqual([view.approvals[0].state, view.actions.some((a) => a.id === "act-6")], ["consumed", false], "read back: spent, and no action");
  assert.throws(() => w.op(id, "act-start", { ...MIGRATION, approval: "apr-1" }), refusedWith("APPROVAL_NOT_GRANTED"));
});

test("an ended task decides nothing more, and an approval it left open is no longer anybody's to answer", (t) => {
  const { w, id, rev } = waiting(t);
  w.op(id, "cancel", { human: true, expected: rev, because: "the migration window closed" });
  const view = w.view(id);
  assert.deepEqual([view.lifecycle, view.stopReason, view.approvals[0].open], ["CANCELLED", "CANCELLED_BY_HUMAN", false]);
  assert.throws(() => w.op(id, "approve", { approval: "apr-1", human: true, expected: rev + 1 }), refusedWith("TASK_ENDED"));
});
