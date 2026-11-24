// RESOURCES (Orbit Web 0.8.0, ADR 0061): what an employee may use when it works, and what the account and the machine
// can give. A hierarchy, each level never above the one before it:
//
//   infrastructure capacity  what this host can give employee containers (detected or configured), minus what Orbit
//                            itself, PostgreSQL, the proxy, the allocator and the OS keep (headroom)
//   account budget           the most an account's employees may use at once (CPU, memory, concurrency) and keep
//                            (storage); its AUTHORIZED ceiling is the operator's
//   employee profile         the limits of ONE employee's attempt (a versioned revision, pinned at admission)
//   attempt                  two containers -- the model plane (the CLI) and the tool plane (the sandbox) -- whose
//                            limits are applied by the container runtime and read back as evidence
//
// An idle employee holds NO CPU or memory: compute is reserved when an attempt is admitted and released once its
// containers are verified gone. Persistent storage (desk, cache) is COMMITTED at hire.
import type { Checked } from "./validate.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body).filter((k) => !allowed.includes(k)).map((k) => `${k} is not a field of this request`);
const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });
const NOT_OBJECT: Checked<never> = { ok: false, errors: ["the body must be a JSON object"] };

// What enforces a limit: the kernel refuses past it (HARD), Orbit measures and acts (SOFT -- never shown as isolation),
// or nothing does (UNSUPPORTED).
export const ENFORCEMENT_LEVELS = ["HARD_ENFORCED", "SOFT_MONITORED", "UNSUPPORTED"] as const;
export type EnforcementLevel = (typeof ENFORCEMENT_LEVELS)[number];

