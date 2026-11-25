import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { delegationScope, resolveTarget, scopeIsEmpty, type AuthorityFacts } from "./authority.js";

const working = [
  { employeeId: "an", name: "An", title: "CEO", departmentId: null, departmentName: null },
  { employeeId: "minh", name: "Minh", title: "Research lead", departmentId: "R", departmentName: "Research" },
  { employeeId: "lan", name: "Lan", title: "Analyst", departmentId: "R", departmentName: "Research" },
  { employeeId: "hoa", name: "Hoa", title: "Finance lead", departmentId: "F", departmentName: "Finance" },
  { employeeId: "binh", name: "Binh", title: "Accountant", departmentId: "F", departmentName: "Finance" },
];
const managers = [
  { employeeId: "minh", name: "Minh", title: "Research lead", departmentId: "R", departmentName: "Research", appointmentId: "ap-r", slotRevision: 1 },
  { employeeId: "hoa", name: "Hoa", title: "Finance lead", departmentId: "F", departmentName: "Finance", appointmentId: "ap-f", slotRevision: 2 },
];
const departments = [{ id: "R", name: "Research" }, { id: "F", name: "Finance" }, { id: "L", name: "Legal" }];
const base: AuthorityFacts = { self: "x", chain: [], appointment: null, managers, working, departments, grants: [] };

describe("who an employee may give work to", () => {
  test("a title, instructions or a profile switch grant nothing: no appointment, no grant -- no one", () => {
    assert.equal(scopeIsEmpty(delegationScope({ ...base, self: "lan" })), true);
  });

  test("the CEO gives work to the managers in office, and to the departments they run (never one without a manager in office)", () => {
    const s = delegationScope({ ...base, self: "an", appointment: { role: "ceo", departmentId: null } });
    assert.deepEqual(s.employees.map((e) => e.id), ["minh", "hoa"]);
    assert.deepEqual(s.departments.map((d) => [d.id, d.manager?.employeeId]), [["R", "minh"], ["F", "hoa"]]);
    assert.ok(!s.employees.some((e) => e.id === "lan"), "a CEO reaches a department's members only through its manager");
    const r = resolveTarget(s, { department: "research" });
    assert.deepEqual(r, { employeeId: "minh", target: { kind: "department", departmentId: "R", appointmentId: "ap-r", appointmentRevision: 1 } });
    assert.match((resolveTarget(s, { employee: "Lan" }) as { problem: string }).problem, /not someone you may give work to.*Research, Finance/);
  });

  test("a manager gives work to the working members of its own department -- not itself, not another department's", () => {
    const s = delegationScope({ ...base, self: "minh", appointment: { role: "manager", departmentId: "R" } });
    assert.deepEqual(s.employees.map((e) => e.id), ["lan"]);
    assert.ok("problem" in resolveTarget(s, { employee: "Binh" }));
  });

  test("a grant reaches its employee, or a department through its manager; never anyone above it in the mission's chain", () => {
    const s = delegationScope({ ...base, self: "binh", chain: ["hoa"], grants: [{ kind: "employee", employeeId: "lan" }, { kind: "department", departmentId: "F" }, { kind: "department", departmentId: "L" }] });
    assert.deepEqual(s.employees.map((e) => [e.id, e.via]), [["lan", "grant"]]);
    assert.deepEqual(s.departments.map((d) => d.id), ["L"], "Finance's manager is its own lead: not a target");
    assert.match((resolveTarget(s, { department: "Legal" }) as { problem: string }).problem, /no manager in office/);
  });
});
