// THE OWNER'S HIRING REQUEST, CARRIED OUT (Executive, application; ADR 0062, staffing). The owner asks once -- what the
// company needs, for one department or the whole company, on the model and resources the owner chose -- and the CEO
// plans it in an answer of its own (the turn's `kind` is staffing: its prompt gains a hiring section with the company's
// departments, their managers and the request's bounds). When that turn ends, Orbit carries the plan out AT ONCE, on the
// authority of the person who asked (their user as it is now: deferredOwnerActor), never on the model's: every department
// made, every hire and every manager appointed goes through the existing command, decided under the account's policy as
// that person's own click is. All or nothing: a plan that breaks a rule creates nothing, every problem listed; one
// command refused rolls back every other. The request leaves `planning` once, in the turn's own transaction, and Orbit
// says what it did as a report of its own in the conversation.
import { Inject, Injectable } from "@nestjs/common";
import { checkHireEmployee, STAFFING_LIMITS, type ExecutiveReport, type HireEmployeeRequest, type StaffingOutcome, type StaffingPlan, type StaffingState } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { Db } from "../../../infra/db/db.js";
import { AccountsService } from "../../../modules/auth/accounts.service.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import { deferredOwnerActor, OfficeGovernance, systemActor, type Actor } from "../../shared/application/commands.js";
import { DomainError } from "../../shared/domain.js";
import { AppointmentsService } from "../../workforce/application/appointments.service.js";
import { HiringService } from "../../workforce/application/hiring.service.js";
import { OfficeService } from "../../workforce/application/office.service.js";
import { AppointmentRepository } from "../../workforce/infrastructure/appointments.repository.js";
import { DepartmentRepository } from "../../workforce/infrastructure/repositories.js";
import { readStaffing, type PlannedHire, type ReadStaffing, type StaffingFacts } from "../domain/staffing.js";
import type { PromptTask } from "../infrastructure/executive-prompt.js";
import { ExecutiveRepository, messageView, type TurnRecord } from "../infrastructure/executive.repository.js";
import { ExecutiveStream } from "../infrastructure/executive-stream.js";
import { StaffingRepository, type StaffingRecord } from "../infrastructure/staffing.repository.js";
import type { TurnTask } from "./turn-tasks.js";

// A department a new department's hires are checked against before it exists.
const NOT_YET = "00000000-0000-4000-8000-000000000000";
// What a lead may engage while it works (ADR 0061: assistants), as every new profile.
const ASSISTANTS = 2;

