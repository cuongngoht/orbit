// THE SECURITY PLANE, IN THE ALLOCATOR (ADR 0063): the trusted host component that already alone creates, starts, stops
// and removes every attempt's containers is also the one that protects them -- binds each attempt's identity as the
// kernel sees it, installs and reads back its policy, proves it by a probe before anything the employee runs may start,
// keeps proving it while it runs, and contains the attempt (its two containers, no other) when the proof is lost. None
// of it waits for Orbit Web's worker, a page, a model or an event consumer: the allocator acts on what it reads itself.
//
// One protection record per attempt (its own lifecycle, never the assignment's), kept beside the registry that
// attributes the sensor's events. Telemetry is a bounded ring with an epoch and a sequence: Orbit Web pulls from a
// cursor; what the ring no longer holds is said LOST, never skipped in silence; an event from a container Orbit did not
// make belongs to no account and is only counted.
import { createHash, randomBytes } from "node:crypto";
import type { HostKind, PlaneIdentity, ProtectionCheck, ProtectionEvidence, ProtectionState, RuntimeOutcome, WatchedRunKind } from "@orbit-web/contracts";
import { outcomeOf } from "@orbit-web/contracts";
import { RUNTIME_CONTROL_IDS, strictestRuntimeMode, type RuntimeControlId, type RuntimeMode, type RuntimePlane } from "@orbit-web/governance-core";
import type { RuntimeSecurityBackend, SensorStatus } from "./backend.js";
import { CANARY_PATH, CANARY_POLICY, compileAttemptPolicy, CONTROL_TARGETS, PolicyCompileError, type CompiledPolicy } from "./policy.js";
import { WorkloadRegistry } from "./registry.js";
import { parseSensorLine, type SensorEvent } from "./sensor-events.js";
import { decide, type WatchAction } from "./watchdog.js";
import type { RuntimePull, WireProtection, WireRuntimeEvent } from "../../contexts/execution/infrastructure/sandbox/runtime-security-wire.js";

export type { RuntimePull, WireProtection, WireRuntimeEvent };

// What the service asks of the container runtime: the allocator's own exec, stop and inspect, narrowed.
export interface PlaneRuntime {
  exec(containerId: string, argv: string[], o: { user: string; timeoutMs: number }): Promise<{ code: number | null; out: string }>;
  stop(containerId: string): Promise<void>;
  // null: the container is gone. startedAt: when its current process tree started (a restart is new namespaces).
  inspect(containerId: string): Promise<{ running: boolean; startedAt: string } | null>;
}

export interface ProtectRequest {
  dispatchKey: string;
  runKind: WatchedRunKind;
  runId: string;
  accountId: string;
  employeeId: string | null;
  assignmentId: string | null;
  sessionId: string | null;
  fence: number;
  requested: { mode: RuntimeMode; controls: RuntimeControlId[] };
  planes: { plane: RuntimePlane; containerId: string; startedAt: string; user: string }[];
}

export class ProtectionRefused extends Error {}

export interface PersistedRecord {
  req: ProtectRequest;
  mode: RuntimeMode;
  controls: RuntimeControlId[];
  state: ProtectionState;
  detail: string;
  policy: CompiledPolicy | null;
  installedMode: "enforce" | "monitor" | null;
  planes: PlaneIdentity[];
  checks: ProtectionCheck[];
  verifiedAt: number | null;
  sensorGeneration: string | null;
  backendVersion: string | null;
  opened: boolean;
}

interface ProtectionRecord {
  req: ProtectRequest;
  mode: RuntimeMode;
  controls: RuntimeControlId[];
  state: ProtectionState;
  detail: string;
  policy: CompiledPolicy | null;
  installedMode: "enforce" | "monitor" | null;
  planes: PlaneIdentity[];
  checks: ProtectionCheck[];
  verifiedAt: number | null;
  freshUntil: number | null;
  sensorGeneration: string | null;
  backendVersion: string | null;
  opened: boolean;
  lostSince: number | null;
  updatedAt: number;
}

