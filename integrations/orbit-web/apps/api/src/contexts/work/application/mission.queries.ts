// WORK's read side: the missions of an account (paged by a stable cursor), one mission in full -- its assignments with
// their last attempt, its handoffs with their artifacts and claims, and its timeline (the outbox journal of the mission,
// in order) -- and Needs me. Everything is read for the session's account; a record of another account is not found.
// The office version a page was read at comes with it, so a page can say "data as of" and refresh on `office.changed`.
import { Inject, Injectable, Optional } from "@nestjs/common";
import { MISSION_REPOSITORIES, type MissionRepositories } from "./mission-repositories.port.js";
import {
  isWorkforceId,
  type AssignmentAction,
  type AssignmentState,
  type AssignmentSummary,
  type AssignmentView,
  type ArtifactView,
  type ClarificationView,
  type HandoffClaim,
  type HandoffView,
  type Inbox,
  type MissionDetail,
  type MissionList,
  type MissionSummary,
  type ResponsibleNow,
  type TimelineEntry,
} from "@orbit-web/contracts";
import { ClarificationRepository } from "../infrastructure/clarifications.repository.js";
import { TeamService } from "./team.service.js";
import { Db, type Row } from "../../../infra/db/db.js";
import { RunViews } from "../../execution/application/run-views.js";
import { missing } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { DecisionRepository } from "../infrastructure/decisions.js";
import { DeliveriesService } from "./deliveries.service.js";

const PAGE = 50;
const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// What a person may do with an assignment in its state (the command decides again when asked). A part's hand-in is its
// lead's to review, never the person's; a question is the person's to answer only when it was asked of them (the root's,
// or one moved up to them).
export function actionsOf(state: AssignmentState, waitingOn: string | null, o: { root: boolean; question: "owner" | "lead" | null } = { root: true, question: waitingOn === "information" ? "owner" : null }): AssignmentAction[] {
  switch (state) {
    case "QUEUED":
      return ["hand_over", "cancel"];
    case "ASSIGNED":
      return ["pause", "hand_over", "cancel"];
    case "RUNNING":
    case "REVIEWING":
    case "ANSWERING":
      return ["pause", "cancel"];
    case "WAITING_FOR_SUBORDINATES":
      return ["pause", "hand_over", "cancel"];
    case "AWAITING_ACCEPTANCE":
      return o.root ? ["accept", "request_revision", "pause", "cancel"] : ["pause", "cancel"];
    case "BLOCKED":
      return [...(o.question === "owner" ? (["answer"] as const) : o.question === "lead" ? [] : (["retry"] as const)), "pause", "hand_over", "repin", "cancel"];
    case "RECOVERING":
      return ["retry", "cancel"];
    case "PAUSED":
      return ["resume", "hand_over", "repin", "cancel"];
    default:
      return [];
  }
}

const summaryOf = (r: Row): AssignmentSummary => ({
  id: s(r.id),
  missionId: s(r.mission_id),
  title: s(r.mission_title ?? ""),
  employeeId: s(r.employee_id),
  employeeName: s(r.employee_name ?? ""),
  state: s(r.state) as AssignmentState,
  reason: sn(r.reason),
  waitingOn: sn(r.waiting_on),
  deadline: sn(r.deadline),
  version: Number(r.version),
  updatedAt: s(r.updated_at),
});

// The next thing that has to happen for a mission, in words.
function nextActionOf(a: AssignmentSummary): string | null {
  switch (a.state) {
    case "QUEUED":
      return `Waits for ${a.employeeName} to finish their current work.`;
    case "ASSIGNED":
      return `${a.employeeName} starts as soon as resources are free.`;
    case "RUNNING":
      return `${a.employeeName} is working on it.`;
    case "AWAITING_ACCEPTANCE":
      return "Review the result: accept it or request a revision.";
    case "WAITING_FOR_SUBORDINATES":
      return `${a.employeeName} waits for their team.`;
    case "REVIEWING":
      return `${a.employeeName} reviews their team's work.`;
    case "ANSWERING":
      return `${a.employeeName} answers their team's questions.`;
    case "BLOCKED":
      return a.waitingOn === "information" ? `Answer ${a.employeeName}'s question.` : "Look at why it is blocked, then retry or cancel.";
    case "PAUSED":
      return "Resume it when you are ready.";
    case "RECOVERING":
      return "An attempt is being reconciled.";
    case "CANCELLING":
      return "The running attempt is being stopped.";
    default:
      return null;
  }
}

