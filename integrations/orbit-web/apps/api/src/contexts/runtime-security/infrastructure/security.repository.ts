// THE SECURITY CONTEXT'S STORE (ADR 0063, migration 3): what the allocator reported, kept by account -- every read and
// write names the account first, and nothing here reads another account's rows. Protections are replaced only by a NEWER
// report; events are deduplicated by their key and bounded per run (what is not kept is said, by a gap marker) and by
// age; an incident is one per cause per attempt; what was done about an incident is history (the database refuses a
// change of it).
import { Inject, Injectable } from "@nestjs/common";
import type { IncidentActionView, IncidentCategory, IncidentDecision, IncidentSeverity, IncidentState, IncidentView, ProtectionEvidence, ProtectionState, RuntimeEventKind, RuntimeEventView, RuntimeOutcome, WatchedRunKind, WorkloadProtectionView } from "@orbit-web/contracts";
import type { RuntimeControlId, RuntimeMode } from "@orbit-web/governance-core";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";
import type { WireProtection, WireSensor } from "../../execution/infrastructure/sandbox/runtime-security-wire.js";

const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface FeedState {
  epoch: string | null;
  seq: number;
  sensor: WireSensor | null;
  lost: number;
  unattributed: number;
  gaps: number;
  canaryProvenAt: string | null;
  lastEventAt: string | null;
  updatedAt: string | null;
}

export interface EventRow {
  accountId: string;
  key: string;
  occurredAt: string;
  runKind: WatchedRunKind;
  runId: string;
  employeeId: string | null;
  kind: RuntimeEventKind;
  outcome: RuntimeOutcome;
  severity: IncidentSeverity;
  plane: string | null;
  binary: string | null;
  parentBinary: string | null;
  path: string | null;
  control: string | null;
  execId: string | null;
  parentExecId: string | null;
  exitCode: number | null;
  signal: string | null;
}

export interface IncidentRecord extends Omit<IncidentView, "actions" | "employeeName"> {
  accountId: string;
  fingerprint: string;
}

const eventView = (r: Row): RuntimeEventView => ({
  id: s(r.id),
  occurredAt: s(r.occurred_at),
  kind: s(r.kind) as RuntimeEventKind,
  outcome: s(r.outcome) as RuntimeOutcome,
  severity: s(r.severity) as IncidentSeverity,
  runKind: s(r.run_kind) as WatchedRunKind,
  plane: (sn(r.plane) ?? "session-plane") as RuntimeEventView["plane"],
  runId: sn(r.run_id),
  employeeId: sn(r.employee_id),
  binary: sn(r.binary_path),
  parentBinary: sn(r.parent_binary),
  path: sn(r.target_path),
  control: sn(r.control) as RuntimeControlId | null,
  execId: sn(r.exec_id),
  parentExecId: sn(r.parent_exec_id),
  exitCode: n(r.exit_code),
  signal: sn(r.signal),
  dropped: n(r.dropped),
});

