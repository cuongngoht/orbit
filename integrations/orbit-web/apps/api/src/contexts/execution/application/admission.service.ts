// RESOURCE ADMISSION, applied: ONE pass at a time across the whole deployment (it holds the capacity row FOR UPDATE, and
// every account's budget row it touches), so two workers can never both take the last capacity. A pass reads every
// pending attempt, works out its demand from what is CURRENT (an attempt is not pinned before it is admitted: a lowered
// budget or a revised profile moves it between waiting, unschedulable and admitted), decides (domain/admission.ts) and
// writes, in the same transaction: the compute reservations and the counters of the admitted attempts (their resource
// revision PINNED), the reason of every waiting one, and a Needs-me item for each that can never start as configured.
//
// RELEASE is idempotent (a reservation is released once: `released_at IS NULL`), and is done only once the attempt's
// containers are verified gone -- never because a lease ran out.
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ResourceProfile } from "@orbit-web/contracts";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";
import { AuditService } from "../../../modules/governance/audit.service.js";
import { systemActor } from "../../shared/application/commands.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { decideAdmissions, type AccountState, type Candidate, type HostState, type Verdict } from "../domain/admission.js";
import { ResourcesService, SYSTEM_ACCOUNT } from "./resources.service.js";

export interface AdmissionPolicy {
  agingMinutes: number;
  guardMinutes: number;
}

export interface Admitted {
  runId: string;
  orbitId: string;
}

interface PendingRow {
  run: Row;
  profile: ResourceProfile;
  resourceRevision: number;
  runtime: string;
  scratchCommitted: boolean;
  missionId: string;
}

