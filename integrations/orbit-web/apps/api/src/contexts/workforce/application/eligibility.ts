// ELIGIBILITY (Workforce → Work, synchronous, in the caller's transaction): may this employee take work NOW, and what
// does a claim pin? Asked by every claim -- a person's "start now", the queue's next item, a schedule's occurrence -- so
// one rule decides them all. It locks the employee's row FIRST (FOR UPDATE): every claim takes its locks in the same
// order (employee → assignment → reservation → office version), and two claims of one employee take turns.
import { Inject, Injectable } from "@nestjs/common";
import type { EmployeeKind, EmployeeProfile, Employment, ExecutionProfile, ExecutionSources } from "@orbit-web/contracts";
import { WORKING } from "../domain/employee.js";
import { resolveExecution } from "../domain/execution-precedence.js";
import { ConnectionsReader, employeeUse, type ConnectionFacts } from "../infrastructure/connections.reader.js";
import { AppointmentRepository } from "../infrastructure/appointments.repository.js";
import { DepartmentRepository, EmployeeRepository, OfficeRepository, SandboxRepository, type SandboxRecord } from "../infrastructure/repositories.js";

export interface Eligibility {
  eligible: boolean;
  reason: string | null;
  employeeId: string;
  name: string;
  // A temporary assistant is its lead's for one mission (missionScope): nobody gives it work of its own.
  kind: EmployeeKind;
  missionScope: string | null;
  profileRevision: number;
  resourceRevision: number;
  departmentId: string | null;
  departmentName: string | null;
  // The execution its work runs on: the profile's own fields, else its department's default, else the company's.
  execution: ExecutionProfile;
  // Which layer gave each field.
  sources: ExecutionSources;
  profile: EmployeeProfile;
  sandboxId: string | null;
  // The appointment it holds and whether it is in force (a suspended one grants nothing): authority, never a title.
  appointment: { id: string; role: "ceo" | "manager"; departmentId: string | null; active: boolean } | null;
}

@Injectable()
export class EmployeeEligibility {
  constructor(
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(SandboxRepository) private readonly sandboxes: SandboxRepository,
    @Inject(DepartmentRepository) private readonly departments: DepartmentRepository,
    @Inject(ConnectionsReader) private readonly connections: ConnectionsReader,
    @Inject(OfficeRepository) private readonly offices: OfficeRepository,
    @Inject(AppointmentRepository) private readonly appointments: AppointmentRepository,
  ) {}

  // Null: no such employee in this account.
  async of(orbitId: string, employeeId: string, lock = true): Promise<Eligibility | null> {
    const e = await this.employees.get(orbitId, employeeId, lock);
    if (e === null) return null;
    const d = e.data;
    const profile = (await this.employees.profile(orbitId, employeeId, d.profileRevision)) as EmployeeProfile;
    const department = d.departmentId === null ? null : await this.departments.get(orbitId, d.departmentId);
    const sandbox = await this.sandboxes.ofEmployee(orbitId, employeeId);
    const resolved = resolveExecution({ override: null, profile: profile.execution, department: department?.defaults ?? null, company: (await this.offices.get(orbitId))?.defaults ?? null });
    const connectionId = resolved.execution.connectionId;
    const connection = connectionId !== null ? await this.connections.get(orbitId, connectionId) : await this.connections.defaultFor(orbitId, profile.execution.runtime);
    const unresolved = resolved.unresolved.length > 0 ? `${d.name}'s profile leaves its ${resolved.unresolved.join(" and ")} to its department or company, and neither names one: set a default, or choose it on the profile.` : null;
    const reason = unresolved ?? this.reasonOf(d.name, d.employment, d.expiresAt, sandbox, connection);
    const held = (await this.appointments.heldBy(orbitId, employeeId))?.data ?? null;
    return {
      eligible: reason === null,
      reason,
      employeeId,
      name: d.name,
      kind: d.kind,
      missionScope: d.missionScope,
      profileRevision: d.profileRevision,
      resourceRevision: d.resourceRevision,
      departmentId: d.departmentId,
      departmentName: department?.name ?? null,
      execution: { ...resolved.execution, connectionId: connection?.id ?? resolved.execution.connectionId },
      sources: resolved.sources,
      profile,
      sandboxId: sandbox?.id ?? null,
      appointment: held === null ? null : { id: held.id, role: held.role, departmentId: held.departmentId, active: held.state === "active" },
    };
  }

  private reasonOf(name: string, employment: Employment, expiresAt: string | null, sandbox: SandboxRecord | null, connection: ConnectionFacts | null): string | null {
    if (!WORKING.includes(employment)) return `${name} is ${employment}: only an employee on trial or active takes work.`;
    if (expiresAt !== null && Date.parse(expiresAt) <= Date.now()) return `${name}'s engagement as an assistant ended.`;
    if (sandbox === null) return `${name}'s Personal Sandbox is missing.`;
    if (sandbox.state !== "READY") return `${name}'s Personal Sandbox is ${sandbox.state.toLowerCase()}${sandbox.reason !== null ? `: ${sandbox.reason}` : ""}.`;
    const use = employeeUse(connection);
    if (!use.ready) return `${name}'s AI connection cannot run work now: ${use.reason}.`;
    return null;
  }
}