const incidentOf = (r: Row): IncidentRecord => ({
  id: s(r.id),
  accountId: s(r.account_id),
  fingerprint: s(r.fingerprint),
  category: s(r.category) as IncidentCategory,
  severity: s(r.severity) as IncidentSeverity,
  state: s(r.state) as IncidentState,
  title: s(r.title),
  runId: sn(r.run_id),
  assignmentId: sn(r.assignment_id),
  missionId: sn(r.mission_id),
  employeeId: sn(r.employee_id),
  firstSeen: s(r.first_seen),
  lastSeen: s(r.last_seen),
  count: Number(r.count),
  blocksRetry: r.blocks_retry === true,
  evidence: (r.evidence ?? {}) as IncidentView["evidence"],
  review: (r.review as IncidentView["review"]) ?? null,
  version: Number(r.version),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => typeof v === "string" && UUID.test(v);

@Injectable()
export class SecurityRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---- the stream ------------------------------------------------------------------------------------------------------

  async feed(): Promise<FeedState> {
    const r = await this.db.one("SELECT * FROM security.feed WHERE id = 1");
    if (r === null) return { epoch: null, seq: 0, sensor: null, lost: 0, unattributed: 0, gaps: 0, canaryProvenAt: null, lastEventAt: null, updatedAt: null };
    return { epoch: sn(r.epoch), seq: Number(r.seq), sensor: (r.sensor as WireSensor | null) ?? null, lost: Number(r.lost), unattributed: Number(r.unattributed), gaps: Number(r.gaps), canaryProvenAt: sn(r.canary_proven_at), lastEventAt: sn(r.last_event_at), updatedAt: sn(r.updated_at) };
  }

  async saveFeed(f: Omit<FeedState, "updatedAt">, at: string): Promise<void> {
    await this.db.run(
      `INSERT INTO security.feed (id, epoch, seq, sensor, lost, unattributed, gaps, canary_proven_at, last_event_at, updated_at) VALUES (1, $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET epoch = excluded.epoch, seq = excluded.seq, sensor = excluded.sensor, lost = excluded.lost, unattributed = excluded.unattributed, gaps = excluded.gaps, canary_proven_at = excluded.canary_proven_at, last_event_at = excluded.last_event_at, updated_at = excluded.updated_at`,
      [f.epoch, f.seq, jsonParam(f.sensor), f.lost, f.unattributed, f.gaps, f.canaryProvenAt, f.lastEventAt, at],
    );
  }

  // ---- protections ------------------------------------------------------------------------------------------------------

  // The allocator's report of one attempt's protection, kept if it is newer than what is kept (and the run is the
  // account's): the state it replaced, or undefined when it was not taken.
  async reportProtection(p: WireProtection): Promise<{ from: ProtectionState | null } | undefined> {
    if (!isUuid(p.accountId) || !isUuid(p.runId)) return undefined;
    const run = await this.db.one("SELECT 1 AS x FROM workforce.runs WHERE account_id = $1 AND id = $2", [p.accountId, p.runId]);
    if (run === null) return undefined;
    const before = await this.db.one("SELECT state, reported_at FROM security.protections WHERE account_id = $1 AND run_id = $2 FOR UPDATE", [p.accountId, p.runId]);
    if (before !== null && Date.parse(s(before.reported_at)) > Date.parse(p.updatedAt)) return undefined;
    if (before !== null && s(before.state) === p.state && Date.parse(s(before.reported_at)) === Date.parse(p.updatedAt)) return undefined;
    const { dispatchKey: _d, runId: _r, accountId: _a, assignmentId: _as, employeeId: _e, fence: _f, opened: _o, lostSince: _l, updatedAt: _u, ...evidence } = p;
    await this.db.run(
      `INSERT INTO security.protections (account_id, run_id, dispatch_key, fence, employee_id, assignment_id, mode, state, evidence, reported_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       ON CONFLICT (account_id, run_id) DO UPDATE SET mode = excluded.mode, state = excluded.state, evidence = excluded.evidence, reported_at = excluded.reported_at, updated_at = excluded.updated_at`,
      [p.accountId, p.runId, p.dispatchKey, p.fence, isUuid(p.employeeId) ? p.employeeId : null, isUuid(p.assignmentId) ? p.assignmentId : null, p.mode, p.state, jsonParam({ ...evidence, opened: p.opened, lostSince: p.lostSince }), p.updatedAt, new Date().toISOString()],
    );
    return { from: before === null ? null : (s(before.state) as ProtectionState) };
  }

  // What an attempt is held to: the allocator's latest report, else what the worker kept with the run when it opened it
  // (the evidence of its start) -- never nothing while the attempt carries evidence.
  // Every field from ONE source: a report's state is never paired with the start evidence's freshness.
  async protectionOf(accountId: string, runId: string): Promise<{ mode: RuntimeMode; state: ProtectionState; freshUntil: string | null } | null> {
    if (!isUuid(runId)) return null;
    const r = await this.db.one(
      `SELECT CASE WHEN p.run_id IS NULL THEN r.sandbox->'protection'->>'mode' ELSE p.mode END AS mode,
              CASE WHEN p.run_id IS NULL THEN r.sandbox->'protection'->>'state' ELSE p.state END AS state,
              CASE WHEN p.run_id IS NULL THEN r.sandbox->'protection'->>'freshUntil' ELSE p.evidence->>'freshUntil' END AS fresh_until
         FROM workforce.runs r LEFT JOIN security.protections p ON p.account_id = r.account_id AND p.run_id = r.id
        WHERE r.account_id = $1 AND r.id = $2`,
      [accountId, runId],
    );
    return r === null || r.mode === null ? null : { mode: s(r.mode) as RuntimeMode, state: s(r.state) as ProtectionState, freshUntil: sn(r.fresh_until) };
  }

  // ---- events -------------------------------------------------------------------------------------------------------------

  // Kept up to `cap` per run; beyond it, one gap marker per run counts what was not kept. Deduplicated by key.
  async insertEvents(rows: readonly EventRow[], cap: number, at: string): Promise<number> {
    if (rows.length === 0) return 0;
    const runs = [...new Set(rows.map((r) => `${r.accountId}\u0001${r.runId}`))];
    const counts = new Map<string, number>();
    for (const key of runs) {
      const [accountId, runId] = key.split("\u0001") as [string, string];
      const c = await this.db.one("SELECT count(*)::int AS c FROM security.events WHERE account_id = $1 AND run_id = $2 AND kind <> 'telemetry.gap'", [accountId, runId]);
      counts.set(key, Number(c?.c ?? 0));
    }
    let kept = 0;
    const over = new Map<string, { row: EventRow; dropped: number }>();
    for (const r of rows) {
      const key = `${r.accountId}\u0001${r.runId}`;
      const c = counts.get(key) ?? 0;
      if (c >= cap && r.severity === "INFO") {
        const o = over.get(key) ?? { row: r, dropped: 0 };
        o.dropped += 1;
        over.set(key, o);
        continue;
      }
      const done = await this.db.run(
        `INSERT INTO security.events (account_id, event_key, occurred_at, received_at, run_kind, run_id, employee_id, kind, outcome, severity, plane, binary_path, parent_binary, target_path, control, exec_id, parent_exec_id, exit_code, signal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) ON CONFLICT (account_id, event_key) DO NOTHING`,
        [r.accountId, r.key, r.occurredAt, at, r.runKind, r.runId, isUuid(r.employeeId) ? r.employeeId : null, r.kind, r.outcome, r.severity, r.plane, r.binary, r.parentBinary, r.path, r.control, r.execId, r.parentExecId, r.exitCode, r.signal],
      );
      if (done > 0) {
        kept += 1;
        counts.set(key, c + 1);
      }
    }
    for (const [, o] of over) await this.gap(o.row.accountId, o.row.runKind, o.row.runId, o.row.employeeId, o.dropped, at, `cap:${o.row.runId}`);
    return kept;
  }

  // A marker in a run's stream: events of it that were not kept (its cap) or lost before Orbit Web read them.
  async gap(accountId: string, runKind: WatchedRunKind, runId: string, employeeId: string | null, dropped: number, at: string, key: string): Promise<void> {
    await this.db.run(
      `INSERT INTO security.events (account_id, event_key, occurred_at, received_at, run_kind, run_id, employee_id, kind, outcome, severity, dropped) VALUES ($1, $2, $3, $3, $4, $5, $6, 'telemetry.gap', 'OBSERVED', 'LOW', $7)
       ON CONFLICT (account_id, event_key) DO UPDATE SET dropped = security.events.dropped + excluded.dropped, received_at = excluded.received_at`,
      [accountId, key, at, runKind, runId, isUuid(employeeId) ? employeeId : null, dropped],
    );
  }

  async events(accountId: string, q: { runId?: string; employeeId?: string; kind?: string; outcome?: string; minSeverity?: IncidentSeverity; since?: string; before?: number; limit: number }): Promise<RuntimeEventView[]> {
    const order = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const severities = q.minSeverity === undefined ? null : order.slice(order.indexOf(q.minSeverity));
    const rows = await this.db.query(
      `SELECT * FROM security.events WHERE account_id = $1
         AND ($2::text IS NULL OR run_id = $2) AND ($3::uuid IS NULL OR employee_id = $3) AND ($4::text IS NULL OR kind = $4) AND ($5::text IS NULL OR outcome = $5)
         AND ($6::text[] IS NULL OR severity = ANY($6)) AND ($7::timestamptz IS NULL OR occurred_at >= $7) AND ($8::bigint IS NULL OR id < $8)
       ORDER BY id DESC LIMIT $9`,
      [accountId, q.runId ?? null, isUuid(q.employeeId) ? q.employeeId : null, q.kind ?? null, q.outcome ?? null, severities, q.since ?? null, q.before ?? null, q.limit],
    );
    return rows.map(eventView);
  }

  async counts(accountId: string, since: string): Promise<{ prevented: number; detected: number }> {
    const r = await this.db.one(`SELECT count(*) FILTER (WHERE outcome = 'OPERATION_PREVENTED')::int AS p, count(*) FILTER (WHERE outcome = 'VIOLATION_DETECTED' OR kind IN ('exec.fileless', 'exec.model_plane', 'identity.mismatch'))::int AS d FROM security.events WHERE account_id = $1 AND occurred_at >= $2`, [accountId, since]);
    return { prevented: Number(r?.p ?? 0), detected: Number(r?.d ?? 0) };
  }

  // Retention: events older than the cutoff are removed, for every account (incidents and their history stay).
  async prune(cutoff: string): Promise<number> {
    return this.db.run("DELETE FROM security.events WHERE occurred_at < $1", [cutoff]);
  }

  // ---- incidents -----------------------------------------------------------------------------------------------------------

  // One per cause per attempt: an existing one (by its fingerprint) is seen again, raising its count; a new one is made.
  async openIncident(accountId: string, i: { fingerprint: string; category: IncidentCategory; severity: IncidentSeverity; state: IncidentState; title: string; runId: string | null; assignmentId: string | null; employeeId: string | null; blocksRetry: boolean; evidence: Record<string, string | number | boolean | null> }, at: string, id: string): Promise<{ incident: IncidentRecord; created: boolean }> {
    const existing = await this.db.one("SELECT * FROM security.incidents WHERE account_id = $1 AND fingerprint = $2 FOR UPDATE", [accountId, i.fingerprint]);
    if (existing !== null) {
      const stronger = (a: IncidentState, b: IncidentState): IncidentState => (["OPEN", "INVESTIGATING", "CONTAINING", "CONTAINED", "RESOLVED"].indexOf(b) > ["OPEN", "INVESTIGATING", "CONTAINING", "CONTAINED", "RESOLVED"].indexOf(a) && a !== "RESOLVED" ? b : a);
      const r = await this.db.one(
        `UPDATE security.incidents SET last_seen = $3, count = count + 1, state = $4, blocks_retry = blocks_retry OR $5, evidence = evidence || $6::jsonb, version = version + 1, updated_at = $3 WHERE account_id = $1 AND id = $2 RETURNING *`,
        [accountId, s(existing.id), at, stronger(s(existing.state) as IncidentState, i.state), i.blocksRetry, jsonParam(i.evidence)],
      );
      return { incident: incidentOf(r as Row), created: false };
    }
    const missionId = isUuid(i.assignmentId) ? ((await this.db.one("SELECT mission_id FROM workforce.assignments WHERE account_id = $1 AND id = $2", [accountId, i.assignmentId]))?.mission_id ?? null) : null;
    const r = await this.db.one(
      `INSERT INTO security.incidents (id, account_id, fingerprint, category, severity, state, title, run_id, assignment_id, mission_id, employee_id, first_seen, last_seen, count, blocks_retry, evidence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, 1, $13, $14::jsonb, $12, $12) RETURNING *`,
      [id, accountId, i.fingerprint, i.category, i.severity, i.state, i.title.slice(0, 300), isUuid(i.runId) ? i.runId : null, isUuid(i.assignmentId) ? i.assignmentId : null, sn(missionId), isUuid(i.employeeId) ? i.employeeId : null, at, i.blocksRetry, jsonParam(i.evidence)],
    );
    return { incident: incidentOf(r as Row), created: true };
  }

  async setIncidentState(accountId: string, id: string, state: IncidentState, at: string): Promise<IncidentRecord | null> {
    const r = await this.db.one("UPDATE security.incidents SET state = $3, version = version + 1, updated_at = $4 WHERE account_id = $1 AND id = $2 AND state <> 'RESOLVED' RETURNING *", [accountId, id, state, at]);
    return r === null ? null : incidentOf(r);
  }

  async addAction(accountId: string, incidentId: string, a: { action: string; actor: string; outcome: string; detail: string | null }, at: string): Promise<void> {
    await this.db.run("INSERT INTO security.incident_actions (account_id, incident_id, at, action, actor, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)", [accountId, incidentId, at, a.action, a.actor.slice(0, 200), a.outcome.slice(0, 200), a.detail?.slice(0, 1000) ?? null]);
  }

  async incident(accountId: string, id: string): Promise<{ incident: IncidentRecord; actions: IncidentActionView[] } | null> {
    const r = await this.db.one("SELECT * FROM security.incidents WHERE account_id = $1 AND id = $2", [accountId, id]);
    if (r === null) return null;
    const actions = await this.db.query("SELECT at, action, actor, outcome, detail FROM security.incident_actions WHERE account_id = $1 AND incident_id = $2 ORDER BY id", [accountId, id]);
    return { incident: incidentOf(r), actions: actions.map((a) => ({ at: s(a.at), action: s(a.action), actor: s(a.actor), outcome: s(a.outcome), detail: sn(a.detail) })) };
  }

  async incidents(accountId: string, q: { open?: boolean; employeeId?: string; limit: number }): Promise<IncidentRecord[]> {
    const rows = await this.db.query(`SELECT * FROM security.incidents WHERE account_id = $1 AND ($2::boolean IS NOT TRUE OR state <> 'RESOLVED') AND ($3::uuid IS NULL OR employee_id = $3) ORDER BY last_seen DESC LIMIT $4`, [accountId, q.open ?? null, isUuid(q.employeeId) ? q.employeeId : null, q.limit]);
    return rows.map(incidentOf);
  }

  async openCount(accountId: string): Promise<number> {
    return Number((await this.db.one("SELECT count(*)::int AS c FROM security.incidents WHERE account_id = $1 AND state <> 'RESOLVED'", [accountId]))?.c ?? 0);
  }

  // A person's review: names the version read; a decision on a stale version is refused (the caller answers 412).
  async review(accountId: string, id: string, expectedVersion: number, decision: IncidentDecision, note: string, by: string, at: string): Promise<IncidentRecord | null> {
    const state: IncidentState = decision === "investigate" ? "INVESTIGATING" : "RESOLVED";
    const r = await this.db.one(
      `UPDATE security.incidents SET state = $4, review = $5::jsonb, blocks_retry = CASE WHEN $6 THEN false ELSE blocks_retry END, version = version + 1, updated_at = $7
       WHERE account_id = $1 AND id = $2 AND version = $3 RETURNING *`,
      [accountId, id, expectedVersion, state, jsonParam({ decision, note, at, by }), decision === "authorize_retry", at],
    );
    return r === null ? null : incidentOf(r);
  }

  // The incident that holds an assignment from a person's Retry (none: null).
  async heldBy(accountId: string, assignmentId: string): Promise<{ id: string; title: string } | null> {
    if (!isUuid(assignmentId)) return null;
    const r = await this.db.one("SELECT id, title FROM security.incidents WHERE account_id = $1 AND assignment_id = $2 AND blocks_retry ORDER BY last_seen DESC LIMIT 1", [accountId, assignmentId]);
    return r === null ? null : { id: s(r.id), title: s(r.title) };
  }

  // ---- workloads ----------------------------------------------------------------------------------------------------------

  async workloads(accountId: string, q: { employeeId?: string; live?: boolean; limit: number }): Promise<WorkloadProtectionView[]> {
    // From the runs: the allocator's latest report where there is one, else the evidence the worker kept at the start.
    const rows = await this.db.query(
      `SELECT r.id AS run_id, r.employee_id, COALESCE(p.mode, r.sandbox->'protection'->>'mode') AS mode, COALESCE(p.state, r.sandbox->'protection'->>'state') AS state,
              COALESCE(p.evidence, r.sandbox->'protection') AS evidence, COALESCE(p.updated_at, r.updated_at) AS updated_at,
              r.state AS run_state, r.attempt_no, r.assignment_id AS r_assignment, e.name AS employee_name, e.department_id, a.mission_id
         FROM workforce.runs r
         LEFT JOIN security.protections p ON p.account_id = r.account_id AND p.run_id = r.id
         JOIN workforce.employees e ON e.account_id = r.account_id AND e.id = r.employee_id
         LEFT JOIN workforce.assignments a ON a.account_id = r.account_id AND a.id = r.assignment_id
        WHERE r.account_id = $1 AND (p.run_id IS NOT NULL OR r.sandbox->'protection' IS NOT NULL) AND ($2::uuid IS NULL OR r.employee_id = $2) AND ($3::boolean IS NOT TRUE OR r.state IN ('starting', 'running'))
        ORDER BY COALESCE(p.updated_at, r.updated_at) DESC LIMIT $4`,
      [accountId, isUuid(q.employeeId) ? q.employeeId : null, q.live ?? null, q.limit],
    );
    return rows.map((r) => {
      const ev = (r.evidence ?? {}) as Partial<ProtectionEvidence>;
      return {
        runId: s(r.run_id),
        assignmentId: s(r.r_assignment),
        missionId: sn(r.mission_id),
        employeeId: s(r.employee_id),
        employeeName: s(r.employee_name),
        departmentId: sn(r.department_id),
        attempt: Number(r.attempt_no),
        runState: s(r.run_state),
        state: s(r.state) as ProtectionState,
        mode: s(r.mode) as RuntimeMode,
        controls: (ev.controls ?? []) as RuntimeControlId[],
        detail: ev.detail ?? "",
        verifiedAt: ev.verifiedAt ?? null,
        freshUntil: ev.freshUntil ?? null,
        planes: ev.planes ?? [],
        checks: ev.checks ?? [],
        updatedAt: s(r.updated_at),
      };
    });
  }

  // Running attempts of the account, by what holds them now: never inferred from a configuration.
  async coverage(accountId: string): Promise<{ running: number; byState: Record<string, number> }> {
    const running = Number((await this.db.one("SELECT count(*)::int AS c FROM workforce.runs WHERE account_id = $1 AND state = 'running'", [accountId]))?.c ?? 0);
    const rows = await this.db.query(
      `SELECT COALESCE(p.state, r.sandbox->'protection'->>'state') AS state, COALESCE(p.evidence, r.sandbox->'protection')->>'freshUntil' AS fresh, count(*)::int AS c
         FROM workforce.runs r LEFT JOIN security.protections p ON p.account_id = r.account_id AND p.run_id = r.id
        WHERE r.account_id = $1 AND r.state = 'running' AND (p.run_id IS NOT NULL OR r.sandbox->'protection' IS NOT NULL) GROUP BY 1, 2`,
      [accountId],
    );
    const byState: Record<string, number> = {};
    const now = Date.now();
    for (const r of rows) {
      // A PROTECTED whose proof is no longer fresh is counted as unknown: never green on stale evidence.
      const state = s(r.state) === "PROTECTED" && (sn(r.fresh) === null || Date.parse(s(r.fresh)) <= now) ? "UNKNOWN" : s(r.state);
      byState[state] = (byState[state] ?? 0) + Number(r.c);
    }
    return { running, byState };
  }

  async runtimeProbe(): Promise<unknown> {
    return (await this.db.one("SELECT runtime_security FROM workforce.capacity WHERE account_id = '00000000-0000-4000-8000-000000000001'"))?.runtime_security ?? null;
  }
}
