// THE ALLOCATOR (ADR 0067): the one process that holds the container runtime's socket, and what it does with it -- only
// the typed operations of the protocol (contexts/execution/infrastructure/sandbox/allocator-protocol.ts), each checked
// whole first, each worked out from ids: which containers, from which fixed image, with which fixed mounts, on which
// network, with which limits. It never takes a host path, an image, a mount, a privilege or a capability from a caller.
//
// Idempotent by ids: an employee's areas are made once (and their quotas re-applied); an attempt's two containers have
// names derived from its dispatch key, so a second start finds the first and a restarted Orbit Web finds them again.
// Operations on one employee, and on one attempt, are serialized.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { constants as osConstants } from "node:os";
import type { EnforcementLevel, StorageArea, UsageView } from "@orbit-web/contracts";
import type { SandboxConfig } from "../config/sandbox-config.js";
import type { AreaState, AttemptEvidence, ExecRequest, ExecResult, FileEntry, HostCapabilities, ProvisionResult, SandboxIds } from "../contexts/execution/application/sandbox.port.js";
import {
  AllocatorError,
  checkAttemptSpec,
  checkAttestSpec,
  checkExecRequest,
  checkProbes,
  checkQuotas,
  checkSandboxIds,
  checkToolPath,
  intIn,
  MAX_FILE_BYTES,
  type AllocatorApi,
  type AllocatorAttemptSpec,
  type AttemptRecord,
  type AttemptStatusRecord,
  type AttestRequest,
  type PublishResult,
} from "../contexts/execution/infrastructure/sandbox/allocator-protocol.js";
import { assignmentDir, attemptLabels, attemptNetworks, cacheArea, checkDispatchKey, checkId, connectionSubpath, deskArea, LABELS, planeNames, runnerToken, sandboxMeta, SCRATCH_DIRS, scratchArea, subnetBlocks, teamArea, workspaceMeta, type EmployeeIds } from "../contexts/execution/infrastructure/sandbox/ids.js";
import { MODEL_PLANE, TOOL_PLANE } from "../contexts/execution/infrastructure/sandbox/layout.js";
import { storageAdmits, tmpSizeMiB, type AreaLevel } from "../contexts/execution/infrastructure/sandbox/storage-policy.js";
import { check, hardeningProblems, mountProblems, mountRootProblems, parseMountInfo, type Check } from "./attest-checks.js";
import { cgroupUsage, limitsMatch, observedLimits, parseReading, type CgroupReading } from "./cgroup.js";
import { execIn, failure, text, type ExecOutcome } from "./containers.js";
import { DockerEngine, DockerError, type ContainerInspect, type NetworkInspect as NetworkInfo } from "./docker/engine.js";
import { attestProbeScript, cgroupScript, modelPlaneScript, nodeScript, syncScript, toolFileScript, writeTestScript, type AttestProbeConfig } from "./scripts/node-scripts.js";
import { limitsProbeBody, MiB, MODEL_PLANE_PIDS, MODEL_PLANE_TMPFS, modelPlaneBody, modelPlaneMounts, PROBE_LIMITS, toolPlaneBody, toolPlaneMounts, type VolumeMount } from "./specs.js";
import { WorkforceStorage, type StorageState } from "./storage.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

interface SandboxRecord {
  orbitId: string;
  employeeId: string;
  sandboxId: string;
  deskMiB: number;
  cacheMiB: number;
  state: "READY";
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DeskVersion {
  version: number;
  // The last publish (so a retry of it after a crash is answered, not refused).
  by: string | null;
  from: number | null;
  changed: string[];
}

interface WorkspaceRecord {
  assignmentId: string;
  seededFromDeskVersion: number;
  scratchMiB: number;
  createdAt: string;
}

const SIGNALS: Record<number, string> = Object.fromEntries(Object.entries(osConstants.signals).map(([name, n]) => [n, name]));

export interface AllocatorOptions {
  config: SandboxConfig;
  secret: string;
  engine?: DockerEngine;
  now?: () => Date;
}

export class Allocator implements AllocatorApi {
  readonly engine: DockerEngine;
  readonly storage: WorkforceStorage;
  private readonly config: SandboxConfig;
  private readonly secret: string;
  private readonly now: () => Date;
  private readonly locks = new KeyedMutex();
  private caps: HostCapabilities | null = null;
  private probing: Promise<HostCapabilities> | null = null;
  private readonly pidsPeaks = new Map<string, number>();

  constructor(o: AllocatorOptions) {
    this.config = o.config;
    this.secret = o.secret;
    this.engine = o.engine ?? new DockerEngine(o.config.allocatorServer.dockerSocket);
    this.now = o.now ?? (() => new Date());
    this.storage = new WorkforceStorage(this.engine, this.config, this.now);
  }

  private get prefix(): string {
    return this.config.names.prefix;
  }

  private iso(): string {
    return this.now().toISOString();
  }

  // ---- the probe -----------------------------------------------------------------------------------------------------

  probe(force = false): Promise<HostCapabilities> {
    if (!force && this.caps !== null) return Promise.resolve(this.caps);
    if (this.probing === null) {
      this.probing = this.probeNow(force).finally(() => {
        this.probing = null;
      });
    }
    return this.probing;
  }

  private async probeNow(force: boolean): Promise<HostCapabilities> {
    const probedAt = this.iso();
    if (!(await this.engine.ping())) {
      const why = `the container runtime does not answer on ${this.config.allocatorServer.dockerSocket}`;
      return { provider: "container", runtime: { reachable: false, version: null, cgroup: null, detail: why }, limits: { cpu: "UNSUPPORTED", memory: "UNSUPPORTED", pids: "UNSUPPORTED", evidence: why }, storage: { mechanism: "none", perArea: "UNSUPPORTED", hostProtection: "UNSUPPORTED", evidence: why, probedAt }, host: { cpuMillis: null, memoryMiB: null, storageMiB: null }, shellPossible: false, probedAt };
    }
    const [version, info] = await Promise.all([this.engine.version(), this.engine.info()]);
    const cgroup = info.CgroupVersion === "2" ? "v2" : info.CgroupVersion === "1" ? "v1" : null;
    const limits = await this.probeLimits().catch((err: unknown): HostCapabilities["limits"] => {
      const why = `the limits probe could not run: ${err instanceof Error ? err.message : String(err)}`.slice(0, 800);
      return { cpu: "UNSUPPORTED", memory: "UNSUPPORTED", pids: "UNSUPPORTED", evidence: why };
    });
    const st = await this.storage.ensure(force);
    const df = st.volume !== null ? await this.storage.capacity() : null;
    const storageMiB = df === null ? null : Math.floor((st.pool !== null ? df.sizeBytes : df.availableBytes) / MiB);
    const limitsHard = limits.cpu === "HARD_ENFORCED" && limits.memory === "HARD_ENFORCED" && limits.pids === "HARD_ENFORCED";
    const caps: HostCapabilities = {
      provider: "container",
      runtime: { reachable: true, version: version.Version, cgroup, detail: `Docker ${version.Version} (API ${version.ApiVersion}), cgroup ${info.CgroupVersion ?? "?"} (${info.CgroupDriver ?? "?"} driver), storage driver ${info.Driver}, kernel ${version.KernelVersion}` },
      limits,
      storage: { mechanism: st.mechanism, perArea: st.perArea, hostProtection: st.hostProtection, evidence: this.storageEvidence(st), probedAt: st.probedAt },
      host: { cpuMillis: info.NCPU * 1000, memoryMiB: Math.floor(info.MemTotal / MiB), storageMiB },
      shellPossible: limitsHard && (st.perArea === "HARD_ENFORCED" || st.hostProtection === "HARD_ENFORCED"),
      probedAt,
    };
    this.caps = caps;
    this.remember(caps);
    return caps;
  }

