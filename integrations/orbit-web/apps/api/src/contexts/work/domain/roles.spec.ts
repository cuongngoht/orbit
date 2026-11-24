import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthorityFacts } from "./authority.js";
import { handInRefusal, roleFrom, roleOf, rulesOf, toolRefusal } from "./roles.js";

describe("roles in the AI workforce: the CEO plans, managers run their departments", () => {
  test("the role comes from the appointment in force and the department's working members, never a title", () => {
    assert.equal(roleOf({ appointment: { role: "ceo", departmentId: null }, workingMembers: 0 }), "ceo");
    assert.equal(roleOf({ appointment: { role: "manager", departmentId: "R" }, workingMembers: 2 }), "manager_with_team");
    assert.equal(roleOf({ appointment: { role: "manager", departmentId: "R" }, workingMembers: 0 }), "manager_alone");
    assert.equal(roleOf({ appointment: null, workingMembers: 3 }), "employee");
  });

  test("a manager's team is the working employees of its department, other than itself", () => {
    const facts = (working: AuthorityFacts["working"]): AuthorityFacts => ({ self: "minh", chain: [], appointment: { role: "manager", departmentId: "R" }, managers: [], working, departments: [{ id: "R", name: "Research" }], grants: [] });
    const w = (employeeId: string, departmentId: string | null) => ({ employeeId, name: employeeId, title: "", departmentId, departmentName: null });
    assert.equal(roleFrom(facts([w("minh", "R")])), "manager_alone", "itself is not its team");
    assert.equal(roleFrom(facts([w("minh", "R"), w("hoa", "F")])), "manager_alone", "another department's employee is not its team");
    assert.equal(roleFrom(facts([w("minh", "R"), w("lan", "R")])), "manager_with_team");
    assert.equal(roleFrom({ ...facts([w("lan", "R")]), appointment: null }), "employee");
  });

  test("the CEO runs no command and reads no company system; it decides its team's questions and asks only the person who gave it the work", () => {
    const root = rulesOf("ceo", true);
    assert.match(toolRefusal(root, "shell", false) ?? "", /The CEO does not run commands/);
    assert.match(toolRefusal(root, "github_search", true) ?? "", /read the company's systems/, "every connector and knowledge-base tool");
    assert.match(toolRefusal(root, "escalate_question", false) ?? "", /The CEO decides/);
    assert.equal(toolRefusal(root, "ask_question", false), null, "a root CEO may ask the person who gave it the work");
    assert.match(toolRefusal(rulesOf("ceo", false), "ask_question", false) ?? "", /asks nobody but the person/);
    for (const kept of ["read_file", "write_file", "delegate", "review_unit", "answer_question", "submit_handoff"]) assert.equal(toolRefusal(root, kept, false), null, kept);
    assert.equal(root.escalates, false);
  });

  test("a manager decides: it never asks up nor moves a question up, with or without a team", () => {
    for (const role of ["manager_with_team", "manager_alone"] as const) {
      const r = rulesOf(role, false);
      assert.match(toolRefusal(r, "ask_question", false) ?? "", /You decide: questions do not leave your department/);
      assert.match(toolRefusal(r, "escalate_question", false) ?? "", /You decide/);
      assert.equal(toolRefusal(r, "shell", false), null, "a manager keeps its shell");
      assert.equal(toolRefusal(r, "github_search", true), null, "and the connectors it was let use");
      assert.equal(r.escalates, false);
    }
  });

  test("the CEO and a manager with a team hand in only once they gave the work; a manager alone and an employee do the work", () => {
    assert.equal(handInRefusal(rulesOf("ceo", true), 0)?.code, "ceo_delegates_only");
    assert.equal(handInRefusal(rulesOf("ceo", true), 2), null);
    assert.equal(handInRefusal(rulesOf("manager_with_team", false), 0)?.code, "manager_delegates_to_team");
    assert.equal(handInRefusal(rulesOf("manager_with_team", false), 1), null);
    assert.equal(handInRefusal(rulesOf("manager_alone", false), 0), null);
    assert.equal(handInRefusal(rulesOf("employee", true), 0), null);
  });

  test("an employee keeps every tool, and may move a question up (only to a lead below the CEO: the service holds that)", () => {
    const e = rulesOf("employee", false);
    for (const name of ["shell", "ask_question", "escalate_question"]) assert.equal(toolRefusal(e, name, false), null, name);
    assert.equal(toolRefusal(e, "github_search", true), null);
    assert.equal(e.escalates, true);
  });
});
