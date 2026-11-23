// RESOURCES (Execution context reads them; Governance owns the account's budget): what the host can give employee
// containers, what each account may use and keep, and what its attempts hold now.
//
//   capacity   the SYSTEM account's one row: the host's CPU, memory and workforce storage -- detected by the sandbox
//              provider's probe (or this process's host when there is none) or set by the operator
//              (ORBIT_WEB_CAPACITY_CPU / _MEMORY / _STORAGE) -- minus the HEADROOM Orbit Web itself, PostgreSQL, the
//              proxy, the allocator and the OS keep (ORBIT_WEB_CAPACITY_RESERVE_*), giving the USABLE capacity.
//   budget     an account's row: CPU, memory, storage, concurrency and per-employee ceilings, never above the operator's
//              AUTHORIZATION (by default: the usable capacity); the owner may lower it, never raise it above that. The
//              counters of what its admitted attempts hold move only under this row's lock (admission.service.ts).
//
// The host is read again AT EVERY START (a resized host, a pool of another size, ORBIT_WEB_CAPACITY_* changed), and an
// authorization that comes from the capacity follows it: a budget value that stood at the old authorization moves with
// it, one the owner had lowered stays (never above the new one). An authorization the operator set
// (`governance.js budget set`) is the operator's, and stays.
//   storage    per category and owner: what is committed (a quota promised: desks, caches, team rooms) and what is used.
//
// An idle employee holds NO CPU or memory: compute is reserved at admission and released when the attempt's containers
// are verified gone. A hire is refused only by a per-employee ceiling or the storage budget -- never because the
// account's compute is busy right now (then its work waits).
import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import {
  ceilingProblems,
  DEFAULT_PRESETS,
  type AccountResourceBudget,
  type BudgetAuthorization,
  type InfrastructureCapacity,
  type PerEmployeeCeiling,
  type ResourcePreset,
  type ResourceProfile,
  type ResourceSummary,
  type StorageCategory,
  type UpdateBudgetRequest,
} from "@orbit-web/contracts";
import { cpus, totalmem } from "node:os";
import { statfsSync } from "node:fs";
import type { AppConfig } from "../../../config/config.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";
import { refused, stale, unprocessable } from "../../shared/domain.js";
import { loadSandboxConfig, type SandboxConfig } from "../../../config/sandbox-config.js";
import { infrastructureCapacity } from "../infrastructure/sandbox/capacity.js";
import { SANDBOX_PROVIDER, type HostCapabilities, type SandboxIds, type SandboxProvider } from "./sandbox.port.js";

const sandboxConfigOrNull = (env: AppConfig["sourceEnv"]): SandboxConfig | null => {
  try {
    return loadSandboxConfig(env);
  } catch {
    return null;
  }
};

export const SYSTEM_ACCOUNT = "00000000-0000-4000-8000-000000000001";

const MiB = 1024 * 1024;

interface Amounts3 {
  cpuMillis: number;
  memoryMiB: number;
  storageMiB: number;
}

// Starting values for what each runtime's model plane (the CLI) reserves beside the employee's own limits. The peaks each
// run records show the operator when to change them (ORBIT_WEB_MODEL_PLANE_<RUNTIME>_CPU / _MEMORY).
const MODEL_PLANE_DEFAULTS: Record<string, { cpuMillis: number; memoryMiB: number }> = {
  claude: { cpuMillis: 500, memoryMiB: 1024 },
  codex: { cpuMillis: 500, memoryMiB: 768 },
  agy: { cpuMillis: 500, memoryMiB: 1024 },
};

// At a start, how often (and how far apart) the sandbox provider is asked before the capacity is left as it was: the
// allocator starts beside Orbit Web.
const START_TRIES = 10;
const START_PAUSE_MS = 3_000;

