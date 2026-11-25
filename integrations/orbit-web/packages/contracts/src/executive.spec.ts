import assert from "node:assert/strict";
import { test } from "node:test";
import { checkExecutiveMission, checkExecutiveReport, checkExecutiveText, checkHiringRequest, checkMissionFields, checkStaffingPlan, EXECUTIVE_LIMITS, STAFFING_LIMITS } from "./executive.js";
import { DEFAULT_PRESETS } from "./resources.js";

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

const EXECUTION = { runtime: "claude", connectionId: ID, model: "claude-sonnet-5-5", effort: "medium", webSearch: false, orbitPlugin: false };
const RESOURCES = DEFAULT_PRESETS[0]?.profile;

test("a hiring request: the owner's words, a scope, and what every hire runs on and holds -- the owner's choice, nothing else", () => {
  const ok = checkHiringRequest({ requirement: "  Two analysts for FX.\r\n", departmentId: ID, execution: EXECUTION, resources: RESOURCES });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.ok && ok.value.requirement, "Two analysts for FX.");
  assert.equal(checkHiringRequest({ requirement: "x", departmentId: null, execution: { ...EXECUTION, connectionId: null, inherit: ["connection", "model", "effort"] }, resources: RESOURCES }).ok, true, "the defaults may be asked for");
  for (const bad of [{ requirement: "" }, { requirement: "x".repeat(STAFFING_LIMITS.requirementLength + 1) }, { requirement: "a\u0000b" }, { departmentId: "nope" }, { execution: { runtime: "claude" } }, { resources: { presetId: "x" } }, { hires: 3 }]) {
    const c = checkHiringRequest({ requirement: "Hire.", departmentId: null, execution: EXECUTION, resources: RESOURCES, ...bad });
    assert.equal(c.ok, false, JSON.stringify(bad));
  }
});

test("a staffing plan: a person's own fields alone, each within bounds -- never a model, resources or a permission", () => {
  const hire = { name: "Lan", department: "HR", role: "manager", title: "HR manager", duties: "Hires.", instructions: "Ask first.", skills: ["recruiting"], languages: ["vi"] };
  const ok = checkStaffingPlan({ departments: [{ name: "HR" }], hires: [hire, { name: "Minh", department: "HR", title: "Recruiter" }] });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.deepEqual(ok.ok && ok.value.hires[1], { name: "Minh", department: "HR", role: "member", title: "Recruiter", duties: "", instructions: "", skills: [], languages: [] }, "what is left out is empty, and a member");
  assert.equal(checkStaffingPlan({ hires: [hire] }).ok, true, "departments may be left out");
  for (const field of ["execution", "model", "resources", "canDelegate", "maxAssistants", "skipProbation", "knowledge", "managerId"]) {
    const c = checkStaffingPlan({ hires: [{ ...hire, [field]: "x" }] });
    assert.ok(!c.ok && c.errors.some((e) => e.includes(`hires[0].${field} is not a field Orbit takes from a plan`)), field);
  }
  assert.equal(checkStaffingPlan({ hires: [] }).ok, false, "at least one hire");
  assert.equal(checkStaffingPlan({ hires: Array.from({ length: STAFFING_LIMITS.hires + 1 }, (_, i) => ({ ...hire, name: `P${i}` })) }).ok, false);
  assert.equal(checkStaffingPlan({ departments: Array.from({ length: STAFFING_LIMITS.departments + 1 }, (_, i) => ({ name: `D${i}` })), hires: [hire] }).ok, false);
  assert.equal(checkStaffingPlan({ hires: [{ ...hire, role: "ceo" }] }).ok, false, "never a CEO");
  assert.equal(checkStaffingPlan({ hires: [{ ...hire, name: "two\nlines" }] }).ok, false);
  assert.equal(checkStaffingPlan({ hires: [hire], approve: true }).ok, false);
  assert.equal(checkStaffingPlan("a plan").ok, false);
});
