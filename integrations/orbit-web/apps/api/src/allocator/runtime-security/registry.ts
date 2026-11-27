// THE WORKLOAD REGISTRY (ADR 0063): which containers this allocator made, for whom -- the account, the run, the plane --
// as the allocator itself labelled them, so that an event the sensor reports is attributed to exactly one workload or to
// none. Nothing an agent, a process or an environment variable says enters here: the container's id (from the sensor's
// cgroup) and the policy whose hook matched (for runc's own exec into a container, which carries no container id yet).
//
// A container and a policy that disagree are an identity MISMATCH -- reported, never silently attributed to either. A
// removed workload stays a TOMBSTONE for a while (its late events are still its own; no new workload inherits its ids),
// and the policy it held is remembered with its namespace inodes until its deletion is read back, because the kernel
// hands a freed inode to the next container at once.
import type { RuntimeControlId, RuntimeMode, RuntimePlane } from "@orbit-web/governance-core";

export type WatchedKind = "assignment" | "chat" | "research" | "executive";
export type WorkloadPlaneName = RuntimePlane | "session-plane";

export interface WorkloadPlaneInit {
  plane: WorkloadPlaneName;
  containerId: string;
  startedAt: string;
}

export interface WorkloadInit {
  dispatchKey: string;
  runKind: WatchedKind;
  accountId: string;
  runId: string;
  employeeId: string | null;
  assignmentId: string | null;
  sessionId: string | null;
  fence: number;
  // The mode in effect (the strictest of the spec's and the deployment's floor), and its controls.
  mode: RuntimeMode;
  controls: RuntimeControlId[];
  planes: WorkloadPlaneInit[];
}

export interface PolicyBinding {
  name: string;
  inodes: string[];
  digest: string;
}

export interface Workload extends WorkloadInit {
  policy: PolicyBinding | null;
  retiredAt: number | null;
}

export interface Attribution {
  workload: Workload;
  // null: attributed by policy (runc's exec), the plane not known from the event itself.
  plane: WorkloadPlaneName | null;
  retired: boolean;
  mismatch: boolean;
}

const MIN_PREFIX = 12;

export class WorkloadRegistry {
  private readonly items = new Map<string, Workload>();
  private readonly tombstones: Workload[] = [];
  // Policies whose deletion has not been read back, by name: the inodes they still hold.
  private readonly lingering = new Map<string, PolicyBinding>();
  private readonly tombstoneMs: number;
  private readonly now: () => number;

  constructor(o: { tombstoneMs?: number; now?: () => number } = {}) {
    this.tombstoneMs = o.tombstoneMs ?? 10 * 60_000;
    this.now = o.now ?? Date.now;
  }

  register(init: WorkloadInit): Workload {
    const existing = this.items.get(init.dispatchKey);
    const w: Workload = { ...init, planes: init.planes.map((p) => ({ ...p })), policy: existing?.policy ?? null, retiredAt: null };
    this.items.set(init.dispatchKey, w);
    return w;
  }

  get(dispatchKey: string): Workload | null {
    return this.items.get(dispatchKey) ?? null;
  }

  live(): Workload[] {
    return [...this.items.values()];
  }

  bindPolicy(dispatchKey: string, binding: PolicyBinding): void {
    const w = this.items.get(dispatchKey);
    if (w === undefined) return;
    w.policy = { ...binding, inodes: [...binding.inodes] };
    this.lingering.set(binding.name, w.policy);
  }

  // The policy's deletion was read back: it holds nothing any more.
  policyGone(name: string): void {
    this.lingering.delete(name);
    for (const w of [...this.items.values(), ...this.tombstones]) if (w.policy?.name === name) w.policy = { ...w.policy, inodes: [] };
  }

  retire(dispatchKey: string): void {
    const w = this.items.get(dispatchKey);
    if (w === undefined) return;
    this.items.delete(dispatchKey);
    w.retiredAt = this.now();
    this.tombstones.push(w);
    this.sweep();
  }

  sweep(): void {
    const cutoff = this.now() - this.tombstoneMs;
    for (let i = this.tombstones.length - 1; i >= 0; i -= 1) if ((this.tombstones[i]?.retiredAt ?? 0) < cutoff) this.tombstones.splice(i, 1);
  }

  private byContainer(prefix: string): { w: Workload; plane: WorkloadPlaneName } | null {
    if (prefix.length < MIN_PREFIX) return null;
    for (const w of [...this.items.values(), ...[...this.tombstones].reverse()]) {
      const p = w.planes.find((x) => x.containerId.startsWith(prefix));
      if (p !== undefined) return { w, plane: p.plane };
    }
    return null;
  }

  private byPolicy(name: string): Workload | null {
    for (const w of [...this.items.values(), ...[...this.tombstones].reverse()]) if (w.policy?.name === name) return w;
    return null;
  }

  attribute(e: { dockerPrefix: string | null; policy: string | null }): Attribution | null {
    const c = e.dockerPrefix !== null ? this.byContainer(e.dockerPrefix) : null;
    const p = e.policy !== null ? this.byPolicy(e.policy) : null;
    if (c !== null) return { workload: c.w, plane: c.plane, retired: c.w.retiredAt !== null, mismatch: p !== null && p !== c.w };
    if (p !== null) return { workload: p, plane: null, retired: p.retiredAt !== null, mismatch: false };
    return null;
  }

  // Every policy -- of a live workload, a tombstone, or one whose deletion was never read back -- other than this
  // attempt's own, that names one of these namespace inodes. Each must be removed before this attempt is bound.
  policiesHolding(inodes: readonly string[], exceptDispatchKey: string): string[] {
    const own = this.items.get(exceptDispatchKey)?.policy?.name ?? null;
    const names = new Set<string>();
    for (const [name, binding] of this.lingering) if (name !== own && binding.inodes.some((i) => inodes.includes(i))) names.add(name);
    return [...names].sort();
  }
}
