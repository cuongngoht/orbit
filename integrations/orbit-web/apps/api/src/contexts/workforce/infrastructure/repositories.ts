// THE WORKFORCE CONTEXT'S REPOSITORIES: the office, its departments, employees with their profile and resource
// revisions, and their Personal Sandboxes. Every method takes the OrbitId first; a save names the version it read.
import { Inject, Injectable } from "@nestjs/common";
import type { AreaState } from "../../execution/application/sandbox.port.js";
import type { Department, EmployeeProfile, Office, ResourceProfile, SandboxState } from "@orbit-web/contracts";
import { Db, jsonParam, pgCode, UNIQUE_VIOLATION, type Row } from "../../../infra/db/db.js";
import { conflictWith, stale } from "../../shared/domain.js";
import { Employee, type EmployeeData } from "../domain/employee.js";

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export const employeeDataOf = (r: Row): EmployeeData => ({
  id: str(r.id),
  orbitId: str(r.account_id),
  name: str(r.name),
  kind: str(r.kind) as EmployeeData["kind"],
  departmentId: strOrNull(r.department_id),
  managerId: strOrNull(r.manager_id),
  employment: str(r.employment) as EmployeeData["employment"],
  employmentReason: strOrNull(r.employment_reason),
  profileRevision: Number(r.profile_revision),
  resourceRevision: Number(r.resource_revision),
  connectionId: strOrNull(r.connection_id),
  expiresAt: strOrNull(r.expires_at),
  missionScope: strOrNull(r.mission_scope),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  version: Number(r.version),
});

export interface DepartmentRecord {
  id: string;
  orbitId: string;
  name: string;
  position: number;
  archivedAt: string | null;
  version: number;
}

const departmentOf = (r: Row): DepartmentRecord => ({ id: str(r.id), orbitId: str(r.account_id), name: str(r.name), position: Number(r.position), archivedAt: strOrNull(r.archived_at), version: Number(r.version) });

export const departmentView = (d: DepartmentRecord, members: number): Department => ({ id: d.id, name: d.name, position: d.position, archived: d.archivedAt !== null, version: d.version, members });

export interface SandboxRecord {
  id: string;
  orbitId: string;
  employeeId: string;
  state: SandboxState;
  reason: string | null;
  provider: "container" | "process";
  areas: AreaState[];
  deskVersion: number;
  provisionAttempts: number;
  version: number;
  updatedAt: string;
}

const sandboxOf = (r: Row): SandboxRecord => ({
  id: str(r.id),
  orbitId: str(r.account_id),
  employeeId: str(r.employee_id),
  state: str(r.state) as SandboxState,
  reason: strOrNull(r.reason),
  provider: str(r.provider) as SandboxRecord["provider"],
  areas: r.areas as AreaState[],
  deskVersion: Number(r.desk_version),
  provisionAttempts: Number(r.provision_attempts),
  version: Number(r.version),
  updatedAt: str(r.updated_at),
});

@Injectable()
export class OfficeRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async get(orbitId: string): Promise<Office | null> {
    const row = await this.db.one("SELECT * FROM workforce.offices WHERE account_id = $1", [orbitId]);
    return row === null ? null : { id: str(row.id), name: str(row.name), version: Number(row.version), createdAt: str(row.created_at) };
  }

  // Idempotent: one office per account (a unique constraint behind it); the existing one is returned.
  async ensure(orbitId: string, id: string, name: string, by: string, at: string): Promise<{ office: Office; created: boolean }> {
    const inserted = await this.db.one("INSERT INTO workforce.offices (id, account_id, name, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (account_id) DO NOTHING RETURNING id", [id, orbitId, name, by, at]);
    return { office: (await this.get(orbitId)) as Office, created: inserted !== null };
  }
}

