// THE SECURITY PLANE ON THIS HOST (ADR 0063): the allocator's runtime security, put together from what the operator
// configured -- the backend (Tetragon, or none), the deployment's floor, the deadlines -- and the allocator's own means
// (its Docker client: exec, stop, inspect, create). It runs, in the allocator's own process and needing nothing else:
//
//   ingest     the sensor's export, every half second, into the attributed ring Orbit Web pulls
//   watchdog   every five seconds: renew what still holds, lose what does not, contain an enforced attempt whose proof
//              stays lost past the deadline, reap Orbit's orphan policies
//   canary     every thirty seconds: the host's two canary containers -- the canary REFUSED in the one the canary policy
//              names, RUN in the one it does not, both reported by the sensor -- which is what proves, for this kernel
//              and this sensor generation, that prevention works and that its scope is not the host
//
// What it must keep across a restart of the allocator (each attempt's request, policy, binding, whether it was opened)
// is written to the allocator's state directory; a restored attempt is unproven until the watchdog proves it again.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityResult, HostKind, ProtectionEvidence } from "@orbit-web/contracts";
import type { RuntimeControlId, RuntimeMode } from "@orbit-web/governance-core";
import type { SandboxConfig } from "../../config/sandbox-config.js";
import type { RuntimeHostProbe } from "../../contexts/execution/infrastructure/sandbox/runtime-security-wire.js";
import { LABELS } from "../../contexts/execution/infrastructure/sandbox/ids.js";
import { TOOL_PLANE } from "../../contexts/execution/infrastructure/sandbox/layout.js";
import { execIn, text } from "../containers.js";
import type { ContainerInspect, DockerEngine } from "../docker/engine.js";
import { LOGS } from "../specs.js";
import { DisabledBackend, type RuntimeSecurityBackend, type SensorStatus } from "./backend.js";
import { CANARY_PATH, CANARY_POLICY, compileCanaryPolicy } from "./policy.js";
import { RuntimeSecurityService, type PersistedRecord, type PlaneRuntime, type ProtectRequest } from "./service.js";
import { TetragonBackend } from "./tetragon.js";

export const SECURITY_LABELS = { mode: "orbit-web.security-mode", controls: "orbit-web.security-controls" } as const;

const MEMFD = 'import os\nfd=os.memfd_create("orbit-canary",0)\nos.write(fd,open("/bin/true","rb").read())\nos.execv("/proc/self/fd/%d"%fd,["orbit-canary"])';

export function hostKindOf(info: { OperatingSystem?: string; KernelVersion?: string; SecurityOptions?: string[] | null }): HostKind {
  if ((info.SecurityOptions ?? []).some((o) => /name=rootless/.test(o))) return "rootless-docker";
  if (/docker desktop/i.test(info.OperatingSystem ?? "")) return "docker-desktop";
  if (/microsoft|wsl/i.test(info.KernelVersion ?? "")) return "wsl";
  return info.KernelVersion ? "native-linux" : "unknown";
}

export interface HostSecurityOptions {
  engine: DockerEngine;
  config: SandboxConfig;
  now: () => Date;
  backend?: RuntimeSecurityBackend;
  // Where what went wrong is said (the allocator's log).
  log?: (line: string) => void;
}

export class HostSecurity {
  readonly service: RuntimeSecurityService;
  private readonly backend: RuntimeSecurityBackend;
  private readonly recordsFile: string;
  private timers: NodeJS.Timeout[] = [];
  private persisting = false;
  private busy = { watch: false, canary: false };
  private canaryDetail = "not proven yet";
  private hostKind: HostKind = "unknown";
  private kernel: string | null = null;
  private arch: string | null = null;
  // The namespace the host canary's policy was compiled for: a canary container that started again has a new one.
  private canaryBoundTo: string | null = null;
  // One proof at a time: a probe and the 30 s loop never remove and apply the canary's policy under each other.
  private proving: Promise<unknown> = Promise.resolve();
  // What the latest proofs established, by capability, and the sensor as they last read it.
  private latest = new Map<CapabilityResult["capability"], CapabilityResult>();
  private lastStatus: SensorStatus | null = null;
  private readonly log: (line: string) => void;