  private storageEvidence(st: StorageState): string {
    const tried = st.candidates.map((c) => `${c.mechanism}: ${c.outcome} (${c.evidence})`).join("; ");
    return `${st.areaEvidence}. Host disk: ${st.hostEvidence}.${tried ? ` Candidates in order: ${tried}.` : ""}`;
  }

  private remember(caps: HostCapabilities): void {
    try {
      mkdirSync(this.config.allocatorServer.stateDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(this.config.allocatorServer.stateDir, "probe.json"), `${JSON.stringify(caps, null, 2)}\n`, { mode: 0o600 });
    } catch {
      // A record for the operator only: the probe's answer stands without it.
    }
  }

  // CPU, memory and PID limits as the kernel applies them here: a probe container with small limits, read back.
  private async probeLimits(): Promise<HostCapabilities["limits"]> {
    if ((await this.engine.imageInspect(this.config.images.workstation)) === null) {
      const why = `no workstation image ${this.config.images.workstation} to probe the limits with`;
      return { cpu: "UNSUPPORTED", memory: "UNSUPPORTED", pids: "UNSUPPORTED", evidence: why };
    }
    const name = `${this.prefix}-limits-probe-${Date.now().toString(36)}`;
    const created = await this.engine.containerCreate(name, limitsProbeBody({ image: this.config.images.workstation, prefix: this.prefix }));
    if (created === null) return { cpu: "UNSUPPORTED", memory: "UNSUPPORTED", pids: "UNSUPPORTED", evidence: `${name} already exists` };
    try {
      await this.engine.containerStart(created.id);
      const reading = await this.readCgroup(created.id, `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`);
      const inspect = await this.engine.containerInspect(created.id);
      if (reading === null || inspect === null) return { cpu: "UNSUPPORTED", memory: "UNSUPPORTED", pids: "UNSUPPORTED", evidence: "the probe container's cgroup could not be read" };
      const o = observedLimits(reading);
      const level = (ok: boolean): EnforcementLevel => (ok ? "HARD_ENFORCED" : "UNSUPPORTED");
      return {
        cpu: level(o.cpuMillis !== null && Math.abs(o.cpuMillis - PROBE_LIMITS.cpuMillis) <= 1),
        memory: level(o.memoryBytes === PROBE_LIMITS.memoryMiB * MiB),
        pids: level(o.pids === PROBE_LIMITS.pidsLimit),
        evidence: `applied NanoCpus=${inspect.HostConfig.NanoCpus} Memory=${inspect.HostConfig.Memory} PidsLimit=${inspect.HostConfig.PidsLimit ?? "none"}; the kernel's cgroup ${reading.version} files show cpu ${o.cpuQuota ?? "?"}, memory ${o.memoryLimit ?? "?"}, pids ${o.pidsMax ?? "?"} (asked ${PROBE_LIMITS.cpuMillis}m, ${PROBE_LIMITS.memoryMiB} MiB, ${PROBE_LIMITS.pidsLimit})`,
      };
    } finally {
      await this.engine.containerRemove(created.id, true).catch(() => undefined);
    }
  }

  private async readCgroup(containerId: string, user: string): Promise<CgroupReading | null> {
    const r = await execIn(this.engine, containerId, ["node", "-e", nodeScript(cgroupScript)], { user, timeoutMs: 30_000, maxOutputBytes: 256 * 1024 });
    return r.code === 0 ? parseReading(text(r.stdout)) : null;
  }

  private async ready(): Promise<StorageState & { volume: string }> {
    const st = await this.storage.ensure();
    if (st.volume === null) throw new AllocatorError("unavailable", `no workforce storage: ${st.areaEvidence}`);
    return st as StorageState & { volume: string };
  }

  // ---- the Personal Sandbox --------------------------------------------------------------------------------------------

  private async sandboxRecord(ids: EmployeeIds): Promise<SandboxRecord | null> {
    const raw = await this.storage.get(sandboxMeta(ids));
    return raw === null ? null : (JSON.parse(raw.toString("utf8")) as SandboxRecord);
  }

  private async deskVersion(ids: EmployeeIds): Promise<DeskVersion> {
    const raw = await this.storage.get(`${deskArea(ids)}/version`);
    return raw === null ? { version: 0, by: null, from: null, changed: [] } : (JSON.parse(raw.toString("utf8")) as DeskVersion);
  }

  private areaState(st: StorageState, area: StorageArea, quotaMiB: number, usage: { usedBytes: number; limitBytes: number } | null): AreaState {
    const usedMiB = usage === null ? null : Math.round((usage.usedBytes / MiB) * 100) / 100;
    if (st.perArea === "HARD_ENFORCED") {
      const exact = usage !== null && usage.limitBytes === quotaMiB * MiB;
      return { area, quotaMiB, usedMiB, level: exact ? "HARD_ENFORCED" : "UNSUPPORTED", evidence: exact ? `${st.areaEvidence}; this area's limit, read back: ${usage.limitBytes} bytes` : `the limit read back (${usage?.limitBytes ?? "none"} bytes) is not the ${quotaMiB} MiB set` };
    }
    return { area, quotaMiB, usedMiB, level: st.perArea, evidence: st.areaEvidence };
  }

  private employeeContainers(ids: EmployeeIds) {
    return this.engine.containerList({ [LABELS.prefix]: this.prefix, [LABELS.account]: ids.orbitId, [LABELS.employee]: ids.employeeId });
  }

