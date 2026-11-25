// CONVERSATION RUNS (Execution, ADR 0062): one bounded inference of an employee with no tool -- the CEO answering in CEO
// Chat. Requested by the executive context, admitted by the same pass as the attempts (admission.service.ts), driven by
// the process its lease names, and released once its process is gone. Every write is held to the state it moves from,
// so two processes never both drive one.
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";

export type ConversationRunState = "requested" | "waiting" | "starting" | "running" | "succeeded" | "failed" | "interrupted" | "cancelled";

export const LIVE_CONVERSATION_STATES: readonly ConversationRunState[] = ["starting", "running"];
export const PENDING_CONVERSATION_STATES: readonly ConversationRunState[] = ["requested", "waiting"];

// What a conversation run asks to run on: the employee's execution as resolved when it was asked, and the appointment
// it answers under (a different CEO since is not this run's).
export interface ConversationRunRequest {
  runtime: string;
  connectionId: string | null;
  model: string;
  effort: string | null;
  appointmentId: string | null;
  appointmentRevision: number | null;
}

export interface ConversationRunRecord {
  id: string;
  orbitId: string;
  employeeId: string;
  state: ConversationRunState;
  requested: ConversationRunRequest;
  priority: number;
  cpuMillis: number | null;
  memoryMiB: number | null;
  reservedAt: string | null;
  releasedAt: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
  stopRequested: string | null;
  waitingReason: string | null;
  waitingSince: string;
  startedAt: string | null;
  endedAt: string | null;
  detail: string | null;
  version: number;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(String(v)).toISOString());

export function conversationRunOf(r: Row): ConversationRunRecord {
  return {
    id: String(r.id),
    orbitId: String(r.account_id),
    employeeId: String(r.employee_id),
    state: String(r.state) as ConversationRunState,
    requested: r.requested as ConversationRunRequest,
    priority: Number(r.priority),
    cpuMillis: r.cpu_millis === null ? null : Number(r.cpu_millis),
    memoryMiB: r.memory_mib === null ? null : Number(r.memory_mib),
    reservedAt: iso(r.reserved_at),
    releasedAt: iso(r.released_at),
    leaseOwner: r.lease_owner === null ? null : String(r.lease_owner),
    leaseUntil: iso(r.lease_until),
    stopRequested: r.stop_requested === null ? null : String(r.stop_requested),
    waitingReason: r.waiting_reason === null ? null : String(r.waiting_reason),
    waitingSince: iso(r.waiting_since) as string,
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    detail: r.detail === null ? null : String(r.detail),
    version: Number(r.version),
  };
}

@Injectable()
export class ConversationRunRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async request(o: { orbitId: string; employeeId: string; requested: ConversationRunRequest; priority?: number }): Promise<ConversationRunRecord> {
    const at = new Date().toISOString();
    const row = await this.db.one(
      `INSERT INTO workforce.conversation_runs (id, account_id, employee_id, state, requested, priority, waiting_since, created_at, updated_at)
       VALUES ($1, $2, $3, 'requested', $4::jsonb, $5, $6, $6, $6) RETURNING *`,
      [randomUUID(), o.orbitId, o.employeeId, jsonParam(o.requested), o.priority ?? 5, at],
    );
    return conversationRunOf(row as Row);
  }

  async get(orbitId: string, id: string, lock = false): Promise<ConversationRunRecord | null> {
    const row = await this.db.one(`SELECT * FROM workforce.conversation_runs WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : conversationRunOf(row);
  }

  // Whether any conversation run waits to be admitted (the worker asks before a pass).
  async anyPending(): Promise<boolean> {
    return (await this.db.one("SELECT 1 AS x FROM workforce.conversation_runs WHERE state IN ('requested', 'waiting') LIMIT 1")) !== null;
  }

  // The live one of an employee (starting or running), if any.
  async liveOfEmployee(orbitId: string, employeeId: string): Promise<ConversationRunRecord | null> {
    const row = await this.db.one("SELECT * FROM workforce.conversation_runs WHERE account_id = $1 AND employee_id = $2 AND state IN ('starting', 'running') LIMIT 1", [orbitId, employeeId]);
    return row === null ? null : conversationRunOf(row);
  }

  // From `from` to `to`, with the fields given; false when it was no longer in `from` (someone else moved it first).
  async move(orbitId: string, id: string, from: readonly ConversationRunState[], to: ConversationRunState, set: { detail?: string | null; waitingReason?: string | null; startedAt?: string; endedAt?: string } = {}): Promise<boolean> {
    const sets = ["state = $4", "updated_at = now()", "version = version + 1"];
    const params: unknown[] = [orbitId, id, [...from], to];
    const add = (column: string, v: unknown) => {
      params.push(v);
      sets.push(`${column} = $${params.length}`);
    };
    if (set.detail !== undefined) add("detail", set.detail === null ? null : set.detail.slice(0, 2000));
    if (set.waitingReason !== undefined) add("waiting_reason", set.waitingReason);
    if (set.startedAt !== undefined) add("started_at", set.startedAt);
    if (set.endedAt !== undefined) add("ended_at", set.endedAt);
    return (await this.db.run(`UPDATE workforce.conversation_runs SET ${sets.join(", ")} WHERE account_id = $1 AND id = $2 AND state = ANY($3)`, params as never)) > 0;
  }

  // The lease of the process that drives it, renewed while it does; false when another process holds it now.
  async renew(orbitId: string, id: string, owner: string, leaseMs: number): Promise<boolean> {
    return (await this.db.run("UPDATE workforce.conversation_runs SET lease_until = $4 WHERE account_id = $1 AND id = $2 AND lease_owner = $3 AND state IN ('starting', 'running')", [orbitId, id, owner, new Date(Date.now() + leaseMs).toISOString()])) > 0;
  }

  // A person (or a disconnected connection) asked it to stop: read by the process that drives it.
  async requestStop(orbitId: string, id: string, reason: string): Promise<boolean> {
    return (await this.db.run("UPDATE workforce.conversation_runs SET stop_requested = COALESCE(stop_requested, $3), updated_at = now() WHERE account_id = $1 AND id = $2 AND state IN ('requested', 'waiting', 'starting', 'running')", [orbitId, id, reason])) > 0;
  }

  // Every live or waiting conversation run on a connection, asked to stop (it was disconnected).
  async requestStopOnConnection(orbitId: string, connectionId: string, reason: string): Promise<ConversationRunRecord[]> {
    const rows = await this.db.query(
      "UPDATE workforce.conversation_runs SET stop_requested = COALESCE(stop_requested, $3), updated_at = now() WHERE account_id = $1 AND requested->>'connectionId' = $2 AND state IN ('requested', 'waiting', 'starting', 'running') RETURNING *",
      [orbitId, connectionId, reason],
    );
    return rows.map(conversationRunOf);
  }

  // Live runs whose lease ran out (the process that drove them is gone).
  async expired(): Promise<ConversationRunRecord[]> {
    return (await this.db.query("SELECT * FROM workforce.conversation_runs WHERE state IN ('starting', 'running') AND (lease_until IS NULL OR lease_until < now()) ORDER BY lease_until NULLS FIRST LIMIT 100")).map(conversationRunOf);
  }

  // Runs an earlier process of this host drove: recovered now, not after their lease runs out.
  async expireHost(hostPrefix: string, owner: string): Promise<void> {
    await this.db.run("UPDATE workforce.conversation_runs SET lease_until = now() WHERE state IN ('starting', 'running') AND lease_owner LIKE $1 AND lease_owner <> $2", [`${hostPrefix}:%`, owner]);
  }
}
