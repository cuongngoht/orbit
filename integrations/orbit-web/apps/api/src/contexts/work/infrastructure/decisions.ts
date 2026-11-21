// NEEDS ME (Work context's decision requests): what waits for a person's decision -- a result to review, information to
// give, a run to reconcile, work that can never start as configured -- each pinned to the version it was raised against,
// deduplicated by a key (one open item per subject), resolved by the command of the context that owns the subject.
import { Inject, Injectable } from "@nestjs/common";
import type { InboxItem, InboxKind } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";

export const decisionOf = (r: Row): InboxItem => ({
  id: String(r.id),
  kind: String(r.kind) as InboxKind,
  state: String(r.state) as InboxItem["state"],
  missionId: String(r.mission_id),
  assignmentId: r.assignment_id === null ? null : String(r.assignment_id),
  title: String(r.title),
  reason: String(r.reason),
  waiting: r.waiting === null ? null : String(r.waiting),
  deadline: r.deadline === null ? null : String(r.deadline),
  pin: r.pin as InboxItem["pin"],
  createdAt: String(r.created_at),
  resolvedAt: r.resolved_at === null ? null : String(r.resolved_at),
  resolution: r.resolution === null ? null : String(r.resolution),
});

export interface OpenDecision {
  orbitId: string;
  kind: InboxKind;
  missionId: string;
  assignmentId: string | null;
  runId?: string | null;
  title: string;
  reason: string;
  waiting: string | null;
  deadline: string | null;
  pin: InboxItem["pin"];
  // One open item per subject: a second `open` with the same key updates the open one instead of adding another.
  dedupKey: string;
}

@Injectable()
export class DecisionRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async open(d: OpenDecision): Promise<void> {
    await this.db.query(
      `INSERT INTO workforce.decisions (id, account_id, kind, state, mission_id, assignment_id, run_id, title, reason, waiting, deadline, pin, dedup_key, created_at)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
       ON CONFLICT (account_id, dedup_key) WHERE state = 'open' DO UPDATE SET reason = excluded.reason, pin = excluded.pin, title = excluded.title, version = workforce.decisions.version + 1`,
      [randomUUID(), d.orbitId, d.kind, d.missionId, d.assignmentId, d.runId ?? null, d.title.slice(0, 200), d.reason.slice(0, 1000), d.waiting, d.deadline, jsonParam(d.pin), d.dedupKey, new Date().toISOString()],
    );
  }

  // Closes the open item of a subject (resolved by a person's command, or withdrawn because it no longer applies).
  async close(orbitId: string, dedupKey: string, state: "resolved" | "withdrawn" | "expired", resolution: string, by: string | null): Promise<void> {
    await this.db.query("UPDATE workforce.decisions SET state = $3, resolution = $4, resolved_by = $5, resolved_at = $6, version = version + 1 WHERE account_id = $1 AND dedup_key = $2 AND state = 'open'", [orbitId, dedupKey, state, resolution.slice(0, 300), by, new Date().toISOString()]);
  }

  // Every open item about an assignment (when it ends, they no longer apply).
  async closeAllFor(orbitId: string, assignmentId: string, resolution: string): Promise<void> {
    await this.db.query("UPDATE workforce.decisions SET state = 'withdrawn', resolution = $3, resolved_at = $4, version = version + 1 WHERE account_id = $1 AND assignment_id = $2 AND state = 'open'", [orbitId, assignmentId, resolution.slice(0, 300), new Date().toISOString()]);
  }

  async list(orbitId: string, open: boolean, cursor: string | null, limit: number): Promise<InboxItem[]> {
    const rows = await this.db.query(
      `SELECT * FROM workforce.decisions WHERE account_id = $1 AND ${open ? "state = 'open'" : "state <> 'open'"}
         AND ($2::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM workforce.decisions WHERE account_id = $1 AND id = $2::uuid))
       ORDER BY created_at DESC, id DESC LIMIT $3`,
      [orbitId, cursor, limit],
    );
    return rows.map(decisionOf);
  }

  async openCount(orbitId: string): Promise<number> {
    return Number((await this.db.one("SELECT count(*) AS n FROM workforce.decisions WHERE account_id = $1 AND state = 'open'", [orbitId]))?.n ?? 0);
  }
}