  async provisionEmployee(idsIn: SandboxIds, quotasIn: { deskMiB: number; cacheMiB: number }): Promise<ProvisionResult> {
    const ids = checkSandboxIds(idsIn);
    const quotas = checkQuotas(quotasIn);
    return this.locks.run(`employee:${ids.orbitId}/${ids.employeeId}`, async () => {
      const st = await this.storage.ensure();
      if (st.volume === null) return { state: "FAILED", areas: [], reason: `no workforce storage: ${st.areaEvidence}` };
      try {
        const existing = await this.sandboxRecord(ids);
        if (existing !== null && existing.sandboxId !== ids.sandboxId) return { state: "FAILED", areas: [], reason: `this employee's sandbox is ${existing.sandboxId}, not ${ids.sandboxId}` };
        if (existing?.archived) return { state: "FAILED", areas: [], reason: "the employee is archived: its sandbox is frozen" };
        const desk = deskArea(ids);
        await this.storage.ensureArea(desk, quotas.deskMiB * MiB, "root", "0755");
        if (existing === null) {
          await this.storage.ensureDir(`${desk}/files`, "employee", "0700");
          for (const d of ["toolbox", "toolbox/skills", "toolbox/scripts"]) await this.storage.ensureDir(`${desk}/files/${d}`, "employee", "0755");
          if ((await this.storage.get(`${desk}/version`)) === null) await this.storage.put(`${desk}/version`, Buffer.from(JSON.stringify({ version: 0, by: null, from: null, changed: [] } satisfies DeskVersion)));
        }
        if (quotas.cacheMiB > 0) await this.storage.ensureArea(cacheArea(ids), quotas.cacheMiB * MiB, "employee", "0700");
        // A write in each area, as the employee.
        const mounts: VolumeMount[] = [{ volume: st.volume, subpath: `${desk}/files`, target: "/desk", readOnly: false }, ...(quotas.cacheMiB > 0 ? [{ volume: st.volume, subpath: cacheArea(ids), target: "/cache", readOnly: false }] : [])];
        const w = await this.storage.worker(mounts, ["node", "-e", nodeScript(writeTestScript), ...mounts.map((m) => m.target)]);
        if (w.code !== 0) return { state: "FAILED", areas: [], reason: failure("the write test", w) };
        const tests = JSON.parse(text(w.stdout)) as { dir: string; ok: boolean; code: string | null }[];
        const failed = tests.filter((t) => !t.ok);
        if (failed.length > 0) return { state: "FAILED", areas: [], reason: `the write test failed in ${failed.map((t) => `${t.dir} (${t.code ?? "read back differs"})`).join(", ")}` };
        const areas: AreaState[] = [this.areaState(st, "desk", quotas.deskMiB, await this.storage.usage(desk))];
        if (quotas.cacheMiB > 0) areas.push(this.areaState(st, "cache", quotas.cacheMiB, await this.storage.usage(cacheArea(ids))));
        const at = this.iso();
        const record: SandboxRecord = { ...ids, deskMiB: quotas.deskMiB, cacheMiB: quotas.cacheMiB, state: "READY", archived: false, createdAt: existing?.createdAt ?? at, updatedAt: at };
        await this.storage.put(sandboxMeta(ids), Buffer.from(JSON.stringify(record)));
        const back = await this.sandboxRecord(ids);
        if (back?.orbitId !== ids.orbitId || back.employeeId !== ids.employeeId || back.sandboxId !== ids.sandboxId) return { state: "FAILED", areas, reason: "the sandbox's labels did not read back as written" };
        const unproven = areas.filter((a) => a.level === "UNSUPPORTED" && st.perArea === "HARD_ENFORCED");
        if (unproven.length > 0) return { state: "FAILED", areas, reason: unproven.map((a) => `${a.area}: ${a.evidence}`).join("; ") };
        const running = (await this.employeeContainers(ids)).filter((c) => c.State === "running" && (c.Labels[LABELS.role] === "tool-plane" || c.Labels[LABELS.role] === "model-plane"));
        if (running.length > 0) return { state: "FAILED", areas, reason: `an attempt of this employee is running (${running.length} container(s)): a sandbox is READY only with none` };
        return { state: "READY", areas, reason: null };
      } catch (err) {
        return { state: "FAILED", areas: [], reason: err instanceof Error ? err.message.slice(0, 800) : String(err) };
      }
    });
  }

  async archiveEmployee(idsIn: SandboxIds): Promise<void> {
    const ids = checkSandboxIds(idsIn);
    await this.locks.run(`employee:${ids.orbitId}/${ids.employeeId}`, async () => {
      await this.ready();
      const record = await this.sandboxRecord(ids);
      if (record === null || record.sandboxId !== ids.sandboxId) throw new AllocatorError("not_found", "no such sandbox");
      await this.storage.put(sandboxMeta(ids), Buffer.from(JSON.stringify({ ...record, archived: true, updatedAt: this.iso() } satisfies SandboxRecord)));
      await this.storage.freeze(deskArea(ids));
      if (record.cacheMiB > 0) await this.storage.freeze(cacheArea(ids));
    });
  }

  async measure(idsIn: SandboxIds): Promise<AreaState[]> {
    const ids = checkSandboxIds(idsIn);
    const st = await this.ready();
    const record = await this.sandboxRecord(ids);
    if (record === null || record.sandboxId !== ids.sandboxId) throw new AllocatorError("not_found", "no such sandbox");
    const areas = [this.areaState(st, "desk", record.deskMiB, await this.storage.usage(deskArea(ids)))];
    if (record.cacheMiB > 0) areas.push(this.areaState(st, "cache", record.cacheMiB, await this.storage.usage(cacheArea(ids))));
    return areas;
  }

  private async readySandbox(ids: EmployeeIds): Promise<SandboxRecord> {
    const record = await this.sandboxRecord(ids);
    if (record === null || record.sandboxId !== ids.sandboxId) throw new AllocatorError("conflict", "the employee's sandbox is not READY (it was never provisioned)");
    if (record.archived) throw new AllocatorError("conflict", "the employee is archived: its sandbox is frozen");
    return record;
  }

  // ---- an assignment's workspace -----------------------------------------------------------------------------------

  async prepareWorkspace(idsIn: SandboxIds, assignmentIdIn: string, scratchMiBIn: number): Promise<AreaState> {
    const ids = checkSandboxIds(idsIn);
    const assignmentId = checkId(assignmentIdIn, "assignmentId");
    const scratchMiB = intIn(scratchMiBIn, 16, 4 * 1024 * 1024, "scratchMiB");
    return this.locks.run(`employee:${ids.orbitId}/${ids.employeeId}`, async () => {
      const st = await this.ready();
      await this.readySandbox(ids);
      const scratch = scratchArea(ids, assignmentId);
      await this.storage.ensureArea(scratch, scratchMiB * MiB, "root", "0755");
      for (const d of SCRATCH_DIRS) await this.storage.ensureDir(`${scratch}/${d}`, "employee", "0700");
      const metaPath = workspaceMeta(ids, assignmentId);
      const raw = await this.storage.get(metaPath);
      const existing = raw === null ? null : (JSON.parse(raw.toString("utf8")) as WorkspaceRecord);
      if (existing === null) {
        const desk = await this.deskVersion(ids);
        const r = await this.storage.worker(
          [
            { volume: st.volume, subpath: `${deskArea(ids)}/files`, target: "/src", readOnly: true },
            { volume: st.volume, subpath: `${scratch}/work`, target: "/dst", readOnly: false },
          ],
          ["node", "-e", nodeScript(syncScript), "seed", "/src", "/dst"],
        );
        if (r.code === 7) throw new AllocatorError("conflict", `the desk does not fit in the ${scratchMiB} MiB scratch quota`);
        if (r.code !== 0) throw new Error(failure("seeding the workspace from the desk", r));
        await this.storage.put(metaPath, Buffer.from(JSON.stringify({ assignmentId, seededFromDeskVersion: desk.version, scratchMiB, createdAt: this.iso() } satisfies WorkspaceRecord)));
      } else if (existing.scratchMiB !== scratchMiB) {
        await this.storage.put(metaPath, Buffer.from(JSON.stringify({ ...existing, scratchMiB })));
      }
      return this.areaState(st, "scratch", scratchMiB, await this.storage.usage(scratch));
    });
  }

  async publishWorkspace(idsIn: SandboxIds, assignmentIdIn: string, expectedIn: number): Promise<PublishResult> {
    const ids = checkSandboxIds(idsIn);
    const assignmentId = checkId(assignmentIdIn, "assignmentId");
    const expected = intIn(expectedIn, 0, Number.MAX_SAFE_INTEGER, "expectedDeskVersion");
    return this.locks.run(`employee:${ids.orbitId}/${ids.employeeId}`, async () => {
      const st = await this.ready();
      const record = await this.readySandbox(ids);
      const desk = await this.deskVersion(ids);
      // This very assignment produced the desk's version (a retry after a crash between this publish and its record): the
      // answer it had, never a second publish or a refusal.
      if (desk.by === assignmentId) return { published: true, deskVersion: desk.version, changed: desk.changed, reason: null };
      if (desk.version !== expected) return { published: false, deskVersion: desk.version, changed: [], reason: `the desk is at version ${desk.version}, not ${expected}: it changed after this assignment's workspace was prepared` };
      if ((await this.storage.get(workspaceMeta(ids, assignmentId))) === null) return { published: false, deskVersion: desk.version, changed: [], reason: "this assignment has no workspace" };
      const r = await this.storage.worker(
        [
          { volume: st.volume, subpath: `${scratchArea(ids, assignmentId)}/work`, target: "/src", readOnly: true },
          { volume: st.volume, subpath: `${deskArea(ids)}/files`, target: "/dst", readOnly: false },
        ],
        ["node", "-e", nodeScript(syncScript), "publish", "/src", "/dst"],
      );
      if (r.code === 7) return { published: false, deskVersion: desk.version, changed: [], reason: `the desk's quota (${record.deskMiB} MiB) cannot hold the work tree: nothing was published` };
      if (r.code !== 0) throw new Error(failure("publishing the workspace to the desk", r));
      const changed = (JSON.parse(text(r.stdout)) as { changed: string[] }).changed;
      const next: DeskVersion = { version: desk.version + 1, by: assignmentId, from: expected, changed };
      await this.storage.put(`${deskArea(ids)}/version`, Buffer.from(JSON.stringify(next)));
      return { published: true, deskVersion: next.version, changed, reason: null };
    });
  }