@Injectable()
export class DepartmentRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async list(orbitId: string, includeArchived = false): Promise<DepartmentRecord[]> {
    return (await this.db.query(`SELECT * FROM workforce.departments WHERE account_id = $1${includeArchived ? "" : " AND archived_at IS NULL"} ORDER BY position, lower(name), id`, [orbitId])).map(departmentOf);
  }

  // `lock`: "update" serializes an archive against moves into it; "share" lets moves run together but not beside one.
  async get(orbitId: string, id: string, lock: "update" | "share" | null = null): Promise<DepartmentRecord | null> {
    const row = await this.db.one(`SELECT * FROM workforce.departments WHERE account_id = $1 AND id = $2${lock === "update" ? " FOR UPDATE" : lock === "share" ? " FOR SHARE" : ""}`, [orbitId, id]);
    return row === null ? null : departmentOf(row);
  }

  async members(orbitId: string): Promise<Map<string, number>> {
    const rows = await this.db.query("SELECT department_id, count(*) AS n FROM workforce.employees WHERE account_id = $1 AND employment NOT IN ('archived', 'deleted') AND department_id IS NOT NULL GROUP BY department_id", [orbitId]);
    return new Map(rows.map((r) => [str(r.department_id), Number(r.n)]));
  }

  async insert(d: DepartmentRecord, at: string): Promise<void> {
    try {
      await this.db.tx(async () => {
        await this.db.query("INSERT INTO workforce.departments (id, account_id, name, position, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)", [d.id, d.orbitId, d.name, d.position, at]);
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) throw conflictWith("department_name_taken", `A department named "${d.name}" already exists.`);
      throw err;
    }
  }

  async save(d: DepartmentRecord, expectedVersion: number, at: string): Promise<number> {
    try {
      return await this.db.tx(async () => {
        const row = await this.db.one("UPDATE workforce.departments SET name = $3, position = $4, archived_at = $5, updated_at = $6, version = version + 1 WHERE account_id = $1 AND id = $2 AND version = $7 RETURNING version", [d.orbitId, d.id, d.name, d.position, d.archivedAt, at, expectedVersion]);
        if (row === null) throw stale("This department changed since it was read: read it again.");
        return Number(row.version);
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) throw conflictWith("department_name_taken", `A department named "${d.name}" already exists.`);
      throw err;
    }
  }
}

@Injectable()
export class EmployeeRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async get(orbitId: string, id: string, lock = false): Promise<Employee | null> {
    const row = await this.db.one(`SELECT * FROM workforce.employees WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : Employee.restore(employeeDataOf(row));
  }

  async managers(orbitId: string): Promise<Map<string, string | null>> {
    const rows = await this.db.query("SELECT id, manager_id FROM workforce.employees WHERE account_id = $1", [orbitId]);
    return new Map(rows.map((r) => [str(r.id), strOrNull(r.manager_id)]));
  }

  async inDepartment(orbitId: string, departmentId: string): Promise<Employee[]> {
    return (await this.db.query("SELECT * FROM workforce.employees WHERE account_id = $1 AND department_id = $2 AND employment NOT IN ('archived', 'deleted') ORDER BY id FOR UPDATE", [orbitId, departmentId])).map((r) => Employee.restore(employeeDataOf(r)));
  }

  async insert(e: Employee): Promise<void> {
    const d = e.data;
    await this.db.query(
      `INSERT INTO workforce.employees (id, account_id, name, kind, department_id, manager_id, employment, employment_reason, profile_revision, resource_revision, connection_id, expires_at, mission_scope, created_by, created_at, updated_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, 1)`,
      [d.id, d.orbitId, d.name, d.kind, d.departmentId, d.managerId, d.employment, d.employmentReason, d.profileRevision, d.resourceRevision, d.connectionId, d.expiresAt, d.missionScope, d.createdBy, d.createdAt],
    );
  }

  async save(e: Employee, expectedVersion: number): Promise<number> {
    const d = e.data;
    const row = await this.db.one(
      `UPDATE workforce.employees SET name = $3, department_id = $4, manager_id = $5, employment = $6, employment_reason = $7, profile_revision = $8, resource_revision = $9, connection_id = $10, updated_at = $11, version = version + 1
       WHERE account_id = $1 AND id = $2 AND version = $12 RETURNING version`,
      [d.orbitId, d.id, d.name, d.departmentId, d.managerId, d.employment, d.employmentReason, d.profileRevision, d.resourceRevision, d.connectionId, d.updatedAt, expectedVersion],
    );
    if (row === null) throw stale("This employee changed since it was read: read it again.", { employeeId: d.id });
    return Number(row.version);
  }

  async insertProfile(orbitId: string, employeeId: string, revision: number, profile: EmployeeProfile, note: string, basedOn: number | null, by: string, at: string): Promise<void> {
    await this.db.query("INSERT INTO workforce.employee_profiles (account_id, employee_id, revision, profile, note, based_on, created_by, created_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)", [orbitId, employeeId, revision, jsonParam(profile), note, basedOn, by, at]);
  }

  async profile(orbitId: string, employeeId: string, revision: number): Promise<EmployeeProfile | null> {
    const row = await this.db.one("SELECT profile FROM workforce.employee_profiles WHERE account_id = $1 AND employee_id = $2 AND revision = $3", [orbitId, employeeId, revision]);
    return row === null ? null : (row.profile as EmployeeProfile);
  }

  async profiles(orbitId: string, employeeId: string): Promise<{ revision: number; note: string; basedOn: number | null; createdBy: string; createdAt: string }[]> {
    return (await this.db.query("SELECT revision, note, based_on, created_by, created_at FROM workforce.employee_profiles WHERE account_id = $1 AND employee_id = $2 ORDER BY revision DESC", [orbitId, employeeId])).map((r) => ({ revision: Number(r.revision), note: str(r.note), basedOn: r.based_on === null ? null : Number(r.based_on), createdBy: str(r.created_by), createdAt: str(r.created_at) }));
  }

  async insertResources(orbitId: string, employeeId: string, revision: number, profile: ResourceProfile, note: string, by: string, at: string): Promise<void> {
    await this.db.query("INSERT INTO workforce.employee_resources (account_id, employee_id, revision, profile, note, created_by, created_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)", [orbitId, employeeId, revision, jsonParam(profile), note, by, at]);
  }

  async resources(orbitId: string, employeeId: string, revision: number): Promise<ResourceProfile | null> {
    const row = await this.db.one("SELECT profile FROM workforce.employee_resources WHERE account_id = $1 AND employee_id = $2 AND revision = $3", [orbitId, employeeId, revision]);
    return row === null ? null : (row.profile as ResourceProfile);
  }

  async resourceRevisions(orbitId: string, employeeId: string): Promise<{ revision: number; profile: ResourceProfile; note: string; createdBy: string; createdAt: string }[]> {
    return (await this.db.query("SELECT revision, profile, note, created_by, created_at FROM workforce.employee_resources WHERE account_id = $1 AND employee_id = $2 ORDER BY revision DESC", [orbitId, employeeId])).map((r) => ({ revision: Number(r.revision), profile: r.profile as ResourceProfile, note: str(r.note), createdBy: str(r.created_by), createdAt: str(r.created_at) }));
  }
}

@Injectable()
export class SandboxRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async ofEmployee(orbitId: string, employeeId: string, lock = false): Promise<SandboxRecord | null> {
    const row = await this.db.one(`SELECT * FROM workforce.sandboxes WHERE account_id = $1 AND employee_id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, employeeId]);
    return row === null ? null : sandboxOf(row);
  }

  async insert(s: Omit<SandboxRecord, "version" | "updatedAt">, at: string): Promise<void> {
    await this.db.query("INSERT INTO workforce.sandboxes (id, account_id, employee_id, state, reason, provider, areas, desk_version, provision_attempts, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $10)", [
      s.id,
      s.orbitId,
      s.employeeId,
      s.state,
      s.reason,
      s.provider,
      jsonParam(s.areas),
      s.deskVersion,
      s.provisionAttempts,
      at,
    ]);
  }

  async save(s: SandboxRecord, at: string): Promise<number> {
    const row = await this.db.one(
      "UPDATE workforce.sandboxes SET state = $3, reason = $4, provider = $5, areas = $6::jsonb, desk_version = $7, provision_attempts = $8, updated_at = $9, version = version + 1 WHERE account_id = $1 AND id = $2 AND version = $10 RETURNING version",
      [s.orbitId, s.id, s.state, s.reason, s.provider, jsonParam(s.areas), s.deskVersion, s.provisionAttempts, at, s.version],
    );
    if (row === null) throw stale("This sandbox changed since it was read.");
    return Number(row.version);
  }
}