export const STORAGE_AREAS = ["desk", "cache", "scratch", "team", "tmp"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

export const STORAGE_MECHANISMS = ["xfs-project", "xfs-loop-pool", "btrfs-qgroup", "loop-per-volume", "measured", "none"] as const;
export type StorageMechanism = (typeof STORAGE_MECHANISMS)[number];

export interface ResourceProfile {
  presetId: string | null;
  // Millicores (1000 = one vCPU).
  cpuMillis: number;
  memoryMiB: number;
  // The employee's persistent desk (and toolbox), committed at hire.
  deskStorageMiB: number;
  // One attempt's disk-backed scratch (`/work`, `/output`), reserved at admission.
  scratchStorageMiB: number;
  // An optional dependency cache (pip, npm ...), evictable; 0 for none.
  cacheStorageMiB: number;
  pidsLimit: number;
  timeoutMinutes: number;
}

export interface ResourcePreset {
  id: string;
  name: string;
  description: string;
  profile: ResourceProfile;
}

const GiB = 1024;

// Suggestions that fill the form: not tied to a role, every employee may use custom values.
export const DEFAULT_PRESETS: readonly ResourcePreset[] = [
  { id: "lightweight", name: "Lightweight", description: "Writing, light analysis, small scripts.", profile: { presetId: "lightweight", cpuMillis: 1000, memoryMiB: 2 * GiB, deskStorageMiB: 5 * GiB, scratchStorageMiB: 5 * GiB, cacheStorageMiB: 1 * GiB, pidsLimit: 256, timeoutMinutes: 60 } },
  { id: "research", name: "Research", description: "Reading sources, downloading documents, data notebooks.", profile: { presetId: "research", cpuMillis: 1000, memoryMiB: 2 * GiB, deskStorageMiB: 10 * GiB, scratchStorageMiB: 5 * GiB, cacheStorageMiB: 2 * GiB, pidsLimit: 256, timeoutMinutes: 120 } },
  { id: "developer", name: "Developer", description: "Code, dependencies, unit tests.", profile: { presetId: "developer", cpuMillis: 2000, memoryMiB: 4 * GiB, deskStorageMiB: 20 * GiB, scratchStorageMiB: 10 * GiB, cacheStorageMiB: 5 * GiB, pidsLimit: 1024, timeoutMinutes: 240 } },
  { id: "build-test", name: "Build / Test", description: "Builds and test suites that use several cores.", profile: { presetId: "build-test", cpuMillis: 4000, memoryMiB: 8 * GiB, deskStorageMiB: 30 * GiB, scratchStorageMiB: 20 * GiB, cacheStorageMiB: 10 * GiB, pidsLimit: 2048, timeoutMinutes: 480 } },
];

export const RESOURCE_BOUNDS = {
  cpuMillis: { min: 250, max: 64_000 },
  memoryMiB: { min: 512, max: 256 * GiB },
  deskStorageMiB: { min: 256, max: 2048 * GiB },
  scratchStorageMiB: { min: 256, max: 1024 * GiB },
  cacheStorageMiB: { min: 0, max: 512 * GiB },
  pidsLimit: { min: 64, max: 32_768 },
  timeoutMinutes: { min: 5, max: 7 * 24 * 60 },
} as const;

export interface Amounts {
  cpuMillis: number;
  memoryMiB: number;
}

// What the host can give employee containers.
export interface InfrastructureCapacity {
  // `detected`: read from the container runtime (CPUs, memory) and the workforce volume's free space; `configured`: the
  // operator's ORBIT_WEB_CAPACITY_* values.
  source: "detected" | "configured" | "unknown";
  total: Amounts & { storageMiB: number };
  // Kept for Orbit itself, PostgreSQL, the proxy, the allocator and the OS.
  headroom: Amounts & { storageMiB: number };
  usable: Amounts & { storageMiB: number };
  storage: StorageCapability;
  checkedAt: string | null;
}

export interface StorageCapability {
  mechanism: StorageMechanism;
  // Per sandbox area: the kernel refuses a write past the quota (HARD), or Orbit measures it (SOFT), or nothing.
  perArea: EnforcementLevel;
  // Whether exhausting the workforce areas could fill the host's own disk.
  hostProtection: EnforcementLevel;
  evidence: string;
  probedAt: string | null;
}

export interface PerEmployeeCeiling {
  cpuMillis: number;
  memoryMiB: number;
  deskStorageMiB: number;
  scratchStorageMiB: number;
  cacheStorageMiB: number;
}

// Where an account's authorization comes from: the host's usable capacity -- which it follows when the host is read
// again at a start (a resized host, another pool, ORBIT_WEB_CAPACITY_* changed) -- or the operator's own numbers
// (`governance.js budget set`), which it keeps until the operator says otherwise. Absent: the capacity (as first made).
export type AuthorizationSource = "capacity" | "operator";

export interface BudgetAuthorization {
  cpuMillis: number;
  memoryMiB: number;
  storageMiB: number;
  maxConcurrent: number;
  perEmployee: PerEmployeeCeiling;
  source?: AuthorizationSource;
}

export interface AccountResourceBudget {
  cpuMillis: number;
  memoryMiB: number;
  storageMiB: number;
  maxConcurrent: number;
  perEmployee: PerEmployeeCeiling;
  // The operator's authorization: the owner may lower the budget, never raise it above this.
  authorized: BudgetAuthorization;
  version: number;
  updatedAt: string;
}

export const STORAGE_CATEGORIES = ["desk", "cache", "team", "scratch", "artifacts", "research", "logs"] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export interface StorageAccount {
  budgetMiB: number;
  // Quotas promised (desks, caches, team rooms) + scratch held by admitted attempts.
  committedMiB: number;
  // Measured (artifacts, research snapshots, logs; and the real use of the quota'd areas).
  usedMiB: number;
  byCategory: Record<StorageCategory, { committedMiB: number; usedMiB: number }>;
  measuredAt: string | null;
}

export interface ResourceSummary {
  capacity: InfrastructureCapacity;
  budget: AccountResourceBudget;
  reserved: Amounts & { scratchMiB: number };
  available: Amounts;
  storage: StorageAccount;
  // Attempts of the account.
  running: number;
  waiting: number;
  unschedulable: number;
  // The model-plane overhead each runtime's attempt reserves beside the employee's own limits.
  modelPlane: { runtime: string; cpuMillis: number; memoryMiB: number }[];
  // What the running attempts were last MEASURED using -- never what they reserved. Null: nothing sampled lately.
  observed: { runs: number; memoryCurrentMiB: number | null; memoryPeakMiB: number | null; cpuSeconds: number | null; sampledAt: string | null };
  asOf: string;
}

export interface UpdateBudgetRequest {
  cpuMillis?: number;
  memoryMiB?: number;
  storageMiB?: number;
  maxConcurrent?: number;
  perEmployee?: Partial<PerEmployeeCeiling>;
}

// One attempt's resources, three records never merged: what the profile asked, what the container runtime was given (read
// back), and what the container itself shows (its cgroup files and behaviour tests).
export interface ResourceEvidence {
  requested: ResourceProfile & { modelPlane: Amounts };
  applied: { cpuMillis: number | null; memoryMiB: number | null; pidsLimit: number | null; readBackAt: string } | null;
  observed: { cpuQuota: string | null; memoryLimit: string | null; pidsMax: string | null; storage: { area: StorageArea; level: EnforcementLevel; evidence: string }[]; at: string } | null;
}

export interface UsageView {
  cpuSeconds: number | null;
  memoryCurrentMiB: number | null;
  memoryPeakMiB: number | null;
  oomKilled: boolean;
  pidsPeak: number | null;
  diskUsedMiB: number | null;
  networkBytesIn: number | null;
  networkBytesOut: number | null;
  sampledAt: string | null;
}

// DELETING: an archived employee's desk being removed (tried again until the allocator reads it back gone); DELETED: gone.
export const SANDBOX_STATES = ["PROVISIONING", "READY", "FAILED", "ARCHIVED", "DELETING", "DELETED"] as const;
export type SandboxState = (typeof SANDBOX_STATES)[number];

export interface SandboxAreaView {
  area: StorageArea;
  quotaMiB: number;
  usedMiB: number | null;
  level: EnforcementLevel;
  evidence: string;
}

export interface SandboxView {
  id: string;
  state: SandboxState;
  reason: string | null;
  provider: "container" | "process";
  areas: SandboxAreaView[];
  resourceRevision: number;
  resources: ResourceProfile;
  version: number;
}

export interface ResourceRevisionView {
  revision: number;
  profile: ResourceProfile;
  note: string;
  createdBy: string;
  createdAt: string;
}

const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function checkResourceProfile(v: unknown): Checked<ResourceProfile> {
  if (!isRecord(v)) return { ok: false, errors: ["resources must be an object"] };
  const keys = Object.keys(RESOURCE_BOUNDS) as (keyof typeof RESOURCE_BOUNDS)[];
  const errors = unknownFields(v, ["presetId", ...keys]).map((e) => `resources.${e}`);
  if (v.presetId !== undefined && v.presetId !== null && (typeof v.presetId !== "string" || !/^[a-z0-9-]{1,40}$/.test(v.presetId))) errors.push("resources.presetId must be a preset's id or null");
  for (const k of keys) {
    const b = RESOURCE_BOUNDS[k];
    if (!int(v[k]) || (v[k] as number) < b.min || (v[k] as number) > b.max) errors.push(`resources.${k} must be a whole number from ${b.min} to ${b.max}`);
  }
  return checked(errors, () => ({
    presetId: (v.presetId as string | null | undefined) ?? null,
    cpuMillis: v.cpuMillis as number,
    memoryMiB: v.memoryMiB as number,
    deskStorageMiB: v.deskStorageMiB as number,
    scratchStorageMiB: v.scratchStorageMiB as number,
    cacheStorageMiB: v.cacheStorageMiB as number,
    pidsLimit: v.pidsLimit as number,
    timeoutMinutes: v.timeoutMinutes as number,
  }));
}

// The problems of a profile against an account's per-employee ceiling (empty: within it).
export function ceilingProblems(p: ResourceProfile, c: PerEmployeeCeiling): string[] {
  const out: string[] = [];
  if (p.cpuMillis > c.cpuMillis) out.push(`CPU ${p.cpuMillis / 1000} vCPU is above the per-employee limit of ${c.cpuMillis / 1000} vCPU`);
  if (p.memoryMiB > c.memoryMiB) out.push(`memory ${p.memoryMiB} MiB is above the per-employee limit of ${c.memoryMiB} MiB`);
  if (p.deskStorageMiB > c.deskStorageMiB) out.push(`desk storage ${p.deskStorageMiB} MiB is above the per-employee limit of ${c.deskStorageMiB} MiB`);
  if (p.scratchStorageMiB > c.scratchStorageMiB) out.push(`scratch storage ${p.scratchStorageMiB} MiB is above the per-employee limit of ${c.scratchStorageMiB} MiB`);
  if (p.cacheStorageMiB > c.cacheStorageMiB) out.push(`cache ${p.cacheStorageMiB} MiB is above the per-employee limit of ${c.cacheStorageMiB} MiB`);
  return out;
}

export function checkUpdateBudget(body: unknown): Checked<UpdateBudgetRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["cpuMillis", "memoryMiB", "storageMiB", "maxConcurrent", "perEmployee"]);
  for (const k of ["cpuMillis", "memoryMiB", "storageMiB", "maxConcurrent"] as const) if (body[k] !== undefined && (!int(body[k]) || (body[k] as number) < (k === "maxConcurrent" ? 0 : 0))) errors.push(`${k} must be a whole number of at least 0`);
  if (body.perEmployee !== undefined) {
    if (!isRecord(body.perEmployee)) errors.push("perEmployee must be an object");
    else for (const [k, v] of Object.entries(body.perEmployee)) if (!["cpuMillis", "memoryMiB", "deskStorageMiB", "scratchStorageMiB", "cacheStorageMiB"].includes(k) || !int(v) || (v as number) < 0) errors.push(`perEmployee.${k} must be a known limit and a whole number`);
  }
  if (Object.keys(body).length === 0) errors.push("nothing to change");
  return checked(errors, () => body as UpdateBudgetRequest);
}
