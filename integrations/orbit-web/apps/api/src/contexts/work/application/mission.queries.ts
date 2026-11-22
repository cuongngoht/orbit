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
  type HandoffClaim,
  type HandoffView,
  type Inbox,
  type MissionDetail,
  type MissionList,
  type MissionSummary,
  type TimelineEntry,
} from "@orbit-web/contracts";
import { Db, type Row } from "../../../infra/db/db.js";
import { RunViews } from "../../execution/application/run-views.js";
import { missing } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { DecisionRepository } from "../infrastructure/decisions.js";
import { DeliveriesService } from "./deliveries.service.js";

const PAGE = 50;
const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// What a person may do with an assignment in its state (the command decides again when asked).
export function actionsOf(state: AssignmentState, waitingOn: string | null): AssignmentAction[] {
  switch (state) {
    case "QUEUED":
      return ["cancel"];
    case "ASSIGNED":
    case "RUNNING":
      return ["pause", "cancel"];
    case "AWAITING_ACCEPTANCE":
      return ["accept", "request_revision", "pause", "cancel"];
    case "BLOCKED":
      return [waitingOn === "information" ? "answer" : "retry", "pause", "cancel"];
    case "RECOVERING":
      return ["retry", "cancel"];
    case "PAUSED":
      return ["resume", "cancel"];
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
    default:
      return type;
  }
}

@Injectable()
export class MissionQueries {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(RunViews) private readonly runViews: RunViews,
    @Inject(DecisionRepository) private readonly decisions: DecisionRepository,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService,
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
    const assignments: AssignmentView[] = rows.map((r) => {
      const base = summaryOf(r);
      const run = runs.get(base.id);
      const brief = r.brief as { goal: string; deliverables: AssignmentView["brief"]["deliverables"]; acceptanceCriteria: string[]; dependsOn?: string[] };
      const pinned = (r.pinned ?? null) as { profileRevision?: number; departmentId?: string | null; departmentName?: string | null; execution?: AssignmentView["pinned"]["execution"] } | null;
      return {
        ...base,
        parentId: sn(r.parent_id),
        unitKey: sn(r.unit_key),
        brief: { goal: brief.goal, deliverables: brief.deliverables, acceptanceCriteria: brief.acceptanceCriteria, dependsOn: brief.dependsOn ?? [] },
        handoffRevision: Number(r.handoff_revision),
        reworkCount: Number(r.rework_count),
        pinned: { profileRevision: pinned?.profileRevision ?? null, departmentId: pinned?.departmentId ?? null, departmentName: pinned?.departmentName ?? null, execution: pinned?.execution ?? null },
        lastRun: run?.last ?? null,
        attempts: run?.attempts ?? 0,
        claimedAt: sn(r.claimed_at),
        finishedAt: sn(r.finished_at),
        createdAt: s(r.created_at),
        actions: actionsOf(base.state, base.waitingOn),
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