  async removeWorkspace(idsIn: SandboxIds, assignmentIdIn: string): Promise<{ gone: boolean; detail: string }> {
    const ids = checkSandboxIds(idsIn);
    const assignmentId = checkId(assignmentIdIn, "assignmentId");
    return this.locks.run(`employee:${ids.orbitId}/${ids.employeeId}`, async () => {
      await this.ready();
      const left = await this.engine.containerList({ [LABELS.prefix]: this.prefix, [LABELS.account]: ids.orbitId, [LABELS.assignment]: assignmentId });
      const planes = left.filter((c) => c.Labels[LABELS.role] === "tool-plane" || c.Labels[LABELS.role] === "model-plane");
      if (planes.length > 0) return { gone: false, detail: `${planes.length} container(s) of an attempt of this assignment still exist: remove the attempt first` };
      await this.storage.removeArea(scratchArea(ids, assignmentId));
      await this.storage.removeDir(assignmentDir(ids, assignmentId));
      const still = (await this.storage.get(workspaceMeta(ids, assignmentId))) !== null || (await this.storage.usage(scratchArea(ids, assignmentId))) !== null;
      return still ? { gone: false, detail: "the workspace is still there after its removal" } : { gone: true, detail: "the scratch area and its record are gone (read back)" };
    });
  }

  // ---- an attempt ----------------------------------------------------------------------------------------------------

  private async planes(dispatchKey: string): Promise<{ tool: ContainerInspect | null; model: ContainerInspect | null }> {
    const names = planeNames(this.prefix, dispatchKey);
    const [tool, model] = await Promise.all([this.engine.containerInspect(names.tool), this.engine.containerInspect(names.model)]);
    for (const c of [tool, model]) if (c !== null && c.Config.Labels?.[LABELS.dispatchKey] !== dispatchKey) throw new AllocatorError("conflict", `${c.Name} does not belong to this dispatch key`);
    return { tool, model };
  }

  // The attempt's own two networks, as the runtime knows them (each labelled with its dispatch key).
  private async networksOf(dispatchKey: string): Promise<{ tool: NetworkInfo | null; model: NetworkInfo | null }> {
    const names = attemptNetworks(this.prefix, dispatchKey);
    const [tool, model] = await Promise.all([this.engine.networkInspect(names.tool), this.engine.networkInspect(names.model)]);
    for (const n of [tool, model]) if (n !== null && n.Labels?.[LABELS.dispatchKey] !== dispatchKey) throw new AllocatorError("conflict", `${n.Name} does not belong to this dispatch key`);
    return { tool, model };
  }

  // One plane's own internal network: made once (from ORBIT_WEB_ATTEMPT_SUBNETS when the operator gave ranges), labelled
  // as its attempt, and joined by Orbit Web's container (the proxies, the tool endpoint) under the name attempts use.
  private async attemptNetwork(name: string, labels: Record<string, string>, dispatchKey: string): Promise<void> {
    let net = await this.engine.networkInspect(name);
    if (net === null) {
      await this.createNetwork(name, labels);
      net = await this.engine.networkInspect(name);
    }
    if (net === null) throw new Error(`the network ${name} vanished while it was being made`);
    if (net.Labels?.[LABELS.dispatchKey] !== dispatchKey) throw new AllocatorError("conflict", `${name} does not belong to this dispatch key`);
    if (!net.Internal) throw new AllocatorError("conflict", `${name} is not internal: an attempt there could reach the internet directly`);
    if (this.config.control.container !== null) await this.engine.networkConnect(name, this.config.control.container, [this.config.control.alias]);
  }

  private async createNetwork(name: string, labels: Record<string, string>): Promise<void> {
    const exhausted = (err: unknown) => (err instanceof DockerError && /address pools|fully subnetted|no available/i.test(err.reason) ? new AllocatorError("unavailable", `the container runtime has no address space left for another attempt's network (${err.reason}): set ORBIT_WEB_ATTEMPT_SUBNETS, or Docker's default-address-pools`) : err);
    if (this.config.attemptSubnets.length === 0) {
      await this.engine.networkCreate({ Name: name, Internal: true, Labels: labels }).catch((err: unknown) => Promise.reject(exhausted(err)));
      return;
    }
    const used = new Set((await this.engine.networkList({ [LABELS.prefix]: this.prefix })).flatMap((n) => (n.IPAM.Config ?? []).map((c) => c.Subnet)));
    for (const subnet of subnetBlocks(this.config.attemptSubnets)) {
      if (used.has(subnet)) continue;
      try {
        await this.engine.networkCreate({ Name: name, Internal: true, Labels: labels, IPAM: { Config: [{ Subnet: subnet }] } });
        return;
      } catch (err) {
        if (err instanceof DockerError && /overlap/i.test(err.reason)) continue;
        throw err;
      }
    }
    throw new AllocatorError("unavailable", `no /28 is free in ORBIT_WEB_ATTEMPT_SUBNETS (${this.config.attemptSubnets.join(", ")}) for another attempt's network`);
  }

  // Each network holds its plane and Orbit Web's container, and nothing else.
  private async networkProblems(dispatchKey: string, toolId: string, modelId: string): Promise<string[]> {
    const names = attemptNetworks(this.prefix, dispatchKey);
    const control = this.config.control.container === null ? null : await this.engine.containerInspect(this.config.control.container);
    const problems: string[] = [];
    for (const [name, own] of [[names.tool, toolId], [names.model, modelId]] as const) {
      const net = await this.engine.networkInspect(name);
      if (net === null) {
        problems.push(`${name} does not exist`);
        continue;
      }
      if (!net.Internal) problems.push(`${name} is not internal`);
      const members = Object.keys(net.Containers ?? {});
      const allowed = new Set([own, ...(control !== null ? [control.Id] : [])]);
      const strangers = members.filter((m) => !allowed.has(m));
      if (strangers.length > 0) problems.push(`${name} has other members: ${strangers.map((id) => net.Containers?.[id]?.Name ?? id).join(", ")}`);
      if (!members.includes(own)) problems.push(`${name} does not hold its plane`);
    }
    return problems;
  }

