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
  DEFAULT_PRESETS,
  isWorkforceId,
  modelOf,
  WORKFORCE_LIMITS,
  type EmployeeProfile,
  type ExecutionProfile,
  type HireAssistantRequest,
  type ResourceProfile,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accepted } from "../../../common/errors.js";
import { modelAllowed } from "@orbit-web/governance-core";
import { PolicyService } from "../../../modules/governance/policy.service.js";
import { GovernedResources } from "../../../modules/governance/resources.service.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import { SANDBOX_PROVIDER, type SandboxProvider } from "../../execution/application/sandbox.port.js";
import { EMPLOYEE_RUNTIMES } from "../../execution/infrastructure/employee-runtimes.js";
import { OfficeGovernance, type Actor } from "../../shared/application/commands.js";
import { conflictWith, DomainError, missing, refused, stale, unprocessable } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { Employee, managerCycle, type EmploymentMove } from "../domain/employee.js";
import { resolveExecution } from "../domain/execution-precedence.js";
import { AppointmentRepository } from "../infrastructure/appointments.repository.js";
import { EmployeeEligibility } from "./eligibility.js";
import { ConnectionsReader, usable, type ConnectionFacts } from "../infrastructure/connections.reader.js";
import { ConnectionProbe } from "../../../modules/connections/probe.js";
import { DepartmentRepository, EmployeeRepository, OfficeRepository, SandboxRepository } from "../infrastructure/repositories.js";

// What happens to the assignment an employee holds when its employment is suspended or archived: the Work context's
// to do (registered by it, so Workforce imports nothing of Work).
export interface HeldWorkPort {
  pauseHeld(actor: Actor, employeeId: string, reason: string): Promise<void>;
  cancelHeld(actor: Actor, employeeId: string, reason: string): Promise<void>;
  // Every open piece of work of the employee -- the held one and those queued for it -- cancelled (each wakes its lead).
  cancelOpen(actor: Actor, employeeId: string, reason: string): Promise<void>;
  holds(orbitId: string, employeeId: string): Promise<boolean>;
}

// What a lead's plan asks of one TEMPORARY ASSISTANT (ADR 0061 §8): who it is, the mission it is engaged for, the
// department it joins and who manages it there, and what the same plan engages before it (each counts against the
// lead's quota, and commits storage).
export interface AssistantAsk {
  leadId: string;
  missionId: string;
  // The mission's deadline: the engagement ends then at the latest.
  deadline: string | null;
  departmentId: string;
  managerId: string;
  hire: HireAssistantRequest;
  before: { assistants: number; deskMiB: number; cacheMiB: number };
}

// An engagement decided (as the lead, through governance) and checked -- not made yet: `engageAssistant` makes it.
export interface Engagement {
  readonly id: string;
  readonly leadId: string;
  readonly missionId: string;
  readonly departmentId: string;
  readonly managerId: string;
  readonly name: string;
  readonly expiresAt: string;
  readonly profile: EmployeeProfile;
  readonly resources: ResourceProfile;
}

// A lead's assistants now: its profile's maxAssistants, and how many are engaged and not released or expired.
export interface AssistantQuota {
  max: number;
  engaged: number;
  left: number;
}

