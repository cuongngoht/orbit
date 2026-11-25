import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canDelegate, placeHire, quotaOf } from "./assistants.js";
import { delegationScope, type AuthorityFacts } from "./authority.js";

const working = [
  { employeeId: "an", name: "An", title: "CEO", departmentId: null, departmentName: null },
  { employeeId: "minh", name: "Minh", title: "Research lead", departmentId: "R", departmentName: "Research" },
  { employeeId: "hoa", name: "Hoa", title: "Finance lead", departmentId: "F", departmentName: "Finance" },
];
const managers = [
  { employeeId: "minh", name: "Minh", title: "Research lead", departmentId: "R", departmentName: "Research", appointmentId: "ap-r", slotRevision: 1 },
  { employeeId: "hoa", name: "Hoa", title: "Finance lead", departmentId: "F", departmentName: "Finance", appointmentId: "ap-f", slotRevision: 3 },
];
const departments = [{ id: "R", name: "Research" }, { id: "F", name: "Finance" }, { id: "L", name: "Legal" }];
const base: AuthorityFacts = { self: "x", chain: [], appointment: null, managers, working, departments, grants: [] };
const ceo: AuthorityFacts = { ...base, self: "an", appointment: { role: "ceo", departmentId: null } };
const minh: AuthorityFacts = { ...base, self: "minh", appointment: { role: "manager", departmentId: "R" } };

describe("temporary assistants", () => {
  test("a quota counts what is engaged against the lead's maxAssistants; 0 engages none", () => {
    assert.deepEqual(quotaOf(2, 0), { max: 2, engaged: 0, left: 2 });
    assert.deepEqual(quotaOf(2, 3), { max: 2, engaged: 3, left: 0 }, "a quota lowered below what is engaged leaves no room, never a negative one");
    assert.deepEqual(quotaOf(0, 0), { max: 0, engaged: 0, left: 0 });
  });

  test("a manager alone may engage while its quota has room: delegate is offered with nobody to name", () => {
    const alone = delegationScope(minh);
    assert.deepEqual(alone.employees, []);
    assert.equal(canDelegate(alone, minh.appointment, quotaOf(2, 0)), true);
    assert.equal(canDelegate(alone, minh.appointment, quotaOf(2, 2)), false, "a full quota: nothing to give");
    assert.equal(canDelegate(alone, minh.appointment, quotaOf(0, 0)), false, "maxAssistants 0 turns it off");
    assert.equal(canDelegate(delegationScope({ ...base, self: "lan" }), null, null), false, "no appointment: no assistant");
    assert.equal(canDelegate(delegationScope(ceo), ceo.appointment, quotaOf(0, 0)), true, "the CEO with departments to give work to");
  });

  test("a department's manager engages into its own department, and the part goes to the assistant itself", () => {
    assert.deepEqual(placeHire(minh, delegationScope(minh), {}), { departmentId: "R", goesTo: "assistant" });
    assert.deepEqual(placeHire(minh, delegationScope(minh), { department: "research" }), { departmentId: "R", goesTo: "assistant" });
    assert.match((placeHire(minh, delegationScope(minh), { department: "Finance" }) as { problem: string }).problem, /joins your own department/);
    assert.match((placeHire(minh, delegationScope(minh), { employee: "Lan" }) as { problem: string }).problem, /names nobody else/);
  });

  test("the CEO names a department with a manager in office: the assistant joins it, and the part goes to that manager", () => {
    assert.deepEqual(placeHire(ceo, delegationScope(ceo), { department: "Finance" }), { departmentId: "F", goesTo: "manager", employeeId: "hoa", target: { kind: "department", departmentId: "F", appointmentId: "ap-f", appointmentRevision: 3 } });
    assert.match((placeHire(ceo, delegationScope(ceo), {}) as { problem: string }).problem, /name the department it joins/);
    assert.match((placeHire(ceo, delegationScope(ceo), { department: "Legal" }) as { problem: string }).problem, /not a department you may give work to/);
  });

  test("only an appointee in force engages: a grant lets one give work, never hire", () => {
    const granted: AuthorityFacts = { ...base, self: "lan", grants: [{ kind: "department", departmentId: "F" }] };
    assert.match((placeHire(granted, delegationScope(granted), { department: "Finance" }) as { problem: string }).problem, /Only the CEO or a department's manager engages/);
  });
});
