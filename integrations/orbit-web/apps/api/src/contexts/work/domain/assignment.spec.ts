import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "../../shared/domain.js";
import { Assignment, type Pinned } from "./assignment.js";

const AT = "2026-11-21T12:00:00.000Z";
const pinned: Pinned = { profileRevision: 1, departmentId: null, departmentName: null, execution: { runtime: "claude", connectionId: null, model: "sonnet", effort: "medium", webSearch: false, orbitPlugin: false } };

const fresh = (): Assignment =>
  Assignment.queued({
    id: "a1",
    orbitId: "o1",
    missionId: "m1",
    parentId: null,
    unitKey: "root",
    employeeId: "e1",
    brief: { goal: "Write the report", deliverables: [{ name: "report.md", required: true } as never], acceptanceCriteria: ["Has totals"], revisions: [], answers: [] },
    execution: null,
    priority: 5,
    eligibleAt: AT,
    deadline: null,
    createdBy: "owner",
    createdAt: AT,
  });

const refusedWith = (code: string) => (err: unknown) => err instanceof DomainError && err.code === code;

test("a claim holds the employee and moves the fence; a run of that fence starts it", () => {
  const a = fresh();
  assert.equal(a.state, "QUEUED");
  a.claim(pinned, AT);
  assert.equal(a.state, "ASSIGNED");
  assert.equal(a.data.fence, 1);
  assert.ok(a.holding);
  assert.throws(() => a.runStarted(0, AT), refusedWith("stale_fence"));
  a.runStarted(1, AT);
  assert.equal(a.state, "RUNNING");
  assert.deepEqual(a.pullEvents().map((e) => e.type), ["AssignmentQueued", "AssignmentClaimed", "RunStarted"]);
});

test("a handoff of the current attempt waits for review; one of a replaced attempt is refused", () => {
  const a = fresh();
  a.claim(pinned, AT);
  a.runStarted(1, AT);
  assert.throws(() => a.handoffSubmitted(1, "d1", 0, AT), refusedWith("stale_fence"));
  assert.throws(() => a.handoffSubmitted(2, "d1", 1, AT), refusedWith("handoff_revision"));
  a.handoffSubmitted(1, "d1", 1, AT);
  assert.equal(a.state, "AWAITING_ACCEPTANCE");
});

test("a revision keeps the employee, records what to change, and starts a new attempt under a new fence", () => {
  const a = fresh();
  a.claim(pinned, AT);
  a.runStarted(1, AT);
  a.handoffSubmitted(1, "d1", 1, AT);
  const fence = a.requestRevision("Add the VAT column", "owner", AT);
  assert.equal(fence, 2);
  assert.equal(a.state, "ASSIGNED");
  assert.equal(a.data.employeeId, "e1");
  assert.equal(a.data.reworkCount, 1);
  assert.deepEqual(a.data.brief.revisions.map((r) => r.criteria), ["Add the VAT column"]);
  assert.ok(a.holding);
});

test("an acceptance completes it once and releases the employee; nothing else can be accepted", () => {
  const a = fresh();
  assert.throws(() => a.accept(1, "owner", AT), refusedWith("invalid_transition"));
  a.claim(pinned, AT);
  a.runStarted(1, AT);
  a.handoffSubmitted(1, "d1", 1, AT);
  assert.throws(() => a.accept(0, "owner", AT), refusedWith("stale_handoff"));
  a.pullEvents();
  a.accept(1, "owner", AT);
  assert.equal(a.state, "COMPLETED");
  assert.equal(a.holding, false);
  assert.deepEqual(a.pullEvents().map((e) => e.type), ["AssignmentAccepted", "ReservationReleased"]);
  assert.throws(() => a.accept(1, "owner", AT), refusedWith("invalid_transition"));
});

test("cancelling a running assignment waits for its run to stop; a queued one ends at once", () => {
  const running = fresh();
  running.claim(pinned, AT);
  running.runStarted(1, AT);
  running.cancel(true, "no longer needed", AT);
  assert.equal(running.state, "CANCELLING");
  assert.ok(running.holding);
  running.cancelled(AT);
  assert.equal(running.state, "CANCELLED");
  const queued = fresh();
  queued.cancel(false, "", AT);
  assert.equal(queued.state, "CANCELLED");
  assert.equal(queued.pullEvents().some((e) => e.type === "ReservationReleased"), false);
});

test("a question blocks it on information; the answer is added to the brief and a new attempt runs", () => {
  const a = fresh();
  a.claim(pinned, AT);
  a.runStarted(1, AT);
  a.block("Which quarter?", "information", AT);
  assert.equal(a.state, "BLOCKED");
  const fence = a.unblock(AT, { question: "Which quarter?", answer: "Q3" });
  assert.equal(fence, 2);
  assert.deepEqual(a.data.brief.answers.map((x) => x.answer), ["Q3"]);
});

test("pausing moves the fence (the running attempt's result is refused); resuming starts a new attempt", () => {
  const a = fresh();
  a.claim(pinned, AT);
  a.runStarted(1, AT);
  a.pause("lunch", AT);
  assert.equal(a.state, "PAUSED");
  assert.throws(() => a.handoffSubmitted(1, "d", 1, AT), refusedWith("invalid_transition"));
  assert.equal(a.resume(AT), 3);
  assert.equal(a.state, "ASSIGNED");
});
