// WHAT WORK READS OF THE COMPANY'S AUTHORITY (Workforce's records, read only): who holds which appointment in force,
// which delegation grants hold, who works where, and who fills a slot now -- the facts `delegationScope` and
// `resolveMissionTarget` decide on. A slot is read after its row is locked FOR SHARE, so an appointment changing at the
// same time is either before or after it, never half.
import { Inject, Injectable } from "@nestjs/common";
import type { MissionTarget } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";
import { missing } from "../../shared/domain.js";
import type { AuthorityFacts } from "../domain/authority.js";
import type { SlotFacts } from "../domain/target.js";

const WORKING = "e.employment IN ('probation', 'active') AND (e.expires_at IS NULL OR e.expires_at > now())";

@Injectable()
export class OrgReader {
  constructor(@Inject(Db) private readonly db: Db) {}

  // The employees of the leads above an assignment: its lead's, its lead's lead's ...
  async chainOf(orbitId: string, assignmentId: string): Promise<string[]> {
    const rows = await this.db.query(
      `WITH RECURSIVE up(id, parent_id, employee_id, n) AS (
         SELECT id, parent_id, employee_id, 0 FROM workforce.assignments WHERE account_id = $1 AND id = $2
         UNION ALL SELECT p.id, p.parent_id, p.employee_id, up.n + 1 FROM workforce.assignments p JOIN up ON p.id = up.parent_id WHERE p.account_id = $1 AND up.n < 10)
       SELECT employee_id FROM up WHERE n > 0 ORDER BY n`,
      [orbitId, assignmentId],
    );
    return rows.map((r) => String(r.employee_id));
  }

  async authority(orbitId: string, employeeId: string, chain: readonly string[]): Promise<AuthorityFacts> {
    const own = await this.db.one("SELECT role, department_id FROM workforce.appointments WHERE account_id = $1 AND employee_id = $2 AND state = 'active'", [orbitId, employeeId]);
    const managers = await this.db.query(
      `SELECT a.id, a.employee_id, a.department_id, a.slot_revision, e.name, p.profile->>'title' AS title, d.name AS department_name
       FROM workforce.appointments a
       JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
       JOIN workforce.employee_profiles p ON p.account_id = e.account_id AND p.employee_id = e.id AND p.revision = e.profile_revision
       JOIN workforce.departments d ON d.account_id = a.account_id AND d.id = a.department_id
       WHERE a.account_id = $1 AND a.role = 'manager' AND a.state = 'active' AND d.archived_at IS NULL AND ${WORKING}
       ORDER BY d.name, d.id`,
      [orbitId],
    );
    const working = await this.db.query(
      `SELECT e.id, e.name, p.profile->>'title' AS title, e.department_id, d.name AS department_name
       FROM workforce.employees e
       JOIN workforce.employee_profiles p ON p.account_id = e.account_id AND p.employee_id = e.id AND p.revision = e.profile_revision
       LEFT JOIN workforce.departments d ON d.account_id = e.account_id AND d.id = e.department_id
       WHERE e.account_id = $1 AND ${WORKING} ORDER BY e.name, e.id`,
      [orbitId],
    );
    const departments = await this.db.query("SELECT id, name FROM workforce.departments WHERE account_id = $1 AND archived_at IS NULL ORDER BY name, id", [orbitId]);
    const grants = await this.db.query("SELECT target_kind, target_employee_id, target_department_id FROM workforce.delegation_grants WHERE account_id = $1 AND employee_id = $2 AND state = 'active' ORDER BY granted_at, id", [orbitId, employeeId]);
    return {
      self: employeeId,
      chain,
      appointment: own === null ? null : { role: own.role === "ceo" ? "ceo" : "manager", departmentId: own.department_id === null ? null : String(own.department_id) },
      managers: managers.map((m) => ({ employeeId: String(m.employee_id), name: String(m.name), title: String(m.title ?? ""), departmentId: String(m.department_id), departmentName: String(m.department_name), appointmentId: String(m.id), slotRevision: Number(m.slot_revision) })),
      working: working.map((w) => ({ employeeId: String(w.id), name: String(w.name), title: String(w.title ?? ""), departmentId: w.department_id === null ? null : String(w.department_id), departmentName: w.department_name === null ? null : String(w.department_name) })),
      departments: departments.map((d) => ({ id: String(d.id), name: String(d.name) })),
      grants: grants.map((g) => (g.target_kind === "employee" ? { kind: "employee" as const, employeeId: String(g.target_employee_id) } : { kind: "department" as const, departmentId: String(g.target_department_id) })),
    };
  }

  // Who fills the slot a mission's target names, read with the slot's row held (FOR SHARE when `lock`).
  async slot(orbitId: string, target: MissionTarget, lock: boolean): Promise<SlotFacts> {
    if (target.kind === "employee") return { incumbent: null, departmentName: null };
    const share = lock ? " FOR SHARE" : "";
    let departmentName: string | null = null;
    if (target.kind === "department") {
      const d = await this.db.one(`SELECT name, archived_at FROM workforce.departments WHERE account_id = $1 AND id = $2${share}`, [orbitId, target.departmentId]);
      if (d === null || d.archived_at !== null) throw missing("The department");
      departmentName = String(d.name);
    } else {
      await this.db.one(`SELECT id FROM workforce.offices WHERE account_id = $1${share}`, [orbitId]);
    }
    const row = await this.db.one(
      `SELECT a.id, a.employee_id, a.state, a.slot_revision, e.name, (${WORKING}) AS working FROM workforce.appointments a
       JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
       WHERE a.account_id = $1 AND a.state IN ('active', 'suspended') AND ${target.kind === "ceo" ? "a.role = 'ceo'" : "a.role = 'manager' AND a.department_id = $2"}`,
      target.kind === "ceo" ? [orbitId] : [orbitId, target.departmentId],
    );
    return {
      departmentName,
      incumbent: row === null ? null : { appointmentId: String(row.id), employeeId: String(row.employee_id), employeeName: String(row.name), state: row.state === "suspended" ? "suspended" : "active", slotRevision: Number(row.slot_revision), working: row.working === true },
    };
  }

  async departmentName(orbitId: string, departmentId: string): Promise<string | null> {
    const r = await this.db.one("SELECT name FROM workforce.departments WHERE account_id = $1 AND id = $2", [orbitId, departmentId]);
    return r === null ? null : String(r.name);
  }
}