  private record(dispatchKey: string, runId: string, tool: ContainerInspect | null, model: ContainerInspect | null): AttemptRecord {
    const ip = model?.NetworkSettings.Networks?.[attemptNetworks(this.prefix, dispatchKey).model]?.IPAddress || null;
    return {
      dispatchKey,
      runId,
      toolPlane: tool === null ? null : { id: tool.Id, name: tool.Name.replace(/^\//, "") },
      modelPlane: model === null ? null : { id: model.Id, name: model.Name.replace(/^\//, ""), ip, port: MODEL_PLANE.runnerPort },
      createdAt: tool?.Created ?? model?.Created ?? this.iso(),
      modelPlaneHome: MODEL_PLANE.home,
      modelPlaneCwd: MODEL_PLANE.cwd,
      bridgeCommand: { command: MODEL_PLANE.bridgeCommand.command, args: [...MODEL_PLANE.bridgeCommand.args] },
    };
  }

  // What an attempt's containers rely on must be what the operator meant: Orbit Web's container (it joins the attempt's
  // networks: the proxies, the tool endpoint), and Orbit Web's data volume (the runtime would otherwise make an empty one
  // silently).
  private async placesHold(): Promise<void> {
    const control = this.config.control.container;
    if (control !== null && (await this.engine.containerInspect(control)) === null) throw new AllocatorError("conflict", `Orbit Web's container ${control} does not exist (ORBIT_WEB_CONTROL_CONTAINER)`);
    if ((await this.engine.volumeInspect(this.config.names.dataVolume)) === null) throw new AllocatorError("conflict", `Orbit Web's data volume ${this.config.names.dataVolume} does not exist (ORBIT_WEB_DATA_VOLUME)`);
  }

  private sameAttempt(c: ContainerInspect, s: AllocatorAttemptSpec): boolean {
    const l = c.Config.Labels ?? {};
    return l[LABELS.account] === s.orbitId && l[LABELS.employee] === s.employeeId && l[LABELS.run] === s.runId && l[LABELS.assignment] === s.assignmentId && l[LABELS.sandbox] === s.sandboxId;
  }

  async startAttempt(specIn: AllocatorAttemptSpec): Promise<AttemptRecord> {
    const s = checkAttemptSpec(specIn);
    return this.locks.run(`attempt:${s.dispatchKey}`, async () => {
      const st = await this.ready();
      const names = planeNames(this.prefix, s.dispatchKey);
      let { tool, model } = await this.planes(s.dispatchKey);
      for (const c of [tool, model]) if (c !== null && !this.sameAttempt(c, s)) throw new AllocatorError("conflict", `the dispatch key ${s.dispatchKey} belongs to another run`);
      if (tool === null || model === null) await this.placesHold();
      // Each plane's own network first, Orbit Web's container connected to both (made once; a retry finds them).
      const nets = attemptNetworks(this.prefix, s.dispatchKey);
      await this.attemptNetwork(nets.tool, attemptLabels(this.prefix, s, "tool-network"), s.dispatchKey);
      await this.attemptNetwork(nets.model, attemptLabels(this.prefix, s, "model-network"), s.dispatchKey);
      if (tool === null) {
        const record = await this.readySandbox(s);
        if ((await this.storage.get(workspaceMeta(s, s.assignmentId))) === null) throw new AllocatorError("conflict", "the assignment's workspace was not prepared");
        const scratch = scratchArea(s, s.assignmentId);
        const team = s.teamRoom === null ? null : teamArea(s.orbitId, s.teamRoom.id);
        if (team !== null && s.teamRoom !== null) await this.storage.ensureArea(team, s.teamRoom.quotaMiB * MiB, "employee", "0700");
        const inputs = await this.storage.worker([{ volume: st.volume, subpath: `${scratch}/input`, target: "/dst", readOnly: false }], ["node", "-e", nodeScript(syncScript), "inputs", "/dst"], Buffer.from(JSON.stringify(s.inputs)));
        if (inputs.code !== 0) throw new Error(failure("materializing the inputs", inputs));
        const body = toolPlaneBody({ image: this.config.images.workstation, network: nets.tool, workforceVolume: st.volume, labels: attemptLabels(this.prefix, s, "tool-plane"), areas: { scratch, cache: record.cacheMiB > 0 ? cacheArea(s) : null, team }, resources: s.resources, egress: s.egress });
        await this.engine.containerCreate(names.tool, body);
        tool = await this.engine.containerInspect(names.tool);
      }
      if (model === null) {
        const body = modelPlaneBody({ image: this.config.images.modelPlane, network: nets.model, dataVolume: this.config.names.dataVolume, connectionSubpath: connectionSubpath(s.orbitId, s.modelPlane.connectionHome), labels: attemptLabels(this.prefix, s, "model-plane"), cpuMillis: s.modelPlane.cpuMillis, memoryMiB: s.modelPlane.memoryMiB, runnerToken: runnerToken(this.secret, s.dispatchKey), env: s.modelPlane.env });
        await this.engine.containerCreate(names.model, body);
        model = await this.engine.containerInspect(names.model);
      }
      if (tool === null || model === null) throw new Error("an attempt's container vanished while it was being made");
      for (const c of [tool, model]) if (!this.sameAttempt(c, s)) throw new AllocatorError("conflict", `the dispatch key ${s.dispatchKey} belongs to another run`);
      try {
        await Promise.all([tool.State.Running ? null : this.engine.containerStart(tool.Id), model.State.Running ? null : this.engine.containerStart(model.Id)]);
      } catch (err) {
        if (err instanceof DockerError) throw new AllocatorError("conflict", `the attempt could not start: ${err.reason}`);
        throw err;
      }
      await this.waitForRunner(model.Id);
      const after = await this.planes(s.dispatchKey);
      return this.record(s.dispatchKey, s.runId, after.tool, after.model);
    });
  }

  private async waitForRunner(modelId: string): Promise<void> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const r = await execIn(this.engine, modelId, ["node", "-e", nodeScript(modelPlaneScript), "ready", String(MODEL_PLANE.runnerPort)], { user: `${MODEL_PLANE.uid}:${MODEL_PLANE.gid}`, timeoutMs: 10_000, maxOutputBytes: 4096 }).catch(() => null);
      if (r?.code === 0) return;
      if (Date.now() > deadline) {
        const logs = await this.engine.containerLogs(modelId, 20).catch(() => null);
        throw new AllocatorError("conflict", `the model plane's runner did not start listening${logs ? `: ${text(logs.stderr) || text(logs.stdout)}` : ""}`.slice(0, 800));
      }
      await sleep(150);
    }
  }

  async findAttempt(dispatchKeyIn: string): Promise<AttemptStatusRecord | null> {
    const dispatchKey = checkDispatchKey(dispatchKeyIn);
    const { tool, model } = await this.planes(dispatchKey);
    // Networks left without their containers (a crash between the two) are still an attempt: found, so that its
    // removal takes them away.
    const nets = await this.networksOf(dispatchKey);
    if (tool === null && model === null && nets.tool === null && nets.model === null) return null;
    const runId = (tool ?? model)?.Config.Labels?.[LABELS.run] ?? nets.tool?.Labels?.[LABELS.run] ?? nets.model?.Labels?.[LABELS.run] ?? "";
    return { ...this.record(dispatchKey, runId, tool, model), toolPlaneRunning: tool?.State.Running === true, modelPlaneRunning: model?.State.Running === true, oomKilled: { toolPlane: tool?.State.OOMKilled === true, modelPlane: model?.State.OOMKilled === true } };
  }

  private async toolPlane(dispatchKey: string): Promise<ContainerInspect> {
    const { tool } = await this.planes(checkDispatchKey(dispatchKey));
    if (tool === null) throw new AllocatorError("not_found", "no such attempt");
    if (!tool.State.Running) throw new AllocatorError("conflict", `the attempt's tool plane is not running (${tool.State.Status})`);
    return tool;
  }

  // ---- the attestation -----------------------------------------------------------------------------------------------

  async attest(dispatchKeyIn: string, request: AttestRequest): Promise<AttemptEvidence> {
    const dispatchKey = checkDispatchKey(dispatchKeyIn);
    const spec = checkAttestSpec(request?.spec);
    const probes = checkProbes(request?.probes);
    if (spec.dispatchKey !== dispatchKey) throw new AllocatorError("bad_request", "the spec is of another attempt");
    const st = await this.ready();
    const checks: Check[] = [];
    const add = (c: Check) => checks.push(c);
    const { tool, model } = await this.planes(dispatchKey);
    const checkedAt = this.iso();
    add(check("tool_plane_running", tool?.State.Running ? [] : ["the tool plane is not running"], "the tool plane runs"));
    add(check("model_plane_running", model?.State.Running ? [] : ["the model plane is not running"], "the model plane runs"));
    if (tool === null || model === null || !tool.State.Running || !model.State.Running) return this.evidence(checks, null, null, checkedAt);
    const s = spec;
    const labels = tool.Config.Labels ?? {};
    add(check("attempt_identity", labels[LABELS.account] === s.orbitId && labels[LABELS.employee] === s.employeeId && labels[LABELS.run] === s.runId && labels[LABELS.assignment] === s.assignmentId ? [] : ["the containers are labelled for another account, employee, run or assignment"], "the containers are this attempt's (account, employee, run, assignment)"));
    // Applied: what the runtime was given, read back.
    const th = tool.HostConfig;
    const applied = { cpuMillis: th.NanoCpus / 1_000_000, memoryMiB: th.Memory / MiB, pidsLimit: th.PidsLimit, readBackAt: checkedAt };
    add(check("tool_plane_limits_applied", [...(applied.cpuMillis === s.resources.cpuMillis ? [] : [`NanoCpus ${th.NanoCpus}`]), ...(applied.memoryMiB === s.resources.memoryMiB && th.MemorySwap === th.Memory ? [] : [`Memory ${th.Memory} / MemorySwap ${th.MemorySwap}`]), ...(applied.pidsLimit === s.resources.pidsLimit ? [] : [`PidsLimit ${th.PidsLimit}`])], `the runtime holds ${applied.cpuMillis}m CPU, ${applied.memoryMiB} MiB (no swap), ${applied.pidsLimit} PIDs`));
    const mh = model.HostConfig;
    add(check("model_plane_limits_applied", mh.NanoCpus === s.modelPlane.cpuMillis * 1_000_000 && mh.Memory === s.modelPlane.memoryMiB * MiB && mh.MemorySwap === mh.Memory && mh.PidsLimit === MODEL_PLANE_PIDS ? [] : [`NanoCpus ${mh.NanoCpus}, Memory ${mh.Memory}, PidsLimit ${mh.PidsLimit}`], `the runtime holds ${s.modelPlane.cpuMillis}m CPU, ${s.modelPlane.memoryMiB} MiB, ${MODEL_PLANE_PIDS} PIDs`));
    // Hardening and mounts, from outside.
    const toolUser = `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`;
    const modelUser = `${MODEL_PLANE.uid}:${MODEL_PLANE.gid}`;
    const nets = attemptNetworks(this.prefix, dispatchKey);
    add(check("tool_plane_hardening", hardeningProblems(tool, toolUser, nets.tool), "no privilege or capability, read-only root, the employee's user, only its own network, nothing published"));
    add(check("model_plane_hardening", hardeningProblems(model, modelUser, nets.model), "no privilege or capability, read-only root, its own user, only its own network, nothing published"));
    add(check("attempt_networks", await this.networkProblems(dispatchKey, tool.Id, model.Id), `each plane alone on an internal network of its own${this.config.control.container !== null ? ` with Orbit Web's container (${this.config.control.container})` : ""}: no other attempt can reach either`));
    const record = await this.sandboxRecord(s);
    const toolMounts = toolPlaneMounts(st.volume, { scratch: scratchArea(s, s.assignmentId), cache: record !== null && record.cacheMiB > 0 ? cacheArea(s) : null, team: s.teamRoom === null ? null : teamArea(s.orbitId, s.teamRoom.id) });
    const modelMounts = modelPlaneMounts({ dataVolume: this.config.names.dataVolume, connectionSubpath: connectionSubpath(s.orbitId, s.modelPlane.connectionHome) });
    const requested = (c: ContainerInspect) => ((c.HostConfig as unknown as { Mounts?: { Target: string; Source: string; VolumeOptions?: { Subpath?: string } }[] }).Mounts ?? []);
    add(check("tool_plane_mounts", mountProblems(tool, toolMounts, [TOOL_PLANE.tmp], requested(tool)), `exactly its own areas (${toolMounts.map((m) => m.target).join(", ")}) and a tmpfs /tmp; no runtime socket`));
    add(check("model_plane_mounts", mountProblems(model, modelMounts, Object.keys(MODEL_PLANE_TMPFS(s.modelPlane.memoryMiB)), requested(model)), "exactly the connection's home and small tmpfs; no desk, scratch or room; no runtime socket"));
    // Observed: the kernel's own files.
    const toolCg = await this.readCgroup(tool.Id, toolUser);
    const modelCg = await this.readCgroup(model.Id, modelUser);
    const toolObserved = toolCg === null ? null : observedLimits(toolCg);
    add(check("tool_plane_limits_observed", toolObserved === null ? ["the cgroup could not be read"] : limitsMatch(toolObserved, s.resources), toolObserved === null ? "" : `the kernel (cgroup ${toolCg?.version}) enforces cpu ${toolObserved.cpuQuota}, memory ${toolObserved.memoryLimit}, pids ${toolObserved.pidsMax}`));
    const modelObserved = modelCg === null ? null : observedLimits(modelCg);
    add(check("model_plane_limits_observed", modelObserved === null ? ["the cgroup could not be read"] : limitsMatch(modelObserved, { cpuMillis: s.modelPlane.cpuMillis, memoryMiB: s.modelPlane.memoryMiB, pidsLimit: MODEL_PLANE_PIDS }), modelObserved === null ? "" : `the kernel enforces cpu ${modelObserved.cpuQuota}, memory ${modelObserved.memoryLimit}, pids ${modelObserved.pidsMax}`));
    const mountinfo = await execIn(this.engine, tool.Id, ["cat", "/proc/self/mountinfo"], { user: toolUser, timeoutMs: 15_000, maxOutputBytes: 1024 * 1024 });
    add(check("tool_plane_mount_roots", mountinfo.code === 0 ? mountRootProblems(parseMountInfo(text(mountinfo.stdout)), toolMounts) : ["/proc/self/mountinfo could not be read"], "inside, each mount holds exactly its area's directory (the kernel's mount table)"));
    const managed = await execIn(this.engine, model.Id, ["node", "-e", nodeScript(modelPlaneScript), "absent", MODEL_PLANE.managedSettings], { user: modelUser, timeoutMs: 15_000, maxOutputBytes: 4096 });
    const managedAbsent = managed.code === 0 && (JSON.parse(text(managed.stdout) || "{}") as { absent?: boolean }).absent === true;
    add(check("no_managed_settings", managedAbsent ? [] : [`${MODEL_PLANE.managedSettings} is present in the model plane (or could not be told apart)`], `${MODEL_PLANE.managedSettings} (Claude Code's managed settings) is not in the model plane`));
    // Canaries: one in this attempt's own connection home, one in another employee's desk.
    const credential = await this.plantInModelPlane(model.Id);
    const sibling = await this.plantInSiblingDesk(s);
    try {
      const modelIp = model.NetworkSettings.Networks?.[nets.model]?.IPAddress || null;
      const cfg: AttestProbeConfig = {
        absent: [
          { name: "no_docker_socket", path: "/var/run/docker.sock" },
          { name: "no_docker_socket_run", path: "/run/docker.sock" },
          { name: "no_connection_home", path: MODEL_PLANE.home },
        ],
        canaries: [
          ...(credential !== null ? [{ name: "credential_canary", nonce: credential.nonce, paths: this.canaryPaths(credential.name) }] : []),
          ...(sibling !== null ? [{ name: "sibling_desk_canary", nonce: sibling.nonce, paths: this.canaryPaths(sibling.name) }] : []),
        ],
        closed: [
          { name: "direct_egress", host: probes.egress.host, port: probes.egress.port, what: "the internet" },
          ...(probes.database !== null ? [{ name: "no_database", host: probes.database.host, port: probes.database.port, what: "the control plane's database" }] : []),
          ...(modelIp !== null ? [{ name: "no_model_plane", host: modelIp, port: MODEL_PLANE.runnerPort, what: "the model plane's runner" }] : []),
        ],
        dnsName: probes.dnsName,
        tmp: { path: `${TOOL_PLANE.tmp}/.orbit-tmp-probe`, limitBytes: tmpSizeMiB(s.resources.memoryMiB) * MiB },
      };
      if (credential === null) add(check("credential_canary", ["a marker could not be planted in the connection's home"], ""));
      if (sibling === null) add(check("sibling_desk_canary", ["a marker could not be planted in another desk"], ""));
      if (probes.database === null) add(check("no_database", ["Orbit Web did not say where its database is: the check cannot be made"], ""));
      if (modelIp === null) add(check("no_model_plane", ["the model plane has no address on the model network"], ""));
      const probe = await execIn(this.engine, tool.Id, ["node", "-e", nodeScript(attestProbeScript), JSON.stringify(cfg)], { user: toolUser, timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 });
      if (probe.code === 0) for (const c of (JSON.parse(text(probe.stdout)) as { checks: Check[] }).checks) add(c);
      else add(check("tool_plane_probe", [failure("the tool plane's own checks", probe)], ""));
    } finally {
      if (credential !== null) await execIn(this.engine, model.Id, ["node", "-e", nodeScript(modelPlaneScript), "unplant", `${MODEL_PLANE.home}/${credential.name}`], { user: modelUser, timeoutMs: 15_000, maxOutputBytes: 4096 }).catch(() => undefined);
      if (sibling !== null) await this.storage.unplant(sibling.path);
    }
    // Storage: every writable area of the tool plane, and the admission rule.
    const tmpHeld = checks.find((c) => c.name === "tmp_quota")?.ok === true;
    const areas: (AreaLevel & { evidence: string })[] = [
      { area: "scratch", level: st.perArea, evidence: st.areaEvidence },
      ...(record !== null && record.cacheMiB > 0 ? [{ area: "cache" as const, level: st.perArea, evidence: st.areaEvidence }] : []),
      ...(s.teamRoom !== null ? [{ area: "team" as const, level: st.perArea, evidence: st.areaEvidence }] : []),
      { area: "tmp", level: tmpHeld ? "HARD_ENFORCED" : "UNSUPPORTED", evidence: checks.find((c) => c.name === "tmp_quota")?.detail ?? "not checked" },
    ];
    const admitted = storageAdmits(areas, st.hostProtection, request.acceptSoftStorage === true);
    add({ name: "storage_enforcement", ok: admitted.ok, detail: admitted.detail });
    const observed = toolObserved === null ? null : { cpuQuota: toolObserved.cpuQuota, memoryLimit: toolObserved.memoryLimit, pidsMax: toolObserved.pidsMax, storage: areas.map((a) => ({ area: a.area, level: a.level, evidence: a.evidence })), at: this.iso() };
    return this.evidence(checks, applied, observed, checkedAt);
  }

  private evidence(checks: Check[], applied: AttemptEvidence["applied"], observed: AttemptEvidence["observed"], checkedAt: string): AttemptEvidence {
    const failed = checks.filter((c) => !c.ok);
    const held = failed.length === 0;
    return {
      attestation: {
        provider: "container",
        state: held ? "attested" : "failed",
        shell: held,
        detail: held ? `every check held (${checks.length}): the shell runs in this attempt's own container` : `the shell is refused -- ${failed.map((c) => c.name).join(", ")}: ${failed[0]?.detail ?? ""}`.slice(0, 1500),
        checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail || null })),
        checkedAt,
      },
      applied,
      observed,
    };
  }