  constructor(private readonly o: HostSecurityOptions) {
    const rs = o.config.runtimeSecurity;
    const stateDir = join(o.config.allocatorServer.stateDir, "runtime-security");
    this.recordsFile = join(stateDir, "records.json");
    this.backend = o.backend ?? (rs.backend === "tetragon" ? new TetragonBackend({ engine: o.engine, sensor: rs.sensor, eventsDir: rs.eventsDir, stateFile: join(stateDir, "export-position.json") }) : new DisabledBackend());
    const runtime: PlaneRuntime = {
      exec: async (id, argv, x) => {
        const r = await execIn(o.engine, id, argv, { user: x.user, timeoutMs: x.timeoutMs, maxOutputBytes: 64 * 1024 });
        return { code: r.code, out: `${text(r.stdout)}\n${text(r.stderr)}` };
      },
      stop: async (id) => {
        await o.engine.containerStop(id, 0);
      },
      inspect: async (id) => {
        const c = await o.engine.containerInspect(id);
        return c === null ? null : { running: c.State.Running, startedAt: c.State.StartedAt };
      },
    };
    this.service = new RuntimeSecurityService({ backend: this.backend, runtime, floor: rs.floor, containAfterMs: rs.containAfterMs, freshMs: rs.freshMs, now: () => o.now().getTime(), onChange: () => this.persistSoon() });
    this.log = o.log ?? (() => undefined);
  }

  get enabled(): boolean {
    return this.backend.kind !== "disabled";
  }

  // What an attempt's containers are labelled with: the mode in effect (the strictest of the request and the floor) and
  // its controls -- written once by the allocator, read back after a restart, changed by nobody.
  labels(requested: { mode: RuntimeMode; controls: RuntimeControlId[] } | undefined): Record<string, string> {
    const mode = this.service.effectiveMode(requested?.mode ?? "disabled");
    return { [SECURITY_LABELS.mode]: mode, [SECURITY_LABELS.controls]: (requested?.controls ?? []).join(",") };
  }

  protect(req: ProtectRequest): Promise<ProtectionEvidence> {
    return this.service.protect(req);
  }

  // ---- the host canary ------------------------------------------------------------------------------------------------

  private canaryName(side: "in" | "out"): string {
    return `${this.o.config.names.prefix}-rs-canary-${side}`;
  }