@Injectable()
export class AdmissionService {
  private readonly logger = new Logger("Admission");

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ResourcesService) private readonly resources: ResourcesService,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // One pass. The admitted runs are leased to `owner` (the worker that will dispatch them).
  async pass(owner: string, policy: AdmissionPolicy, leaseMs: number): Promise<Admitted[]> {
    return this.db.tx(async () => {
      const capacity = await this.resources.capacity(true);
      const pending = await this.pending();
      if (pending.length === 0) return [];
      const accounts = new Map<string, AccountState>();
      for (const id of [...new Set(pending.map((p) => String(p.run.account_id)))].sort()) {
        const b = await this.resources.budget(id, true);
        const r = await this.resources.reserved(id);
        accounts.set(id, { cpuMillis: b.cpuMillis, memoryMiB: b.memoryMiB, storageMiB: b.storageMiB, maxConcurrent: b.maxConcurrent, reservedCpu: r.cpuMillis, reservedMemory: r.memoryMiB, running: r.running, committedStorage: await this.resources.committedStorage(id) });
      }
      const held = await this.db.one("SELECT COALESCE(SUM(reserved_cpu_millis), 0) AS c, COALESCE(SUM(reserved_memory_mib), 0) AS m FROM workforce.budgets");
      const host: HostState = { usableCpu: capacity.usable.cpuMillis, usableMemory: capacity.usable.memoryMiB, reservedCpu: Number(held?.c ?? 0), reservedMemory: Number(held?.m ?? 0) };
      const byRun = new Map(pending.map((p) => [String(p.run.id), p]));
      const candidates: Candidate[] = pending.map((p) => {
        const mp = this.resources.modelPlane(p.runtime);
        return {
          runId: String(p.run.id),
          orbitId: String(p.run.account_id),
          priority: Number(p.run.priority),
          waitingSince: String(p.run.waiting_since ?? p.run.created_at),
          demand: { cpuMillis: p.profile.cpuMillis + mp.cpuMillis, memoryMiB: p.profile.memoryMiB + mp.memoryMiB, scratchMiB: p.scratchCommitted ? 0 : p.profile.scratchStorageMiB },
        };
      });
      const verdicts = decideAdmissions(candidates, accounts, host, { now: Date.now(), ...policy });
      const admitted: Admitted[] = [];
      for (const v of verdicts) {
        const p = byRun.get(v.runId) as PendingRow;
        if (v.kind === "admit") {
          await this.admit(p, candidates.find((c) => c.runId === v.runId) as Candidate, owner, leaseMs);
          admitted.push({ runId: v.runId, orbitId: v.orbitId });
        } else await this.hold(p, v);
      }
      return admitted;
    });
  }

  private async pending(): Promise<PendingRow[]> {
    const rows = await this.db.query(
      `SELECT r.*, e.resource_revision AS current_resources, er.profile AS resource_profile, a.mission_id,
              EXISTS (SELECT 1 FROM workforce.storage_usage su WHERE su.account_id = r.account_id AND su.category = 'scratch' AND su.owner_ref = r.assignment_id::text) AS scratch_committed
       FROM workforce.runs r
       JOIN workforce.employees e ON e.account_id = r.account_id AND e.id = r.employee_id
       JOIN workforce.employee_resources er ON er.account_id = e.account_id AND er.employee_id = e.id AND er.revision = e.resource_revision
       JOIN workforce.assignments a ON a.account_id = r.account_id AND a.id = r.assignment_id
       WHERE r.state IN ('requested', 'waiting_for_resources', 'unschedulable')
         -- One live attempt per employee: a new attempt waits until its employee's previous one has ended.
         AND NOT EXISTS (SELECT 1 FROM workforce.runs o WHERE o.account_id = r.account_id AND o.employee_id = r.employee_id AND o.id <> r.id AND o.state IN ('starting', 'running', 'unknown'))
       ORDER BY r.waiting_since, r.id LIMIT 500 FOR UPDATE OF r SKIP LOCKED`,
    );
    return rows.map((r) => ({ run: r, profile: r.resource_profile as ResourceProfile, resourceRevision: Number(r.current_resources), runtime: String((r.requested as { runtime?: string }).runtime ?? "claude"), scratchCommitted: r.scratch_committed === true, missionId: String(r.mission_id) }));
  }

  private async admit(p: PendingRow, c: Candidate, owner: string, leaseMs: number): Promise<void> {
    const orbitId = String(p.run.account_id);
    const runId = String(p.run.id);
    const mp = this.resources.modelPlane(p.runtime);
    const at = new Date().toISOString();
    await this.db.query("INSERT INTO workforce.compute_reservations (account_id, run_id, cpu_millis, memory_mib, scratch_mib, model_plane, reserved_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [orbitId, runId, c.demand.cpuMillis, c.demand.memoryMiB, p.profile.scratchStorageMiB, jsonParam(mp), at]);
    await this.db.query("UPDATE workforce.budgets SET reserved_cpu_millis = reserved_cpu_millis + $2, reserved_memory_mib = reserved_memory_mib + $3, running = running + 1 WHERE account_id = $1", [orbitId, c.demand.cpuMillis, c.demand.memoryMiB]);
    if (!p.scratchCommitted) await this.resources.commit(orbitId, "scratch", String(p.run.assignment_id), p.profile.scratchStorageMiB);
    const evidence = { requested: { ...p.profile, modelPlane: mp }, applied: null, observed: null };
    await this.db.query(
      `UPDATE workforce.runs SET state = 'starting', resource_revision = $3, resources = $4::jsonb, waiting_reason = NULL, lease_owner = $5, lease_until = $6, updated_at = $7, version = version + 1 WHERE account_id = $1 AND id = $2`,
      [orbitId, runId, p.resourceRevision, jsonParam(evidence), owner, new Date(Date.now() + leaseMs).toISOString(), at],
    );
    const actor = systemActor(orbitId, "admission", `admission:${runId}`);
    await this.outbox.append(actor.command, [{ type: "ResourcesReserved", aggregateType: "run", aggregateId: runId, aggregateVersion: Number(p.run.version) + 1, missionId: p.missionId, payload: { cpuMillis: c.demand.cpuMillis, memoryMiB: c.demand.memoryMiB, scratchMiB: p.profile.scratchStorageMiB, resourceRevision: p.resourceRevision } }]);
    await this.db.query("UPDATE workforce.decisions SET state = 'withdrawn', resolution = 'admitted', resolved_at = $3 WHERE account_id = $1 AND dedup_key = $2 AND state = 'open'", [orbitId, `unschedulable:${String(p.run.assignment_id)}`, at]);
    await this.audit.record(actor.governance, { type: "office.run.admitted", outcome: "admitted", runId, data: { runId, cpuMillis: c.demand.cpuMillis, memoryMiB: c.demand.memoryMiB, scratchMiB: p.profile.scratchStorageMiB, resourceRevision: p.resourceRevision } });
    await this.outbox.touched(orbitId, ["roster", "missions"], p.missionId);
  }

  private async hold(p: PendingRow, v: Exclude<Verdict, { kind: "admit" }>): Promise<void> {
    const orbitId = String(p.run.account_id);
    const runId = String(p.run.id);
    const state = v.kind === "unschedulable" ? "unschedulable" : "waiting_for_resources";
    const changed = String(p.run.state) !== state || String(p.run.waiting_reason ?? "") !== v.reason;
    if (!changed) return;
    await this.db.query("UPDATE workforce.runs SET state = $3, waiting_reason = $4, updated_at = $5, version = version + 1 WHERE account_id = $1 AND id = $2", [orbitId, runId, state, v.reason, new Date().toISOString()]);
    const actor = systemActor(orbitId, "admission", `admission:${runId}`);
    if (String(p.run.state) !== state) await this.outbox.append(actor.command, [{ type: state === "unschedulable" ? "RunUnschedulable" : "RunWaitingForResources", aggregateType: "run", aggregateId: runId, aggregateVersion: Number(p.run.version) + 1, missionId: p.missionId, payload: { code: v.code, reason: v.reason } }]);
    const dedupKey = `unschedulable:${String(p.run.assignment_id)}`;
    if (state === "unschedulable") {
      await this.db.query(
        `INSERT INTO workforce.decisions (id, account_id, kind, state, mission_id, assignment_id, run_id, title, reason, waiting, deadline, pin, dedup_key, created_at)
         VALUES (gen_random_uuid(), $1, 'unschedulable', 'open', $2, $3, $4, 'Work that can never start as configured', $5, NULL, NULL, $6::jsonb, $7, $8)
         ON CONFLICT (account_id, dedup_key) WHERE state = 'open' DO UPDATE SET reason = excluded.reason, version = workforce.decisions.version + 1`,
        [orbitId, p.missionId, String(p.run.assignment_id), runId, `${v.reason} Lower the employee's resources (Office → the employee → Sandbox & resources), or ask the operator to raise the account's authorization (cli/governance.js budget set).`, jsonParam({ assignmentVersion: null, handoffDigest: null, deliveryId: null }), dedupKey, new Date().toISOString()],
      );
    } else await this.db.query("UPDATE workforce.decisions SET state = 'withdrawn', resolution = 'it can fit now', resolved_at = $3 WHERE account_id = $1 AND dedup_key = $2 AND state = 'open'", [orbitId, dedupKey, new Date().toISOString()]);
    await this.outbox.touched(orbitId, ["roster", "missions", "inbox"], p.missionId);
  }

  // Released once its containers are VERIFIED gone. Idempotent; true when this call released it.
  async release(orbitId: string, runId: string, reason: string): Promise<boolean> {
    return this.db.tx(async () => {
      await this.resources.budget(orbitId, true);
      const r = await this.db.one("UPDATE workforce.compute_reservations SET released_at = $3, release_reason = $4 WHERE account_id = $1 AND run_id = $2 AND released_at IS NULL RETURNING cpu_millis, memory_mib", [orbitId, runId, new Date().toISOString(), reason.slice(0, 200)]);
      if (r === null) return false;
      await this.db.query("UPDATE workforce.budgets SET reserved_cpu_millis = GREATEST(0, reserved_cpu_millis - $2), reserved_memory_mib = GREATEST(0, reserved_memory_mib - $3), running = GREATEST(0, running - 1) WHERE account_id = $1", [orbitId, Number(r.cpu_millis), Number(r.memory_mib)]);
      const actor = systemActor(orbitId, "admission", `release:${runId}`);
      const run = await this.db.one("SELECT r.version, a.mission_id FROM workforce.runs r JOIN workforce.assignments a ON a.account_id = r.account_id AND a.id = r.assignment_id WHERE r.account_id = $1 AND r.id = $2", [orbitId, runId]);
      await this.outbox.append(actor.command, [{ type: "ResourcesReleased", aggregateType: "run", aggregateId: runId, aggregateVersion: Number(run?.version ?? 1), missionId: run?.mission_id === undefined ? null : String(run.mission_id), payload: { reason: reason.slice(0, 200) } }]);
      await this.audit.record(actor.governance, { type: "office.run.released", outcome: "released", runId, data: { runId, reason: reason.slice(0, 200) } });
      await this.outbox.touched(orbitId, ["roster"]);
      return true;
    });
  }

  // The scratch an assignment's workspace committed, given back once the workspace is removed.
  async releaseScratch(orbitId: string, assignmentId: string): Promise<void> {
    await this.db.query("DELETE FROM workforce.storage_usage WHERE account_id = $1 AND category = 'scratch' AND owner_ref = $2", [orbitId, assignmentId]);
  }

  // A host with capacity known: kept for the deployment's own row (the pass refuses nothing for the system account).
  get system(): string {
    return SYSTEM_ACCOUNT;
  }

  warn(message: string): void {
    this.logger.warn(message);
  }
}
