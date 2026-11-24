import assert from "node:assert/strict";
import { test } from "node:test";
import { checkExecutiveMission, checkExecutiveReport, checkExecutiveText, checkMissionFields, EXECUTIVE_LIMITS } from "./executive.js";

const ID = "c1000000-0000-4000-8000-000000000001";

test("a CEO Chat message: its text alone, printable, within bounds", () => {
  assert.deepEqual(checkExecutiveText({ text: "  How are we doing?\r\n " }), { ok: true, value: { text: "How are we doing?" } });
  assert.equal(checkExecutiveText({ text: "" }).ok, false);
  assert.equal(checkExecutiveText({ text: "x".repeat(EXECUTIVE_LIMITS.textLength + 1) }).ok, false);
  assert.equal(checkExecutiveText({ text: "a\u0000b" }).ok, false);
  const extra = checkExecutiveText({ text: "hi", role: "ceo" });
  assert.ok(!extra.ok && extra.errors.some((e) => /role is not a field/.test(e)), "a message cannot say who wrote it");
});

test("a report names one of Orbit's records, nothing else", () => {
  assert.deepEqual(checkExecutiveReport({ kind: "status" }), { ok: true, value: { kind: "status" } });
  assert.equal(checkExecutiveReport({ kind: "everything" }).ok, false);
});

test("work for the CEO: a mission's own fields, checked as the mission will be, held to who the owner saw -- never a target, an employee or an execution of its own", () => {
  const mission = { title: "AI market", goal: "Size it.", deliverables: [{ name: "market.md", required: true }], acceptanceCriteria: ["Three segments"], deadline: null, priority: 6 };
  const seen = { employeeId: ID, appointmentId: ID, appointmentRevision: 1 };
  const ok = checkExecutiveMission({ proposalMessageId: ID, mission, expectedAssignee: seen });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { proposalMessageId: ID, mission, expectedAssignee: seen });
  assert.ok(checkExecutiveMission({ mission, expectedAssignee: seen }).ok, "no proposal: the owner's own words");
  for (const sneaky of [{ target: { kind: "employee", employeeId: ID } }, { targetEmployeeId: ID }, { execution: { model: "opus" } }, { whenBusy: "reject" }]) {
    const r = checkExecutiveMission({ proposalMessageId: null, mission: { ...mission, ...sneaky }, expectedAssignee: seen });
    assert.equal(r.ok, false, JSON.stringify(sneaky));
  }
  assert.equal(checkExecutiveMission({ proposalMessageId: null, mission }).ok, false, "who the owner saw is required");
  assert.equal(checkMissionFields({ ...mission, goal: "" }).ok, false);
  assert.deepEqual(checkMissionFields({ goal: "Close the books." }), { ok: true, value: { title: "Close the books.", goal: "Close the books.", deliverables: [], acceptanceCriteria: [], deadline: null, priority: 5 } });
});