  private async canaryContainer(side: "in" | "out"): Promise<ContainerInspect | null> {
    const name = this.canaryName(side);
    let c = await this.o.engine.containerInspect(name);
    if (c === null) {
      await this.o.engine.containerCreate(name, {
        Image: this.o.config.images.workstation,
        Hostname: `runtime-canary-${side}`,
        User: `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`,
        Cmd: ["sleep", "infinity"],
        Labels: { [LABELS.managed]: "1", [LABELS.prefix]: this.o.config.names.prefix, [LABELS.role]: "probe", [LABELS.kind]: `runtime-canary-${side}` },
        HostConfig: { Init: true, ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", IpcMode: "private", RestartPolicy: { Name: "unless-stopped" }, LogConfig: LOGS, NanoCpus: 100_000_000, Memory: 64 * 1024 * 1024, PidsLimit: 32, Tmpfs: { "/tmp": "rw,nosuid,nodev,size=8m" } },
      });
      c = await this.o.engine.containerInspect(name);
    }
    if (c !== null && !c.State.Running) {
      await this.o.engine.containerStart(c.Id);
      c = await this.o.engine.containerInspect(name);
    }
    if (c !== null) this.service.watchCanary(c.Id, side);
    return c;
  }

  private async canaryExec(c: ContainerInspect, argv: string[]): Promise<string> {
    const r = await execIn(this.o.engine, c.Id, argv, { user: `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`, timeoutMs: 15_000, maxOutputBytes: 16 * 1024 });
    return `${text(r.stdout)}\n${text(r.stderr)}`;
  }

  private async waitSeen(test: () => boolean, ms = 5_000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      this.service.ingest();
      if (test()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return test();
  }

  // One proof of the host's prevention and its scope, after any other in progress. Returns the capability results it
  // established; they are also what the host is said to prove from now on (current()).
  proveCanary(fileless = false): Promise<CapabilityResult[]> {
    const run = this.proving.then(() => this.proveCanaryNow(fileless));
    this.proving = run.catch(() => undefined);
    return run.then((out) => {
      for (const c of out) this.latest.set(c.capability, c);
      return out;
    });
  }

  // What a probe said, with what the proofs since established: the capabilities proven again, the sensor as last read.
  current(probe: RuntimeHostProbe): RuntimeHostProbe {
    const capabilities = probe.capabilities.map((c) => this.latest.get(c.capability) ?? c);
    for (const c of this.latest.values()) if (!capabilities.some((x) => x.capability === c.capability)) capabilities.push(c);
    return { ...probe, capabilities, sensor: this.lastStatus ?? probe.sensor };
  }

  private async proveCanaryNow(fileless: boolean): Promise<CapabilityResult[]> {
    const at = new Date().toISOString();
    const result = (capability: CapabilityResult["capability"], state: CapabilityResult["state"], detail: string): CapabilityResult => ({ capability, state, detail, checkedAt: at });
    if (!this.enabled) return (["observe.process", "observe.fileless", "prevent.exec", "scope.workload"] as const).map((c) => result(c, "UNSUPPORTED", "no runtime security backend on this host"));
    const status = await this.backend.status();
    this.lastStatus = status;
    if (status.state !== "HEALTHY") return (["observe.process", "observe.fileless", "prevent.exec", "scope.workload"] as const).map((c) => result(c, "UNKNOWN", `the sensor is ${status.state.toLowerCase()}: ${status.detail}`));
    const inside = await this.canaryContainer("in");
    const outside = await this.canaryContainer("out");
    if (inside === null || outside === null) return (["observe.process", "observe.fileless", "prevent.exec", "scope.workload"] as const).map((c) => result(c, "UNKNOWN", "the canary containers could not be made"));
    const mnt = /mnt:\[(\d+)\]/.exec(await this.canaryExec(inside, ["readlink", "/proc/self/ns/mnt"]))?.[1] ?? null;
    let applyDetail = "";
    // Bound again whenever the in-scope canary has another namespace than the one the policy names (that container
    // started again): a policy left on the old inode refuses nothing here, and would land on whatever reuses it.
    const enabled = ((await this.backend.policies()) ?? []).some((p) => p.name === CANARY_POLICY && p.state === "TP_STATE_ENABLED");
    if (mnt !== null && (!enabled || this.canaryBoundTo !== mnt)) {
      await this.backend.remove(CANARY_POLICY);
      const a = await this.backend.apply(compileCanaryPolicy(mnt), "enforce");
      applyDetail = a.ok ? "" : a.detail;
      this.canaryBoundTo = a.ok ? mnt : null;
    }
    const startedAt = this.o.now().getTime();
    const inOut = await this.canaryExec(inside, ["sh", "-c", `${CANARY_PATH}; echo "rc=$?"`]);
    const outOut = await this.canaryExec(outside, ["sh", "-c", `${CANARY_PATH}; echo "rc=$?"`]);
    const refused = /rc=126/.test(inOut) && /not permitted/i.test(inOut);
    const ran = /rc=0/.test(outOut);
    const seen = await this.waitSeen(() => (this.service.canaryReport().in ?? 0) >= startedAt && (this.service.canaryReport().out ?? 0) >= startedAt);
    const report = this.service.canaryReport();
    const missing = /not found|no such file/i.test(inOut + outOut);
    const out: CapabilityResult[] = [
      result("observe.process", (report.out ?? 0) >= startedAt ? "SUPPORTED" : "DEGRADED", (report.out ?? 0) >= startedAt ? "an exec in the out-of-scope canary reached the sensor's export, attributed to that container" : "the sensor did not report the canary's exec"),
      result("prevent.exec", missing ? "UNKNOWN" : refused && (report.in ?? 0) >= startedAt ? "SUPPORTED" : applyDetail !== "" ? "UNSUPPORTED" : "DEGRADED", missing ? `the canary program ${CANARY_PATH} is not in the workstation image (${this.o.config.images.workstation})` : refused ? "the canary was refused (EPERM) in the canary container the policy names, and the sensor reported the override" : applyDetail !== "" ? `the sensor refused the canary policy: ${applyDetail.slice(0, 300)}` : "the canary was not refused where the policy names it"),
      result("scope.workload", ran ? "SUPPORTED" : missing ? "UNKNOWN" : "DEGRADED", ran ? "the canary still ran in the canary container the policy does not name: the policy is not the host's" : "the out-of-scope canary did not run"),
    ];
    if (fileless) {
      const before = this.o.now().getTime();
      await this.canaryExec(outside, ["python3", "-c", MEMFD]);
      const sawFileless = await this.waitSeen(() => (this.service.canaryReport().fileless ?? 0) >= before);
      out.push(result("observe.fileless", sawFileless ? "SUPPORTED" : "DEGRADED", sawFileless ? "an exec of a memory-only file was reported as such (detected; no hook can refuse it here)" : "the sensor did not report the memory-only exec"));
    }
    const proven = seen && refused && ran;
    if (proven) this.service.canaryProven(this.o.now().getTime());
    this.canaryDetail = proven ? "proven" : out.filter((c) => c.state !== "SUPPORTED").map((c) => `${c.capability}: ${c.detail}`).join("; ");
    return out;
  }

  async probe(info: { OperatingSystem?: string; KernelVersion?: string; Architecture?: string; SecurityOptions?: string[] | null }): Promise<RuntimeHostProbe> {
    this.hostKind = hostKindOf(info);
    this.kernel = info.KernelVersion ?? null;
    this.arch = info.Architecture ?? null;
    const capabilities = await this.proveCanary(true).catch((err: unknown) => (["observe.process", "observe.fileless", "prevent.exec", "scope.workload"] as const).map((c): CapabilityResult => ({ capability: c, state: "UNKNOWN", detail: `the probe failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400), checkedAt: new Date().toISOString() })));
    const status = await this.backend.status();
    return { backend: this.backend.kind, backendVersion: status.version, backendImage: status.image, hostKind: this.hostKind, kernel: this.kernel, arch: this.arch, floor: this.o.config.runtimeSecurity.floor, sensor: status, capabilities, resources: await this.backend.resources().catch(() => ({ cpuPercent: null, memoryMiB: null })), probedAt: this.o.now().toISOString() };
  }

  // ---- across a restart -----------------------------------------------------------------------------------------------

  private persistSoon(): void {
    if (this.persisting) return;
    this.persisting = true;
    setImmediate(() => {
      this.persisting = false;
      this.persist();
    });
  }

  persist(): void {
    try {
      mkdirSync(join(this.o.config.allocatorServer.stateDir, "runtime-security"), { recursive: true, mode: 0o700 });
      writeFileSync(`${this.recordsFile}.tmp`, JSON.stringify(this.service.exportRecords()), { mode: 0o600 });
      renameSync(`${this.recordsFile}.tmp`, this.recordsFile);
    } catch (err) {
      // After a restart an enforced attempt with no record is contained either way (containUnrecorded); said, never hidden.
      this.log(`runtime security: the protection records could not be written: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // At start: the records of the previous process, for the watchdog to prove again (or contain); those whose containers
  // are gone are released (their policies reaped).
  private readRecords(): PersistedRecord[] | null {
    try {
      return JSON.parse(readFileSync(this.recordsFile, "utf8")) as PersistedRecord[];
    } catch {
      return null;
    }
  }

  async restore(): Promise<number> {
    const records = this.readRecords() ?? [];
    this.service.restore(records);
    let kept = 0;
    for (const r of records) {
      const alive = await Promise.all(r.req.planes.map((p) => this.o.engine.containerInspect(p.containerId).catch(() => null)));
      if (alive.some((c) => c === null)) await this.service.release(r.req.dispatchKey);
      else kept += 1;
    }
    await this.containUnrecorded();
    this.persist();
    return kept;
  }

  // An attempt whose planes run under enforce (their labels say so: written by this allocator at creation) but whose
  // protection record is gone -- a write that failed, a crash before it landed -- cannot be proven again from anything
  // this process holds: both its planes are stopped, never left running unprotected. An observed one is left to run:
  // observation is never containment.
  private async containUnrecorded(): Promise<number> {
    const known = new Set(this.service.exportRecords().map((r) => r.req.dispatchKey));
    let stopped = 0;
    for (const c of await this.o.engine.containerList({ [LABELS.managed]: "1", [SECURITY_LABELS.mode]: "enforce" })) {
      const key = c.Labels[LABELS.dispatchKey];
      if (key === undefined || known.has(key) || c.State !== "running") continue;
      await this.o.engine.containerStop(c.Id, 0);
      stopped += 1;
      this.log(`runtime security: ${c.Names[0] ?? c.Id.slice(0, 12)} of ${key} ran under enforce with no protection record after a restart: stopped`);
    }
    return stopped;
  }

  // At a start: what the previous process protected is restored for the watchdog to prove again, an enforced attempt
  // with no record is contained, and the loops run -- whatever the restore met.
  async begin(): Promise<number | null> {
    let kept: number | null = null;
    try {
      kept = await this.restore();
    } catch (err) {
      this.log(`runtime security: the previous process's attempts could not be restored (${err instanceof Error ? err.message : String(err)}); the watchdog runs anyway`);
    }
    this.start();
    return kept;
  }

  get running(): boolean {
    return this.timers.length > 0;
  }

  // ---- the loops ------------------------------------------------------------------------------------------------------

  start(): void {
    if (!this.enabled || this.timers.length > 0) return;
    const every = (ms: number, fn: () => Promise<unknown> | unknown) => {
      const t = setInterval(() => void Promise.resolve().then(fn).catch(() => undefined), ms);
      t.unref();
      this.timers.push(t);
    };
    every(500, () => this.service.ingest());
    every(5_000, async () => {
      if (this.busy.watch) return;
      this.busy.watch = true;
      try {
        await this.service.watch();
      } finally {
        this.busy.watch = false;
      }
    });
    every(30_000, async () => {
      if (this.busy.canary) return;
      this.busy.canary = true;
      try {
        await this.proveCanary(false);
      } finally {
        this.busy.canary = false;
      }
    });
    void this.proveCanary(false).catch(() => undefined);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  get canaryState(): string {
    return this.canaryDetail;
  }
}
