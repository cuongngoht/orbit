// The company's appointments and delegation grants (Workforce), and the SLOT of each appointment: the office's row for
// the CEO, the department's row for its manager. A command that appoints, replaces or ends an appointment takes its slot
// row FOR UPDATE first and numbers the slot's next appointment from a counter on that row (never MAX()+1); a reader that
// resolves a slot -- a mission given to a department, a lead's delegation -- takes it FOR SHARE first and then reads the
// incumbent in a statement of its own, so it sees either the appointment before a replacement or the one after it, never
// a slot with nobody (READ COMMITTED re-reads a row it waited for, and a new statement sees what committed).
import { Inject, Injectable } from "@nestjs/common";
import type { AppointmentRole, AppointmentSummary, DelegationGrantView, DelegationTarget } from "@orbit-web/contracts";
import { Db, pgCode, UNIQUE_VIOLATION, type Row } from "../../../infra/db/db.js";
import { conflictWith, missing, stale } from "../../shared/domain.js";
import { Appointment, type AppointmentData } from "../domain/appointment.js";

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export interface Slot {
  role: AppointmentRole;
  // The manager's department; null for the CEO.
  departmentId: string | null;
}

const appointmentOf = (r: Row): AppointmentData => ({
  id: str(r.id),
  orbitId: str(r.account_id),
  role: str(r.role) as AppointmentRole,
  departmentId: strOrNull(r.department_id),
  employeeId: str(r.employee_id),
  state: str(r.state) as AppointmentData["state"],
  slotRevision: Number(r.slot_revision),
  replaces: strOrNull(r.replaces),
  reason: str(r.reason),
  appointedBy: str(r.appointed_by),
  appointedAt: str(r.appointed_at),
  endedBy: strOrNull(r.ended_by),
  endedAt: strOrNull(r.ended_at),
  endReason: strOrNull(r.end_reason),
  updatedAt: str(r.updated_at),
  version: Number(r.version),
});

export interface DelegationGrantRecord {
  id: string;
  orbitId: string;
  employeeId: string;
  target: DelegationTarget;
  state: "active" | "revoked";
  note: string;
  grantedBy: string;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  version: number;
}

const grantOf = (r: Row): DelegationGrantRecord => ({
  id: str(r.id),
  orbitId: str(r.account_id),
  employeeId: str(r.employee_id),
  target: str(r.target_kind) === "employee" ? { kind: "employee", employeeId: str(r.target_employee_id) } : { kind: "department", departmentId: str(r.target_department_id) },
  state: str(r.state) as DelegationGrantRecord["state"],
  note: str(r.note),
  grantedBy: str(r.granted_by),
  grantedAt: str(r.granted_at),
  revokedBy: strOrNull(r.revoked_by),
  revokedAt: strOrNull(r.revoked_at),
  version: Number(r.version),
});

export const grantView = (g: DelegationGrantRecord, name: string): DelegationGrantView => ({ id: g.id, employeeId: g.employeeId, target: { ...g.target, name }, state: g.state, note: g.note, grantedBy: g.grantedBy, grantedAt: g.grantedAt, revokedBy: g.revokedBy, revokedAt: g.revokedAt, version: g.version });