// One sentence per kind of event the timeline shows (the payload's words, never a model's text).
function sentenceOf(type: string, p: Record<string, unknown>): string {
  const str = (k: string): string => (typeof p[k] === "string" ? (p[k] as string) : "");
  const num = (k: string): string => (typeof p[k] === "number" ? String(p[k]) : "");
  switch (type) {
    case "MissionCreated":
      return "Mission created.";
    case "AssignmentQueued":
      return "Queued: the employee was busy.";
    case "AssignmentClaimed":
      return `The employee took the work (profile revision ${num("profileRevision")}).`;
    case "RunRequested":
      return `Attempt ${num("attemptNo")} requested.`;
    case "ResourcesReserved":
      return `Resources reserved: ${num("cpuMillis")} millicores, ${num("memoryMiB")} MiB of memory, ${num("scratchMiB")} MiB of scratch.`;
    case "RunWaitingForResources":
      return `Waiting for resources: ${str("reason")}`;
    case "RunUnschedulable":
      return `Cannot start as configured: ${str("reason")}`;
    case "RunStarted":
      return "The employee started working.";
    case "HandoffSubmitted":
      return `Result handed in (revision ${num("revision")}).`;
    case "RevisionRequested":
      return "A revision was requested.";
    case "AssignmentAccepted":
      return `Accepted (revision ${num("handoffRevision")}).`;
    case "AssignmentBlocked":
      return `Blocked: ${str("reason")}`;
    case "AssignmentPaused":
      return `Paused: ${str("reason")}`;
    case "AssignmentResumed":
      return "Resumed: a new attempt runs.";
    case "AssignmentCancelling":
      return "Cancelling: the running attempt is being stopped.";
    case "AssignmentCancelled":
      return "Cancelled.";
    case "AssignmentFailed":
      return `Failed: ${str("reason")}`;
    case "InformationProvided":
      return "The question was answered.";
    case "ReservationReleased":
      return `The employee was released (${str("outcome")}).`;
    case "ResourcesReleased":
      return "The attempt's resources were released.";
    case "DeskPublished":
      return p.published === true ? `Published to the employee's desk (${num("changed")} file(s) changed).` : `Not published to the employee's desk: ${str("reason")}`;
    case "StaleResultRejected":
      return "A result of a replaced attempt was kept as history, not acted on.";
    case "AssignmentDelegated":
      return `Gave ${num("units")} part(s) to its team.`;
    case "MissionPlanRevised":
      return `The plan was revised (${num("parts")} part(s) given).`;
    case "AssignmentReviewing":
      return "Woken to review its team's work.";
    case "AssignmentAnswering":
      return "Woken to answer its team's questions.";
    case "ClarificationRequested":
      return str("addressee") === "lead" ? "A question was asked of its lead." : "A question was asked of you.";
    case "ClarificationAnswered":
      return str("by") === "lead" ? "Its lead answered the question." : str("by") === "system" ? "Its manager did not answer in time: it was told to decide with its best judgment." : "You answered the question.";
    case "ClarificationEscalated":
      return str("addressee") === "owner" ? `A question was moved up to you (${str("kind").replace(/_/g, " ")}).` : "A question was moved up to the next lead.";
    case "ClarificationWithdrawn":
      return "A question was withdrawn: the one who asked ended.";
    case "AssignmentHandedOver":
      return "The work was handed over to another employee.";
    default:
      return type;
  }
}

