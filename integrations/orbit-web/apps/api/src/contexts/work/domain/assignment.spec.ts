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

test("a lead: delegating ends its attempt (it waits for its team, its tools closed), at most replanLimit plans; woken to review or to answer, then waiting again", () => {
  const a = fresh();
  a.claim(pinned, AT);
  a.runStarted(1, AT);
  assert.equal(a.acting(1), true);
  a.delegated(1, 2, AT);
  assert.equal(a.state, "WAITING_FOR_SUBORDINATES");
  assert.equal(a.acting(1), false, "an attempt that delegated has ended its work");
  const answering = a.answering(AT);
  assert.equal(a.state, "ANSWERING");
  assert.equal(a.acting(answering), true);
  a.waitForTeam(AT);
  a.reviewing(AT);
  a.delegated(a.data.fence, 1, AT);
  a.reviewing(AT);
  a.delegated(a.data.fence, 1, AT);
  assert.equal(a.data.planCount, 3);
  a.reviewing(AT);
  assert.throws(() => a.delegated(a.data.fence, 1, AT), refusedWith("replan_limit"));
});

test("a question blocks the asker (its attempt ends), at most questionLimit of them; the answer resumes it once, to the state it left", () => {
  const a = fresh();
  a.claim(pinned, AT);
  a.runStarted(1, AT);
  a.asked("Global or Southeast Asia?", "lead", 1, AT);
  assert.equal(a.state, "BLOCKED");
  assert.equal(a.acting(1), false);
  assert.throws(() => a.asked("Again?", "lead", 1, AT), refusedWith("stale_fence"));
  const fence = a.unblock(AT, { question: "Global or Southeast Asia?", answer: "Southeast Asia" });
  assert.equal(a.state, "ASSIGNED");
  assert.equal(a.data.brief.answers.length, 1);
  assert.throws(() => a.unblock(AT, null), refusedWith("invalid_transition"), "resumed once");
  a.runStarted(fence, AT);
  a.asked("Q2?", "lead", fence, AT);
  a.unblock(AT, { question: "Q2?", answer: "A2" });
  a.runStarted(a.data.fence, AT);
  a.asked("Q3?", "lead", a.data.fence, AT);
  a.unblock(AT, { question: "Q3?", answer: "A3" });
  a.runStarted(a.data.fence, AT);
  assert.throws(() => a.asked("Q4?", "lead", a.data.fence, AT), refusedWith("question_limit"));
});

test("a pause returns to the state it left: a lead waiting for its team waits again, with nothing to run", () => {
  const a = fresh();
  a.claim(pinned, AT);
  a.runStarted(1, AT);
  a.delegated(1, 1, AT);
  a.pause("a person looks", AT);
  assert.equal(a.state, "PAUSED");
  assert.equal(a.resume(AT), null);
  assert.equal(a.state, "WAITING_FOR_SUBORDINATES");
});

test("rework is bounded: the sixth revision of one hand-in is refused", () => {
  const a = fresh();
  a.claim(pinned, AT);
  for (let i = 1; i <= 5; i += 1) {
    a.runStarted(a.data.fence, AT);
    a.handoffSubmitted(i, `d${i}`, a.data.fence, AT);
    a.requestRevision(`change ${i}`, "owner", AT);
  }
  a.runStarted(a.data.fence, AT);
  a.handoffSubmitted(6, "d6", a.data.fence, AT);
  assert.throws(() => a.requestRevision("again", "owner", AT), refusedWith("rework_limit"));
});
