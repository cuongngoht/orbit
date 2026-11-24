// WORK MANAGEMENT's commands: the ONE write path for giving work and deciding on its result.
//
// CREATE (POST /api/missions, Idempotency-Key): in ONE transaction, holding the employee's row first -- authorize under
// the account's policy, check eligibility, sources and the execution asked, create the mission and its assignment, and
// either CLAIM the employee now (reservation + run intent + events) or QUEUE it. "Start now" on a busy employee answers
// 409 employee_busy and creates NOTHING; "enqueue" queues it (202). The same key and request answer the same result.
//
// REVIEW: accept and request-revision name the handoff digest the person was looking at, and the assignment version
// (If-Match); a newer handoff or version refuses them. A revision keeps the employee and starts a new attempt under a
// new fence; an acceptance completes the assignment and releases its reservation in the same transaction, after which
// the scheduler gives the employee its next queued work.
//
// TARGETS (ADR 0061 §8): a mission goes to an employee by name, to a DEPARTMENT (its manager in office) or to the CEO --
// resolved in the same transaction from the slot as it is then, and refused when it moved from what the person saw
// (409 target_changed), when nobody holds it (no_ceo, no_manager) or its holder is suspended (appointment_suspended).
//
// RUN OUTCOMES (RunOutcomes, reported by Execution): Work decides what a run's end means for the assignment.
import { Inject, Injectable, type OnModuleInit, Optional } from "@nestjs/common";
import type { MissionRepositoryRequest } from "@orbit-web/contracts";
import { MISSION_REPOSITORIES, type MissionRepositories, type MissionRepository as ResolvedRepository } from "./mission-repositories.port.js";
import {
  checkAccept,
  checkHandOver,
  checkAnswer,
  checkCreateMission,
  checkReason,
  checkRequestRevision,
  isIdempotencyKey,
  isWorkforceId,
  type ClarificationKind,
  type CommandResult,
  type EmployeeBusyDetails,
  type ExpectedAssignee,
  type MissionAccepted,
  type MissionTarget,
  type MissionTargetPreview,
} from "@orbit-web/contracts";
import { createHash, randomUUID } from "node:crypto";
import { accepted } from "../../../common/errors.js";
import { Db } from "../../../infra/db/db.js";
import { RunRequests } from "../../execution/application/run-requests.js";
import type { AttemptContext, DelegatedUnit, RunEnd, RunOutcomes, SubmittedHandoff, TeamRoom } from "../../execution/application/run-outcomes.port.js";
import { scopeIsEmpty } from "../domain/authority.js";
import { CEO_NEEDS_DEPARTMENTS, resolveMissionTarget, sameAssignee, type ResolvedMissionTarget } from "../domain/target.js";
import { handInRefusal, rulesOf } from "../domain/roles.js";
import { allEnded, DONE } from "../domain/team.js";
import { OrgReader } from "../infrastructure/org.reader.js";
import { ClarificationsService } from "./clarifications.service.js";
import { OfficeGovernance, systemActor, type Actor } from "../../shared/application/commands.js";
import { conflictWith, DomainError, invalid, missing, stale, unprocessable, type RaisedEvent } from "../../shared/domain.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { Idempotency, type IdempotencyScope, type StoredAnswer } from "../../shared/infrastructure/idempotency.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { EmployeeEligibility, type Eligibility } from "../../workforce/application/eligibility.js";
import { HiringService } from "../../workforce/application/hiring.service.js";
import { Assignment, type Pinned } from "../domain/assignment.js";
import { Mission } from "../domain/mission.js";
import { DecisionRepository } from "../infrastructure/decisions.js";
import { AssignmentRepository, HandoffRepository, MissionRepository } from "../infrastructure/repositories.js";
import { SourcesCheck } from "../infrastructure/sources.check.js";
import { AttemptDataService } from "./attempt-data.service.js";
import { TeamService } from "./team.service.js";

const AGING_MINUTES = 30;

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};

// The digest an acceptance names: the handoff's manifest and every artifact's hash.
export const handoffDigest = (o: { assignmentId: string; revision: number; summary: string; artifacts: { name: string; sha256: string; size: number }[]; claims: unknown[] }): string =>
  createHash("sha256").update(canonical({ ...o, artifacts: [...o.artifacts].sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ name: a.name, sha256: a.sha256, size: a.size })) })).digest("hex");