  private canaryPaths(name: string): string[] {
    return [TOOL_PLANE.work, TOOL_PLANE.output, TOOL_PLANE.input, TOOL_PLANE.home, TOOL_PLANE.cache, TOOL_PLANE.team, TOOL_PLANE.tmp, "", MODEL_PLANE.home, "/data/connections", "/var/lib/orbit"].map((d) => `${d}/${name}`);
  }

  private async plantInModelPlane(modelId: string): Promise<{ name: string; nonce: string } | null> {
    const name = `.orbit-canary-${randomBytes(8).toString("hex")}`;
    const nonce = randomBytes(16).toString("hex");
    const r = await execIn(this.engine, modelId, ["node", "-e", nodeScript(modelPlaneScript), "plant", `${MODEL_PLANE.home}/${name}`, nonce], { user: `${MODEL_PLANE.uid}:${MODEL_PLANE.gid}`, timeoutMs: 15_000, maxOutputBytes: 4096 }).catch(() => null);
    return r?.code === 0 ? { name, nonce } : null;
  }

  // Another employee's desk -- of another account when there is one -- or, with no other employee, a desk-shaped area
  // of the allocator's own.
  private async plantInSiblingDesk(s: EmployeeIds): Promise<{ path: string; name: string; nonce: string } | null> {
    try {
      const own = `accounts/${s.orbitId}/employees/${s.employeeId}`;
      const others = (await this.storage.employees()).filter((e) => e !== own);
      const pick = others.find((e) => !e.startsWith(`accounts/${s.orbitId}/`)) ?? others[0] ?? null;
      let dir: string;
      if (pick !== null) dir = `${pick}/desk/files`;
      else {
        await this.storage.ensureDir("canary/desk/files", "root", "0755");
        dir = "canary/desk/files";
      }
      return await this.storage.plant(dir);
    } catch {
      return null;
    }
  }