// WHO HOLDS THE MISSION'S NEXT MOVE NOW, and why: the employees acting, the leads reviewing or asked a question, and the
// person -- for what is theirs (the root's result, a question asked of them, a block, a pause).
export function responsibleNow(assignments: readonly AssignmentView[], questions: readonly ClarificationView[], handoffs: readonly HandoffView[]): ResponsibleNow[] {
  const out: ResponsibleNow[] = [];
  const byId = new Map(assignments.map((a) => [a.id, a]));
  const you = (a: AssignmentView, what: string, why: string) => out.push({ assignmentId: a.id, employeeId: null, name: "You", what, why });
  for (const a of assignments) {
    const q = questions.find((c) => c.askerAssignmentId === a.id && c.state === "open");
    const latest = handoffs.find((h) => h.assignmentId === a.id && h.status === "submitted");
    if (a.state === "RUNNING" || a.state === "ASSIGNED" || a.state === "RECOVERING") out.push({ assignmentId: a.id, employeeId: a.employeeId, name: a.employeeName, what: a.parentId === null ? "works on the mission" : `works on "${a.title}"`, why: a.lastRun?.wakeReason ?? "it was given the work" });
    else if (a.state === "REVIEWING") out.push({ assignmentId: a.id, employeeId: a.employeeId, name: a.employeeName, what: "reviews its team's work", why: a.lastRun?.wakeReason ?? "its team handed in" });
    else if (a.state === "ANSWERING") out.push({ assignmentId: a.id, employeeId: a.employeeId, name: a.employeeName, what: "answers its team's questions", why: a.lastRun?.wakeReason ?? "its team asked" });
    else if (a.state === "AWAITING_ACCEPTANCE" && a.parentId === null) you(a, `review revision ${latest?.revision ?? a.handoffRevision}`, "the mission's result was handed in to you");
    else if (a.state === "AWAITING_ACCEPTANCE") out.push({ assignmentId: a.id, employeeId: byId.get(a.parentId as string)?.employeeId ?? null, name: a.leadName ?? "its lead", what: `reviews "${a.title}" (revision ${latest?.revision ?? a.handoffRevision})`, why: `${a.employeeName} handed it in` });
    else if (a.state === "BLOCKED" && q !== undefined && q.addressee === "lead") out.push({ assignmentId: a.id, employeeId: q.addresseeAssignmentId === null ? null : (byId.get(q.addresseeAssignmentId)?.employeeId ?? null), name: q.addresseeName ?? "its lead", what: `answers ${a.employeeName}`, why: q.question.slice(0, 300) });
    else if (a.state === "BLOCKED" && q !== undefined) you(a, `answer ${a.employeeName}`, q.question.slice(0, 300));
    else if (a.state === "BLOCKED") you(a, `decide on ${a.employeeName}'s blocked work`, a.reason ?? "it is blocked");
    else if (a.state === "PAUSED") you(a, `resume ${a.employeeName}'s work`, a.reason ?? "it was paused");
  }
  return out;
}

