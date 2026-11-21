// RUNS (Execution context): one attempt of an assignment, from its durable INTENT (requested -- written in the claim's
// transaction) to its end. A worker drives a run only while it holds its LEASE (owner + deadline, renewed by heartbeat);
// every write a worker makes names the run's FENCE (the assignment's at the attempt) and the run's state it expects, so
// a worker that lost its lease -- or a run replaced by a newer attempt -- changes nothing.
import { Inject, Injectable } from "@nestjs/common";
import type { ExecutionProfile, ResourceEvidence, RunState, SandboxAttestation, UsageView } from "@orbit-web/contracts";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";
import type { AttemptHandle } from "../application/sandbox.port.js";

export interface RunRecord {
  id: string;
  orbitId: string;
  assignmentId: string;
  employeeId: string;
  attemptNo: number;
  state: RunState;
  dispatchKey: string;
  fence: number;
  leaseOwner: string | null;
  leaseUntil: string | null;
  requested: Partial<ExecutionProfile> & { brief?: unknown };
  resolved: ExecutionProfile | null;
  observed: Record<string, unknown> | null;
  resourceRevision: number | null;
  resources: ResourceEvidence | null;
  usage: { modelPlane: UsageView | null; toolPlane: UsageView | null } | null;
  modelUsage: { costUsd: number | null; turns: number | null; durationMs: number | null } | null;
  sandbox: SandboxAttestation | null;
  handle: AttemptHandle | null;
  waitingReason: string | null;
  waitingSince: string | null;
  priority: number;
  stopRequested: string | null;
  startedAt: string | null;
  endedAt: string | null;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export const runOf = (r: Row): RunRecord => ({
  id: s(r.id),
  orbitId: s(r.account_id),
  assignmentId: s(r.assignment_id),
  employeeId: s(r.employee_id),
  attemptNo: Number(r.attempt_no),
  state: s(r.state) as RunState,
  dispatchKey: s(r.dispatch_key),
  fence: Number(r.fence),
  leaseOwner: sn(r.lease_owner),
  leaseUntil: sn(r.lease_until),
  requested: (r.requested ?? {}) as RunRecord["requested"],
  resolved: (r.resolved as ExecutionProfile | null) ?? null,
  observed: (r.observed as Record<string, unknown> | null) ?? null,
  resourceRevision: r.resource_revision === null ? null : Number(r.resource_revision),
  resources: (r.resources as ResourceEvidence | null) ?? null,
  usage: (r.usage as RunRecord["usage"]) ?? null,
  modelUsage: (r.model_usage as RunRecord["modelUsage"]) ?? null,
  sandbox: (r.sandbox as SandboxAttestation | null) ?? null,
  handle: (r.sandbox_handle as AttemptHandle | null) ?? null,
  waitingReason: sn(r.waiting_reason),
  waitingSince: sn(r.waiting_since),
  priority: Number(r.priority),
  stopRequested: sn(r.stop_requested),
  startedAt: sn(r.started_at),
  endedAt: sn(r.ended_at),
  detail: sn(r.detail),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
  version: Number(r.version),
});

export const LIVE_RUN_STATES: readonly RunState[] = ["requested", "waiting_for_resources", "unschedulable", "starting", "running", "unknown"];
export const PENDING_RUN_STATES: readonly RunState[] = ["requested", "waiting_for_resources", "unschedulable"];

@Injectable()
export class RunRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async get(orbitId: string, id: string, lock = false): Promise<RunRecord | null> {
    const row = await this.db.one(`SELECT * FROM workforce.runs WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : runOf(row);
  }

  // Found by id alone: only for the run token's own binding (the token names the run), and for the worker's own leases.
  async byId(id: string): Promise<RunRecord | null> {
    const row = await this.db.one("SELECT * FROM workforce.runs WHERE id = $1", [id]);
    return row === null ? null : runOf(row);
  }

  async live(orbitId: string, assignmentId: string, lock = false): Promise<RunRecord | null> {
    const row = await this.db.one(`SELECT * FROM workforce.runs WHERE account_id = $1 AND assignment_id = $2 AND state = ANY($3) ORDER BY attempt_no DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`, [orbitId, assignmentId, [...LIVE_RUN_STATES]]);
    return row === null ? null : runOf(row);
  }

  // The attempt of an employee that is live now (at most one: admission starts none beside it).
  async liveOfEmployee(orbitId: string, employeeId: string): Promise<RunRecord | null> {
    const row = await this.db.one("SELECT * FROM workforce.runs WHERE account_id = $1 AND employee_id = $2 AND state IN ('starting', 'running', 'unknown') ORDER BY created_at DESC LIMIT 1", [orbitId, employeeId]);
    return row === null ? null : runOf(row);
  }

  async latest(orbitId: string, assignmentId: string): Promise<RunRecord | null> {
    const row = await this.db.one("SELECT * FROM workforce.runs WHERE account_id = $1 AND assignment_id = $2 ORDER BY attempt_no DESC LIMIT 1", [orbitId, assignmentId]);
    return row === null ? null : runOf(row);
  }

  async ofAssignments(orbitId: string, ids: readonly string[]): Promise<RunRecord[]> {
    if (ids.length === 0) return [];
    return (await this.db.query("SELECT * FROM workforce.runs WHERE account_id = $1 AND assignment_id = ANY($2) ORDER BY assignment_id, attempt_no", [orbitId, [...ids]])).map(runOf);
  }

  async attempts(orbitId: string, assignmentId: string): Promise<number> {
    return Number((await this.db.one("SELECT COALESCE(MAX(attempt_no), 0) AS n FROM workforce.runs WHERE account_id = $1 AND assignment_id = $2", [orbitId, assignmentId]))?.n ?? 0);
  }

  async insert(r: { id: string; orbitId: string; assignmentId: string; employeeId: string; attemptNo: number; fence: number; requested: RunRecord["requested"]; priority: number; at: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO workforce.runs (id, account_id, assignment_id, employee_id, attempt_no, state, dispatch_key, fence, requested, priority, waiting_since, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'requested', $6, $7, $8::jsonb, $9, $10, $10, $10)`,
      [r.id, r.orbitId, r.assignmentId, r.employeeId, r.attemptNo, `${r.assignmentId}:${r.attemptNo}`, r.fence, jsonParam(r.requested), r.priority, r.at],
    );
  }