const outcomeOf = (problems: string[]): StaffingOutcome => ({ hired: [], departmentsCreated: [], appointed: [], problems });
const firstLine = (s: string, max = 200): string => {
  const line = s.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

@Injectable()
export class StaffingRunner implements TurnTask {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(StaffingRepository) private readonly staffing: StaffingRepository,
    @Inject(ExecutiveRepository) private readonly repo: ExecutiveRepository,
    @Inject(ExecutiveStream) private readonly stream: ExecutiveStream,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(OfficeService) private readonly office: OfficeService,
    @Inject(HiringService) private readonly hiring: HiringService,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(DepartmentRepository) private readonly departments: DepartmentRepository,
    @Inject(AppointmentRepository) private readonly appointmentsRepo: AppointmentRepository,
    @Inject(ResourcesService) private readonly resources: ResourcesService,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
  ) {}

  // The company as the plan is held to now: the request's scope, the live departments and their managers in office, and
  // the room -- the request's bound, or what the storage budget holds now, whichever is less.
  async factsOf(req: Pick<StaffingRecord, "orbitId" | "departmentId" | "maxHires" | "resources">): Promise<StaffingFacts> {
    const managers = (await this.appointmentsRepo.incumbents(req.orbitId)).managers;
    const departments = (await this.departments.list(req.orbitId)).map((d) => ({ id: d.id, name: d.name, manager: managers.get(d.id)?.name ?? null }));
    const room = await this.resources.hiresThatFit(req.orbitId, req.resources);
    return { departmentId: req.departmentId, departments, maxHires: Math.min(req.maxHires, room.fit) };
  }

  // What the CEO is asked beyond an answer, for a hiring request's turn: the hiring section.
  async taskOf(turn: TurnRecord): Promise<PromptTask | null> {
    const req = await this.staffing.ofTurn(turn.orbitId, turn.id);
    if (req === null) return null;
    const f = await this.factsOf(req);
    const scope = f.departments.find((d) => d.id === req.departmentId);
    return {
      tag: "hiring",
      lines: [
        "This message is the owner's HIRING REQUEST: plan who to hire for it, then end your answer with ONE ```orbit-staffing block (rule 7).",
        req.departmentId === null ? "Scope: the whole company -- a hire goes into one of the departments below, or into a department the plan makes." : `Scope: the department "${scope?.name ?? "?"}" only -- every hire goes into it, and the plan makes no department.`,
        "The departments now, each with its manager in office:",
        ...(f.departments.length > 0 ? f.departments.map((d) => `- ${d.name}: ${d.manager === null ? "no manager" : `manager ${d.manager}`}`) : ["- (none yet)"]),
        `Bounds: at most ${f.maxHires} hire(s)${req.departmentId === null ? `, and at most ${STAFFING_LIMITS.departments} new department(s)` : ""}.`,
        'Managers: a department the plan makes gets exactly one hire with "role": "manager"; a department with no manager may get one; a department whose manager is in office gets none. Every other hire is "role": "member". Never a CEO.',
        "Write each hire's title, duties, instructions and skills in the language of the owner's request; \"languages\" lists the languages each one works in. Duties say what the person is responsible for; instructions say how they work: what to read first, what to produce, when to ask.",
        "Every hire runs on the model and the resources the owner chose for this request: you choose the people, never a model, a connection or resources.",
      ],
    };
  }

  // A hiring request's turn ended (inside its transaction): its plan is carried out, or the request ends saying why.
  async settled(turn: TurnRecord, raw: string | null, ended: { completed: boolean; detail: string | null }): Promise<void> {
    const req = await this.staffing.ofTurn(turn.orbitId, turn.id, true);
    if (req === null || req.state !== "planning") return;
    if (!ended.completed) return this.end(req, "failed", null, outcomeOf([`The CEO's answer did not complete${ended.detail ? ` (${ended.detail})` : ""}: nothing was hired. Send the request again.`]), null);
    const read = readStaffing(raw, await this.factsOf(req));
    if (read.plan === null || read.problems.length > 0) return this.end(req, "refused", read.plan, outcomeOf(read.problems), null);
    const owner = await this.accounts.ownerNow(req.orbitId, req.userId, req.sessionId);
    if (owner === null) return this.end(req, "refused", read.plan, outcomeOf(["The person who sent this request can no longer act for the company: nothing was hired."]), null);
    const actor = deferredOwnerActor(owner, `staffing:${req.id}`);
    const before = this.preflight(req, read);
    if (before.length > 0) return this.end(req, "refused", read.plan, outcomeOf(before), actor);
    try {
      const done = await this.db.tx(() => this.carryOut(actor, req, read));
      return await this.end(req, "hired", read.plan, done, actor);
    } catch (err) {
      const why = err instanceof DomainError ? err.message : `Orbit could not carry the plan out (${err instanceof Error ? err.message : String(err)}).`;
      return this.end(req, err instanceof DomainError ? "refused" : "failed", read.plan, outcomeOf([`${why} Nothing was hired.`]), actor);
    }
  }

  // Every hire as the hire itself will check it, before anything is made: each one's problems, all of them.
  private preflight(req: StaffingRecord, read: ReadStaffing): string[] {
    return read.hires.flatMap((h) => {
      const c = checkHireEmployee(this.hireOf(req, h, h.departmentId ?? NOT_YET));
      return c.ok ? [] : c.errors.map((e) => `${h.name}: ${e}.`);
    });
  }

  private hireOf(req: StaffingRecord, h: PlannedHire, departmentId: string): HireEmployeeRequest {
    return {
      name: h.name,
      departmentId,
      profile: { title: h.title, duties: h.duties, instructions: h.instructions, skills: h.skills, languages: h.languages, knowledge: [], execution: req.execution, handoffStandard: "", reportingRule: "", canDelegate: h.role === "manager", maxAssistants: ASSISTANTS, canHirePermanent: false },
      resources: req.resources,
    };
  }

  // The departments made, everyone hired (on probation), the managers appointed -- each through its own command, as the
  // person who asked. Inside a savepoint: one refusal rolls back all of it.
  private async carryOut(actor: Actor, req: StaffingRecord, read: ReadStaffing): Promise<StaffingOutcome> {
    const made = new Map<string, { id: string; name: string }>();
    for (const name of read.departments) {
      const d = await this.office.createDepartment(actor, { name });
      made.set(name, { id: d.id, name: d.name });
    }
    const hired: StaffingOutcome["hired"] = [];
    for (const h of read.hires) {
      const department = h.departmentId !== null ? { id: h.departmentId, name: h.department } : (made.get(h.newDepartment as string) as { id: string; name: string });
      const employeeId = await this.hiring.hire(actor, this.hireOf(req, h, department.id));
      hired.push({ employeeId, name: h.name, departmentId: department.id, departmentName: department.name, role: h.role });
    }
    const appointed: StaffingOutcome["appointed"] = [];
    for (const m of hired.filter((x) => x.role === "manager")) {
      await this.appointments.appoint(actor, { role: "manager", departmentId: m.departmentId, employeeId: m.employeeId, reason: "Appointed on the owner's hiring request." });
      appointed.push({ employeeId: m.employeeId, name: m.name, departmentName: m.departmentName });
    }
    return { hired, departmentsCreated: [...made.values()], appointed, problems: [] };
  }

  // The request ends once: Orbit's report in the conversation, the request's state, and the record of it.
  private async end(req: StaffingRecord, state: Exclude<StaffingState, "planning">, plan: StaffingPlan | null, outcome: StaffingOutcome, actor: Actor | null): Promise<void> {
    const at = new Date().toISOString();
    const report = this.reportOf(req, state, outcome, at);
    const row = await this.repo.addMessage({ id: randomUUID(), orbitId: req.orbitId, conversationId: req.conversationId, role: "system", authorName: "Orbit", text: report.title, report, at });
    if ((await this.staffing.end(req.orbitId, req.id, { state, plan, outcome, reportMessageId: row === null ? null : String(row.id), at })) === null) return;
    if (row !== null) await this.stream.publish(req.orbitId, req.conversationId, "executive.message.created", { message: messageView(row, null) }, null);
    const by = actor ?? systemActor(req.orbitId, "staffing", `staffing:${req.id}`);
    await this.governance.recorded(by, "executive.staffing", "staffing", req.id, 1, `${state}: ${outcome.hired.length} hired, ${outcome.departmentsCreated.length} department(s) made, ${outcome.appointed.length} manager(s) appointed${outcome.problems.length > 0 ? `; ${outcome.problems[0]}` : ""}`);
  }

  private reportOf(req: StaffingRecord, state: Exclude<StaffingState, "planning">, o: StaffingOutcome, at: string): ExecutiveReport {
    const title = state === "hired" ? `Hired ${o.hired.length} employee${o.hired.length === 1 ? "" : "s"} on your hiring request` : state === "refused" ? "Your hiring request was not carried out" : "Your hiring request ended without a plan";
    const runsOn = `${req.execution.runtime}${req.execution.model ? ` ${req.execution.model}` : ""}${(req.execution.inherit ?? []).length > 0 ? " (with the defaults)" : ""}`;
    return {
      kind: "staffing",
      title,
      at,
      facts: [
        { label: "Request", value: firstLine(req.requirement) },
        { label: "Departments made", value: o.departmentsCreated.map((d) => d.name).join(", ") || "none" },
        { label: "Managers appointed", value: o.appointed.map((m) => `${m.name} (${m.departmentName})`).join(", ") || "none" },
        { label: "Runs on", value: runsOn },
      ],
      items: [
        ...o.hired.map((h) => ({ title: h.name, detail: `${h.role === "manager" ? "manager" : "member"} of ${h.departmentName}, on probation`, href: `#/office/employee/${h.employeeId}`, tone: "ok" as const })),
        ...o.problems.map((p) => ({ title: p, detail: "", href: null, tone: "danger" as const })),
      ],
    };
  }
}