@Injectable()
export class MissionQueries {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(RunViews) private readonly runViews: RunViews,
    @Inject(DecisionRepository) private readonly decisions: DecisionRepository,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService,
    @Inject(ClarificationRepository) private readonly questions: ClarificationRepository,
    @Inject(TeamService) private readonly team: TeamService,
    @Optional() @Inject(MISSION_REPOSITORIES) private readonly repositories: MissionRepositories | null = null,
  ) {}

  async list(orbitId: string, q: { state?: string; employee?: string; cursor?: string }): Promise<MissionList> {
    return this.db.snapshot(() => this.page(orbitId, q));
  }

  private async page(orbitId: string, q: { state?: string; employee?: string; cursor?: string }): Promise<MissionList> {
    const version = await this.outbox.version(orbitId);
    const params: unknown[] = [orbitId];
    let where = "m.account_id = $1 AND a.parent_id IS NULL";
    if (q.state === "closed") where += " AND m.state <> 'open'";
    else if (q.state !== undefined && ["open", "completed", "cancelled", "failed"].includes(q.state)) {
      params.push(q.state);
      where += ` AND m.state = $${params.length}`;
    }
    if (q.employee !== undefined && isWorkforceId(q.employee)) {
      params.push(q.employee);
      where += ` AND a.employee_id = $${params.length}`;
    }
    if (q.cursor !== undefined) {
      const [at, id] = q.cursor.split("|");
      if (at !== undefined && id !== undefined && isWorkforceId(id) && !Number.isNaN(Date.parse(at))) {
        params.push(at, id);
        where += ` AND (m.updated_at, m.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
      }
    }
    const rows = await this.db.query(
      `SELECT m.id AS m_id, m.title AS mission_title, m.goal, m.state AS m_state, m.deadline AS m_deadline, m.schedule_id, m.created_at AS m_created, m.updated_at AS m_updated,
              a.*, e.name AS employee_name
       FROM workforce.missions m
       JOIN workforce.assignments a ON a.account_id = m.account_id AND a.mission_id = m.id
       JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
       WHERE ${where}
       ORDER BY m.updated_at DESC, m.id DESC LIMIT ${PAGE + 1}`,
      params as never,
    );
    const page = rows.slice(0, PAGE).map((r) => this.missionSummaryOf(r));
    const last = rows.length > PAGE ? rows[PAGE - 1] : undefined;
    return { missions: page, nextCursor: last === undefined ? null : `${new Date(s(last.m_updated)).toISOString()}|${s(last.m_id)}`, version, asOf: new Date().toISOString() };
  }

  private missionSummaryOf(r: Row): MissionSummary {
    const assignment = summaryOf(r);
    return {
      id: s(r.m_id),
      title: s(r.mission_title),
      goal: s(r.goal),
      state: s(r.m_state) as MissionSummary["state"],
      assignment,
      deadline: sn(r.m_deadline),
      nextAction: nextActionOf(assignment),
      scheduleId: sn(r.schedule_id),
      createdAt: s(r.m_created),
      updatedAt: s(r.m_updated),
    };
  }

  // One mission in full, read from ONE snapshot: its row, its assignments, their runs and handoffs agree with each other.
  async detail(orbitId: string, missionId: string): Promise<MissionDetail> {
    if (!isWorkforceId(missionId)) throw missing("Mission");
    return this.db.snapshot(() => this.read(orbitId, missionId));
  }

  private async read(orbitId: string, missionId: string): Promise<MissionDetail> {
    const m = await this.db.one("SELECT * FROM workforce.missions WHERE account_id = $1 AND id = $2", [orbitId, missionId]);
    if (m === null) throw missing("Mission");
    const rows = await this.db.query(
      `SELECT a.*, m.title AS mission_title, e.name AS employee_name FROM workforce.assignments a
       JOIN workforce.missions m ON m.account_id = a.account_id AND m.id = a.mission_id
       JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
       WHERE a.account_id = $1 AND a.mission_id = $2 ORDER BY a.created_at, a.id`,
      [orbitId, missionId],
    );
    const runs = await this.runViews.ofAssignments(orbitId, rows.map((r) => s(r.id)));
    const clarifications = await this.questions.ofMission(orbitId, missionId);
    const names = new Map(rows.map((r) => [s(r.id), s(r.employee_name ?? "")]));
    const departments = new Map((await this.db.query("SELECT id, name FROM workforce.departments WHERE account_id = $1", [orbitId])).map((d) => [s(d.id), s(d.name)]));
    const assignments: AssignmentView[] = rows.map((r) => {
      const base = summaryOf(r);
      const run = runs.get(base.id);
      const brief = r.brief as { goal: string; deliverables: AssignmentView["brief"]["deliverables"]; acceptanceCriteria: string[]; dependsOn?: string[] };
      const pinned = (r.pinned ?? null) as { profileRevision?: number; departmentId?: string | null; departmentName?: string | null; execution?: AssignmentView["pinned"]["execution"] } | null;
      const parentId = sn(r.parent_id);
      const open = clarifications.find((c) => c.askerAssignmentId === base.id && c.state === "open") ?? null;
      const targetDepartment = sn(r.target_department_id);
      return {
        ...base,
        // A part is named by its own title (the first line of its brief), the root by its mission's.
        title: parentId === null ? base.title : (brief.goal.split("\n")[0] ?? base.title).slice(0, 120),
        parentId,
        unitKey: sn(r.unit_key),
        target: r.target_kind === null ? null : { kind: s(r.target_kind) as "employee" | "department" | "ceo", departmentId: targetDepartment, departmentName: targetDepartment === null ? null : (departments.get(targetDepartment) ?? null), appointmentId: sn(r.target_appointment_id), appointmentRevision: r.target_appointment_revision === null ? null : Number(r.target_appointment_revision) },
        reviewedBy: parentId === null ? ("owner" as const) : ("lead" as const),
        leadName: parentId === null ? null : (names.get(parentId) ?? null),
        planCount: Number(r.plan_count ?? 0),
        questionCount: Number(r.question_count ?? 0),
        brief: { goal: brief.goal, deliverables: brief.deliverables, acceptanceCriteria: brief.acceptanceCriteria, dependsOn: brief.dependsOn ?? [] },
        handoffRevision: Number(r.handoff_revision),
        reworkCount: Number(r.rework_count),
        pinned: { profileRevision: pinned?.profileRevision ?? null, departmentId: pinned?.departmentId ?? null, departmentName: pinned?.departmentName ?? null, execution: pinned?.execution ?? null },
        lastRun: run?.last ?? null,
        attempts: run?.attempts ?? 0,
        claimedAt: sn(r.claimed_at),
        finishedAt: sn(r.finished_at),
        createdAt: s(r.created_at),
        actions: actionsOf(base.state, base.waitingOn, { root: parentId === null, question: open === null ? null : open.addressee }),
      };
    });
    const root = assignments.find((a) => a.parentId === null) ?? assignments[0];
    if (root === undefined) throw missing("Mission");
    const handoffs = await this.handoffsOf(orbitId, assignments.map((a) => a.id));
    return {
      id: s(m.id),
      title: s(m.title),
      goal: s(m.goal),
      state: s(m.state) as MissionDetail["state"],
      target: root.target,
      responsibleNow: responsibleNow(assignments, clarifications, handoffs),
      clarifications,
      dataShares: await this.team.missionShares(orbitId, missionId),
      assignment: root,
      deadline: sn(m.deadline),
      nextAction: nextActionOf(root),
      scheduleId: sn(m.schedule_id),
      createdAt: s(m.created_at),
      updatedAt: s(m.updated_at),
      createdBy: s(m.created_by),
      acceptanceMode: s(m.acceptance_mode) as MissionDetail["acceptanceMode"],
      acceptanceCriteria: m.acceptance_criteria as string[],
      deliverables: m.deliverables as MissionDetail["deliverables"],
      workspaceId: sn(m.research_workspace_id),
      sourceRevisionIds: m.source_revision_ids as string[],
      repositories: ((await this.repositories?.of(orbitId, missionId)) ?? []).map((r) => ({ source: r.source, fullName: r.fullName, branch: r.branch })),
      planRevision: Number(m.plan_revision),
      assignments,
      handoffs,
      timeline: await this.timeline(orbitId, missionId),
      deliveries: await this.deliveries.ofMission(orbitId, missionId),
      resourceVersion: await this.outbox.version(orbitId),
    };
  }

  private async handoffsOf(orbitId: string, assignmentIds: string[]): Promise<HandoffView[]> {
    if (assignmentIds.length === 0) return [];
    const rows = await this.db.query("SELECT * FROM workforce.handoffs WHERE account_id = $1 AND assignment_id = ANY($2) ORDER BY assignment_id, revision DESC", [orbitId, assignmentIds]);
    const ids = rows.map((r) => s(r.id));
    const files = ids.length === 0 ? [] : await this.db.query("SELECT * FROM workforce.artifacts WHERE account_id = $1 AND handoff_id = ANY($2) ORDER BY name", [orbitId, ids]);
    const byHandoff = new Map<string, ArtifactView[]>();
    for (const f of files) {
      const list = byHandoff.get(s(f.handoff_id)) ?? [];
      list.push({ id: s(f.id), name: s(f.name), kind: s(f.kind) as ArtifactView["kind"], mediaType: s(f.media_type), size: Number(f.size), sha256: s(f.sha256) });
      byHandoff.set(s(f.handoff_id), list);
    }
    return rows.map((r) => ({
      id: s(r.id),
      assignmentId: s(r.assignment_id),
      revision: Number(r.revision),
      digest: s(r.digest),
      summary: s(r.summary),
      status: s(r.status) as HandoffView["status"],
      artifacts: byHandoff.get(s(r.id)) ?? [],
      claims: (r.claims as (HandoffClaim & { web?: { url: string; readAt: string } | null })[]).map((c) => ({ text: c.text, sources: c.sources ?? [], supported: c.supported === true, ...(c.web ? { web: c.web } : {}) })),
      missing: r.missing as string[],
      submittedAt: s(r.submitted_at),
      submittedBy: s(r.submitted_by),
      review: (r.review as HandoffView["review"]) ?? null,
    }));
  }

  private async timeline(orbitId: string, missionId: string): Promise<TimelineEntry[]> {
    const rows = await this.db.query("SELECT seq, occurred_at, type, actor, aggregate_type, aggregate_id, payload FROM workforce.events WHERE account_id = $1 AND mission_id = $2 ORDER BY seq LIMIT 1000", [orbitId, missionId]);
    return rows.map((r) => {
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      const assignmentId = s(r.aggregate_type) === "assignment" ? s(r.aggregate_id) : typeof payload.assignmentId === "string" ? payload.assignmentId : null;
      return { seq: Number(r.seq), at: s(r.occurred_at), type: s(r.type), actor: s(r.actor), summary: sentenceOf(s(r.type), payload), assignmentId };
    });
  }

  // An artifact's facts, for serving its bytes: only one of the session's account.
  async artifact(orbitId: string, artifactId: string): Promise<{ name: string; mediaType: string; size: number; sha256: string } | null> {
    if (!isWorkforceId(artifactId)) return null;
    const r = await this.db.one("SELECT name, media_type, size, sha256 FROM workforce.artifacts WHERE account_id = $1 AND id = $2", [orbitId, artifactId]);
    return r === null ? null : { name: s(r.name), mediaType: s(r.media_type), size: Number(r.size), sha256: s(r.sha256) };
  }

  async inbox(orbitId: string, q: { open: boolean; cursor: string | null }): Promise<Inbox> {
    const items = await this.decisions.list(orbitId, q.open, q.cursor, PAGE + 1);
    const page = items.slice(0, PAGE);
    return { items: page, open: await this.decisions.openCount(orbitId), nextCursor: items.length > PAGE ? (page.at(-1)?.id ?? null) : null, version: await this.outbox.version(orbitId), asOf: new Date().toISOString() };
  }
}