  // ---- the tool plane: commands and files ---------------------------------------------------------------------------

  async exec(dispatchKey: string, reqIn: ExecRequest): Promise<ExecResult> {
    const req = checkExecRequest(reqIn);
    const tool = await this.toolPlane(dispatchKey);
    const started = Date.now();
    const seconds = (req.timeoutMs / 1000).toFixed(3);
    const r = await execIn(this.engine, tool.Id, ["timeout", "--kill-after=5", `${seconds}s`, ...req.argv], {
      user: `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`,
      env: Object.entries(req.env ?? {}).map(([k, v]) => `${k}=${v}`),
      workingDir: req.cwd,
      stdin: req.stdin !== undefined ? Buffer.from(req.stdin, "utf8") : null,
      timeoutMs: req.timeoutMs + 15_000,
      maxOutputBytes: req.maxOutputBytes,
    });
    const elapsed = Date.now() - started;
    const timedOut = r.timedOut || ((r.code === 124 || r.code === 137) && elapsed >= req.timeoutMs - 100);
    const signal = r.code !== null && r.code > 128 && r.code <= 128 + 64 ? (SIGNALS[r.code - 128] ?? null) : null;
    return { code: r.code, signal, stdout: r.stdout.toString("utf8"), stderr: r.stderr.toString("utf8"), timedOut, truncated: r.truncated };
  }