// What the usable capacity authorizes an account by default: all of it -- and per employee, half the storage for a desk
// and half for scratch (at least 256 MiB each), a quarter for a cache.
export function authorizationFrom(c: Pick<InfrastructureCapacity, "usable">): BudgetAuthorization {
  const perEmployee: PerEmployeeCeiling = {
    cpuMillis: c.usable.cpuMillis,
    memoryMiB: c.usable.memoryMiB,
    deskStorageMiB: Math.max(256, Math.floor(c.usable.storageMiB / 2)),
    scratchStorageMiB: Math.max(256, Math.floor(c.usable.storageMiB / 2)),
    cacheStorageMiB: Math.max(0, Math.floor(c.usable.storageMiB / 4)),
  };
  return { cpuMillis: c.usable.cpuMillis, memoryMiB: c.usable.memoryMiB, storageMiB: c.usable.storageMiB, maxConcurrent: Math.max(1, Math.floor(c.usable.cpuMillis / 1000)), perEmployee, source: "capacity" };
}

export type BudgetLimits = Omit<BudgetAuthorization, "source">;

const CEILING_KEYS = ["cpuMillis", "memoryMiB", "deskStorageMiB", "scratchStorageMiB", "cacheStorageMiB"] as const satisfies readonly (keyof PerEmployeeCeiling)[];

// Whether two authorizations allow the same (where each came from aside).
export function sameLimits(a: BudgetLimits, b: BudgetLimits): boolean {
  const top = a.cpuMillis === b.cpuMillis && a.memoryMiB === b.memoryMiB && a.storageMiB === b.storageMiB && a.maxConcurrent === b.maxConcurrent;
  return top && CEILING_KEYS.every((k) => a.perEmployee[k] === b.perEmployee[k]);
}

// An account's budget under a new authorization: a value that stood AT the old authorization follows it (up or down);
// one the owner had lowered stays as it is, never above the new authorization.
export function followAuthorization(before: Pick<AccountResourceBudget, "cpuMillis" | "memoryMiB" | "storageMiB" | "maxConcurrent" | "perEmployee" | "authorized">, next: BudgetLimits): BudgetLimits {
  const follow = (value: number, old: number, now: number): number => (value === old ? now : Math.min(value, now));
  const perEmployee = Object.fromEntries(CEILING_KEYS.map((k) => [k, follow(before.perEmployee[k], before.authorized.perEmployee[k], next.perEmployee[k])])) as unknown as PerEmployeeCeiling;
  return {
    cpuMillis: follow(before.cpuMillis, before.authorized.cpuMillis, next.cpuMillis),
    memoryMiB: follow(before.memoryMiB, before.authorized.memoryMiB, next.memoryMiB),
    storageMiB: follow(before.storageMiB, before.authorized.storageMiB, next.storageMiB),
    maxConcurrent: follow(before.maxConcurrent, before.authorized.maxConcurrent, next.maxConcurrent),
    perEmployee,
  };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms).unref());

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

const budgetOf = (r: Row): AccountResourceBudget => ({
  cpuMillis: Number(r.cpu_millis),
  memoryMiB: Number(r.memory_mib),
  storageMiB: Number(r.storage_mib),
  maxConcurrent: Number(r.max_concurrent),
  perEmployee: r.per_employee as PerEmployeeCeiling,
  authorized: r.authorized as AccountResourceBudget["authorized"],
  version: Number(r.version),
  updatedAt: String(r.updated_at),
});

export interface Reserved {
  cpuMillis: number;
  memoryMiB: number;
  scratchMiB: number;
  running: number;
}

