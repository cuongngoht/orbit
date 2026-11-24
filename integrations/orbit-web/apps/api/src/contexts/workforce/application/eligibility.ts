// ELIGIBILITY (Workforce → Work, synchronous, in the caller's transaction): may this employee take work NOW, and what
// does a claim pin? Asked by every claim -- a person's "start now", the queue's next item, a schedule's occurrence -- so
// one rule decides them all. It locks the employee's row FIRST (FOR UPDATE): every claim takes its locks in the same
// order (employee → assignment → reservation → office version), and two claims of one employee take turns.
import { Inject, Injectable } from "@nestjs/common";
import type { EmployeeProfile, Employment, ExecutionProfile } from "@orbit-web/contracts";
import { WORKING } from "../domain/employee.js";
import { ConnectionsReader, employeeUse, type ConnectionFacts } from "../infrastructure/connections.reader.js";
import { DepartmentRepository, EmployeeRepository, SandboxRepository, type SandboxRecord } from "../infrastructure/repositories.js";

export interface Eligibility {
  eligible: boolean;
  reason: string | null;
  employeeId: string;
  name: string;
  profileRevision: number;
  resourceRevision: number;
  departmentId: string | null;
  departmentName: string | null;
  execution: ExecutionProfile;
  profile: EmployeeProfile;
  sandboxId: string | null;
}

@Injectable()
export class EmployeeEligibility {
  constructor(
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(SandboxRepository) private readonly sandboxes: SandboxRepository,
    @Inject(DepartmentRepository) private readonly departments: DepartmentRepository,
    @Inject(ConnectionsReader) private readonly connections: ConnectionsReader,
  ) {}

  // Null: no such employee in this account.
  async of(orbitId: string, employeeId: string, lock = true): Promise<Eligibility | null> {
    const e = await this.employees.get(orbitId, employeeId, lock);
    if (e === null) return null;
    const d = e.data;
    const profile = (await this.employees.profile(orbitId, employeeId, d.profileRevision)) as EmployeeProfile;
    const department = d.departmentId === null ? null : await this.departments.get(orbitId, d.departmentId);
    const sandbox = await this.sandboxes.ofEmployee(orbitId, employeeId);
    const connection = profile.execution.connectionId !== null ? await this.connections.get(orbitId, profile.execution.connectionId) : await this.connections.defaultFor(orbitId, profile.execution.runtime);
    const reason = this.reasonOf(d.name, d.employment, d.expiresAt, sandbox, connection);
    return {
      eligible: reason === null,
      reason,
      employeeId,
      name: d.name,
      profileRevision: d.profileRevision,
      resourceRevision: d.resourceRevision,
      departmentId: d.departmentId,
      departmentName: department?.name ?? null,
      execution: { ...profile.execution, connectionId: connection?.id ?? profile.execution.connectionId },
      profile,
      sandboxId: sandbox?.id ?? null,
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
