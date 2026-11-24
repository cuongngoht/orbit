// THE WORK CONTEXT'S REPOSITORIES: one per aggregate, each asked with the OrbitId first, each writing in the caller's
// transaction (Db.tx is the unit of work). A save names the version the aggregate was read at: a row that moved in the
// meantime is refused (stale_version), never overwritten. The reservation is the assignment repository's to keep in
// step with the state it saves -- inserted when an assignment starts holding its employee, deleted when it lets go --
// and the database itself refuses one employee holding two assignments (primary key) and a holding state without its
// reservation (a constraint trigger at commit).
import { Inject, Injectable } from "@nestjs/common";
import { isHolding, type AssignmentState, type HandoffStatus } from "@orbit-web/contracts";
import { Db, jsonParam, pgCode, UNIQUE_VIOLATION, type Row } from "../../../infra/db/db.js";
import { conflictWith, stale } from "../../shared/domain.js";
import { Assignment, type AssignmentData } from "../domain/assignment.js";
import { Mission, type MissionData } from "../domain/mission.js";

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const missionOf = (r: Row): Mission =>
  Mission.restore({
    id: str(r.id),
    orbitId: str(r.account_id),
    title: str(r.title),
    goal: str(r.goal),
    state: str(r.state) as MissionData["state"],
    createdBy: str(r.created_by),
    acceptanceMode: str(r.acceptance_mode) as MissionData["acceptanceMode"],
    acceptanceCriteria: r.acceptance_criteria as string[],
    deliverables: r.deliverables as MissionData["deliverables"],
    researchWorkspaceId: strOrNull(r.research_workspace_id),
    sourceRevisionIds: r.source_revision_ids as string[],
    deadline: strOrNull(r.deadline),
    priority: Number(r.priority),
    planRevision: Number(r.plan_revision),
    scheduleId: strOrNull(r.schedule_id),
    occurrenceId: strOrNull(r.occurrence_id),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    version: Number(r.version),
  });

export const assignmentDataOf = (r: Row): AssignmentData => ({
  id: str(r.id),
  orbitId: str(r.account_id),
  missionId: str(r.mission_id),
  parentId: strOrNull(r.parent_id),
  unitKey: strOrNull(r.unit_key),
  employeeId: str(r.employee_id),
  state: str(r.state) as AssignmentState,
  reason: strOrNull(r.reason),
  waitingOn: strOrNull(r.waiting_on),
  brief: r.brief as AssignmentData["brief"],
  execution: (r.execution as AssignmentData["execution"]) ?? null,
  handoffRevision: Number(r.handoff_revision),
  reworkCount: Number(r.rework_count),
  pinned: (r.pinned as AssignmentData["pinned"]) ?? null,
  priority: Number(r.priority),
  eligibleAt: str(r.eligible_at),
  deadline: strOrNull(r.deadline),
  fence: Number(r.fence),
  claimedAt: strOrNull(r.claimed_at),
  finishedAt: strOrNull(r.finished_at),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  version: Number(r.version),
});

@Injectable()
export class MissionRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async get(orbitId: string, id: string, lock = false): Promise<Mission | null> {
    const row = await this.db.one(`SELECT * FROM workforce.missions WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : missionOf(row);
  }

  async insert(m: Mission): Promise<void> {
    const d = m.data;
    await this.db.query(
      `INSERT INTO workforce.missions (id, account_id, title, goal, state, created_by, acceptance_mode, acceptance_criteria, deliverables, research_workspace_id, source_revision_ids, deadline, priority, plan_revision, schedule_id, occurrence_id, created_at, updated_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $17, 1)`,
      [d.id, d.orbitId, d.title, d.goal, d.state, d.createdBy, d.acceptanceMode, jsonParam(d.acceptanceCriteria), jsonParam(d.deliverables), d.researchWorkspaceId, jsonParam(d.sourceRevisionIds), d.deadline, d.priority, d.planRevision, d.scheduleId, d.occurrenceId, d.createdAt],
    );
  }

  async save(m: Mission): Promise<number> {
    const d = m.data;
    const row = await this.db.one("UPDATE workforce.missions SET state = $3, updated_at = $4, version = version + 1 WHERE account_id = $1 AND id = $2 AND version = $5 RETURNING version", [d.orbitId, d.id, d.state, d.updatedAt, d.version]);
    if (row === null) throw stale("This mission changed since it was read: read it again.");
    return Number(row.version);
  }
}

@Injectable()
export class AssignmentRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async get(orbitId: string, id: string, lock = false): Promise<Assignment | null> {
    const row = await this.db.one(`SELECT * FROM workforce.assignments WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : Assignment.restore(assignmentDataOf(row));
  }