  private async fileOp(dispatchKey: string, args: string[], stdin: Buffer | null, maxOutputBytes: number): Promise<ExecOutcome> {
    const tool = await this.toolPlane(dispatchKey);
    return execIn(this.engine, tool.Id, ["node", "-e", nodeScript(toolFileScript), ...args], { user: `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`, stdin, timeoutMs: 120_000, maxOutputBytes });
  }

  private fileError(r: ExecOutcome, what: string): AllocatorError {
    const said = text(r.stderr);
    if (r.code === 4) return new AllocatorError("bad_request", `${what}: ${said || "outside /work, /output, /team and /toolbox"}`);
    if (r.code === 5) return new AllocatorError("file_too_large", `${what}: the file is larger than allowed (${said} bytes)`);
    if (r.code === 6) return new AllocatorError("bad_request", `${what}: ${said}`);
    if (r.code === 7) return new AllocatorError("conflict", `${what}: the workspace's quota is full`);
    return new AllocatorError("internal", failure(what, r));
  }

  async readFile(dispatchKey: string, path: string, maxBytesIn: number): Promise<Buffer | null> {
    const abs = checkToolPath(path);
    const maxBytes = intIn(maxBytesIn, 0, MAX_FILE_BYTES, "maxBytes");
    const r = await this.fileOp(dispatchKey, ["read", abs, String(maxBytes)], null, maxBytes + 1);
    if (r.code === 0) return r.stdout;
    if (r.code === 3) return null;
    throw this.fileError(r, `reading ${abs}`);
  }

  async writeFile(dispatchKey: string, path: string, bytes: Buffer): Promise<void> {
    const abs = checkToolPath(path);
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_FILE_BYTES) throw new AllocatorError("file_too_large", "a file of at most 64 MiB");
    const r = await this.fileOp(dispatchKey, ["write", abs], bytes, 64 * 1024);
    if (r.code !== 0) throw this.fileError(r, `writing ${abs}`);
  }

  async list(dispatchKey: string, dir: string, maxEntriesIn: number): Promise<FileEntry[]> {
    const abs = checkToolPath(dir);
    const maxEntries = intIn(maxEntriesIn, 1, 10_000, "maxEntries");
    const r = await this.fileOp(dispatchKey, ["list", abs, String(maxEntries)], null, 8 * 1024 * 1024);
    if (r.code === 3) throw new AllocatorError("not_found", `${abs} does not exist`);
    if (r.code !== 0) throw this.fileError(r, `listing ${abs}`);
    return (JSON.parse(text(r.stdout)) as { entries: FileEntry[] }).entries;
  }

  // ---- usage, stop, removal ---------------------------------------------------------------------------------------------

  private async planeUsage(c: ContainerInspect | null, user: string, diskMiB: number | null): Promise<UsageView | null> {
    if (c === null) return null;
    const sampledAt = this.iso();
    if (!c.State.Running) return { cpuSeconds: null, memoryCurrentMiB: null, memoryPeakMiB: null, oomKilled: c.State.OOMKilled, pidsPeak: this.pidsPeaks.get(c.Id) ?? null, diskUsedMiB: diskMiB, networkBytesIn: null, networkBytesOut: null, sampledAt };
    const [stats, cg] = await Promise.all([this.engine.containerStats(c.Id).catch(() => null), this.readCgroup(c.Id, user)]);
    const u = cg === null ? null : cgroupUsage(cg);
    const nets = (stats?.networks ?? {}) as Record<string, { rx_bytes?: number; tx_bytes?: number }>;
    const sum = (k: "rx_bytes" | "tx_bytes") => Object.values(nets).reduce((n, x) => n + (x[k] ?? 0), 0);
    const pids = u?.pidsPeak ?? u?.pidsCurrent ?? null;
    if (pids !== null) this.pidsPeaks.set(c.Id, Math.max(pids, this.pidsPeaks.get(c.Id) ?? 0));
    const mib = (b: number | null | undefined) => (b === null || b === undefined ? null : Math.round((b / MiB) * 100) / 100);
    return {
      cpuSeconds: u?.cpuSeconds ?? null,
      memoryCurrentMiB: mib(u?.memoryCurrentBytes),
      memoryPeakMiB: mib(u?.memoryPeakBytes),
      oomKilled: c.State.OOMKilled || (u?.oomKills ?? 0) > 0,
      pidsPeak: this.pidsPeaks.get(c.Id) ?? null,
      diskUsedMiB: diskMiB,
      networkBytesIn: stats === null ? null : sum("rx_bytes"),
      networkBytesOut: stats === null ? null : sum("tx_bytes"),
      sampledAt,
    };
  }

  async usage(dispatchKeyIn: string): Promise<{ modelPlane: UsageView | null; toolPlane: UsageView | null }> {
    const dispatchKey = checkDispatchKey(dispatchKeyIn);
    const { tool, model } = await this.planes(dispatchKey);
    let disk: number | null = null;
    const l = tool?.Config.Labels ?? null;
    if (l !== null && this.storage.state?.volume) {
      const u = await this.storage.usage(scratchArea({ orbitId: l[LABELS.account] as string, employeeId: l[LABELS.employee] as string, sandboxId: l[LABELS.sandbox] as string }, l[LABELS.assignment] as string)).catch(() => null);
      disk = u === null ? null : Math.round((u.usedBytes / MiB) * 100) / 100;
    }
    const [toolPlane, modelPlane] = await Promise.all([this.planeUsage(tool, `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`, disk), this.planeUsage(model, `${MODEL_PLANE.uid}:${MODEL_PLANE.gid}`, null)]);
    return { toolPlane, modelPlane };
  }

  async stop(dispatchKeyIn: string, graceMsIn: number): Promise<void> {
    const dispatchKey = checkDispatchKey(dispatchKeyIn);
    const graceMs = intIn(graceMsIn, 0, 600_000, "graceMs");
    const { tool, model } = await this.planes(dispatchKey);
    await Promise.all([tool, model].flatMap((c) => (c === null ? [] : [this.engine.containerStop(c.Id, Math.ceil(graceMs / 1000))])));
  }

  async remove(dispatchKeyIn: string): Promise<{ gone: boolean; detail: string }> {
    const dispatchKey = checkDispatchKey(dispatchKeyIn);
    return this.locks.run(`attempt:${dispatchKey}`, async () => {
      const { tool, model } = await this.planes(dispatchKey);
      await Promise.all([tool, model].flatMap((c) => (c === null ? [] : [this.engine.containerRemove(c.Id, true)])));
      // Then the attempt's own networks: whatever is still connected (Orbit Web's container) is disconnected first.
      const nets = await this.networksOf(dispatchKey);
      for (const net of [nets.tool, nets.model]) {
        if (net === null) continue;
        for (const member of Object.keys(net.Containers ?? {})) await this.engine.networkDisconnect(net.Name, member);
        await this.engine.networkRemove(net.Name);
      }
      const names = planeNames(this.prefix, dispatchKey);
      const netNames = attemptNetworks(this.prefix, dispatchKey);
      const left = [
        ...(await Promise.all([this.engine.containerInspect(names.tool), this.engine.containerInspect(names.model)])).filter((c) => c !== null).map((c) => c.Name),
        ...(await Promise.all([this.engine.networkInspect(netNames.tool), this.engine.networkInspect(netNames.model)])).filter((n) => n !== null).map((n) => n.Name),
      ];
      for (const c of [tool, model]) if (c !== null) this.pidsPeaks.delete(c.Id);
      return left.length === 0 ? { gone: true, detail: "both planes and their networks are gone (the runtime no longer knows them)" } : { gone: false, detail: `${left.join(", ")} still exist` };
    });
  }
}