// An assistant's resources: the Lightweight preset (writing, light analysis, small scripts).
const ASSISTANT_RESOURCES = (DEFAULT_PRESETS.find((p) => p.id === "lightweight") ?? DEFAULT_PRESETS[0]) as { profile: ResourceProfile };
const DAY_MS = 86_400_000;

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
    @Inject(AppointmentRepository) private readonly appointments: AppointmentRepository,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(EmployeeEligibility) private readonly eligibility: EmployeeEligibility,
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
      const departmentId = req.departmentId ?? null;
      const managerId = req.managerId ?? null;
      if (departmentId !== null) await this.liveDepartment(orbitId, departmentId);
      const execution = await this.executionFor(orbitId, req.profile.execution, departmentId);
      if (managerId !== null && (await this.employees.get(orbitId, managerId)) === null) throw missing("Manager");
      await this.resources.checkProfile(orbitId, req.resources);
      const at = new Date().toISOString();
      const e = Employee.hire(
        { id, orbitId, name: req.name, kind: "permanent", departmentId, managerId, connectionId: execution.connectionId, expiresAt: null, missionScope: null, engagedBy: null, createdBy: actor.command.actor, createdAt: at },
        { skip: req.skipProbation === true, reason: req.skipReason ?? "" },
      );
      await this.employ(actor, e, { ...req.profile, execution }, req.resources, req.templateId ? `from template ${req.templateId}` : "", at);
      await this.governance.recorded(actor, "employee.hire", "employee", id, 1, `${req.name} on ${execution.runtime} ${execution.model}${execution.effort ? ` (${execution.effort})` : ""}`);
      return id;
    });
  }

  // What a hire and an engagement both make, in the caller's transaction: the employee, revision 1 of its profile and of
  // its resources, its Personal Sandbox (PROVISIONING: the provisioner prepares it, and only then says READY), the
  // storage it commits, and their events.
  private async employ(actor: Actor, e: Employee, profile: EmployeeProfile, resources: ResourceProfile, note: string, at: string): Promise<void> {
    const orbitId = actor.command.orbitId;
    const id = e.id;
    await this.employees.insert(e);
    await this.employees.insertProfile(orbitId, id, 1, profile, note, null, actor.command.actor, at);
    await this.employees.insertResources(orbitId, id, 1, resources, "", actor.command.actor, at);
    const sandboxId = randomUUID();
    await this.sandboxes.insert({ id: sandboxId, orbitId, employeeId: id, state: "PROVISIONING", reason: null, provider: this.provider?.kind ?? "process", areas: [], deskVersion: 0, provisionAttempts: 0 }, at);
    await this.resources.commit(orbitId, "desk", id, resources.deskStorageMiB);
    await this.resources.commit(orbitId, "cache", id, resources.cacheStorageMiB);
    await this.governed.register("employee", { accountId: orbitId, id, title: e.data.name });
    await this.outbox.append(actor.command, [
      ...e.pullEvents().map((x) => ({ ...x, aggregateVersion: 1 })),
      { type: "SandboxProvisionRequested", aggregateType: "sandbox", aggregateId: sandboxId, aggregateVersion: 1, payload: { employeeId: id, deskMiB: resources.deskStorageMiB, cacheMiB: resources.cacheStorageMiB } },
    ]);
    await this.outbox.touched(orbitId, ["roster"]);
  }

  // ---- temporary assistants (ADR 0061 §8) ------------------------------------------------------------------------

  // A lead's quota now: its profile's maxAssistants (the owner's, per employee; 0 engages none) against its live ones.
  async assistantQuota(orbitId: string, leadId: string): Promise<AssistantQuota> {
    const lead = await this.employees.get(orbitId, leadId);
    const profile = lead === null ? null : await this.employees.profile(orbitId, leadId, lead.data.profileRevision);
    const max = profile?.maxAssistants ?? 0;
    const engaged = await this.employees.liveAssistantsOf(orbitId, leadId);
    return { max, engaged, left: Math.max(0, max - engaged) };
  }

  // An engagement DECIDED, as the lead (its own agent principal -- never employee.hire, which stays a person's), and
  // checked as a hire is, before anything of it is made: governance decides employee.hire_assistant with the grant its
  // quota gives (a full one is NO_GRANT, said with the numbers); the department takes members; the mission leaves it
  // time (at most WORKFORCE_LIMITS.assistantDays); it runs on its department's defaults for its lead's runtime (else
  // the company's, else exactly as its lead runs), held to the same connection and model rules as a hire; its Lightweight
  // resources fit. Writes only the decision's record. A refusal says why, in words the lead can act on.
  async decideAssistant(actor: Actor, ask: AssistantAsk): Promise<Engagement> {
    const orbitId = actor.command.orbitId;
    const id = randomUUID();
    const quota = await this.assistantQuota(orbitId, ask.leadId);
    const engaged = quota.engaged + ask.before.assistants;
    const room = engaged < quota.max;
    try {
      await this.governance.authorize(actor, "employee.hire_assistant", id, { mission: ask.missionId, employee: id }, undefined, room ? "held" : "not_held");
    } catch (err) {
      if (room || !(err instanceof DomainError) || err.code !== "policy_denied") throw err;
      const d = err.details as { decisionId?: string; reasonCodes?: string[] } | undefined;
      const full = quota.max === 0 ? "your profile engages none (maxAssistants is 0)" : "your quota is full";
      throw refused("assistant_quota", `${engaged} of ${quota.max} assistants engaged: ${full} -- give this part to someone you have. Decision ${d?.decisionId ?? ""} (${(d?.reasonCodes ?? []).join(", ")}).`, { ...quota, engaged });
    }
    await this.liveDepartment(orbitId, ask.departmentId);
    const now = Date.now();
    const deadline = ask.deadline === null ? Number.POSITIVE_INFINITY : Date.parse(ask.deadline);
    const ends = Math.min(now + WORKFORCE_LIMITS.assistantDays * DAY_MS, deadline);
    if (ends <= now) throw conflictWith("engagement_ended", "The mission's deadline has passed: an assistant engaged now would have no time.");
    const execution = await this.executionFor(orbitId, await this.assistantExecution(orbitId, ask), ask.departmentId);
    const resources = ASSISTANT_RESOURCES.profile;
    await this.resources.checkProfile(orbitId, resources, { deskMiB: -ask.before.deskMiB, cacheMiB: -ask.before.cacheMiB });
    const profile: EmployeeProfile = { title: ask.hire.title, duties: ask.hire.duties, instructions: "You are a temporary assistant, engaged for one mission: do the part you are given and hand it in.", skills: ask.hire.skills, languages: ask.hire.languages, knowledge: [], execution, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false };
    return { id, leadId: ask.leadId, missionId: ask.missionId, departmentId: ask.departmentId, managerId: ask.managerId, name: ask.hire.name, expiresAt: new Date(ends).toISOString(), profile, resources };
  }

  // What an assistant runs on: its department's default for its lead's runtime -- else the company's -- inherited as a
  // profile that leaves its connection, model and effort to them; with neither, exactly what its lead runs on now.
  private async assistantExecution(orbitId: string, ask: AssistantAsk): Promise<ExecutionProfile> {
    const lead = await this.eligibility.of(orbitId, ask.leadId, false);
    if (lead === null) throw missing("The lead");
    const runtime = lead.execution.runtime;
    const department = await this.departments.get(orbitId, ask.departmentId);
    const company = (await this.offices.get(orbitId))?.defaults ?? null;
    if (department?.defaults?.[runtime] !== undefined || company?.[runtime] !== undefined) return { runtime, connectionId: null, model: "", effort: null, webSearch: false, orbitPlugin: false, inherit: ["connection", "model", "effort"] };
    return { ...lead.execution };
  }

  // The engagement made, in the caller's transaction (the lead's plan): an active assistant of the mission, its
  // revisions, its Personal Sandbox and storage -- recorded as the lead's employee.hire_assistant.
  async engageAssistant(actor: Actor, g: Engagement): Promise<string> {
    const orbitId = actor.command.orbitId;
    const at = new Date().toISOString();
    const e = Employee.engage({ id: g.id, orbitId, name: g.name, departmentId: g.departmentId, managerId: g.managerId, connectionId: g.profile.execution.connectionId, missionScope: g.missionId, engagedBy: g.leadId, expiresAt: g.expiresAt, createdBy: actor.command.actor, createdAt: at });
    await this.employ(actor, e, g.profile, g.resources, `engaged by ${g.leadId} for mission ${g.missionId}`, at);
    await this.governance.recorded(actor, "employee.hire_assistant", "employee", g.id, 1, `${g.name} for mission ${g.missionId}, engaged by ${g.leadId} until ${g.expiresAt}`);
    return g.id;
  }

  // THE END OF AN ENGAGEMENT -- its mission ended, it expired, or its sandbox could not be made: Orbit's own act (a
  // system actor; no person's employment command and no policy to refuse it -- the engagement was decided when it was
  // made, and this only ends what that decision bounded). Its open work is cancelled (each part wakes its lead), it is
  // archived and its desk deleted, so the storage it committed is freed once the provisioner reads the desk back gone.
  // An assistant already released, or no assistant at all, changes nothing (false).
  async releaseAssistant(actor: Actor, employeeId: string, reason: string): Promise<boolean> {
    const orbitId = actor.command.orbitId;
    const e = await this.employees.get(orbitId, employeeId, true);
    if (e === null || e.data.kind !== "assistant" || e.data.employment === "archived" || e.data.employment === "deleted") return false;
    await this.heldWork?.cancelOpen(actor, employeeId, reason);
    const at = new Date().toISOString();
    const expected = e.data.version;
    e.release(reason, at);
    const v = await this.employees.save(e, expected);
    await this.deleteDesk(orbitId, employeeId, at, `Released: ${reason}`);
    await this.outbox.append(actor.command, e.pullEvents().map((x) => ({ ...x, aggregateVersion: v })));
    await this.outbox.touched(orbitId, ["roster"]);
    await this.governance.recorded(actor, "employee.release_assistant", "employee", employeeId, v, reason);
    return true;
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
        const execution = await this.executionFor(orbitId, req.profile.execution, e.data.departmentId);
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
      const held = await this.appointments.heldBy(orbitId, employeeId);
      if (held !== null && held.data.role === "manager" && held.data.departmentId !== req.departmentId)
        throw conflictWith("appointed_manager", `${e.data.name} manages a department: replace or revoke the appointment before moving them -- a manager is a member of the department it manages.`, { appointmentId: held.id });
      if (held !== null && held.data.role === "ceo" && req.departmentId !== null)
        throw conflictWith("appointed_ceo", `${e.data.name} is the CEO, who belongs to no department: replace or revoke the appointment before moving them into one.`, { appointmentId: held.id });
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
      if (req.command === "archive" || req.command === "reject" || req.command === "delete") {
        const held = await this.appointments.heldBy(orbitId, employeeId);
        if (held !== null) throw conflictWith("employee_appointed", `${e.data.name} holds an appointment (${held.data.role === "ceo" ? "CEO" : "manager"}): replace or revoke it first.`, { appointmentId: held.id });
      }
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
  private async deleteDesk(orbitId: string, employeeId: string, at: string, reason = "Its owner deleted the desk: it is being removed."): Promise<void> {
    const s = await this.sandboxes.ofEmployee(orbitId, employeeId, true);
    if (s !== null && s.state !== "DELETED") {
      if (s.state !== "DELETING") await this.sandboxes.save({ ...s, state: "DELETING", reason, provisionAttempts: 0 }, at);
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

  // A profile that leaves fields to its department or company (`inherit`) is checked as it would RUN -- its department's
  // default, else the company's -- and kept as WRITTEN: an inherited field stays inherited, so a later default applies to
  // later work (work already claimed keeps what it pinned). A model nobody names is refused, saying so.
  async executionFor(orbitId: string, written: ExecutionProfile, departmentId: string | null = null): Promise<ExecutionProfile> {
    const department = departmentId === null ? null : await this.departments.get(orbitId, departmentId);
    const resolved = resolveExecution({ override: null, profile: written, department: department?.defaults ?? null, company: (await this.offices.get(orbitId))?.defaults ?? null });
    if (resolved.unresolved.length > 0) throw unprocessable("execution_unresolved", `This profile leaves its ${resolved.unresolved.join(" and ")} to its department or company, and neither names one for ${written.runtime}: set a default, or choose it here.`, { unresolved: resolved.unresolved });
    const asked = resolved.execution;
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
    // The policy's model allow-list for employees (the company's, narrowed by the department's): a model it leaves out is
    // refused here, at hire or change, never switched for another.
    const allowed = await this.policy.employeeModels(orbitId, departmentId);
    if (!modelAllowed(allowed, asked.runtime, model.id)) throw unprocessable("model_not_allowed", `The policy does not let ${departmentId === null ? "the company's" : "this department's"} employees run on ${asked.runtime}:${model.id} (it allows ${allowed?.join(", ") || "none"}): choose another model, or change the policy.`, { allowed });
    if (model.efforts.length === 0 && asked.effort !== null) throw unprocessable("effort_not_offered", `${model.label} takes no effort level.`);
    if (model.efforts.length > 0 && (asked.effort === null || !model.efforts.includes(asked.effort))) throw unprocessable("effort_not_offered", `${model.label} takes the effort levels ${model.efforts.join(", ")}.`, { efforts: model.efforts });
    if (asked.webSearch && connection.capabilities.webSearch !== "yes") throw unprocessable("search_not_offered", `The runtime's own search is not available on this connection (${connection.capabilities.webSearch}).`);
    if (asked.orbitPlugin && (asked.runtime !== "claude" || !(await this.connections.pluginApproved(orbitId, connection.id)))) throw unprocessable("plugin_not_granted", "The Orbit plugin is offered on Claude Code only, once its owner granted it for employees (Settings → AI Connections → Claude Code → Plugins).");
    const inherits = new Set(written.inherit ?? []);
    if (inherits.size === 0) return { ...asked, connectionId: connection.id };
    return { ...written, connectionId: inherits.has("connection") ? null : connection.id, model: inherits.has("model") ? "" : asked.model, effort: inherits.has("effort") ? null : asked.effort };
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