  // The assignment an employee holds now (its reservation), if any.
  async heldBy(orbitId: string, employeeId: string): Promise<Assignment | null> {
    const row = await this.db.one("SELECT a.* FROM workforce.reservations r JOIN workforce.assignments a ON a.account_id = r.account_id AND a.id = r.assignment_id WHERE r.account_id = $1 AND r.employee_id = $2", [orbitId, employeeId]);
    return row === null ? null : Assignment.restore(assignmentDataOf(row));
  }

  // The next queued assignment of an employee: priority aged by waiting (so a low priority never waits forever), then
  // the time it became eligible, then its id. Locked, skipping rows another claim holds.
  async nextQueued(orbitId: string, employeeId: string, agingMinutes: number): Promise<Assignment | null> {
    const row = await this.db.one(
      `SELECT * FROM workforce.assignments WHERE account_id = $1 AND employee_id = $2 AND state = 'QUEUED' AND eligible_at <= now()
       ORDER BY priority + floor(extract(epoch FROM (now() - eligible_at)) / ($3 * 60.0)) DESC, eligible_at, id
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [orbitId, employeeId, Math.max(1, agingMinutes)],
    );
    return row === null ? null : Assignment.restore(assignmentDataOf(row));
  }

  async insert(a: Assignment): Promise<void> {
    const d = a.data;
    await this.db.query(
      `INSERT INTO workforce.assignments (id, account_id, mission_id, parent_id, unit_key, employee_id, state, reason, waiting_on, brief, execution, handoff_revision, rework_count, pinned, priority, eligible_at, deadline, fence, claimed_at, finished_at, created_by, created_at, updated_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', NULL, NULL, $7::jsonb, $8::jsonb, 0, 0, NULL, $9, $10, $11, 0, NULL, NULL, $12, $13, $13, 1)`,
      [d.id, d.orbitId, d.missionId, d.parentId, d.unitKey, d.employeeId, jsonParam(d.brief), d.execution === null ? null : jsonParam(d.execution), d.priority, d.eligibleAt, d.deadline, d.createdBy, d.createdAt],
    );
  }

  // Saves the aggregate as it is now (a new one is inserted first, as QUEUED, then saved), keeping the reservation in
  // step: taking the employee when it starts holding (refused `employee_busy` when another assignment holds them), and
  // letting go when it stops. Returns the new version.
  async save(a: Assignment): Promise<number> {
    const d = a.data;
    if (a.loadedState === null) await this.insert(a);
    const was = a.loadedState ?? "QUEUED";
    const expected = a.loadedState === null ? 1 : d.version;
    if (!isHolding(was) && isHolding(d.state)) await this.reserve(d.orbitId, d.employeeId, d.id, d.updatedAt);
    if (isHolding(was) && !isHolding(d.state)) await this.db.query("DELETE FROM workforce.reservations WHERE account_id = $1 AND assignment_id = $2", [d.orbitId, d.id]);
    const row = await this.db.one(
      `UPDATE workforce.assignments SET state = $3, reason = $4, waiting_on = $5, brief = $6::jsonb, handoff_revision = $7, rework_count = $8, pinned = $9::jsonb, fence = $10,
         claimed_at = $11, finished_at = $12, updated_at = $13, version = version + 1
       WHERE account_id = $1 AND id = $2 AND version = $14 RETURNING version`,
      [d.orbitId, d.id, d.state, d.reason, d.waitingOn, jsonParam(d.brief), d.handoffRevision, d.reworkCount, d.pinned === null ? null : jsonParam(d.pinned), d.fence, d.claimedAt, d.finishedAt, d.updatedAt, expected],
    );
    if (row === null) throw stale("This assignment changed since it was read: read it again.", { assignmentId: d.id });
    return Number(row.version);
  }

  // A handover written: the holder moves with its reservation (the old one's released, the new one's taken -- a busy
  // new holder refuses it with employee_busy), against the version read; the database holds the rest at commit.
  async handOver(a: Assignment, fromEmployeeId: string): Promise<number> {
    const d = a.data;
    if (a.holding) await this.db.query("DELETE FROM workforce.reservations WHERE account_id = $1 AND assignment_id = $2 AND employee_id = $3", [d.orbitId, d.id, fromEmployeeId]);
    const row = await this.db.one(
      "UPDATE workforce.assignments SET employee_id = $3, pinned = $4::jsonb, fence = $5, updated_at = $6, version = version + 1 WHERE account_id = $1 AND id = $2 AND version = $7 RETURNING version",
      [d.orbitId, d.id, d.employeeId, d.pinned === null ? null : jsonParam(d.pinned), d.fence, d.updatedAt, d.version],
    );
    if (row === null) throw stale("This assignment changed since it was read: read it again.", { assignmentId: d.id });
    if (a.holding) await this.reserve(d.orbitId, d.employeeId, d.id, d.updatedAt);
    return Number(row.version);
  }

  private async reserve(orbitId: string, employeeId: string, assignmentId: string, at: string): Promise<void> {
    try {
      await this.db.tx(async () => {
        await this.db.query("INSERT INTO workforce.reservations (account_id, employee_id, assignment_id, reserved_at) VALUES ($1, $2, $3, $4)", [orbitId, employeeId, assignmentId, at]);
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) throw conflictWith("employee_busy", "This employee already holds an assignment.", { employeeId });
      throw err;
    }
  }
}

export interface HandoffRecord {
  id: string;
  orbitId: string;
  assignmentId: string;
  runId: string | null;
  revision: number;
  digest: string;
  summary: string;
  status: HandoffStatus;
  claims: unknown[];
  missing: string[];
  submissionKey: string;
  submittedBy: string;
  submittedAt: string;
  review: { by: string; at: string; note: string } | null;
}

const handoffOf = (r: Row): HandoffRecord => ({
  id: str(r.id),
  orbitId: str(r.account_id),
  assignmentId: str(r.assignment_id),
  runId: strOrNull(r.run_id),
  revision: Number(r.revision),
  digest: str(r.digest),
  summary: str(r.summary),
  status: str(r.status) as HandoffStatus,
  claims: r.claims as unknown[],
  missing: r.missing as string[],
  submissionKey: str(r.submission_key),
  submittedBy: str(r.submitted_by),
  submittedAt: str(r.submitted_at),
  review: (r.review as HandoffRecord["review"]) ?? null,
});

@Injectable()
export class HandoffRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async latest(orbitId: string, assignmentId: string): Promise<HandoffRecord | null> {
    const row = await this.db.one("SELECT * FROM workforce.handoffs WHERE account_id = $1 AND assignment_id = $2 ORDER BY revision DESC LIMIT 1", [orbitId, assignmentId]);
    return row === null ? null : handoffOf(row);
  }

  async bySubmission(orbitId: string, key: string): Promise<HandoffRecord | null> {
    const row = await this.db.one("SELECT * FROM workforce.handoffs WHERE account_id = $1 AND submission_key = $2", [orbitId, key]);
    return row === null ? null : handoffOf(row);
  }

  async ofAssignments(orbitId: string, assignmentIds: readonly string[]): Promise<HandoffRecord[]> {
    if (assignmentIds.length === 0) return [];
    return (await this.db.query("SELECT * FROM workforce.handoffs WHERE account_id = $1 AND assignment_id = ANY($2) ORDER BY assignment_id, revision", [orbitId, [...assignmentIds]])).map(handoffOf);
  }

  async insert(h: HandoffRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO workforce.handoffs (id, account_id, assignment_id, run_id, revision, digest, summary, status, claims, missing, submission_key, submitted_by, submitted_at, review)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, NULL)`,
      [h.id, h.orbitId, h.assignmentId, h.runId, h.revision, h.digest, h.summary, h.status, jsonParam(h.claims), jsonParam(h.missing), h.submissionKey, h.submittedBy, h.submittedAt],
    );
  }

  // The reviewed revision's status moves only from `submitted` (compare-and-set): one acceptance, one revision request.
  async review(orbitId: string, assignmentId: string, revision: number, status: "accepted" | "revision_requested", review: { by: string; at: string; note: string }): Promise<void> {
    const n = await this.db.run("UPDATE workforce.handoffs SET status = $4, review = $5::jsonb WHERE account_id = $1 AND assignment_id = $2 AND revision = $3 AND status = 'submitted'", [orbitId, assignmentId, revision, status, jsonParam(review)]);
    if (n === 0) throw conflictWith("stale_handoff", "This handoff was already reviewed.");
  }
}
