// WHAT A HIRING REQUEST KEEPS (Executive, infrastructure; ADR 0062, staffing): the owner's request and its bounds, the
// CEO's turn that plans it, and -- once, when that turn ends -- the plan as it was carried out and what came of it. Every
// read and write is scoped by the account; the request leaves `planning` once (a compare-and-set on the state).
import { Inject, Injectable } from "@nestjs/common";
import type { ExecutionProfile, ResourceProfile, StaffingOutcome, StaffingPlan, StaffingState, StaffingView } from "@orbit-web/contracts";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(String(v)).toISOString());

export interface StaffingRecord {
  id: string;
  orbitId: string;
  conversationId: string;
  turnId: string;
  // Who asked: the person whose authority carries the request out, and the session they asked from.
  userId: string;
  sessionId: string;
  requirement: string;
  departmentId: string | null;
  execution: ExecutionProfile;
  resources: ResourceProfile;
  maxHires: number;
  state: StaffingState;
  plan: StaffingPlan | null;
  outcome: StaffingOutcome | null;
  reportMessageId: string | null;
  createdAt: string;
  endedAt: string | null;
}

const staffingOf = (r: Row): StaffingRecord => ({
  id: String(r.id),
  orbitId: String(r.account_id),
  conversationId: String(r.conversation_id),
  turnId: String(r.turn_id),
  userId: String(r.requested_by_user),
  sessionId: String(r.requested_by_session),
  requirement: String(r.requirement),
  departmentId: r.department_id === null ? null : String(r.department_id),
  execution: r.execution as ExecutionProfile,
  resources: r.resources as ResourceProfile,
  maxHires: Number(r.max_hires),
  state: String(r.state) as StaffingState,
  plan: (r.plan as StaffingPlan | null) ?? null,
  outcome: (r.outcome as StaffingOutcome | null) ?? null,
  reportMessageId: r.report_message_id === null ? null : String(r.report_message_id),
  createdAt: iso(r.created_at) as string,
  endedAt: iso(r.ended_at),
});

export const staffingView = (s: StaffingRecord, departmentName: string | null): StaffingView => ({
  id: s.id,
  state: s.state,
  requirement: s.requirement,
  departmentId: s.departmentId,
  departmentName,
  execution: s.execution,
  resources: s.resources,
  maxHires: s.maxHires,
  conversationId: s.conversationId,
  turnId: s.turnId,
  plan: s.plan,
  outcome: s.outcome,
  createdAt: s.createdAt,
  endedAt: s.endedAt,
});

@Injectable()
export class StaffingRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async insert(s: Omit<StaffingRecord, "state" | "plan" | "outcome" | "reportMessageId" | "endedAt">): Promise<StaffingRecord> {
    const row = await this.db.one(
      `INSERT INTO executive.staffing_requests (id, account_id, conversation_id, turn_id, requested_by_user, requested_by_session, requirement, department_id, execution, resources, max_hires, state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, 'planning', $12) RETURNING *`,
      [s.id, s.orbitId, s.conversationId, s.turnId, s.userId, s.sessionId, s.requirement, s.departmentId, jsonParam(s.execution), jsonParam(s.resources), s.maxHires, s.createdAt],
    );
    return staffingOf(row as Row);
  }

  async get(orbitId: string, id: string): Promise<StaffingRecord | null> {
    const row = await this.db.one("SELECT * FROM executive.staffing_requests WHERE account_id = $1 AND id = $2", [orbitId, id]);
    return row === null ? null : staffingOf(row);
  }

  // The request a turn plans (null: an ordinary answer's turn), held for this transaction when `lock`.
  async ofTurn(orbitId: string, turnId: string, lock = false): Promise<StaffingRecord | null> {
    const row = await this.db.one(`SELECT * FROM executive.staffing_requests WHERE account_id = $1 AND turn_id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, turnId]);
    return row === null ? null : staffingOf(row);
  }

  // Leaves `planning` once: null when it already had.
  async end(orbitId: string, id: string, set: { state: Exclude<StaffingState, "planning">; plan: StaffingPlan | null; outcome: StaffingOutcome; reportMessageId: string | null; at: string }): Promise<StaffingRecord | null> {
    const row = await this.db.one(
      `UPDATE executive.staffing_requests SET state = $3, plan = $4::jsonb, outcome = $5::jsonb, report_message_id = $6, ended_at = $7, version = version + 1
       WHERE account_id = $1 AND id = $2 AND state = 'planning' RETURNING *`,
      [orbitId, id, set.state, set.plan === null ? null : jsonParam(set.plan), jsonParam(set.outcome), set.reportMessageId, set.at],
    );
    return row === null ? null : staffingOf(row);
  }
}