  // Moves a run from one of `from` to `to`, with the given fields -- under its fence, and (a worker's write) only while
  // `owner` holds its lease. False: it was not in `from` (or another fence, or another holder), and nothing changed.
  async transition(orbitId: string, id: string, from: readonly RunState[], to: RunState, fields: Partial<Record<RunColumn, unknown>> = {}, fence: number | null = null, owner: string | null = null): Promise<boolean> {
    const sets = ["state = $4", "updated_at = $5", "version = version + 1"];
    const params: unknown[] = [orbitId, id, [...from], to, new Date().toISOString()];
    for (const [k, v] of Object.entries(fields)) {
      const col = COLUMNS[k as RunColumn];
      params.push(JSONB.has(k as RunColumn) ? (v === null ? null : jsonParam(v)) : v);
      sets.push(`${col} = $${params.length}${JSONB.has(k as RunColumn) ? "::jsonb" : ""}`);
    }
    let where = "account_id = $1 AND id = $2 AND state = ANY($3)";
    if (fence !== null) {
      params.push(fence);
      where += ` AND fence = $${params.length}`;
    }
    if (owner !== null) {
      params.push(owner);
      where += ` AND lease_owner = $${params.length}`;
    }
    return (await this.db.run(`UPDATE workforce.runs SET ${sets.join(", ")} WHERE ${where}`, params as never)) > 0;
  }

