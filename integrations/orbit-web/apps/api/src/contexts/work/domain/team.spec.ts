import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { allEnded, leadNext, planProblems } from "./team.js";
import { resolveMissionTarget, sameAssignee, type SlotFacts } from "./target.js";

describe("a lead's team: what it is woken for, and what makes a plan givable", () => {
  const u = (key: string, state: string, dependsOn: string[] = []) => ({ key, state: state as never, dependsOn });

  test("a result to review wins; questions come next; otherwise it waits", () => {
    assert.equal(leadNext([u("a", "AWAITING_ACCEPTANCE"), u("b", "BLOCKED")], 1), "review");
    assert.equal(leadNext([u("a", "BLOCKED"), u("b", "QUEUED", ["a"])], 1), "answer");
    assert.equal(leadNext([u("a", "RUNNING"), u("b", "BLOCKED")], 1), "answer", "a question does not wait for the other parts");
    assert.equal(leadNext([u("a", "RUNNING")], 0), "wait");
    assert.equal(leadNext([u("a", "COMPLETED"), u("b", "CANCELLED")], 0), "review", "every part ended: integrate");
    assert.equal(allEnded([u("a", "COMPLETED"), u("b", "AWAITING_ACCEPTANCE")]), false);
  });

  test("a plan's keys are unique among a lead's parts; a part receives only what it waits for; never to the lead itself", () => {
    const parts = [
      { key: "research", employeeId: "minh", goal: "r", dependsOn: [] },
      { key: "finance", employeeId: "hoa", goal: "f", dependsOn: [], receives: [{ from: "research" }] },
      { key: "self", employeeId: "an", goal: "s", dependsOn: [] },
    ];
    const problems = planProblems(parts, "an", new Set(["research"]));
    assert.ok(problems.some((p) => /"research" was already given/.test(p)));
    assert.ok(problems.some((p) => /receives the hand-in of "research", which it does not wait for/.test(p)));
    assert.ok(problems.some((p) => /"self" is given to yourself/.test(p)));
  });
});

describe("who a mission goes to", () => {
  const incumbent = { appointmentId: "ap", employeeId: "minh", employeeName: "Minh", state: "active" as const, slotRevision: 3, working: true };

  test("a department goes to its manager in office, the CEO to the CEO; nobody, a suspended holder or one not working is refused with why", () => {
    const slot = (i: SlotFacts["incumbent"], departmentName: string | null, departmentsManaged = 1): SlotFacts => ({ incumbent: i, departmentName, departmentsManaged });
    assert.deepEqual(resolveMissionTarget({ kind: "department", departmentId: "R" }, slot(incumbent, "Research")), { employeeId: "minh", appointmentId: "ap", appointmentRevision: 3 });
    assert.deepEqual(resolveMissionTarget({ kind: "ceo" }, slot(incumbent, null)), { employeeId: "minh", appointmentId: "ap", appointmentRevision: 3 });
    assert.equal((resolveMissionTarget({ kind: "ceo" }, slot(null, null)) as { code: string }).code, "no_ceo");
    assert.equal((resolveMissionTarget({ kind: "department", departmentId: "R" }, slot(null, "Research")) as { code: string }).code, "no_manager");
    assert.equal((resolveMissionTarget({ kind: "department", departmentId: "R" }, slot({ ...incumbent, state: "suspended" }, "Research")) as { code: string }).code, "appointment_suspended");
    assert.equal((resolveMissionTarget({ kind: "ceo" }, slot({ ...incumbent, working: false }, null)) as { code: string }).code, "not_working");
    assert.deepEqual(resolveMissionTarget({ kind: "employee", employeeId: "lan" }, slot(null, null, 0)), { employeeId: "lan", appointmentId: null, appointmentRevision: null });
  });

  test("the CEO takes work only while a department has a manager in office to give it to; a department's manager needs none", () => {
    const refused = resolveMissionTarget({ kind: "ceo" }, { incumbent, departmentName: null, departmentsManaged: 0 }) as { code: string; message: string };
    assert.equal(refused.code, "ceo_needs_departments");
    assert.match(refused.message, /create a department and appoint its manager, or give the work to an employee/);
    assert.equal((resolveMissionTarget({ kind: "ceo" }, { incumbent: null, departmentName: null, departmentsManaged: 0 }) as { code: string }).code, "no_ceo", "no CEO is said first");
    assert.deepEqual(resolveMissionTarget({ kind: "department", departmentId: "R" }, { incumbent, departmentName: "Research", departmentsManaged: 0 }), { employeeId: "minh", appointmentId: "ap", appointmentRevision: 3 });
  });

  test("what the person saw must still be who is responsible: the same employee, appointment and revision", () => {
    const now = { employeeId: "minh", appointmentId: "ap", appointmentRevision: 3 };
    assert.equal(sameAssignee({ employeeId: "minh", appointmentId: "ap", appointmentRevision: 3 }, now), true);
    assert.equal(sameAssignee({ employeeId: "minh", appointmentId: "ap", appointmentRevision: 2 }, now), false, "re-appointed since: refused");
  });
});