@Injectable()
export class MissionsService implements OnModuleInit, RunOutcomes {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(MissionRepository) private readonly missions: MissionRepository,
    @Inject(AssignmentRepository) private readonly assignments: AssignmentRepository,
    @Inject(HandoffRepository) private readonly handoffs: HandoffRepository,
    @Inject(DecisionRepository) private readonly decisions: DecisionRepository,
    @Inject(EmployeeEligibility) private readonly eligibility: EmployeeEligibility,
    @Inject(HiringService) private readonly hiring: HiringService,
    @Inject(RunRequests) private readonly runs: RunRequests,
    @Inject(SourcesCheck) private readonly sources: SourcesCheck,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(Idempotency) private readonly idempotency: Idempotency,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Inject(EventDispatcher) private readonly dispatcher: EventDispatcher,
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(AttemptDataService) private readonly attemptData: AttemptDataService,
    @Inject(ClarificationsService) private readonly clarifications: ClarificationsService,
    @Inject(OrgReader) private readonly org: OrgReader,
    @Optional() @Inject(MISSION_REPOSITORIES) private readonly repositories: MissionRepositories | null = null,
  ) {}

  onModuleInit(): void {
    this.hiring.useHeldWork({
      holds: async (orbitId, employeeId) => (await this.assignments.heldBy(orbitId, employeeId)) !== null,
      pauseHeld: (actor, employeeId, reason) => this.onHeld(actor, employeeId, async (a) => this.pauseIn(actor, a, reason)),
      cancelHeld: (actor, employeeId, reason) => this.onHeld(actor, employeeId, async (a) => this.cancelIn(actor, a, reason)),
    });
    // THE CASCADE: a lead that ends takes its open parts with it; an asker that ends withdraws its question.
    this.dispatcher.register({ id: "work.cascade", types: ["AssignmentCancelled", "AssignmentFailed"], handle: async (e) => this.cascade(e.accountId, e.aggregateId, e.correlationId, e.id) });
    // THE SCHEDULER: when an employee lets go of an assignment, becomes able to work, or gets queued work, the next item
    // of its queue is claimed through the same claim as a person's "start now".
    this.dispatcher.register({
      id: "work.scheduler",
      types: ["ReservationReleased", "AssignmentQueued", "EmployeeActivated", "SandboxReady", "ConnectionChanged", "EmployeeEmploymentChanged", "AssignmentHandedOver"],
      handle: async (event) => {
        const employeeId = typeof event.payload.employeeId === "string" ? event.payload.employeeId : event.aggregateType === "employee" ? event.aggregateId : null;
        if (employeeId !== null) await this.claimNext(event.accountId, employeeId, event.correlationId, event.id);
        else if (event.type === "ConnectionChanged") for (const id of await this.queuedEmployees(event.accountId)) await this.claimNext(event.accountId, id, event.correlationId, event.id);
      },
    });
  }

  // ---- giving work ------------------------------------------------------------------------------------------------

  // `origin`: the schedule and occurrence that made this mission (the scheduler's), null for a person's.
  async create(actor: Actor, body: unknown, key: unknown, origin: { scheduleId: string; occurrenceId: string } | null = null): Promise<StoredAnswer> {
    if (isRecord(body) && body.target !== undefined && body.targetEmployeeId !== undefined) {
      const t = body.target as { kind?: unknown; employeeId?: unknown };
      if (t?.kind !== "employee" || t.employeeId !== body.targetEmployeeId) throw unprocessable("target_conflict", "target and targetEmployeeId name different employees: send one of them.");
    }
    const req = accepted(checkCreateMission(body));
    if (!isIdempotencyKey(key)) throw invalid("idempotency_key_required", "Send an Idempotency-Key header (8-128 letters, digits, dots, dashes, colons or underscores) with every new mission.");
    const orbitId = actor.command.orbitId;
    const scope: IdempotencyScope = { orbitId, actor: actor.command.actor, operation: "missions.create", key };
    try {
      return await this.governance.command(actor, "mission.create", req.target.kind === "employee" ? req.target.employeeId : req.target.kind, async () => {
        // A replay answers what the first request was answered, even after the slot moved.
        const prior = await this.idempotency.begin(scope, req);
        if (prior !== null) return prior;
        const resolved = await this.resolveTarget(orbitId, req.target, req.expectedAssignee ?? null);
        const employeeId = resolved.employeeId;
        await this.governance.authorize(actor, "work.assign", employeeId, { employee: employeeId });
        const el = await this.eligibility.of(orbitId, employeeId, true);
        if (el === null) throw missing("Employee");
        // The CEO gives work only to departments (roles.ts): by its slot or by its name, work for it waits for nobody.
        if (el.appointment?.role === "ceo" && el.appointment.active && (await this.org.departmentsManaged(orbitId)) === 0) throw conflictWith("ceo_needs_departments", CEO_NEEDS_DEPARTMENTS, { target: req.target });
        if (req.workspaceId !== null) await this.sources.check(orbitId, req.workspaceId, req.sourceRevisionIds);
        const repositories = await this.repositoriesFor(orbitId, employeeId, req.repositories);
        const execution = req.execution === undefined ? el.execution : await this.hiring.executionFor(orbitId, { ...el.execution, ...(req.execution.model !== undefined ? { model: req.execution.model } : {}), ...(req.execution.effort !== undefined ? { effort: req.execution.effort } : {}) }, el.departmentId);
        const held = await this.assignments.heldBy(orbitId, employeeId);
        if ((held !== null || !el.eligible) && req.whenBusy === "reject") throw await this.busy(orbitId, employeeId, held, el, actor.command.correlationId);
        const at = new Date().toISOString();
        const mission = Mission.create({ id: randomUUID(), orbitId, title: req.title, goal: req.goal, createdBy: actor.command.actor, acceptanceMode: req.acceptanceMode, acceptanceCriteria: req.acceptanceCriteria, deliverables: req.deliverables, researchWorkspaceId: req.workspaceId, sourceRevisionIds: req.sourceRevisionIds, deadline: req.deadline, priority: req.priority, scheduleId: origin?.scheduleId ?? null, occurrenceId: origin?.occurrenceId ?? null, createdAt: at });
        const target = { kind: req.target.kind, departmentId: req.target.kind === "department" ? req.target.departmentId : null, appointmentId: resolved.appointmentId, appointmentRevision: resolved.appointmentRevision };
        const a = Assignment.queued({ id: randomUUID(), orbitId, missionId: mission.id, parentId: null, unitKey: "root", employeeId, brief: { goal: req.goal, deliverables: req.deliverables, acceptanceCriteria: req.acceptanceCriteria, revisions: [], answers: [] }, execution: req.execution ?? null, priority: req.priority, eligibleAt: at, deadline: req.deadline, createdBy: actor.command.actor, createdAt: at, target });
        await this.missions.insert(mission);
        if (repositories.length > 0) await this.repositories?.keep(orbitId, mission.id, repositories, actor.command.actor);
        // A mission given to someone who may give parts of it gets its room at once (its first attempt can prepare it).
        if (!scopeIsEmpty(await this.team.scope(orbitId, a))) await this.team.ensureRoom(orbitId, mission.id, el.employeeId);
        const claimNow = held === null && el.eligible;
        if (claimNow) a.claim(this.pinOf(el, execution, req.execution ?? null), at);
        await this.assignments.save(a);
        const events: RaisedEvent[] = [...mission.pullEvents(), ...a.pullEvents()];
        if (claimNow) events.push(await this.runs.request({ orbitId, assignmentId: a.id, missionId: mission.id, employeeId: a.data.employeeId, fence: a.data.fence, priority: a.data.priority, execution, wake: "given the work" }));
        await this.outbox.append(actor.command, events);
        const resourceVersion = await this.outbox.touched(orbitId, ["roster", "missions"], mission.id);
        await this.governance.recorded(actor, "mission.create", "mission", mission.id, 1, `${claimNow ? "claimed" : "queued"} for ${el.name}`);
        const answer: StoredAnswer = {
          status: claimNow ? 201 : 202,
          body: { missionId: mission.id, assignmentId: a.id, state: a.state, employeeId: a.data.employeeId, resourceVersion, href: `#/office/mission/${mission.id}`, correlationId: actor.command.correlationId } satisfies MissionAccepted,
        };
        await this.idempotency.complete(scope, req, answer);
        return answer;
      });
    } catch (err) {
      // A refusal is the answer to this key too: the same request again gets the same answer, without running again.
      if (err instanceof DomainError && ["employee_busy", "employee_ineligible", "target_changed", "no_ceo", "no_manager", "appointment_suspended", "not_working", "ceo_needs_departments"].includes(err.code)) {
        await this.db.tx(() => this.idempotency.complete(scope, req, { status: 409, body: { error: { code: err.code, message: err.message, details: err.details } } })).catch(() => undefined);
      }
      throw err;
    }
  }

  // Who a target names NOW, its slot's row held: refused when nobody holds it, its holder is suspended, or it is not who
  // the person saw before sending (`expected`).
  private async resolveTarget(orbitId: string, target: MissionTarget, expected: ExpectedAssignee | null): Promise<ResolvedMissionTarget> {
    const r = resolveMissionTarget(target, await this.org.slot(orbitId, target, true));
    if ("code" in r) throw conflictWith(r.code, r.message, { target });
    if (expected !== null && !sameAssignee(expected, r)) throw conflictWith("target_changed", "Who is responsible for this target changed since you looked: check, then send it again.", { current: await this.previewOf(orbitId, target, r) });
    return r;
  }

  // GET /api/missions/target: who would be responsible for a target now (or why nobody is), as a person sees it.
  async preview(orbitId: string, target: MissionTarget): Promise<MissionTargetPreview> {
    const slot = await this.org.slot(orbitId, target, false);
    const r = resolveMissionTarget(target, slot);
    if ("code" in r) return { target, responsible: null, code: r.code, reason: r.message };
    return { target, responsible: await this.previewOf(orbitId, target, r), code: null, reason: null };
  }

  private async previewOf(orbitId: string, target: MissionTarget, r: ResolvedMissionTarget): Promise<MissionTargetPreview["responsible"]> {
    const e = await this.db.one("SELECT name FROM workforce.employees WHERE account_id = $1 AND id = $2", [orbitId, r.employeeId]);
    if (e === null) throw missing("Employee");
    const departmentName = target.kind === "department" ? await this.org.departmentName(orbitId, target.departmentId) : null;
    return { employeeId: r.employeeId, appointmentId: r.appointmentId, appointmentRevision: r.appointmentRevision, employeeName: String(e.name), role: target.kind === "ceo" ? "ceo" : target.kind === "department" ? "manager" : null, departmentName };
  }

  private async busy(orbitId: string, employeeId: string, held: Assignment | null, el: Eligibility, correlationId: string): Promise<DomainError> {
    if (held === null) return conflictWith("employee_ineligible", el.reason ?? "This employee cannot take work now.", { employeeId, holding: null, correlationId });
    const m = await this.missions.get(orbitId, held.data.missionId);
    const details: EmployeeBusyDetails = { employeeId, holding: { assignmentId: held.id, missionId: held.data.missionId, title: m?.data.title ?? "", state: held.state, since: held.data.claimedAt ?? held.data.createdAt }, correlationId };
    return conflictWith("employee_busy", `${el.name} is already working on "${details.holding?.title ?? ""}". Choose another employee, or queue it.`, details);
  }

  // The next queued item of an employee, claimed exactly as "start now" claims: the employee's row first, then the queue.
  async claimNext(orbitId: string, employeeId: string, correlationId: string, causationId: string | null): Promise<string | null> {
    return this.db.tx(async () => {
      const el = await this.eligibility.of(orbitId, employeeId, true);
      if (el === null || !el.eligible) return null;
      if ((await this.assignments.heldBy(orbitId, employeeId)) !== null) return null;
      const next = await this.assignments.nextQueued(orbitId, employeeId, AGING_MINUTES);
      if (next === null) return null;
      const actor = systemActor(orbitId, "scheduler", correlationId, causationId);
      const execution = next.data.execution === null ? el.execution : { ...el.execution, ...(next.data.execution.model !== undefined ? { model: next.data.execution.model } : {}), ...(next.data.execution.effort !== undefined ? { effort: next.data.execution.effort } : {}) };
      next.claim(this.pinOf(el, execution, next.data.execution), new Date().toISOString());
      await this.assignments.save(next);
      const events = [...next.pullEvents(), await this.runs.request({ orbitId, assignmentId: next.id, missionId: next.data.missionId, employeeId, fence: next.data.fence, priority: next.data.priority, execution, wake: next.data.parentId === null ? "its queued work came up" : "a part its lead gave it came up" })];
      await this.outbox.append(actor.command, events);
      await this.outbox.touched(orbitId, ["roster", "missions"], next.data.missionId);
      return next.id;
    });
  }

  private async queuedEmployees(orbitId: string): Promise<string[]> {
    return (await this.db.query("SELECT DISTINCT employee_id FROM workforce.assignments WHERE account_id = $1 AND state = 'QUEUED'", [orbitId])).map((r) => String(r.employee_id));
  }

  // What a claim pins: the profile revision, the department, and the execution with the layer each field came from (a
  // mission's own override of the model or effort beats the employee's, which beats its department's and the company's).
  private pinOf(el: Eligibility, execution: Eligibility["execution"], override: { model?: string; effort?: string | null } | null = null): Pinned {
    const sources = { ...el.sources, ...(override?.model !== undefined ? { model: "mission" as const } : {}), ...(override?.effort !== undefined ? { effort: "mission" as const } : {}) };
    return { profileRevision: el.profileRevision, departmentId: el.departmentId, departmentName: el.departmentName, execution, sources };
  }

  // ---- deciding on a result --------------------------------------------------------------------------------------

  async accept(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkAccept(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.accept", async (a) => {
      this.reviewedByOwner(a);
      const h = await this.handoffs.latest(actor.command.orbitId, a.id);
      if (h === null || h.digest !== req.handoffDigest || h.status !== "submitted") throw conflictWith("stale_handoff", "The handoff you reviewed is no longer the one waiting for a decision: load the latest.", { current: h?.digest ?? null });
      const at = new Date().toISOString();
      // The attempt that handed in may still be ending: it is asked to stop (its workspace is published once it has).
      await this.runs.stop(actor.command.orbitId, a.id, "accepted");
      a.accept(h.revision, actor.command.actor, at);
      await this.handoffs.review(actor.command.orbitId, a.id, h.revision, "accepted", { by: actor.command.actor, at, note: req.note });
      await this.decisions.closeAllFor(actor.command.orbitId, a.id, "accepted");
      if (a.data.parentId === null) {
        const m = await this.missions.get(actor.command.orbitId, a.data.missionId, true);
        if (m !== null && m.data.state === "open") {
          m.complete(at);
          await this.missions.save(m);
        }
      }
      return [];
    });
  }

  async requestRevision(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkRequestRevision(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.request_revision", async (a) => {
      this.reviewedByOwner(a);
      const h = await this.handoffs.latest(actor.command.orbitId, a.id);
      if (h === null || h.digest !== req.handoffDigest || h.status !== "submitted") throw conflictWith("stale_handoff", "The handoff you reviewed is no longer the one waiting for a decision: load the latest.", { current: h?.digest ?? null });
      const at = new Date().toISOString();
      const fence = a.requestRevision(req.criteria, actor.command.actor, at);
      await this.handoffs.review(actor.command.orbitId, a.id, h.revision, "revision_requested", { by: actor.command.actor, at, note: req.criteria });
      await this.decisions.close(actor.command.orbitId, `acceptance:${a.id}`, "resolved", "revision requested", actor.command.actor);
      return [await this.requestRun(a, fence, "the person who gave the work asked for a revision")];
    });
  }

  // A part's hand-in is its lead's to review, never the person's: the review follows the tree.
  private reviewedByOwner(a: Assignment): void {
    if (a.data.parentId !== null) throw conflictWith("reviewed_by_lead", "This is a part of a team's work: its lead reviews it. Review the mission's result when its lead hands it in.");
  }

  async cancel(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkReason(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.cancel", async (a) => this.cancelIn(actor, a, req.reason));
  }

  async pause(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkReason(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.pause", async (a) => this.pauseIn(actor, a, req.reason));
  }

  // A pause undone: work that waited (a lead for its team, a question for its answer) waits again; work that was acting
  // gets a new attempt.
  async resume(actor: Actor, id: string, expectedVersion: number): Promise<CommandResult> {
    return this.onAssignment(actor, id, expectedVersion, "assignment.resume", async (a) => {
      const fence = a.resume(new Date().toISOString());
      return fence === null ? [] : [await this.requestRun(a, fence, "resumed by a person")];
    });
  }

  // A blocked assignment tried again (after its reason was dealt with): a new attempt.
  async retry(actor: Actor, id: string, expectedVersion: number): Promise<CommandResult> {
    return this.onAssignment(actor, id, expectedVersion, "assignment.retry", async (a) => {
      if (a.state === "BLOCKED" && (await this.clarifications.openQuestionOf(actor.command.orbitId, a.id)) !== null) throw conflictWith("waiting_for_answer", "It waits for the answer to its question: answer it (or have its lead answer it) instead of retrying.");
      const fence = a.state === "RECOVERING" ? a.recovered(new Date().toISOString()) : a.unblock(new Date().toISOString(), null);
      await this.decisions.closeAllFor(actor.command.orbitId, a.id, "retried");
      return [await this.requestRun(a, fence, "retried by a person")];
    });
  }

  // A HANDOVER: open work moves to another employee, by a person's act (a replaced appointment moves none by itself).
  // Only before or between attempts: an attempt still running refuses it (pause it first); one asked for and not started
  // is cancelled. Work held is re-pinned to its new holder -- able to take it now -- with a new fence (a late result of the
  // old holder's attempt is refused), and an ASSIGNED one gets a new attempt.
  async handOver(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkHandOver(body));
    const orbitId = actor.command.orbitId;
    return this.governance.command(actor, "assignment.hand_over", id, async () => {
      const a = isWorkforceId(id) ? await this.assignments.get(orbitId, id, true) : null;
      if (a === null) throw missing("Assignment");
      await this.governance.authorize(actor, "work.assign", req.employeeId, { employee: req.employeeId, from: a.data.employeeId });
      if (a.data.version !== expectedVersion) throw stale("This assignment changed since you read it: load the latest.", { version: a.data.version });
      const live = await this.runs.live(orbitId, a.id);
      if (live !== null && ["starting", "running", "unknown"].includes(live.state)) throw conflictWith("attempt_live", "An attempt of this work is running: pause it first, then hand it over.");
      const el = await this.eligibility.of(orbitId, req.employeeId, true);
      if (el === null) throw missing("Employee");
      if (a.holding && !el.eligible) throw conflictWith("employee_ineligible", el.reason ?? "That employee cannot take work now.", { employeeId: req.employeeId });
      await this.runs.stop(orbitId, a.id, "handed_over");
      const at = new Date().toISOString();
      const from = a.handOver({ employeeId: req.employeeId, pinned: a.holding ? this.pinOf(el, el.execution) : null }, at);
      const version = await this.assignments.handOver(a, from);
      const events = a.pullEvents();
      if (a.state === "ASSIGNED") events.push(await this.requestRun(a, a.data.fence, "handed over"));
      await this.outbox.append(actor.command, events);
      const resourceVersion = await this.outbox.touched(orbitId, ["roster", "missions", "inbox"], a.data.missionId);
      await this.governance.recorded(actor, "assignment.hand_over", "assignment", a.id, version, `${from} → ${req.employeeId}${req.reason ? `: ${req.reason}` : ""}`);
      return { assignmentId: a.id, state: a.state, version, resourceVersion, correlationId: actor.command.correlationId };
    });
  }

  // A REPIN: work blocked or paused continues on its employee's profile in effect NOW (after a provider changed, say) --
  // a person's choice, never automatic. The brief, its answers and revisions, the hand-ins and the sources are Orbit's
  // records, so the next attempt -- on the new provider -- starts from them.
  async repin(actor: Actor, id: string, expectedVersion: number): Promise<CommandResult> {
    return this.onAssignment(actor, id, expectedVersion, "assignment.repin", async (a) => {
      const el = await this.eligibility.of(actor.command.orbitId, a.data.employeeId, true);
      if (el === null) throw missing("Employee");
      if (!el.eligible) throw conflictWith("employee_ineligible", el.reason ?? "This employee cannot take work now.", { employeeId: a.data.employeeId });
      a.repin(this.pinOf(el, el.execution, a.data.execution), new Date().toISOString());
      return [];
    });
  }

  // A person's answer to a question asked of THEM (the root's, or one moved up to them); one asked of a lead is the
  // lead's (409 asked_of_lead).
  async answer(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkAnswer(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.answer", async (a) => this.clarifications.answerByOwner(actor, a, req.answer));
  }

  private async pauseIn(actor: Actor, a: Assignment, reason: string): Promise<RaisedEvent[]> {
    await this.runs.stop(actor.command.orbitId, a.id, "paused");
    a.pause(reason, new Date().toISOString());
    return [];
  }

  // A cancel ends the work, and with it -- in the same transaction -- the question it asked (and a person's item for it).
  private async cancelIn(actor: Actor, a: Assignment, reason: string): Promise<RaisedEvent[]> {
    const live = await this.runs.stop(actor.command.orbitId, a.id, "cancelled");
    a.cancel(live, reason, new Date().toISOString());
    if (a.state === "CANCELLED") await this.endedAssignment(actor, a);
    return this.clarifications.withdrawFor(actor.command.orbitId, a.id);
  }

  private async requestRun(a: Assignment, fence: number, wake: string): Promise<RaisedEvent> {
    const execution = a.data.pinned?.execution;
    if (execution === undefined) throw conflictWith("invalid_transition", "This assignment was never claimed.");
    return this.runs.request({ orbitId: a.orbitId, assignmentId: a.id, missionId: a.data.missionId, employeeId: a.data.employeeId, fence, priority: a.data.priority, execution, wake });
  }

  private async onHeld(actor: Actor, employeeId: string, work: (a: Assignment) => Promise<RaisedEvent[]>): Promise<void> {
    const a = await this.assignments.heldBy(actor.command.orbitId, employeeId);
    if (a === null) return;
    const locked = (await this.assignments.get(actor.command.orbitId, a.id, true)) as Assignment;
    const events = await work(locked);
    await this.assignments.save(locked);
    await this.outbox.append(actor.command, [...events, ...locked.pullEvents()]);
  }

  // One command on one assignment: authorized, the version the person read checked (If-Match), saved with its events.
  private async onAssignment(actor: Actor, id: string, expectedVersion: number, name: string, work: (a: Assignment) => Promise<RaisedEvent[]>): Promise<CommandResult> {
    const orbitId = actor.command.orbitId;
    return this.governance.command(actor, name, id, async () => {
      const a = isWorkforceId(id) ? await this.assignments.get(orbitId, id, true) : null;
      if (a === null) throw missing("Assignment");
      await this.governance.authorize(actor, "work.assign", a.data.employeeId, { employee: a.data.employeeId });
      if (a.data.version !== expectedVersion) throw stale("This assignment changed since you read it: load the latest.", { version: a.data.version });
      const events = await work(a);
      const version = await this.assignments.save(a);
      await this.outbox.append(actor.command, [...events, ...a.pullEvents()]);
      const resourceVersion = await this.outbox.touched(orbitId, ["roster", "missions", "inbox"], a.data.missionId);
      await this.governance.recorded(actor, name, "assignment", a.id, version, a.state);
      return { assignmentId: a.id, state: a.state, version, resourceVersion, correlationId: actor.command.correlationId };
    });
  }

  // ---- what Execution reports (RunOutcomes) -------------------------------------------------------------------------

  async current(orbitId: string, assignmentId: string, fence: number): Promise<AttemptContext | null> {
    const a = await this.assignments.get(orbitId, assignmentId);
    if (a === null) return null;
    const m = await this.missions.get(orbitId, a.data.missionId);
    const el = await this.eligibility.of(orbitId, a.data.employeeId, false);
    const pinned = a.data.pinned?.profileRevision ?? null;
    const profile = el === null ? null : pinned === null || pinned === el.profileRevision ? el.profile : await this.hiring.profileAt(orbitId, a.data.employeeId, pinned);
    const b = a.data.brief;
    // What THIS attempt may read: the mission's sources for its root, what its lead shared for a part (§9).
    const data = await this.attemptData.of(orbitId, a.id);
    const { scope, role } = await this.team.standing(orbitId, a);
    const rules = rulesOf(role, a.data.parentId === null);
    const lead = a.data.parentId === null ? null : await this.assignments.get(orbitId, a.data.parentId);
    const leadName = lead === null ? null : await this.employeeName(orbitId, lead.data.employeeId);
    return {
      // Its attempt acts only while it is the current one AND the work is in a state that runs one: an attempt that
      // delegated, asked or handed in has ended its work (its tools close), whatever its CLI still does.
      current: a.acting(fence),
      missionId: a.data.missionId,
      createdBy: a.data.createdBy,
      missionTitle: m?.data.title ?? "",
      brief: { goal: b.goal, deliverables: b.deliverables, acceptanceCriteria: b.acceptanceCriteria, revisions: b.revisions, answers: b.answers },
      deliverables: b.deliverables,
      sources: data?.sources ?? [],
      data: { handoffs: data?.handoffs ?? [], withheld: data?.withheld ?? [] },
      // The mission's repositories come to the employee it was given to, never to a colleague given a part of it.
      repositories: data?.repositories === true && this.repositories !== null ? await this.repositories.of(orbitId, a.data.missionId) : [],
      team: {
        role,
        denied: rules.denied,
        connectorsDenied: rules.connectorsDenied,
        canDelegate: !scopeIsEmpty(scope),
        scope: { employees: scope.employees.map((e) => ({ id: e.id, name: e.name, title: e.title, departmentName: e.departmentName, via: e.via })), departments: scope.departments.map((d) => ({ id: d.id, name: d.name, managerName: d.manager?.name ?? null, via: d.via })) },
        units: await this.team.units(orbitId, a.id),
        questions: (await this.team.openQuestions(orbitId, a.id)).map((q) => ({ id: q.id, askerName: q.askerName, unitKey: q.askerUnit, question: q.question, askedAt: q.askedAt })),
        lead: leadName === null ? null : { name: leadName },
        planCount: a.data.planCount,
        room: await this.team.room(orbitId, a.data.missionId, el?.departmentId ?? null),
      },
      employee: { id: a.data.employeeId, name: el?.name ?? "", departmentId: el?.departmentId ?? null, appointment: el?.appointment ?? null, profile, eligible: el?.eligible ?? false, reason: el === null ? "The employee no longer exists." : el.reason, sandboxId: el?.sandboxId ?? null },
    };
  }

  async roomFor(orbitId: string, assignmentId: string, departmentId: string | null): Promise<TeamRoom | null> {
    const a = await this.assignments.get(orbitId, assignmentId);
    return a === null ? null : this.team.roomFor(orbitId, a.data.missionId, departmentId);
  }

  // The repositories a new mission asks for, each held to what its employee may use (none bound: none may be asked).
  private async repositoriesFor(orbitId: string, employeeId: string, asked: readonly MissionRepositoryRequest[]): Promise<ResolvedRepository[]> {
    if (asked.length === 0) return [];
    if (this.repositories === null) throw invalid("repositories_unavailable", "This installation brings no repository into an employee's work.");
    return this.repositories.resolve(orbitId, employeeId, asked);
  }

  async started(actor: Actor, assignmentId: string, fence: number): Promise<void> {
    await this.onRun(actor, assignmentId, fence, async (a) => {
      if (a.state === "ASSIGNED" || a.state === "RECOVERING") a.runStarted(fence, new Date().toISOString());
    });
  }

  async handoff(actor: Actor, assignmentId: string, fence: number, h: SubmittedHandoff): Promise<{ revision: number; digest: string; missing: string[] }> {
    const orbitId = actor.command.orbitId;
    const existing = await this.handoffs.bySubmission(orbitId, h.submissionKey);
    if (existing !== null) return { revision: existing.revision, digest: existing.digest, missing: existing.missing };
    let out = { revision: 0, digest: "", missing: [] as string[] };
    await this.onRun(actor, assignmentId, fence, async (a) => {
      if (!a.acting(fence)) throw conflictWith("stale_fence", "This attempt has ended its work: its hand-in is not taken.");
      const parts = await this.team.units(actor.command.orbitId, a.id);
      const refusal = handInRefusal(rulesOf((await this.team.standing(orbitId, a)).role, a.data.parentId === null), parts.length);
      if (refusal !== null) throw conflictWith(refusal.code, refusal.message);
      if (!allEnded(parts)) throw conflictWith("parts_not_ended", `Your team's parts are not all ended (${parts.filter((u) => !DONE.includes(u.state)).map((u) => u.key).join(", ")}): review them before you hand in.`);
      const revision = a.data.handoffRevision + 1;
      const required = a.data.brief.deliverables.filter((d) => d.required).map((d) => d.name);
      const missingNames = required.filter((n) => !h.artifacts.some((x) => x.name === n));
      const digest = handoffDigest({ assignmentId, revision, summary: h.summary, artifacts: h.artifacts, claims: h.claims });
      const at = new Date().toISOString();
      const id = randomUUID();
      await this.handoffs.insert({ id, orbitId, assignmentId, runId: h.runId, revision, digest, summary: h.summary, status: "submitted", claims: h.claims, missing: missingNames, submissionKey: h.submissionKey, submittedBy: actor.command.actor, submittedAt: at, review: null });
      for (const x of h.artifacts) {
        await this.db.query("UPDATE workforce.blobs SET refcount = refcount + 1 WHERE account_id = $1 AND sha256 = $2", [orbitId, x.sha256]);
        await this.db.query("INSERT INTO workforce.artifacts (id, account_id, handoff_id, name, kind, media_type, size, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [randomUUID(), orbitId, id, x.name, x.kind, x.mediaType, x.size, x.sha256, at]);
      }
      await this.db.query("UPDATE workforce.handoffs SET status = 'superseded' WHERE account_id = $1 AND assignment_id = $2 AND revision < $3 AND status = 'submitted'", [orbitId, assignmentId, revision]);
      a.handoffSubmitted(revision, digest, fence, at);
      // A part of a manager's work is reviewed by that manager (it wakes when every part handed in).
      if (a.data.parentId !== null) {
        out = { revision, digest, missing: missingNames };
        return;
      }
      await this.decisions.open({
        orbitId,
        kind: "acceptance",
        missionId: a.data.missionId,
        assignmentId,
        title: `Review revision ${revision}`,
        reason: missingNames.length > 0 ? `Handed in without the required ${missingNames.join(", ")}.` : "A result was handed in for your review.",
        waiting: actor.command.actor,
        deadline: a.data.deadline,
        pin: { assignmentVersion: a.nextVersion, handoffDigest: digest, deliveryId: null },
        dedupKey: `acceptance:${assignmentId}`,
      });
      out = { revision, digest, missing: missingNames };
    });
    return out;
  }

  // A hand-in is a publication of the employee's work (artifact.publish), decided AS the employee, on its assignment,
  // before anything of it is staged: a policy -- the company's or its department's -- that refuses it stores nothing.
  async mayPublish(actor: Actor, assignmentId: string, fence: number): Promise<void> {
    const a = await this.assignments.get(actor.command.orbitId, assignmentId);
    if (a === null) throw missing("Assignment");
    if (a.data.fence !== fence) throw conflictWith("stale_fence", "This attempt was replaced: its hand-in is not taken.");
    await this.governance.authorize(actor, "artifact.publish", assignmentId, { assignment: assignmentId, mission: a.data.missionId });
  }

  // A question its attempt cannot go on without: to its lead (a part), or to the person who gave the work (the root).
  async question(actor: Actor, assignmentId: string, fence: number, question: string): Promise<void> {
    await this.onRun(actor, assignmentId, fence, async (a) => this.clarifications.ask(actor, a, fence, question));
  }

  async answerQuestion(actor: Actor, assignmentId: string, fence: number, clarificationId: string, answer: string): Promise<string> {
    let text = "";
    await this.onRun(actor, assignmentId, fence, async (a) => {
      const r = await this.clarifications.answerByLead(actor, a, fence, clarificationId, answer);
      text = r.text;
      return r.events;
    });
    return text;
  }

  async escalateQuestion(actor: Actor, assignmentId: string, fence: number, clarificationId: string, kind: ClarificationKind, note: string): Promise<string> {
    let text = "";
    await this.onRun(actor, assignmentId, fence, async (a) => {
      const r = await this.clarifications.escalate(actor, a, fence, clarificationId, kind, note);
      text = r.text;
      return r.events;
    });
    return text;
  }

  // A run ended: what it means for the assignment is decided here. A late result of a replaced attempt changes nothing.
  async ended(actor: Actor, assignmentId: string, fence: number, e: RunEnd): Promise<void> {
    await this.onRun(actor, assignmentId, fence, async (a) => {
      const at = new Date().toISOString();
      if (a.state === "CANCELLING") {
        a.cancelled(at);
        await this.endedAssignment(actor, a);
        return [];
      }
      // Its work ended by design (it delegated, asked, answered): the assignment moved on already.
      if (e.stoppedFor === "handed_over") return [];
      const interrupted = e.stoppedFor === "recover" || e.stoppedFor === "pause" || e.stoppedFor === "cancel";
      // A lead's answering attempt that left its team's questions unanswered: counted, moved up after the last wake.
      if (a.state === "ANSWERING" && !interrupted) return this.clarifications.answeringEnded(a, at);
      if (a.state === "REVIEWING" && !interrupted) {
        const next = await this.team.reviewEnded(a, at, e.startedAt ?? null);
        if (next.kind === "waiting") return this.team.next(a, at);
        if (next.kind === "again") return [await this.team.wakeAgain(a, at)];
        a.block(next.why, "owner", at);
        await this.decisions.open({ orbitId: actor.command.orbitId, kind: "blocked", missionId: a.data.missionId, assignmentId: a.id, title: "Work is blocked", reason: next.why, waiting: null, deadline: a.data.deadline, pin: { assignmentVersion: a.nextVersion, handoffDigest: null, deliveryId: null }, dedupKey: `blocked:${a.id}` });
        return [];
      }
      if (a.state !== "RUNNING" && a.state !== "ASSIGNED" && a.state !== "RECOVERING") return [];
      if (e.stoppedFor === "recover") return [];
      const why =
        e.state === "succeeded"
          ? "The employee ended its run without handing in a result."
          : e.stoppedFor === "timeout"
            ? `The attempt ran past its time limit. ${e.detail ?? ""}`.trim()
            : `The attempt ${e.state}${e.detail ? `: ${e.detail}` : "."}`;
      a.block(why, "owner", at);
      await this.decisions.open({ orbitId: actor.command.orbitId, kind: "blocked", missionId: a.data.missionId, assignmentId: a.id, title: "Work is blocked", reason: why, waiting: null, deadline: a.data.deadline, pin: { assignmentVersion: a.nextVersion, handoffDigest: null, deliveryId: null }, dedupKey: `blocked:${a.id}` });
      return [];
    }, true);
  }

  // A lead that ended (cancelled, failed): its open parts end with it, and the question it asked is withdrawn -- as is
  // that of any part that ends.
  private async cascade(orbitId: string, assignmentId: string, correlationId: string, causationId: string): Promise<void> {
    const actor = systemActor(orbitId, "cascade", correlationId, causationId);
    await this.db.tx(async () => {
      const events = await this.clarifications.withdrawFor(orbitId, assignmentId);
      const open = await this.db.query("SELECT id FROM workforce.assignments WHERE account_id = $1 AND parent_id = $2 AND state NOT IN ('COMPLETED', 'CANCELLED', 'FAILED_FINAL', 'CANCELLING') ORDER BY created_at, id", [orbitId, assignmentId]);
      for (const row of open) {
        const part = await this.assignments.get(orbitId, String(row.id), true);
        if (part === null) continue;
        events.push(...(await this.cancelIn(actor, part, "Its lead's work ended, and with it this part.")));
        await this.assignments.save(part);
        events.push(...part.pullEvents());
      }
      if (events.length > 0) await this.outbox.append(actor.command, events);
    });
  }

  private async employeeName(orbitId: string, employeeId: string): Promise<string> {
    const r = await this.db.one("SELECT name FROM workforce.employees WHERE account_id = $1 AND id = $2", [orbitId, employeeId]);
    return r === null ? "" : String(r.name);
  }

  // When an assignment ends: open items about it close, and a root assignment's mission ends with it.
  private async endedAssignment(actor: Actor, a: Assignment): Promise<void> {
    await this.decisions.closeAllFor(actor.command.orbitId, a.id, a.state.toLowerCase());
    if (a.data.parentId !== null) return;
    const m = await this.missions.get(actor.command.orbitId, a.data.missionId, true);
    if (m === null || m.data.state !== "open") return;
    m.end(a.state === "CANCELLED" ? "cancelled" : "failed", new Date().toISOString());
    await this.missions.save(m);
  }

  async recovering(actor: Actor, assignmentId: string, fence: number, reason: string): Promise<void> {
    await this.onRun(actor, assignmentId, fence, async (a) => {
      if (a.state !== "RUNNING" && a.state !== "ASSIGNED") return;
      a.recovering(reason, new Date().toISOString());
      await this.decisions.open({ orbitId: actor.command.orbitId, kind: "reconciliation", missionId: a.data.missionId, assignmentId, title: "A run needs reconciling", reason, waiting: null, deadline: null, pin: { assignmentVersion: a.nextVersion, handoffDigest: null, deliveryId: null }, dedupKey: `reconciliation:${assignmentId}` });
    });
  }

  // The worker's report about the CURRENT attempt only: an older fence is refused (and said), except that the end of a
  // cancelled assignment's run always closes it.
  // ---- teams (TeamService decides; these are Execution's doors to it) -------------------------------------------------------

  async delegate(actor: Actor, assignmentId: string, fence: number, units: DelegatedUnit[]): Promise<{ parts: number }> {
    let parts = 0;
    await this.onRun(actor, assignmentId, fence, async (a) => {
      if (!a.acting(fence)) throw conflictWith("stale_fence", "This attempt has ended its work: its plan was not given.");
      const events = await this.team.delegate(actor, a, fence, units);
      parts = units.length;
      return events;
    });
    return { parts };
  }

  async reviewUnit(actor: Actor, assignmentId: string, fence: number, unitKey: string, decision: "accept" | "revise", criteria: string, digest: string | null = null): Promise<string> {
    let text = "";
    await this.onRun(actor, assignmentId, fence, async (a) => {
      const r = await this.team.review(actor, a, unitKey, decision, criteria, digest);
      text = r.text;
      return r.events;
    });
    return text;
  }

  teamRoomChanged(orbitId: string, roomId: string, by: { runId: string; assignmentId: string; employeeId: string }, files: { path: string; sha256: string; size: number }[]): Promise<number> {
    return this.db.tx(() => this.team.roomChanged(orbitId, roomId, by, files));
  }

  private async onRun(actor: Actor, assignmentId: string, fence: number, work: (a: Assignment) => Promise<void | RaisedEvent[]>, endOfRun = false): Promise<void> {
    const orbitId = actor.command.orbitId;
    await this.db.tx(async () => {
      const a = await this.assignments.get(orbitId, assignmentId, true);
      if (a === null) throw missing("Assignment");
      const cancelling = endOfRun && a.state === "CANCELLING";
      if (a.data.fence !== fence && !cancelling) {
        await this.outbox.append(actor.command, [{ type: "StaleResultRejected", aggregateType: "assignment", aggregateId: a.id, aggregateVersion: a.data.version, missionId: a.data.missionId, payload: { fence, current: a.data.fence } }]);
        throw conflictWith("stale_fence", "This attempt was replaced: its result is kept as history, not acted on.");
      }
      const extra = (await work(a)) ?? [];
      const events = [...extra, ...a.pullEvents()];
      if (events.length === 0 && a.loadedState === a.state) return;
      await this.assignments.save(a);
      await this.outbox.append(actor.command, events);
      await this.outbox.touched(orbitId, ["roster", "missions", "inbox"], a.data.missionId);
    });
  }
}