  async set(orbitId: string, id: string, fields: Partial<Record<RunColumn, unknown>>): Promise<void> {
    const sets: string[] = ["updated_at = $3"];
    const params: unknown[] = [orbitId, id, new Date().toISOString()];
    for (const [k, v] of Object.entries(fields)) {
      params.push(JSONB.has(k as RunColumn) ? (v === null ? null : jsonParam(v)) : v);
      sets.push(`${COLUMNS[k as RunColumn]} = $${params.length}${JSONB.has(k as RunColumn) ? "::jsonb" : ""}`);
    }
    await this.db.run(`UPDATE workforce.runs SET ${sets.join(", ")} WHERE account_id = $1 AND id = $2`, params as never);
  }

  // The lease: taken only when free or expired; renewed only by its holder.
  async lease(orbitId: string, id: string, owner: string, ms: number): Promise<boolean> {
    const until = new Date(Date.now() + ms).toISOString();
    return (await this.db.run("UPDATE workforce.runs SET lease_owner = $3, lease_until = $4, heartbeat_at = now() WHERE account_id = $1 AND id = $2 AND (lease_owner IS NULL OR lease_owner = $3 OR lease_until < now())", [orbitId, id, owner, until])) > 0;
  }

  // Renewed only by the worker that holds it (a heartbeat). False: the lease was lost (expired and taken by another).
  async renew(orbitId: string, id: string, owner: string, ms: number): Promise<boolean> {
    const until = new Date(Date.now() + ms).toISOString();
    return (await this.db.run("UPDATE workforce.runs SET lease_until = $4, heartbeat_at = now() WHERE account_id = $1 AND id = $2 AND lease_owner = $3", [orbitId, id, owner, until])) > 0;
  }

  // Ended runs whose reservation is still held (their containers were not verified gone): the reconciler's to finish.
  async unreleased(limit = 20): Promise<RunRecord[]> {
    const rows = await this.db.query(
      `SELECT r.* FROM workforce.runs r JOIN workforce.compute_reservations c ON c.account_id = r.account_id AND c.run_id = r.id
       WHERE c.released_at IS NULL AND r.state IN ('succeeded', 'failed', 'interrupted', 'cancelled') AND (r.lease_until IS NULL OR r.lease_until < now())
       ORDER BY r.updated_at LIMIT $1`,
      [limit],
    );
    return rows.map(runOf);
  }

  async releaseLease(orbitId: string, id: string, owner: string): Promise<void> {
    await this.db.run("UPDATE workforce.runs SET lease_owner = NULL, lease_until = NULL WHERE account_id = $1 AND id = $2 AND lease_owner = $3", [orbitId, id, owner]);
  }

  // Runs whose worker is gone: started (or unknown) and their lease ran out.
  async orphaned(limit = 20): Promise<RunRecord[]> {
    return (await this.db.query("SELECT * FROM workforce.runs WHERE state IN ('starting', 'running', 'unknown') AND (lease_until IS NULL OR lease_until < now()) ORDER BY updated_at LIMIT $1", [limit])).map(runOf);
  }

  async pending(limit = 200): Promise<RunRecord[]> {
    return (await this.db.query("SELECT * FROM workforce.runs WHERE state = ANY($1) ORDER BY waiting_since, id LIMIT $2", [[...PENDING_RUN_STATES], limit])).map(runOf);
  }

  async withStopRequested(): Promise<RunRecord[]> {
    return (await this.db.query("SELECT * FROM workforce.runs WHERE stop_requested IS NOT NULL AND state IN ('starting', 'running')")).map(runOf);
  }
}

const COLUMNS = {
  leaseOwner: "lease_owner",
  leaseUntil: "lease_until",
  resolved: "resolved",
  observed: "observed",
  resourceRevision: "resource_revision",
  resources: "resources",
  usage: "usage",
  modelUsage: "model_usage",
  sandbox: "sandbox",
  handle: "sandbox_handle",
  waitingReason: "waiting_reason",
  waitingSince: "waiting_since",
  stopRequested: "stop_requested",
  startedAt: "started_at",
  endedAt: "ended_at",
  detail: "detail",
} as const;

type RunColumn = keyof typeof COLUMNS;

const JSONB = new Set<RunColumn>(["resolved", "observed", "resources", "usage", "modelUsage", "sandbox", "handle"]);