@Injectable()
export class ResourcesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Resources");
  private closing = false;
  private rechecking: Promise<{ capacity: InfrastructureCapacity; moved: number }> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Optional() @Inject(SANDBOX_PROVIDER) private readonly provider: SandboxProvider | null = null,
  ) {}

  presets(): ResourcePreset[] {
    return DEFAULT_PRESETS.map((p) => ({ ...p, profile: { ...p.profile } }));
  }

  modelPlane(runtime: string): { cpuMillis: number; memoryMiB: number } {
    const d = MODEL_PLANE_DEFAULTS[runtime] ?? { cpuMillis: 500, memoryMiB: 1024 };
    const env = this.config.sourceEnv;
    const key = runtime.toUpperCase();
    return { cpuMillis: num(env[`ORBIT_WEB_MODEL_PLANE_${key}_CPU`]) ?? d.cpuMillis, memoryMiB: num(env[`ORBIT_WEB_MODEL_PLANE_${key}_MEMORY`]) ?? d.memoryMiB };
  }

  onApplicationBootstrap(): void {
    void this.atStart().catch((err: unknown) => this.logger.warn(`the host's capacity was not read again at start: ${err instanceof Error ? err.message : String(err)}`));
  }

  onModuleDestroy(): void {
    this.closing = true;
  }

  // AT A START: the host read again and every authorization that comes from the capacity following it -- once there is
  // a capacity to read again (before that, the first look makes it). A sandbox provider that never answers leaves the
  // capacity as it was: it is never replaced by this process's own view of its host.
  private async atStart(): Promise<void> {
    if ((await this.storedCapacity()) === null) return;
    const capacity = await this.remeasure();
    if (capacity !== null && !this.closing) await this.followCapacity(capacity);
  }

  private async remeasure(): Promise<InfrastructureCapacity | null> {
    for (let attempt = 1; attempt <= START_TRIES && !this.closing; attempt += 1) {
      const probe = await this.probe();
      if (probe !== null || this.provider === null) return this.keepCapacity(this.measure(probe));
      await pause(START_PAUSE_MS);
    }
    if (!this.closing) this.logger.warn("the sandbox provider did not answer at start: the host's capacity stays as it was last read");
    return null;
  }

  // Every account whose authorization comes from the capacity, moved to what `capacity` authorizes (followAuthorization).
  // Returns how many moved.
  async followCapacity(capacity: Pick<InfrastructureCapacity, "usable">): Promise<number> {
    const next = authorizationFrom(capacity);
    let moved = 0;
    for (const r of await this.db.query("SELECT account_id FROM workforce.budgets ORDER BY account_id")) {
      const changed = await this.db.tx(async () => {
        const b = await this.budget(String(r.account_id), true);
        if (b.authorized.source === "operator" || sameLimits(b.authorized, next)) return false;
        await this.reauthorize(String(r.account_id), next);
        return true;
      });
      if (changed) moved += 1;
    }
    if (moved > 0) this.logger.log(`the host's usable capacity is ${next.cpuMillis / 1000} vCPU, ${next.memoryMiB} MiB, ${next.storageMiB} MiB of storage: ${moved} account budget(s) follow it`);
    return moved;
  }

  // A person's RE-CHECK (Settings → Compute & storage): the host read again now -- the sandbox provider's probe -- and
  // every authorization that follows the capacity following it, as at a start. Two at once are one. A provider that does
  // not answer changes nothing, and says so.
  recheckCapacity(): Promise<{ capacity: InfrastructureCapacity; moved: number }> {
    this.rechecking ??= this.recheck().finally(() => (this.rechecking = null));
    return this.rechecking;
  }

  private async recheck(): Promise<{ capacity: InfrastructureCapacity; moved: number }> {
    const probe = await this.probe();
    if (probe === null && this.provider !== null) throw unprocessable("capacity_unreadable", "The sandbox provider (the allocator) did not answer: the host's capacity is left as it was last read. Try again in a moment.");
    const capacity = await this.keepCapacity(this.measure(probe));
    return { capacity, moved: await this.followCapacity(capacity) };
  }

  // The capacity as last read, or null when it was never read (nothing is made).
  async storedCapacity(): Promise<InfrastructureCapacity | null> {
    const row = await this.db.one("SELECT 1 AS x FROM workforce.capacity WHERE account_id = $1", [SYSTEM_ACCOUNT]);
    return row === null ? null : this.capacity();
  }

  // The capacity, read again from the host (provider probe, or this process's host) and kept as the system row.
  async refreshCapacity(): Promise<InfrastructureCapacity> {
    return this.keepCapacity(this.measure(await this.probe()));
  }

  // What the host gives employees, from a probe (null: this process's own host) and the operator's settings.
  private measure(probe: HostCapabilities | null): InfrastructureCapacity {
    const env = this.config.sourceEnv;
    const sandbox = probe === null ? null : sandboxConfigOrNull(env);
    if (probe !== null && sandbox !== null) return infrastructureCapacity(probe, sandbox);
    const configured = { cpuMillis: num(env.ORBIT_WEB_CAPACITY_CPU), memoryMiB: num(env.ORBIT_WEB_CAPACITY_MEMORY), storageMiB: num(env.ORBIT_WEB_CAPACITY_STORAGE) };
    const anyConfigured = configured.cpuMillis !== null || configured.memoryMiB !== null || configured.storageMiB !== null;
    const detected = this.detected(probe);
    const total: Amounts3 = {
      cpuMillis: configured.cpuMillis ?? detected.cpuMillis,
      memoryMiB: configured.memoryMiB ?? detected.memoryMiB,
      storageMiB: configured.storageMiB ?? detected.storageMiB,
    };
    const headroom: Amounts3 = {
      cpuMillis: num(env.ORBIT_WEB_CAPACITY_RESERVE_CPU) ?? Math.max(1000, Math.round(total.cpuMillis * 0.2)),
      memoryMiB: num(env.ORBIT_WEB_CAPACITY_RESERVE_MEMORY) ?? Math.max(2048, Math.round(total.memoryMiB * 0.25)),
      storageMiB: num(env.ORBIT_WEB_CAPACITY_RESERVE_STORAGE) ?? Math.max(10 * 1024, Math.round(total.storageMiB * 0.1)),
    };
    const usable: Amounts3 = { cpuMillis: Math.max(0, total.cpuMillis - headroom.cpuMillis), memoryMiB: Math.max(0, total.memoryMiB - headroom.memoryMiB), storageMiB: Math.max(0, total.storageMiB - headroom.storageMiB) };
    const storage = probe?.storage ?? { mechanism: "measured" as const, perArea: "SOFT_MONITORED" as const, hostProtection: "UNSUPPORTED" as const, evidence: "No container sandbox provider is configured: storage is measured, never enforced by the kernel.", probedAt: new Date().toISOString() };
    return { source: anyConfigured ? "configured" : probe !== null || detected.cpuMillis > 0 ? "detected" : "unknown", total, headroom, usable, storage, checkedAt: new Date().toISOString() };
  }

  private async keepCapacity(capacity: InfrastructureCapacity): Promise<InfrastructureCapacity> {
    const { total, headroom, usable, storage } = capacity;
    await this.db.query(
      `INSERT INTO workforce.capacity (account_id, source, total, headroom, usable, storage, checked_at) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
       ON CONFLICT (account_id) DO UPDATE SET source = excluded.source, total = excluded.total, headroom = excluded.headroom, usable = excluded.usable, storage = excluded.storage, checked_at = excluded.checked_at, version = workforce.capacity.version + 1`,
      [SYSTEM_ACCOUNT, capacity.source, jsonParam(total), jsonParam(headroom), jsonParam(usable), jsonParam(storage), capacity.checkedAt ?? new Date().toISOString()],
    );
    return capacity;
  }

  async capacity(lock = false): Promise<InfrastructureCapacity> {
    const row = await this.db.one(`SELECT * FROM workforce.capacity WHERE account_id = $1${lock ? " FOR UPDATE" : ""}`, [SYSTEM_ACCOUNT]);
    if (row === null) {
      await this.refreshCapacity();
      return this.capacity(lock);
    }
    return { source: String(row.source) as InfrastructureCapacity["source"], total: row.total as Amounts3, headroom: row.headroom as Amounts3, usable: row.usable as Amounts3, storage: row.storage as InfrastructureCapacity["storage"], checkedAt: row.checked_at === null ? null : String(row.checked_at) };
  }

  // The account's budget, made from the capacity the first time it is asked for (inside the caller's transaction).
  async budget(orbitId: string, lock = false): Promise<AccountResourceBudget> {
    const row = await this.db.one(`SELECT * FROM workforce.budgets WHERE account_id = $1${lock ? " FOR UPDATE" : ""}`, [orbitId]);
    if (row !== null) return budgetOf(row);
    const authorized = authorizationFrom(await this.capacity());
    await this.db.query(
      `INSERT INTO workforce.budgets (account_id, cpu_millis, memory_mib, storage_mib, max_concurrent, per_employee, authorized, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8) ON CONFLICT (account_id) DO NOTHING`,
      [orbitId, authorized.cpuMillis, authorized.memoryMiB, authorized.storageMiB, authorized.maxConcurrent, jsonParam(authorized.perEmployee), jsonParam(authorized), new Date().toISOString()],
    );
    return this.budget(orbitId, lock);
  }

  async reserved(orbitId: string): Promise<Reserved> {
    const row = await this.db.one("SELECT reserved_cpu_millis, reserved_memory_mib, reserved_scratch_mib, running FROM workforce.budgets WHERE account_id = $1", [orbitId]);
    return row === null ? { cpuMillis: 0, memoryMiB: 0, scratchMiB: 0, running: 0 } : { cpuMillis: Number(row.reserved_cpu_millis), memoryMiB: Number(row.reserved_memory_mib), scratchMiB: Number(row.reserved_scratch_mib), running: Number(row.running) };
  }

  // The owner lowers (or restores up to the authorization) the account's budget. A budget below what running attempts
  // hold kills nothing: new admissions wait until they fit.
  async updateBudget(orbitId: string, req: UpdateBudgetRequest, expectedVersion: number): Promise<{ before: AccountResourceBudget; after: AccountResourceBudget }> {
    const before = await this.budget(orbitId, true);
    if (before.version !== expectedVersion) throw stale("The account's budget changed since it was read: read it again.");
    const a = before.authorized;
    const next = {
      cpuMillis: req.cpuMillis ?? before.cpuMillis,
      memoryMiB: req.memoryMiB ?? before.memoryMiB,
      storageMiB: req.storageMiB ?? before.storageMiB,
      maxConcurrent: req.maxConcurrent ?? before.maxConcurrent,
      perEmployee: { ...before.perEmployee, ...(req.perEmployee ?? {}) } as PerEmployeeCeiling,
    };
    const above: string[] = [];
    if (next.cpuMillis > a.cpuMillis) above.push(`CPU (authorized ${a.cpuMillis / 1000} vCPU)`);
    if (next.memoryMiB > a.memoryMiB) above.push(`memory (authorized ${a.memoryMiB} MiB)`);
    if (next.storageMiB > a.storageMiB) above.push(`storage (authorized ${a.storageMiB} MiB)`);
    if (next.maxConcurrent > a.maxConcurrent) above.push(`concurrent attempts (authorized ${a.maxConcurrent})`);
    for (const k of Object.keys(next.perEmployee) as (keyof PerEmployeeCeiling)[]) if (next.perEmployee[k] > a.perEmployee[k]) above.push(`per-employee ${k} (authorized ${a.perEmployee[k]})`);
    if (above.length > 0) throw refused("above_authorization", `The budget cannot be raised above what the operator authorized: ${above.join(", ")}.`, { above });
    const row = await this.db.one(
      "UPDATE workforce.budgets SET cpu_millis = $2, memory_mib = $3, storage_mib = $4, max_concurrent = $5, per_employee = $6::jsonb, updated_at = $7, version = version + 1 WHERE account_id = $1 RETURNING *",
      [orbitId, next.cpuMillis, next.memoryMiB, next.storageMiB, next.maxConcurrent, jsonParam(next.perEmployee), new Date().toISOString()],
    );
    return { before, after: budgetOf(row as Row) };
  }

  // A new authorization -- the operator's (`governance.js budget set`) or the capacity's (followCapacity) -- and the
  // budget under it (followAuthorization). Inside the caller's transaction: the row is locked.
  async reauthorize(orbitId: string, next: BudgetAuthorization): Promise<{ before: AccountResourceBudget; after: AccountResourceBudget }> {
    const before = await this.budget(orbitId, true);
    const v = followAuthorization(before, next);
    const row = await this.db.one(
      "UPDATE workforce.budgets SET authorized = $2::jsonb, cpu_millis = $3, memory_mib = $4, storage_mib = $5, max_concurrent = $6, per_employee = $7::jsonb, updated_at = $8, version = version + 1 WHERE account_id = $1 RETURNING *",
      [orbitId, jsonParam(next), v.cpuMillis, v.memoryMiB, v.storageMiB, v.maxConcurrent, jsonParam(v.perEmployee), new Date().toISOString()],
    );
    return { before, after: budgetOf(row as Row) };
  }

  // A hire (or an edit of an employee's resources): refused above a per-employee ceiling, and -- for the persistent areas
  // it commits -- above the account's storage budget. `already` is what this employee committed before (an edit).
  async checkProfile(orbitId: string, profile: ResourceProfile, already: { deskMiB: number; cacheMiB: number } = { deskMiB: 0, cacheMiB: 0 }): Promise<void> {
    const b = await this.budget(orbitId, true);
    const problems = ceilingProblems(profile, b.perEmployee);
    if (problems.length > 0) throw unprocessable("resource_limit_exceeded", `This employee's resources are above the account's per-employee limits: ${problems.join("; ")}.`, { problems });
    const committed = await this.committedStorage(orbitId);
    const extra = profile.deskStorageMiB + profile.cacheStorageMiB - already.deskMiB - already.cacheMiB;
    if (extra > 0 && committed + extra > b.storageMiB) {
      throw unprocessable("storage_budget_exceeded", `The account's storage budget is ${b.storageMiB} MiB, ${committed} MiB of it is committed; this needs ${extra} MiB more. Lower the desk or cache, or archive an employee.`, { budgetMiB: b.storageMiB, committedMiB: committed, neededMiB: extra });
    }
  }

  // Quotas promised (desks, caches, team rooms) + scratch held by admitted attempts + measured use of what has no quota.
  async committedStorage(orbitId: string): Promise<number> {
    const row = await this.db.one(
      `SELECT COALESCE((SELECT SUM(committed_mib) FROM workforce.storage_usage WHERE account_id = $1), 0)
            + COALESCE((SELECT reserved_scratch_mib FROM workforce.budgets WHERE account_id = $1), 0)
            + COALESCE((SELECT SUM(used_mib) FROM workforce.storage_usage WHERE account_id = $1 AND category IN ('artifacts', 'research', 'logs')), 0) AS n`,
      [orbitId],
    );
    return Number(row?.n ?? 0);
  }

  async commit(orbitId: string, category: StorageCategory, ownerRef: string, committedMiB: number): Promise<void> {
    await this.db.query(
      `INSERT INTO workforce.storage_usage (account_id, category, owner_ref, committed_mib) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, category, owner_ref) DO UPDATE SET committed_mib = excluded.committed_mib`,
      [orbitId, category, ownerRef, committedMiB],
    );
  }

  async measured(orbitId: string, category: StorageCategory, ownerRef: string, usedMiB: number | null, level: string | null, evidence: string | null): Promise<void> {
    await this.db.query(
      `INSERT INTO workforce.storage_usage (account_id, category, owner_ref, committed_mib, used_mib, level, evidence, measured_at) VALUES ($1, $2, $3, 0, $4, $5, $6, $7)
       ON CONFLICT (account_id, category, owner_ref) DO UPDATE SET used_mib = excluded.used_mib, level = excluded.level, evidence = excluded.evidence, measured_at = excluded.measured_at`,
      [orbitId, category, ownerRef, usedMiB, level, evidence, new Date().toISOString()],
    );
  }

  // What an employee's desk and cache hold now, as the provider measures them, kept beside what they commit (Governance
  // → Employee desks shows it): after a publish or a provisioning, when the desk is opened, after a clean-up. Rounded up
  // to a MiB. A measurement that fails is logged, never its caller's failure.
  async measureEmployee(ids: SandboxIds): Promise<void> {
    if (this.provider === null) return;
    try {
      for (const a of await this.provider.measure(ids)) {
        if (a.area !== "desk" && a.area !== "cache") continue;
        await this.measured(ids.orbitId, a.area, ids.employeeId, a.usedMiB === null ? null : Math.ceil(a.usedMiB), a.level, a.evidence);
      }
    } catch (err) {
      this.logger.warn(`Measuring the sandbox of employee ${ids.employeeId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async summary(orbitId: string): Promise<ResourceSummary> {
    const capacity = await this.capacity();
    const budget = await this.budget(orbitId);
    const reserved = await this.reserved(orbitId);
    const rows = await this.db.query("SELECT category, SUM(committed_mib) AS c, SUM(COALESCE(used_mib, 0)) AS u, MAX(measured_at) AS m FROM workforce.storage_usage WHERE account_id = $1 GROUP BY category", [orbitId]);
    const artifacts = Number((await this.db.one("SELECT COALESCE(SUM(size), 0) AS n FROM workforce.blobs WHERE account_id = $1", [orbitId]))?.n ?? 0);
    const research = Number((await this.db.one("SELECT COALESCE(SUM(byte_size), 0) AS n FROM research.research_source_revisions WHERE account_id = $1", [orbitId]))?.n ?? 0);
    const byCategory = Object.fromEntries((["desk", "cache", "team", "scratch", "artifacts", "research", "logs"] as const).map((c) => [c, { committedMiB: 0, usedMiB: 0 }])) as ResourceSummary["storage"]["byCategory"];
    let measuredAt: string | null = null;
    for (const r of rows) {
      const c = String(r.category) as StorageCategory;
      byCategory[c] = { committedMiB: Number(r.c), usedMiB: Number(r.u) };
      if (r.m !== null && (measuredAt === null || String(r.m) > measuredAt)) measuredAt = String(r.m);
    }
    byCategory.scratch = { committedMiB: reserved.scratchMiB, usedMiB: byCategory.scratch.usedMiB };
    byCategory.artifacts = { committedMiB: 0, usedMiB: Math.ceil(artifacts / MiB) };
    byCategory.research = { committedMiB: 0, usedMiB: Math.ceil(research / MiB) };
    const counts = await this.db.one(
      "SELECT count(*) FILTER (WHERE state IN ('starting', 'running')) AS running, count(*) FILTER (WHERE state IN ('requested', 'waiting_for_resources')) AS waiting, count(*) FILTER (WHERE state = 'unschedulable') AS unschedulable FROM workforce.runs WHERE account_id = $1",
      [orbitId],
    );
    const committedMiB = Object.values(byCategory).reduce((n, c) => n + c.committedMiB, 0);
    const usedMiB = Object.values(byCategory).reduce((n, c) => n + c.usedMiB, 0);
    return {
      capacity,
      budget,
      reserved: { cpuMillis: reserved.cpuMillis, memoryMiB: reserved.memoryMiB, scratchMiB: reserved.scratchMiB },
      available: { cpuMillis: Math.max(0, budget.cpuMillis - reserved.cpuMillis), memoryMiB: Math.max(0, budget.memoryMiB - reserved.memoryMiB) },
      storage: { budgetMiB: budget.storageMiB, committedMiB, usedMiB, byCategory, measuredAt },
      running: Number(counts?.running ?? 0),
      waiting: Number(counts?.waiting ?? 0),
      unschedulable: Number(counts?.unschedulable ?? 0),
      modelPlane: Object.keys(MODEL_PLANE_DEFAULTS).map((runtime) => ({ runtime, ...this.modelPlane(runtime) })),
      asOf: new Date().toISOString(),
    };
  }

  private async probe(): Promise<HostCapabilities | null> {
    if (this.provider === null) return null;
    try {
      return await this.provider.probe();
    } catch (err) {
      this.logger.warn(`the sandbox provider could not be probed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private detected(probe: HostCapabilities | null): Amounts3 {
    const cpu = probe?.host.cpuMillis ?? cpus().length * 1000;
    const memory = probe?.host.memoryMiB ?? Math.floor(totalmem() / MiB);
    return { cpuMillis: cpu, memoryMiB: memory, storageMiB: probe?.host.storageMiB ?? this.freeStorage() };
  }

  private freeStorage(): number {
    try {
      const s = statfsSync(this.config.data.root);
      return Math.floor((Number(s.bavail) * Number(s.bsize)) / MiB);
    } catch {
      return 0;
    }
  }
}