export interface RuntimeSecurityServiceOptions {
  backend: RuntimeSecurityBackend;
  runtime: PlaneRuntime;
  floor: RuntimeMode;
  containAfterMs: number;
  freshMs: number;
  canaryMaxAgeMs?: number;
  // How long a probe waits for the sensor to report what the probe did.
  sensorWaitMs?: number;
  pollMs?: number;
  ringSize?: number;
  now?: () => number;
  hostKind?: HostKind;
  hostId?: string | null;
  bootId?: string | null;
  // Told whenever a record changes (the allocator persists what it must keep across a restart).
  onChange?: (dispatchKey: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MNT = /mnt:\[(\d+)\]/;

export class RuntimeSecurityService {
  readonly registry: WorkloadRegistry;
  private readonly records = new Map<string, ProtectionRecord>();
  private readonly ring: WireRuntimeEvent[] = [];
  private seq = 0;
  private readonly epoch = randomBytes(8).toString("hex");
  private unattributed = 0;
  private gaps = 0;
  private sensor: SensorStatus | null = null;
  private canaryAt: number | null = null;
  // What the sensor reported of Orbit's own probes: a plane's mount namespace (its identity exec), the canary seen.
  private readonly identity = new Map<string, string>();
  private readonly canaryHits = new Set<string>();
  // The host's own canary containers (in and out of the canary policy's scope): when the sensor last reported each, and
  // the fileless exec it last saw from the out-of-scope one. Never telemetry of any account.
  private readonly canaries = new Map<string, "in" | "out">();
  private readonly canarySeen: { in: number | null; out: number | null; fileless: number | null } = { in: null, out: null, fileless: null };
  private readonly o: Required<Omit<RuntimeSecurityServiceOptions, "onChange" | "hostId" | "bootId">> & Pick<RuntimeSecurityServiceOptions, "onChange" | "hostId" | "bootId">;

  constructor(o: RuntimeSecurityServiceOptions) {
    this.o = { canaryMaxAgeMs: 90_000, sensorWaitMs: 5_000, pollMs: 100, ringSize: 20_000, now: Date.now, hostKind: "unknown", ...o };
    this.registry = new WorkloadRegistry({ now: this.o.now });
  }

  get backendKind(): "tetragon" | "disabled" {
    return this.o.backend.kind;
  }

  effectiveMode(requested: RuntimeMode): RuntimeMode {
    return strictestRuntimeMode(requested, this.o.floor);
  }

  // The host canary was proven (refused in scope, ran out of scope, both seen) at this time.
  canaryProven(at: number): void {
    this.canaryAt = at;
  }

  // ---- an attempt's protection ----------------------------------------------------------------------------------------

  async protect(req: ProtectRequest): Promise<ProtectionEvidence> {
    const mode = this.effectiveMode(req.requested.mode);
    const controls = RUNTIME_CONTROL_IDS.filter((c) => req.requested.controls.includes(c));
    const rec: ProtectionRecord = { req, mode, controls, state: "UNREGISTERED", detail: "", policy: null, installedMode: null, planes: req.planes.map((p) => ({ plane: p.plane, containerId: p.containerId, startedAt: p.startedAt, mntNs: null, sensorMntNs: null })), checks: [], verifiedAt: null, freshUntil: null, sensorGeneration: null, backendVersion: null, opened: false, lostSince: null, updatedAt: this.o.now() };
    this.records.set(req.dispatchKey, rec);
    this.registry.register({ dispatchKey: req.dispatchKey, runKind: req.runKind, accountId: req.accountId, runId: req.runId, employeeId: req.employeeId, assignmentId: req.assignmentId, sessionId: req.sessionId, fence: req.fence, mode, controls, planes: req.planes.map((p) => ({ plane: p.plane, containerId: p.containerId, startedAt: p.startedAt })) });
    if (mode === "disabled") return this.settle(rec, "UNREGISTERED", "Runtime security is disabled for this attempt: only the sandbox's own controls hold it.");
    if (this.o.backend.kind === "disabled") return this.fail(rec, "No runtime security backend runs on this host (ORBIT_WEB_RUNTIME_SECURITY=off).");
    const status = await this.o.backend.status();
    this.sensor = status;
    rec.backendVersion = status.version;
    rec.checks.push({ name: "sensor_healthy", ok: status.state === "HEALTHY", detail: status.detail });
    if (status.state !== "HEALTHY") return this.fail(rec, `The runtime security sensor is ${status.state.toLowerCase()}: ${status.detail}`);
    if (!(await this.bindIdentity(rec))) return this.fail(rec, "The attempt's identity could not be bound: the plane and the sensor did not agree on its namespace.");
    if (!(await this.reapStale(rec))) return this.fail(rec, "A policy left by an earlier attempt still holds this attempt's namespace and could not be removed.");
    try {
      rec.policy = compileAttemptPolicy({ dispatchKey: req.dispatchKey, planes: rec.planes.map((p) => ({ plane: p.plane as RuntimePlane, containerId: p.containerId, mntNs: p.mntNs ?? "" })), controls });
    } catch (err) {
      if (err instanceof PolicyCompileError) return this.fail(rec, `The attempt's policy could not be compiled: ${err.message}`);
      throw err;
    }
    const installedMode = mode === "enforce" ? "enforce" : "monitor";
    const applied = await this.o.backend.apply(rec.policy, installedMode);
    rec.checks.push({ name: "policy_installed", ok: applied.ok, detail: applied.detail.slice(0, 300) || null });
    if (!applied.ok) return this.fail(rec, `The sensor refused the attempt's policy: ${applied.detail.slice(0, 300)}`);
    this.registry.bindPolicy(req.dispatchKey, { name: rec.policy.name, inodes: rec.policy.inodes, digest: rec.policy.digest });
    rec.installedMode = installedMode;
    const listed = (await this.o.backend.policies())?.find((p) => p.name === rec.policy?.name) ?? null;
    const readBack = listed !== null && listed.state === "TP_STATE_ENABLED" && listed.mode === installedMode;
    rec.checks.push({ name: "policy_read_back", ok: readBack, detail: listed === null ? "not listed" : `${listed.state}, ${listed.mode}` });
    if (!readBack) return this.fail(rec, "The policy did not read back enabled in the mode it was given.");
    if (!(await this.proveCanary(rec))) return this.fail(rec, mode === "enforce" ? "The canary was not refused in both planes: the policy does not hold this attempt." : "The sensor did not report the policy matching in both planes.");
    rec.sensorGeneration = status.generation;
    rec.verifiedAt = this.o.now();
    rec.freshUntil = rec.verifiedAt + this.o.freshMs;
    return this.settle(rec, mode === "enforce" ? "VERIFIED" : "OBSERVING", mode === "enforce" ? "Installed, read back, and the canary refused in both planes before anything the employee runs started." : "Observed: every process of the attempt is reported; a rule that matches is reported, never refused.");
  }

  private async waitFor(test: () => boolean): Promise<boolean> {
    const deadline = this.o.now() + this.o.sensorWaitMs;
    for (;;) {
      this.ingest();
      if (test()) return true;
      if (this.o.now() >= deadline) return false;
      await sleep(this.o.pollMs);
      // A fake clock does not move by itself: never wait forever on one.
      if (this.o.pollMs <= 1 && this.o.now() < deadline) return test();
    }
  }

  // The plane says its namespace; the sensor's event for that very exec says the same.
  private async bindIdentity(rec: ProtectionRecord): Promise<boolean> {
    let all = true;
    for (const p of rec.planes) {
      const plane = rec.req.planes.find((x) => x.containerId === p.containerId);
      const r = await this.o.runtime.exec(p.containerId, ["readlink", "/proc/self/ns/mnt"], { user: plane?.user ?? "", timeoutMs: 15_000 });
      p.mntNs = MNT.exec(r.out)?.[1] ?? null;
      const key = `${rec.req.dispatchKey}:${p.plane}`;
      this.identity.delete(key);
      await this.waitFor(() => this.identity.has(key));
      p.sensorMntNs = this.identity.get(key) ?? null;
      const ok = p.mntNs !== null && p.mntNs === p.sensorMntNs;
      rec.checks.push({ name: `identity_${p.plane}`, ok, detail: `the plane says ${p.mntNs ?? "nothing"}, the sensor saw ${p.sensorMntNs ?? "nothing"}` });
      all = all && ok;
    }
    return all;
  }

  private async reapStale(rec: ProtectionRecord): Promise<boolean> {
    const inodes = rec.planes.flatMap((p) => (p.mntNs !== null ? [p.mntNs] : []));
    const stale = this.registry.policiesHolding(inodes, rec.req.dispatchKey);
    let ok = true;
    for (const name of stale) {
      const r = await this.o.backend.remove(name);
      if (r.ok) this.registry.policyGone(name);
      ok = ok && r.ok;
    }
    rec.checks.push({ name: "no_stale_policy", ok, detail: stale.length === 0 ? "no other policy holds these namespaces" : `${stale.join(", ")} ${ok ? "removed first" : "could not be removed"}` });
    return ok;
  }

  // The canary in each plane: refused with EPERM and the override seen (enforce), or seen matching while it ran (observe).
  private async proveCanary(rec: ProtectionRecord): Promise<boolean> {
    let all = true;
    for (const p of rec.planes) {
      const plane = rec.req.planes.find((x) => x.containerId === p.containerId);
      const key = `${rec.policy?.name}:${p.plane}`;
      this.canaryHits.delete(key);
      const r = await this.o.runtime.exec(p.containerId, ["sh", "-c", `${CANARY_PATH}; echo "rc=$?"`], { user: plane?.user ?? "", timeoutMs: 15_000 });
      const refused = /rc=126/.test(r.out) && /not permitted/i.test(r.out);
      const ran = /rc=0/.test(r.out);
      const seen = await this.waitFor(() => this.canaryHits.has(key));
      const ok = rec.mode === "enforce" ? refused && seen : ran && seen;
      rec.checks.push({ name: rec.mode === "enforce" ? "canary_refused" : "canary_observed", ok, detail: `${p.plane}: ${refused ? "refused (EPERM)" : ran ? "ran" : `exit ${r.code ?? "?"}`}, ${seen ? "the sensor saw the policy match" : "the sensor did not report it"}` });
      all = all && ok;
    }
    return all;
  }

  private fail(rec: ProtectionRecord, detail: string): ProtectionEvidence {
    // Enforce never quietly becomes observe: unproven protection is UNKNOWN, and the gate stays shut.
    return this.settle(rec, rec.mode === "enforce" ? "UNKNOWN" : "DEGRADED", detail);
  }

  private settle(rec: ProtectionRecord, state: ProtectionState, detail: string): ProtectionEvidence {
    rec.state = state;
    rec.detail = detail;
    rec.updatedAt = this.o.now();
    this.o.onChange?.(rec.req.dispatchKey);
    return this.evidenceOf(rec);
  }

  gate(dispatchKey: string): { open: boolean; reason: string } {
    const rec = this.records.get(dispatchKey);
    if (rec === undefined) return { open: false, reason: "runtime_protection_not_established: the allocator holds no protection record for this attempt" };
    if (rec.mode !== "enforce") return { open: true, reason: "" };
    const fresh = rec.freshUntil !== null && rec.freshUntil > this.o.now();
    if ((rec.state === "VERIFIED" || rec.state === "PROTECTED") && fresh) return { open: true, reason: "" };
    return { open: false, reason: `runtime_protection_not_established: ${rec.state === "VERIFIED" || rec.state === "PROTECTED" ? "the proof is no longer fresh" : rec.detail}` };
  }

  open(dispatchKey: string): ProtectionEvidence {
    const g = this.gate(dispatchKey);
    const rec = this.records.get(dispatchKey);
    if (!g.open || rec === undefined) throw new ProtectionRefused(g.reason);
    rec.opened = true;
    return this.settle(rec, rec.mode === "enforce" ? "PROTECTED" : rec.state, rec.detail);
  }

  opened(dispatchKey: string): boolean {
    return this.records.get(dispatchKey)?.opened === true;
  }

  // A restarted allocator: what it had opened before (from its own state), never re-proven by a word.
  restoreOpened(dispatchKey: string): void {
    const rec = this.records.get(dispatchKey);
    if (rec !== undefined) rec.opened = true;
  }

  evidence(dispatchKey: string): ProtectionEvidence | null {
    const rec = this.records.get(dispatchKey);
    return rec === undefined ? null : this.evidenceOf(rec);
  }

  // Before an attempt's containers are removed: its policy goes first (a freed namespace inode is reused at once), and
  // its deletion is read back.
  async release(dispatchKey: string): Promise<{ policyRemoved: boolean; detail: string }> {
    const rec = this.records.get(dispatchKey);
    const name = rec?.policy?.name ?? null;
    let out = { policyRemoved: true, detail: "no policy to remove" };
    if (name !== null) {
      const r = await this.o.backend.remove(name);
      const listed = r.ok ? await this.o.backend.policies() : null;
      const gone = r.ok && listed !== null && !listed.some((p) => p.name === name);
      if (gone) this.registry.policyGone(name);
      out = gone ? { policyRemoved: true, detail: `${name} removed and read back gone` } : { policyRemoved: false, detail: `${name} could not be removed (${r.detail.slice(0, 200)}): it is kept on record and reaped once the sensor answers` };
    }
    if (rec !== undefined) this.settle(rec, "CLEANED_UP", out.detail);
    this.registry.retire(dispatchKey);
    return out;
  }

  // A chat's, research's or CEO Chat's own sandbox: observed (by the deployment's floor), never a policy, never enforced.
  registerSession(s: { dispatchKey: string; runKind: WatchedRunKind; accountId: string; runId: string; sessionId: string; containerId: string; startedAt: string }): void {
    this.registry.register({ dispatchKey: s.dispatchKey, runKind: s.runKind, accountId: s.accountId, runId: s.runId, employeeId: null, assignmentId: null, sessionId: s.sessionId, fence: 0, mode: "observe", controls: [], planes: [{ plane: "session-plane", containerId: s.containerId, startedAt: s.startedAt }] });
  }

  retireSession(dispatchKey: string): void {
    this.registry.retire(dispatchKey);
  }

  // ---- telemetry --------------------------------------------------------------------------------------------------------

  ingest(maxBytes = 4 * 1024 * 1024): number {
    const { lines, gap } = this.o.backend.readLines(maxBytes);
    if (gap) this.gaps += 1;
    let n = 0;
    for (const line of lines) {
      const e = parseSensorLine(line);
      if (e !== null) n += this.take(e) ? 1 : 0;
    }
    return n;
  }

  watchCanary(containerId: string, side: "in" | "out"): void {
    this.canaries.set(containerId.slice(0, 31), side);
  }

  canaryReport(): { in: number | null; out: number | null; fileless: number | null } {
    return { ...this.canarySeen };
  }

  private take(e: SensorEvent): boolean {
    const side = e.dockerPrefix === null ? undefined : this.canaries.get(e.dockerPrefix);
    if (side !== undefined) {
      if ((side === "in" && e.kind === "hook" && e.path === CANARY_PATH) || (side === "out" && e.kind === "exec" && e.binary === CANARY_PATH)) this.canarySeen[side] = this.o.now();
      if (side === "out" && e.kind === "exec" && /^\/proc\/(self|thread-self|\d+)\/fd\//.test(e.binary ?? "")) this.canarySeen.fileless = this.o.now();
      return false;
    }
    const a = this.registry.attribute({ dockerPrefix: e.dockerPrefix, policy: e.kind === "hook" ? e.policy : null });
    if (a === null) {
      this.unattributed += 1;
      return false;
    }
    const w = a.workload;
    if (e.kind === "exec" && a.plane !== null && e.binary?.endsWith("/readlink") === true && e.mntNs !== null) this.identity.set(`${w.dispatchKey}:${a.plane}`, e.mntNs);
    if (e.binary === CANARY_PATH && e.kind !== "hook") return false;
    if (e.kind === "hook" && e.path === CANARY_PATH) {
      if (e.policy !== null) this.canaryHits.add(`${e.policy}:${a.plane ?? "?"}`);
      return false;
    }
    const rec = this.records.get(w.dispatchKey);
    const kind: WireRuntimeEvent["kind"] = a.mismatch ? "identity.mismatch" : e.kind === "exec" ? "process.exec" : e.kind === "exit" ? "process.exit" : "control.match";
    const policyMode = rec?.installedMode === "enforce" && e.policy === rec.policy?.name ? "enforce" : rec?.installedMode === "monitor" ? "monitor" : "unknown";
    const outcome: RuntimeOutcome = kind === "identity.mismatch" ? "VIOLATION_DETECTED" : kind === "control.match" ? outcomeOf({ matched: true, policyMode, action: e.action ?? "other" }) : "OBSERVED";
    const control = kind === "control.match" && e.path !== null ? (RUNTIME_CONTROL_IDS.find((id) => Object.values(CONTROL_TARGETS[id]).some((targets) => targets?.some((t) => e.path?.startsWith(t)))) ?? null) : null;
    this.push({ key: createHash("sha256").update([kind, e.execId, e.time, e.policy ?? "", e.path ?? ""].join("|")).digest("hex").slice(0, 32), time: e.time, kind, outcome, accountId: w.accountId, runKind: w.runKind, runId: w.runId, dispatchKey: w.dispatchKey, employeeId: w.employeeId, assignmentId: w.assignmentId, sessionId: w.sessionId, plane: a.plane, binary: e.binary, parentBinary: e.parentBinary, path: e.path, control, execId: e.execId, parentExecId: e.parentExecId, exitCode: e.exitCode, signal: e.signal, policy: e.policy });
    return true;
  }

  private push(e: Omit<WireRuntimeEvent, "seq">): void {
    this.seq += 1;
    this.ring.push({ ...e, seq: this.seq });
    if (this.ring.length > this.o.ringSize) this.ring.splice(0, this.ring.length - this.o.ringSize);
  }

  pull(cursor: { epoch: string | null; seq: number }, max: number): RuntimePull {
    const reset = cursor.epoch !== null && cursor.epoch !== this.epoch;
    const from = reset ? 0 : cursor.seq;
    const first = this.ring[0]?.seq ?? this.seq + 1;
    const lost = from < first - 1 ? first - 1 - from : 0;
    const events = this.ring.filter((e) => e.seq > from).slice(0, Math.max(0, max));
    const next = events.at(-1)?.seq ?? Math.max(from, first - 1);
    return { epoch: this.epoch, reset, events, next, lost, unattributed: this.unattributed, gaps: this.gaps, protections: this.protections(), sensor: this.sensor, canaryProvenAt: this.canaryAt === null ? null : new Date(this.canaryAt).toISOString() };
  }

  protections(): WireProtection[] {
    return [...this.records.values()].map((rec) => ({ ...this.evidenceOf(rec), dispatchKey: rec.req.dispatchKey, runId: rec.req.runId, accountId: rec.req.accountId, assignmentId: rec.req.assignmentId, employeeId: rec.req.employeeId, fence: rec.req.fence, opened: rec.opened, lostSince: rec.lostSince === null ? null : new Date(rec.lostSince).toISOString(), updatedAt: new Date(rec.updatedAt).toISOString() }));
  }

  // ---- across a restart of the allocator ---------------------------------------------------------------------------------

  // What must outlive the allocator's process: each attempt's request, policy, binding and whether it was opened. The
  // proof itself never does: a restored record is unproven until the watchdog proves it again.
  exportRecords(): PersistedRecord[] {
    return [...this.records.values()].filter((r) => r.state !== "CLEANED_UP").map((r) => ({ req: r.req, mode: r.mode, controls: r.controls, state: r.state, detail: r.detail, policy: r.policy, installedMode: r.installedMode, planes: r.planes, checks: r.checks, verifiedAt: r.verifiedAt, sensorGeneration: r.sensorGeneration, backendVersion: r.backendVersion, opened: r.opened }));
  }

  restore(records: readonly PersistedRecord[]): void {
    for (const p of records) {
      const rec: ProtectionRecord = { ...p, req: { ...p.req }, planes: p.planes.map((x) => ({ ...x })), checks: p.checks.map((c) => ({ ...c })), freshUntil: null, lostSince: null, updatedAt: this.o.now() };
      this.records.set(p.req.dispatchKey, rec);
      this.registry.register({ dispatchKey: p.req.dispatchKey, runKind: p.req.runKind, accountId: p.req.accountId, runId: p.req.runId, employeeId: p.req.employeeId, assignmentId: p.req.assignmentId, sessionId: p.req.sessionId, fence: p.req.fence, mode: p.mode, controls: p.controls, planes: p.req.planes.map((x) => ({ plane: x.plane, containerId: x.containerId, startedAt: x.startedAt })) });
      if (p.policy !== null) this.registry.bindPolicy(p.req.dispatchKey, { name: p.policy.name, inodes: p.policy.inodes, digest: p.policy.digest });
    }
  }

  // ---- the watchdog ------------------------------------------------------------------------------------------------------

  async watch(): Promise<WatchAction[]> {
    const status = await this.o.backend.status();
    this.sensor = status;
    const installed = status.state === "HEALTHY" ? await this.o.backend.policies() : null;
    const restarted = new Set<string>();
    for (const r of this.records.values()) if (await this.restartedSince(r)) restarted.add(r.req.dispatchKey);
    const actions = decide({
      now: this.o.now(),
      containAfterMs: this.o.containAfterMs,
      freshMs: this.o.freshMs,
      canaryMaxAgeMs: this.o.canaryMaxAgeMs,
      sensor: { state: status.state, generation: status.generation },
      canary: { provenAt: this.canaryAt },
      installed: installed === null ? null : installed.map((p) => ({ name: p.name, state: p.state, mode: p.mode })),
      workloads: [...this.records.values()].map((r) => ({ dispatchKey: r.req.dispatchKey, mode: r.mode, state: r.state, policy: r.policy?.name ?? null, sensorGeneration: r.sensorGeneration, lostSince: r.lostSince, restarted: restarted.has(r.req.dispatchKey) })),
      keep: [CANARY_POLICY],
    });
    for (const a of actions) await this.act(a, status);
    return actions;
  }

  // Whether a plane of a watched attempt runs again under another start time than the one it was proven for.
  private async restartedSince(r: ProtectionRecord): Promise<boolean> {
    if (r.mode === "disabled" || r.policy === null || ["CONTAINING", "CONTAINED", "CLEANED_UP", "UNREGISTERED"].includes(r.state)) return false;
    for (const p of r.planes) {
      const now = await this.o.runtime.inspect(p.containerId).catch(() => null);
      if (now !== null && now.running && now.startedAt !== p.startedAt) return true;
    }
    return false;
  }

  private async act(a: WatchAction, status: SensorStatus): Promise<void> {
    if (a.type === "reap") {
      if ((await this.o.backend.remove(a.policy)).ok) this.registry.policyGone(a.policy);
      return;
    }
    const rec = this.records.get(a.dispatchKey);
    if (rec === undefined) return;
    if (a.type === "renew") {
      rec.freshUntil = a.freshUntil;
      rec.lostSince = null;
      this.settle(rec, rec.mode === "enforce" ? (rec.opened ? "PROTECTED" : "VERIFIED") : "OBSERVING", rec.detail);
    } else if (a.type === "lost") {
      rec.lostSince = this.o.now();
      rec.freshUntil = null;
      this.settle(rec, "UNKNOWN", `Protection lost: ${a.cause}. Contained unless it is proven again within ${Math.round(this.o.containAfterMs / 1000)} s.`);
    } else if (a.type === "contain") await this.contain(rec, a.cause);
    else if (a.type === "degrade") this.settle(rec, "DEGRADED", `Observation degraded: ${a.cause}.`);
    else if (a.type === "reapply") await this.reapply(rec, status);
  }

  private async reapply(rec: ProtectionRecord, status: SensorStatus): Promise<void> {
    if (rec.policy === null) return;
    const r = await this.o.backend.apply(rec.policy, "monitor");
    if (!r.ok) {
      this.settle(rec, "DEGRADED", `Observation degraded: the policy could not be put back (${r.detail.slice(0, 200)}).`);
      return;
    }
    rec.sensorGeneration = status.generation;
    rec.freshUntil = this.o.now() + this.o.freshMs;
    this.settle(rec, "OBSERVING", "Observed again: the sensor restarted and the attempt's policy was put back.");
  }

  // Exactly this attempt's two containers, stopped by the allocator itself, then read back stopped.
  async contain(rec: ProtectionRecord, cause: string): Promise<void> {
    this.settle(rec, "CONTAINING", `Containing: ${cause}.`);
    for (const p of rec.planes) await this.o.runtime.stop(p.containerId).catch(() => undefined);
    const still = [];
    for (const p of rec.planes) if ((await this.o.runtime.inspect(p.containerId).catch(() => ({ running: true, startedAt: "" })))?.running === true) still.push(p.plane);
    if (still.length > 0) {
      this.settle(rec, "CONTAINING", `Containment could not be verified: the ${still.join(" and ")} still run (${cause}).`);
      return;
    }
    this.push({ key: createHash("sha256").update(`contained|${rec.req.dispatchKey}|${rec.updatedAt}`).digest("hex").slice(0, 32), time: new Date(this.o.now()).toISOString(), kind: "workload.contained", outcome: "WORKLOAD_CONTAINED", accountId: rec.req.accountId, runKind: rec.req.runKind, runId: rec.req.runId, dispatchKey: rec.req.dispatchKey, employeeId: rec.req.employeeId, assignmentId: rec.req.assignmentId, sessionId: rec.req.sessionId, plane: null, binary: null, parentBinary: null, path: null, control: null, execId: null, parentExecId: null, exitCode: null, signal: null, policy: rec.policy?.name ?? null });
    this.settle(rec, "CONTAINED", `Contained: both planes stopped and read back stopped (${cause}).`);
  }

  private evidenceOf(rec: ProtectionRecord): ProtectionEvidence {
    return {
      backend: this.o.backend.kind,
      backendVersion: rec.backendVersion,
      hostKind: this.o.hostKind,
      hostId: this.o.hostId ?? null,
      bootId: this.o.bootId ?? null,
      requestedMode: rec.req.requested.mode,
      mode: rec.mode,
      controls: rec.controls,
      policy: rec.policy?.name ?? null,
      digest: rec.policy?.digest ?? null,
      planes: rec.planes.map((p) => ({ ...p })),
      checks: rec.checks.map((c) => ({ ...c })),
      state: rec.state,
      detail: rec.detail,
      verifiedAt: rec.verifiedAt === null ? null : new Date(rec.verifiedAt).toISOString(),
      freshUntil: rec.freshUntil === null ? null : new Date(rec.freshUntil).toISOString(),
      sensorGeneration: rec.sensorGeneration,
    };
  }
}
