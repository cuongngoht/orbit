// HIRING AND THE EMPLOYEE'S LIFE (Workforce context): a hire, an edit of what an employee is (a new profile revision),
// of what it may use (a new resource revision), its department, and its employment.
//
// A hire needs one VERIFIED connection of the account (connected, with a model catalog its own CLI gave), and the model,
// the effort, the runtime's search and the Orbit plugin it asks for must be what that connection offers. Its resources
// are refused only above a per-employee ceiling or the account's storage budget -- never because the account's compute
// is busy now. It creates the employee, revision 1 of its profile and of its resources, its Personal Sandbox definition
// (PROVISIONING: the provisioner prepares the desk, toolbox and cache, and only then says READY) and the storage it
// commits -- in one transaction, under the account's policy, audited. No container is started.
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  checkEmployment,
  checkHireEmployee,
  checkMoveEmployee,
  checkUpdateEmployee,
  checkUpdateResources,
  isWorkforceId,
  modelOf,
  type EmployeeProfile,
  type ExecutionProfile,
  type ResourceProfile,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accepted } from "../../../common/errors.js";
import { GovernedResources } from "../../../modules/governance/resources.service.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import { SANDBOX_PROVIDER, type SandboxProvider } from "../../execution/application/sandbox.port.js";
import { EMPLOYEE_RUNTIMES } from "../../execution/infrastructure/employee-runtimes.js";
import { OfficeGovernance, type Actor } from "../../shared/application/commands.js";
import { conflictWith, missing, stale, unprocessable } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { Employee, managerCycle, type EmploymentMove } from "../domain/employee.js";
import { ConnectionsReader, usable, type ConnectionFacts } from "../infrastructure/connections.reader.js";
import { ConnectionProbe } from "../../../modules/connections/probe.js";
import { DepartmentRepository, EmployeeRepository, OfficeRepository, SandboxRepository } from "../infrastructure/repositories.js";

// What happens to the assignment an employee holds when its employment is suspended or archived: the Work context's
// to do (registered by it, so Workforce imports nothing of Work).
export interface HeldWorkPort {
  pauseHeld(actor: Actor, employeeId: string, reason: string): Promise<void>;
  cancelHeld(actor: Actor, employeeId: string, reason: string): Promise<void>;
  holds(orbitId: string, employeeId: string): Promise<boolean>;
}

export const HELD_WORK = Symbol("HELD_WORK");

@Injectable()
export class HiringService {
  private heldWork: HeldWorkPort | null = null;

  constructor(
    @Inject(OfficeRepository) private readonly offices: OfficeRepository,
    @Inject(DepartmentRepository) private readonly departments: DepartmentRepository,
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(SandboxRepository) private readonly sandboxes: SandboxRepository,
    @Inject(ConnectionsReader) private readonly connections: ConnectionsReader,
    @Inject(ResourcesService) private readonly resources: ResourcesService,
    @Inject(GovernedResources) private readonly governed: GovernedResources,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Optional() @Inject(SANDBOX_PROVIDER) private readonly provider: SandboxProvider | null = null,
    // What says whether an OpenAI Codex model is held to Orbit's tools on the binary installed (observed).
    @Optional() @Inject(ConnectionProbe) private readonly probe: ConnectionProbe | null = null,
  ) {}

  useHeldWork(port: HeldWorkPort): void {
    this.heldWork = port;
  }