@Injectable()
export class AppointmentRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  // The slot's row, locked: "update" for a command that changes the slot, "share" for a reader that resolves it. False:
  // no such slot (no office, or no such department) -- or an archived department, which holds no manager.
  async lockSlot(orbitId: string, slot: Slot, lock: "update" | "share"): Promise<boolean> {
    const mode = lock === "update" ? "FOR UPDATE" : "FOR SHARE";
    const row =
      slot.role === "ceo"
        ? await this.db.one(`SELECT id FROM workforce.offices WHERE account_id = $1 ${mode}`, [orbitId])
        : await this.db.one(`SELECT id FROM workforce.departments WHERE account_id = $1 AND id = $2 AND archived_at IS NULL ${mode}`, [orbitId, slot.departmentId]);
    return row !== null;
  }

  // The slot's next appointment number (moves the counter on the slot's row; its version, which a page's If-Match names,
  // does not move).
  async nextSlotRevision(orbitId: string, slot: Slot): Promise<number> {
    const row =
      slot.role === "ceo"
        ? await this.db.one("UPDATE workforce.offices SET ceo_revision = ceo_revision + 1 WHERE account_id = $1 RETURNING ceo_revision AS n", [orbitId])
        : await this.db.one("UPDATE workforce.departments SET manager_revision = manager_revision + 1 WHERE account_id = $1 AND id = $2 RETURNING manager_revision AS n", [orbitId, slot.departmentId]);
    if (row === null) throw missing(slot.role === "ceo" ? "The company" : "Department");
    return Number(row.n);
  }

  // The slot's incumbent (active or suspended), if any. A caller that must not race a replacement locked the slot first.
  async incumbent(orbitId: string, slot: Slot): Promise<Appointment | null> {
    const row =
      slot.role === "ceo"
        ? await this.db.one("SELECT * FROM workforce.appointments WHERE account_id = $1 AND role = 'ceo' AND state IN ('active', 'suspended')", [orbitId])
        : await this.db.one("SELECT * FROM workforce.appointments WHERE account_id = $1 AND role = 'manager' AND department_id = $2 AND state IN ('active', 'suspended')", [orbitId, slot.departmentId]);
    return row === null ? null : Appointment.restore(appointmentOf(row));
  }

  // The appointment an employee holds now (active or suspended), if any.
  async heldBy(orbitId: string, employeeId: string): Promise<Appointment | null> {
    const row = await this.db.one("SELECT * FROM workforce.appointments WHERE account_id = $1 AND employee_id = $2 AND state IN ('active', 'suspended')", [orbitId, employeeId]);
    return row === null ? null : Appointment.restore(appointmentOf(row));
  }

  async get(orbitId: string, id: string, lock = false): Promise<Appointment | null> {
    const row = await this.db.one(`SELECT * FROM workforce.appointments WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : Appointment.restore(appointmentOf(row));
  }

  // The incumbents (active or suspended) as a page shows them: the CEO's under "ceo", each manager's under its department.
  async incumbents(orbitId: string): Promise<{ ceo: AppointmentSummary | null; managers: Map<string, AppointmentSummary>; roles: Map<string, AppointmentRole> }> {
    const rows = await this.db.query(
      "SELECT a.*, e.name FROM workforce.appointments a JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id WHERE a.account_id = $1 AND a.state IN ('active', 'suspended')",
      [orbitId],
    );
    const summary = (r: Row): AppointmentSummary => ({ appointmentId: str(r.id), employeeId: str(r.employee_id), name: str(r.name), state: str(r.state) as AppointmentSummary["state"], slotRevision: Number(r.slot_revision), version: Number(r.version) });
    const ceo = rows.find((r) => str(r.role) === "ceo");
    return {
      ceo: ceo === undefined ? null : summary(ceo),
      managers: new Map(rows.filter((r) => str(r.role) === "manager").map((r) => [str(r.department_id), summary(r)])),
      roles: new Map(rows.map((r) => [str(r.employee_id), str(r.role) as AppointmentRole])),
    };
  }

  // Every appointment an employee held (newest first).
  async ofEmployee(orbitId: string, employeeId: string): Promise<AppointmentData[]> {
    return (await this.db.query("SELECT * FROM workforce.appointments WHERE account_id = $1 AND employee_id = $2 ORDER BY appointed_at DESC, id", [orbitId, employeeId])).map(appointmentOf);
  }

  // Every appointment of the account (incumbents and history), newest first.
  async all(orbitId: string): Promise<AppointmentData[]> {
    return (await this.db.query("SELECT * FROM workforce.appointments WHERE account_id = $1 ORDER BY appointed_at DESC, slot_revision DESC, id", [orbitId])).map(appointmentOf);
  }

  async insert(a: Appointment): Promise<void> {
    const d = a.data;
    try {
      await this.db.tx(async () => {
        await this.db.query(
          `INSERT INTO workforce.appointments (id, account_id, role, department_id, employee_id, state, slot_revision, replaces, reason, appointed_by, appointed_at, updated_at, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, 1)`,
          [d.id, d.orbitId, d.role, d.departmentId, d.employeeId, d.state, d.slotRevision, d.replaces, d.reason, d.appointedBy, d.appointedAt],
        );
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) throw conflictWith("appointment_conflict", "That slot has an incumbent already, or that employee holds another appointment: replace or end it first.");
      throw err;
    }
  }

  async save(a: Appointment, expectedVersion: number): Promise<number> {
    const d = a.data;
    const row = await this.db.one(
      "UPDATE workforce.appointments SET state = $3, ended_by = $4, ended_at = $5, end_reason = $6, updated_at = $7, version = version + 1 WHERE account_id = $1 AND id = $2 AND version = $8 RETURNING version",
      [d.orbitId, d.id, d.state, d.endedBy, d.endedAt, d.endReason, d.updatedAt, expectedVersion],
    );
    if (row === null) throw stale("This appointment changed since it was read: read it again.", { appointmentId: d.id });
    return Number(row.version);
  }

  // ---- delegation grants ------------------------------------------------------------------------------------------

  async grantsOf(orbitId: string, employeeId: string, liveOnly = false): Promise<DelegationGrantRecord[]> {
    return (await this.db.query(`SELECT * FROM workforce.delegation_grants WHERE account_id = $1 AND employee_id = $2${liveOnly ? " AND state = 'active'" : ""} ORDER BY granted_at DESC, id`, [orbitId, employeeId])).map(grantOf);
  }

  async grant(orbitId: string, id: string, lock = false): Promise<DelegationGrantRecord | null> {
    const row = await this.db.one(`SELECT * FROM workforce.delegation_grants WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : grantOf(row);
  }

  async insertGrant(g: DelegationGrantRecord): Promise<void> {
    try {
      await this.db.tx(async () => {
        await this.db.query(
          `INSERT INTO workforce.delegation_grants (id, account_id, employee_id, target_kind, target_employee_id, target_department_id, state, note, granted_by, granted_at, version)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, 1)`,
          [g.id, g.orbitId, g.employeeId, g.target.kind, g.target.kind === "employee" ? g.target.employeeId : null, g.target.kind === "department" ? g.target.departmentId : null, g.note, g.grantedBy, g.grantedAt],
        );
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) throw conflictWith("delegation_exists", "That employee may already give work there.");
      throw err;
    }
  }

  async revokeGrant(orbitId: string, id: string, by: string, at: string, expectedVersion: number): Promise<number> {
    const row = await this.db.one("UPDATE workforce.delegation_grants SET state = 'revoked', revoked_by = $3, revoked_at = $4, version = version + 1 WHERE account_id = $1 AND id = $2 AND state = 'active' AND version = $5 RETURNING version", [orbitId, id, by, at, expectedVersion]);
    if (row === null) throw stale("This delegation changed since it was read, or was revoked already: read it again.", { grantId: id });
    return Number(row.version);
  }
}
