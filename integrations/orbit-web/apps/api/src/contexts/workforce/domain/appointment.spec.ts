import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "../../shared/domain.js";
import { Appointment } from "./appointment.js";

const base = { id: "a1", orbitId: "o1", role: "manager" as const, departmentId: "d1", employeeId: "e1", slotRevision: 1, replaces: null, reason: "", by: "owner:o1", at: "2026-11-24T00:00:00.000Z" };

test("an appointment starts active and says so; suspended it still holds its slot; ended it stays ended", () => {
  const a = Appointment.appoint(base);
  assert.equal(a.data.state, "active");
  assert.deepEqual(a.pullEvents().map((e) => [e.type, e.payload.change]), [["AppointmentChanged", "appointed"]]);
  a.move("suspend", "owner:o1", "on leave", base.at);
  assert.equal(a.incumbent, true, "a suspended incumbent still holds the slot");
  a.move("reinstate", "owner:o1", "", base.at);
  a.move("revoke", "owner:o1", "reorganised", base.at);
  assert.deepEqual([a.data.state, a.data.endedBy, a.data.endReason, a.incumbent], ["revoked", "owner:o1", "reorganised", false]);
  assert.throws(() => a.move("reinstate", "owner:o1", "", base.at), (e: unknown) => e instanceof DomainError && e.code === "invalid_transition");
});

test("a CEO has no department, whatever the caller passed", () => {
  assert.equal(Appointment.appoint({ ...base, role: "ceo" }).data.departmentId, null);
});

test("only an incumbent is replaced, and a suspension is only of an active one", () => {
  const a = Appointment.appoint(base);
  a.move("replace", "owner:o1", "", base.at);
  assert.equal(a.data.state, "replaced");
  assert.throws(() => a.move("suspend", "owner:o1", "", base.at), /cannot be suspended/);
});
