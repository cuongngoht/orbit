import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DomainError } from "../../shared/domain.js";
import { Employee } from "./employee.js";

const AT = "2026-11-24T08:00:00.000Z";
const engagement = {
  id: "asst-1",
  orbitId: "acc-1",
  name: "Tâm",
  departmentId: "dept-r",
  managerId: "lead-1",
  connectionId: "conn-1",
  missionScope: "mission-1",
  engagedBy: "lead-1",
  expiresAt: "2026-12-01T08:00:00.000Z",
  createdBy: "employee:lead-1",
  createdAt: AT,
};
const codeOf = (work: () => unknown): string | null => {
  try {
    work();
    return null;
  } catch (err) {
    return err instanceof DomainError ? err.code : "not a domain error";
  }
};

describe("a temporary assistant", () => {
  test("is engaged by a lead for one mission, until a time: active at once (no trial), its lead and mission kept", () => {
    const a = Employee.engage(engagement);
    assert.deepEqual([a.data.kind, a.data.employment, a.data.missionScope, a.data.engagedBy, a.data.expiresAt, a.data.employmentReason], ["assistant", "active", "mission-1", "lead-1", "2026-12-01T08:00:00.000Z", "a temporary assistant: active for its engagement"]);
    const events = a.pullEvents();
    assert.deepEqual(events.map((e) => e.type), ["EmployeeHired", "EmployeeActivated"]);
    assert.deepEqual(events[0]?.payload, { name: "Tâm", kind: "assistant", departmentId: "dept-r", employment: "active", trialSkipped: true, missionId: "mission-1", engagedBy: "lead-1" });
  });

  test("an engagement names its lead, its mission and an end after it starts -- never itself", () => {
    assert.equal(codeOf(() => Employee.engage({ ...engagement, expiresAt: AT })), "engagement_ended");
    assert.equal(codeOf(() => Employee.engage({ ...engagement, engagedBy: "asst-1" })), "relation_cycle");
    assert.equal(codeOf(() => Employee.engage({ ...engagement, missionScope: "" })), "assistant_without_mission");
  });

  test("is released when its engagement ends: archived, then its desk deleted -- each move said; twice changes nothing more", () => {
    const a = Employee.engage(engagement);
    a.pullEvents();
    a.release("Its mission was accepted.", "2026-11-25T08:00:00.000Z");
    assert.deepEqual([a.data.employment, a.data.employmentReason], ["deleted", "Its mission was accepted."]);
    assert.deepEqual(a.pullEvents().map((e) => [e.type, e.payload.command]), [["EmployeeEmploymentChanged", "archive"], ["EmployeeEmploymentChanged", "delete"]]);
    assert.equal(codeOf(() => a.release("again", "2026-11-25T09:00:00.000Z")), "invalid_transition");
  });

  test("a permanent employee is never released as an assistant", () => {
    const p = Employee.hire({ id: "emp-1", orbitId: "acc-1", name: "Minh", kind: "permanent", departmentId: null, managerId: null, connectionId: null, expiresAt: null, missionScope: null, engagedBy: null, createdBy: "owner:acc-1", createdAt: AT }, { skip: false, reason: "" });
    assert.equal(codeOf(() => p.release("no", AT)), "not_an_assistant");
    assert.equal(p.data.employment, "probation");
  });
});