  async hire(actor: Actor, body: unknown): Promise<string> {
    const req = accepted(checkHireEmployee(body));
    const orbitId = actor.command.orbitId;
    const id = randomUUID();
    return this.governance.command(actor, "employee.hire", id, async () => {
      if ((await this.offices.get(orbitId)) === null) throw conflictWith("office_not_set_up", "Set up the office first.");
      await this.governance.authorize(actor, "employee.hire", id, { employee: id });
      const execution = await this.executionFor(orbitId, req.profile.execution);
      const departmentId = req.departmentId ?? null;
      const managerId = req.managerId ?? null;
      if (departmentId !== null) await this.liveDepartment(orbitId, departmentId);
      if (managerId !== null && (await this.employees.get(orbitId, managerId)) === null) throw missing("Manager");
      await this.resources.checkProfile(orbitId, req.resources);
      const at = new Date().toISOString();
      const e = Employee.hire(
        { id, orbitId, name: req.name, kind: "permanent", departmentId, managerId, connectionId: execution.connectionId, expiresAt: null, missionScope: null, createdBy: actor.command.actor, createdAt: at },
        { skip: req.skipProbation === true, reason: req.skipReason ?? "" },
      );
      const profile: EmployeeProfile = { ...req.profile, execution };
      await this.employees.insert(e);
      await this.employees.insertProfile(orbitId, id, 1, profile, req.templateId ? `from template ${req.templateId}` : "", null, actor.command.actor, at);
      await this.employees.insertResources(orbitId, id, 1, req.resources, "", actor.command.actor, at);
      const sandboxId = randomUUID();
      await this.sandboxes.insert({ id: sandboxId, orbitId, employeeId: id, state: "PROVISIONING", reason: null, provider: this.provider?.kind ?? "process", areas: [], deskVersion: 0, provisionAttempts: 0 }, at);
      await this.resources.commit(orbitId, "desk", id, req.resources.deskStorageMiB);
      await this.resources.commit(orbitId, "cache", id, req.resources.cacheStorageMiB);
      await this.governed.register("employee", { accountId: orbitId, id, title: req.name });
      await this.outbox.append(actor.command, [
        ...e.pullEvents().map((x) => ({ ...x, aggregateVersion: 1 })),
        { type: "SandboxProvisionRequested", aggregateType: "sandbox", aggregateId: sandboxId, aggregateVersion: 1, payload: { employeeId: id, deskMiB: req.resources.deskStorageMiB, cacheMiB: req.resources.cacheStorageMiB } },
      ]);
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "employee.hire", "employee", id, 1, `${req.name} on ${execution.runtime} ${execution.model}${execution.effort ? ` (${execution.effort})` : ""}`);
      return id;
    });
  }

  // A new profile revision (and/or a new name or manager). Applies to the next claim; an assignment already claimed keeps
  // the revision it pinned.
  async update(actor: Actor, employeeId: string, body: unknown, expectedVersion: number): Promise<void> {
    const req = accepted(checkUpdateEmployee(body));
    const orbitId = actor.command.orbitId;
    await this.governance.command(actor, "employee.update", employeeId, async () => {
      await this.governance.authorize(actor, req.managerId !== undefined ? "office.roster.manage" : "employee.hire", employeeId, { employee: employeeId });
      const e = await this.employee(orbitId, employeeId, expectedVersion);
      const at = new Date().toISOString();
      if (req.name !== undefined) e.rename(req.name, at);
      if (req.managerId !== undefined) {
        if (req.managerId !== null && (await this.employees.get(orbitId, req.managerId)) === null) throw missing("Manager");
        if (managerCycle(employeeId, req.managerId, await this.employees.managers(orbitId))) throw conflictWith("relation_cycle", "That manager would make a circle of managers.");
        e.setManager(req.managerId, at);
      }
      if (req.profile !== undefined) {
        if (req.basedOn !== undefined && (await this.employees.profile(orbitId, employeeId, req.basedOn)) === null) throw missing("Profile revision");
        const execution = await this.executionFor(orbitId, req.profile.execution);
        const revision = e.revisedProfile(at, execution.connectionId);
        await this.employees.insertProfile(orbitId, employeeId, revision, { ...req.profile, execution }, req.note ?? "", req.basedOn ?? null, actor.command.actor, at);
      }
      const v = await this.employees.save(e, expectedVersion);
      await this.outbox.append(actor.command, e.pullEvents().map((x) => ({ ...x, aggregateVersion: v })));
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "employee.update", "employee", employeeId, v, req.profile !== undefined ? `profile revision ${e.data.profileRevision}` : "");
    });
  }

  // A new resource revision, for FUTURE attempts (an admitted attempt keeps what it was admitted with). A change of the
  // desk or cache quota is applied to the sandbox by provisioning it again.
  async updateResources(actor: Actor, employeeId: string, body: unknown, expectedVersion: number): Promise<void> {
    const req = accepted(checkUpdateResources(body));
    const orbitId = actor.command.orbitId;
    await this.governance.command(actor, "employee.resources", employeeId, async () => {
      await this.governance.authorize(actor, "employee.resources.change", employeeId, { employee: employeeId });
      const e = await this.employee(orbitId, employeeId, expectedVersion);
      const before = (await this.employees.resources(orbitId, employeeId, e.data.resourceRevision)) as ResourceProfile;
      await this.resources.checkProfile(orbitId, req.resources, { deskMiB: before.deskStorageMiB, cacheMiB: before.cacheStorageMiB });
      const at = new Date().toISOString();
      const revision = e.revisedResources(at);
      await this.employees.insertResources(orbitId, employeeId, revision, req.resources, req.note, actor.command.actor, at);
      await this.resources.commit(orbitId, "desk", employeeId, req.resources.deskStorageMiB);
      await this.resources.commit(orbitId, "cache", employeeId, req.resources.cacheStorageMiB);
      const v = await this.employees.save(e, expectedVersion);
      const events = e.pullEvents().map((x) => ({ ...x, aggregateVersion: v }));
      if (before.deskStorageMiB !== req.resources.deskStorageMiB || before.cacheStorageMiB !== req.resources.cacheStorageMiB) {
        const s = await this.sandboxes.ofEmployee(orbitId, employeeId, true);
        if (s !== null && s.state !== "ARCHIVED") {
          const sv = await this.sandboxes.save({ ...s, state: "PROVISIONING", reason: "Applying new storage quotas." }, at);
          events.push({ type: "SandboxProvisionRequested", aggregateType: "sandbox", aggregateId: s.id, aggregateVersion: sv, payload: { employeeId, deskMiB: req.resources.deskStorageMiB, cacheMiB: req.resources.cacheStorageMiB } });
        }
      }
      await this.outbox.append(actor.command, events);
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "employee.resources", "employee", employeeId, v, `resource revision ${revision}`);
    });
  }

  async move(actor: Actor, employeeId: string, body: unknown, expectedVersion: number): Promise<void> {
    const req = accepted(checkMoveEmployee(body));
    const orbitId = actor.command.orbitId;
    await this.governance.command(actor, "employee.move", employeeId, async () => {
      await this.governance.authorize(actor, "office.roster.manage", employeeId, { employee: employeeId });
      // FOR SHARE: a move into a department waits for an archive of it under way, and then sees it archived.
      if (req.departmentId !== null) await this.liveDepartment(orbitId, req.departmentId);
      const e = await this.employee(orbitId, employeeId, expectedVersion);
      e.moveToDepartment(req.departmentId, new Date().toISOString());
      const v = await this.employees.save(e, expectedVersion);
      await this.outbox.append(actor.command, e.pullEvents().map((x) => ({ ...x, aggregateVersion: v })));
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "employee.move", "employee", employeeId, v, req.departmentId ?? "unassigned");
    });
  }

  // Employment moves. Suspending or archiving an employee who holds work: the held assignment is paused (kept) or
  // cancelled, as the owner chose -- never silently dropped.
  async employment(actor: Actor, employeeId: string, body: unknown, expectedVersion: number): Promise<void> {
    const req = accepted(checkEmployment(body));
    const orbitId = actor.command.orbitId;
    await this.governance.command(actor, `employee.${req.command}`, employeeId, async () => {
      await this.governance.authorize(actor, "employee.hire", employeeId, { employee: employeeId });
      const e = await this.employee(orbitId, employeeId, expectedVersion);
      const holds = this.heldWork !== null && (await this.heldWork.holds(orbitId, employeeId));
      if ((req.command === "suspend" || req.command === "archive" || req.command === "reject") && holds) {
        if (req.held === undefined && req.command === "suspend") throw conflictWith("employee_holds_work", "This employee holds an assignment: choose whether it is paused (kept) or cancelled.");
        if (req.held === "cancel" || req.command !== "suspend") await this.heldWork?.cancelHeld(actor, employeeId, req.reason || `Employee ${req.command}`);
        else await this.heldWork?.pauseHeld(actor, employeeId, req.reason || "Employee suspended");
      }
      const at = new Date().toISOString();
      e.move(req.command as EmploymentMove, req.reason ?? "", at);
      const v = await this.employees.save(e, expectedVersion);
      const events = e.pullEvents().map((x) => ({ ...x, aggregateVersion: v }));
      if (e.data.employment === "archived") {
        const s = await this.sandboxes.ofEmployee(orbitId, employeeId, true);
        if (s !== null && s.state !== "ARCHIVED") await this.sandboxes.save({ ...s, state: "ARCHIVED", reason: "The employee was archived: the desk is kept, read-only." }, at);
        await this.resources.commit(orbitId, "cache", employeeId, 0);
      }
      if (e.data.employment === "deleted") await this.deleteDesk(orbitId, employeeId, at);
      await this.outbox.append(actor.command, events);
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, `employee.${req.command}`, "employee", employeeId, v, req.reason ?? "");
    });
  }

  // Its owner deleted an archived employee's desk (Governance → Employee desks): the sandbox goes DELETING, and the
  // provisioner removes it through the provider, tried again until it is read back gone (sandbox-provisioner.ts) -- only
  // then is its storage released. An employee with no sandbox has nothing to remove: its storage is released now.
  private async deleteDesk(orbitId: string, employeeId: string, at: string): Promise<void> {
    const s = await this.sandboxes.ofEmployee(orbitId, employeeId, true);
    if (s !== null && s.state !== "DELETED") {
      await this.sandboxes.save({ ...s, state: "DELETING", reason: "Its owner deleted the desk: it is being removed.", provisionAttempts: 0 }, at);
      return;
    }
    await this.resources.commit(orbitId, "desk", employeeId, 0);
    await this.resources.commit(orbitId, "cache", employeeId, 0);
  }

  // The execution an employee may be given: on a VERIFIED connection of this account, with a model of that connection's
  // own catalog and an effort that model takes; search and the Orbit plugin only where the connection offers them.
  // A profile revision of the employee, as it was written (an assignment runs under the revision it pinned).
  async profileAt(orbitId: string, employeeId: string, revision: number): Promise<EmployeeProfile | null> {
    return this.employees.profile(orbitId, employeeId, revision);
  }

  async executionFor(orbitId: string, asked: ExecutionProfile): Promise<ExecutionProfile> {
    const connection: ConnectionFacts | null = asked.connectionId !== null ? await this.connections.get(orbitId, asked.connectionId) : await this.connections.defaultFor(orbitId, asked.runtime);
    if (connection === null || !usable(connection)) throw conflictWith("connection_required", "Connect an AI CLI first: hiring needs a connection that is signed in and gave its model catalog (Settings → AI Connections).", { runtime: asked.runtime });
    if (connection.runtime !== asked.runtime) throw unprocessable("connection_runtime", `That connection is ${connection.runtime}, not ${asked.runtime}.`);
    // A runtime whose model plane cannot be held to Orbit's tools runs no employee (said now, not at its first run).
    const refusal = EMPLOYEE_RUNTIMES[asked.runtime].refusal(connection);
    if (refusal !== null) throw unprocessable("runtime_cannot_run_employees", refusal, { runtime: asked.runtime });
    // OpenAI Codex: the model asked must itself be observed held (its own catalog entry decides which tools it gets).
    if (asked.runtime === "codex") {
      const held = this.probe === null ? null : await this.probe.codexEmployeeModel(connection, asked.model);
      if (held?.split !== "yes") throw unprocessable("runtime_cannot_run_employees", `OpenAI Codex cannot run ${asked.model} for an employee here: ${held?.reason ?? "it was not observed held to Orbit's tools"}.`, { runtime: asked.runtime });
    }
    const model = modelOf({ source: "account", models: connection.catalog.models, recommended: connection.catalog.recommended ?? "", detail: null }, asked.model);
    if (model === null) throw unprocessable("model_not_offered", `${asked.model} is not a model this connection offers (it offers ${connection.catalog.models.map((m) => m.id).join(", ")}).`, { models: connection.catalog.models.map((m) => m.id) });
    if (model.efforts.length === 0 && asked.effort !== null) throw unprocessable("effort_not_offered", `${model.label} takes no effort level.`);
    if (model.efforts.length > 0 && (asked.effort === null || !model.efforts.includes(asked.effort))) throw unprocessable("effort_not_offered", `${model.label} takes the effort levels ${model.efforts.join(", ")}.`, { efforts: model.efforts });
    if (asked.webSearch && connection.capabilities.webSearch !== "yes") throw unprocessable("search_not_offered", `The runtime's own search is not available on this connection (${connection.capabilities.webSearch}).`);
    if (asked.orbitPlugin && (asked.runtime !== "claude" || !(await this.connections.pluginApproved(orbitId, connection.id)))) throw unprocessable("plugin_not_granted", "The Orbit plugin is offered on Claude Code only, once its owner granted it for employees (Settings → AI Connections → Claude Code → Plugins).");
    return { ...asked, connectionId: connection.id };
  }

  private async employee(orbitId: string, id: string, expectedVersion: number): Promise<Employee> {
    const e = isWorkforceId(id) ? await this.employees.get(orbitId, id, true) : null;
    if (e === null) throw missing("Employee");
    if (e.data.version !== expectedVersion) throw stale("This employee changed since it was read: read it again.");
    return e;
  }

  private async liveDepartment(orbitId: string, id: string): Promise<void> {
    const d = await this.departments.get(orbitId, id, "share");
    if (d === null) throw missing("Department");
    if (d.archivedAt !== null) throw conflictWith("department_archived", "That department is archived: it takes no new members.");
  }
}
