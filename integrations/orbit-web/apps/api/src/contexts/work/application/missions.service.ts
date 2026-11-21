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
// RUN OUTCOMES (RunOutcomes, reported by Execution): Work decides what a run's end means for the assignment.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  checkAccept,
  checkAnswer,
  checkCreateMission,
  checkReason,
  checkRequestRevision,
  isIdempotencyKey,
  isWorkforceId,
  type CommandResult,
  type EmployeeBusyDetails,
  type MissionAccepted,
} from "@orbit-web/contracts";
import { createHash, randomUUID } from "node:crypto";
import { accepted } from "../../../common/errors.js";
import { Db } from "../../../infra/db/db.js";
import { RunRequests } from "../../execution/application/run-requests.js";
import type { AttemptContext, RunEnd, RunOutcomes, SubmittedHandoff } from "../../execution/application/run-outcomes.port.js";
import { OfficeGovernance, systemActor, type Actor } from "../../shared/application/commands.js";
import { conflictWith, DomainError, invalid, missing, stale, type RaisedEvent } from "../../shared/domain.js";
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
  ) {}

  onModuleInit(): void {
    this.hiring.useHeldWork({
      holds: async (orbitId, employeeId) => (await this.assignments.heldBy(orbitId, employeeId)) !== null,
      pauseHeld: (actor, employeeId, reason) => this.onHeld(actor, employeeId, async (a) => this.pauseIn(actor, a, reason)),
      cancelHeld: (actor, employeeId, reason) => this.onHeld(actor, employeeId, async (a) => this.cancelIn(actor, a, reason)),
    });
    // THE SCHEDULER: when an employee lets go of an assignment, becomes able to work, or gets queued work, the next item
    // of its queue is claimed through the same claim as a person's "start now".
    this.dispatcher.register({
      id: "work.scheduler",
      types: ["ReservationReleased", "AssignmentQueued", "EmployeeActivated", "SandboxReady", "ConnectionChanged", "EmployeeEmploymentChanged"],
      handle: async (event) => {
        const employeeId = typeof event.payload.employeeId === "string" ? event.payload.employeeId : event.aggregateType === "employee" ? event.aggregateId : null;
        if (employeeId !== null) await this.claimNext(event.accountId, employeeId, event.correlationId, event.id);
        else if (event.type === "ConnectionChanged") for (const id of await this.queuedEmployees(event.accountId)) await this.claimNext(event.accountId, id, event.correlationId, event.id);
      },
    });
  }

  // ---- giving work ------------------------------------------------------------------------------------------------

  async create(actor: Actor, body: unknown, key: unknown): Promise<StoredAnswer> {
    const req = accepted(checkCreateMission(body));
    if (!isIdempotencyKey(key)) throw invalid("idempotency_key_required", "Send an Idempotency-Key header (8-128 letters, digits, dots, dashes, colons or underscores) with every new mission.");
    const orbitId = actor.command.orbitId;
    const scope: IdempotencyScope = { orbitId, actor: actor.command.actor, operation: "missions.create", key };
    try {
      return await this.governance.command(actor, "mission.create", req.targetEmployeeId, async () => {
        const prior = await this.idempotency.begin(scope, req);
        if (prior !== null) return prior;
        await this.governance.authorize(actor, "work.assign", req.targetEmployeeId, { employee: req.targetEmployeeId });
        const el = await this.eligibility.of(orbitId, req.targetEmployeeId, true);
        if (el === null) throw missing("Employee");
        if (req.workspaceId !== null) await this.sources.check(orbitId, req.workspaceId, req.sourceRevisionIds);
        const execution = req.execution === undefined ? el.execution : await this.hiring.executionFor(orbitId, { ...el.execution, ...(req.execution.model !== undefined ? { model: req.execution.model } : {}), ...(req.execution.effort !== undefined ? { effort: req.execution.effort } : {}) });
        const held = await this.assignments.heldBy(orbitId, req.targetEmployeeId);
        if ((held !== null || !el.eligible) && req.whenBusy === "reject") throw await this.busy(orbitId, req.targetEmployeeId, held, el, actor.command.correlationId);
        const at = new Date().toISOString();
        const mission = Mission.create({ id: randomUUID(), orbitId, title: req.title, goal: req.goal, createdBy: actor.command.actor, acceptanceMode: req.acceptanceMode, acceptanceCriteria: req.acceptanceCriteria, deliverables: req.deliverables, researchWorkspaceId: req.workspaceId, sourceRevisionIds: req.sourceRevisionIds, deadline: req.deadline, priority: req.priority, scheduleId: null, occurrenceId: null, createdAt: at });
        const a = Assignment.queued({ id: randomUUID(), orbitId, missionId: mission.id, parentId: null, unitKey: "root", employeeId: req.targetEmployeeId, brief: { goal: req.goal, deliverables: req.deliverables, acceptanceCriteria: req.acceptanceCriteria, revisions: [], answers: [] }, execution: req.execution ?? null, priority: req.priority, eligibleAt: at, deadline: req.deadline, createdBy: actor.command.actor, createdAt: at });
        await this.missions.insert(mission);
        const claimNow = held === null && el.eligible;
        if (claimNow) a.claim(this.pinOf(el, execution), at);
        await this.assignments.save(a);
        const events: RaisedEvent[] = [...mission.pullEvents(), ...a.pullEvents()];
        if (claimNow) events.push(await this.runs.request({ orbitId, assignmentId: a.id, missionId: mission.id, employeeId: a.data.employeeId, fence: a.data.fence, priority: a.data.priority, execution }));
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
      if (err instanceof DomainError && (err.code === "employee_busy" || err.code === "employee_ineligible")) {
        await this.db.tx(() => this.idempotency.complete(scope, req, { status: 409, body: { error: { code: err.code, message: err.message, details: err.details } } })).catch(() => undefined);
      }
      throw err;
    }
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
      next.claim(this.pinOf(el, execution), new Date().toISOString());
      await this.assignments.save(next);
      const events = [...next.pullEvents(), await this.runs.request({ orbitId, assignmentId: next.id, missionId: next.data.missionId, employeeId, fence: next.data.fence, priority: next.data.priority, execution })];
      await this.outbox.append(actor.command, events);
      await this.outbox.touched(orbitId, ["roster", "missions"], next.data.missionId);
      return next.id;
    });
  }

  private async queuedEmployees(orbitId: string): Promise<string[]> {
    return (await this.db.query("SELECT DISTINCT employee_id FROM workforce.assignments WHERE account_id = $1 AND state = 'QUEUED'", [orbitId])).map((r) => String(r.employee_id));
  }

  private pinOf(el: Eligibility, execution: Eligibility["execution"]): Pinned {
    return { profileRevision: el.profileRevision, departmentId: el.departmentId, departmentName: el.departmentName, execution };
  }

  // ---- deciding on a result --------------------------------------------------------------------------------------

  async accept(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkAccept(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.accept", async (a) => {
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
      const h = await this.handoffs.latest(actor.command.orbitId, a.id);
      if (h === null || h.digest !== req.handoffDigest || h.status !== "submitted") throw conflictWith("stale_handoff", "The handoff you reviewed is no longer the one waiting for a decision: load the latest.", { current: h?.digest ?? null });
      const at = new Date().toISOString();
      const fence = a.requestRevision(req.criteria, actor.command.actor, at);
      await this.handoffs.review(actor.command.orbitId, a.id, h.revision, "revision_requested", { by: actor.command.actor, at, note: req.criteria });
      await this.decisions.close(actor.command.orbitId, `acceptance:${a.id}`, "resolved", "revision requested", actor.command.actor);
      return [await this.requestRun(a, fence)];
    });
  }

  async cancel(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkReason(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.cancel", async (a) => this.cancelIn(actor, a, req.reason));
  }

  async pause(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkReason(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.pause", async (a) => this.pauseIn(actor, a, req.reason));
  }

  async resume(actor: Actor, id: string, expectedVersion: number): Promise<CommandResult> {
    return this.onAssignment(actor, id, expectedVersion, "assignment.resume", async (a) => [await this.requestRun(a, a.resume(new Date().toISOString()))]);
  }

  // A blocked assignment tried again (after its reason was dealt with): a new attempt.
  async retry(actor: Actor, id: string, expectedVersion: number): Promise<CommandResult> {
    return this.onAssignment(actor, id, expectedVersion, "assignment.retry", async (a) => {
      const fence = a.state === "RECOVERING" ? a.recovered(new Date().toISOString()) : a.unblock(new Date().toISOString(), null);
      await this.decisions.closeAllFor(actor.command.orbitId, a.id, "retried");
      return [await this.requestRun(a, fence)];
    });
  }

  async answer(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<CommandResult> {
    const req = accepted(checkAnswer(body));
    return this.onAssignment(actor, id, expectedVersion, "assignment.answer", async (a) => {
      if (a.data.waitingOn !== "information") throw conflictWith("invalid_transition", "This assignment is not waiting for information.");
      const fence = a.unblock(new Date().toISOString(), { question: a.data.reason ?? "", answer: req.answer });
      await this.decisions.close(actor.command.orbitId, `information:${a.id}`, "resolved", "answered", actor.command.actor);
      return [await this.requestRun(a, fence)];
    });
  }

  private async pauseIn(actor: Actor, a: Assignment, reason: string): Promise<RaisedEvent[]> {
    await this.runs.stop(actor.command.orbitId, a.id, "paused");
    a.pause(reason, new Date().toISOString());
    return [];
  }

  private async cancelIn(actor: Actor, a: Assignment, reason: string): Promise<RaisedEvent[]> {
    const live = await this.runs.stop(actor.command.orbitId, a.id, "cancelled");
    a.cancel(live, reason, new Date().toISOString());
    if (a.state === "CANCELLED") await this.endedAssignment(actor, a);
    return [];
  }

  private async requestRun(a: Assignment, fence: number): Promise<RaisedEvent> {
    const execution = a.data.pinned?.execution;
    if (execution === undefined) throw conflictWith("invalid_transition", "This assignment was never claimed.");
    return this.runs.request({ orbitId: a.orbitId, assignmentId: a.id, missionId: a.data.missionId, employeeId: a.data.employeeId, fence, priority: a.data.priority, execution });
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
    return {
      current: a.data.fence === fence && a.holding && a.state !== "CANCELLING" && a.state !== "PAUSED",
      missionId: a.data.missionId,
      missionTitle: m?.data.title ?? "",
      brief: { goal: b.goal, deliverables: b.deliverables, acceptanceCriteria: b.acceptanceCriteria, revisions: b.revisions, answers: b.answers },
      deliverables: b.deliverables,
      employee: { id: a.data.employeeId, name: el?.name ?? "", profile, eligible: el?.eligible ?? false, reason: el === null ? "The employee no longer exists." : el.reason, sandboxId: el?.sandboxId ?? null },
    };
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

  async question(actor: Actor, assignmentId: string, fence: number, question: string): Promise<void> {
    await this.onRun(actor, assignmentId, fence, async (a) => {
      a.block(question, "information", new Date().toISOString());
      await this.decisions.open({ orbitId: actor.command.orbitId, kind: "information", missionId: a.data.missionId, assignmentId, title: "The employee asks", reason: question, waiting: actor.command.actor, deadline: a.data.deadline, pin: { assignmentVersion: a.nextVersion, handoffDigest: null, deliveryId: null }, dedupKey: `information:${assignmentId}` });
    });
  }

  // A run ended: what it means for the assignment is decided here. A late result of a replaced attempt changes nothing.
  async ended(actor: Actor, assignmentId: string, fence: number, e: RunEnd): Promise<void> {
    await this.onRun(actor, assignmentId, fence, async (a) => {
      const at = new Date().toISOString();
      if (a.state === "CANCELLING") {
        a.cancelled(at);
        await this.endedAssignment(actor, a);
        return;
      }
      if (a.state !== "RUNNING" && a.state !== "ASSIGNED" && a.state !== "RECOVERING") return;
      if (e.stoppedFor === "recover") return;
      const why =
        e.state === "succeeded"
          ? "The employee ended its run without handing in a result."
          : e.stoppedFor === "timeout"
            ? `The attempt ran past its time limit. ${e.detail ?? ""}`.trim()
            : `The attempt ${e.state}${e.detail ? `: ${e.detail}` : "."}`;
      a.block(why, "owner", at);
      await this.decisions.open({ orbitId: actor.command.orbitId, kind: "blocked", missionId: a.data.missionId, assignmentId: a.id, title: "Work is blocked", reason: why, waiting: null, deadline: a.data.deadline, pin: { assignmentVersion: a.nextVersion, handoffDigest: null, deliveryId: null }, dedupKey: `blocked:${a.id}` });
    }, true);
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
  private async onRun(actor: Actor, assignmentId: string, fence: number, work: (a: Assignment) => Promise<void>, endOfRun = false): Promise<void> {
    const orbitId = actor.command.orbitId;
    await this.db.tx(async () => {
      const a = await this.assignments.get(orbitId, assignmentId, true);
      if (a === null) throw missing("Assignment");
      const cancelling = endOfRun && a.state === "CANCELLING";
      if (a.data.fence !== fence && !cancelling) {
        await this.outbox.append(actor.command, [{ type: "StaleResultRejected", aggregateType: "assignment", aggregateId: a.id, aggregateVersion: a.data.version, missionId: a.data.missionId, payload: { fence, current: a.data.fence } }]);
        throw conflictWith("stale_fence", "This attempt was replaced: its result is kept as history, not acted on.");
      }
      await work(a);
      const events = a.pullEvents();
      if (events.length === 0 && a.loadedState === a.state) return;
      await this.assignments.save(a);
      await this.outbox.append(actor.command, events);
      await this.outbox.touched(orbitId, ["roster", "missions", "inbox"], a.data.missionId);
    });
  }
}
