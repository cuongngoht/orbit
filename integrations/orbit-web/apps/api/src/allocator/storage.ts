// THE WORKFORCE STORAGE (plan 7.3): every employee area -- desk, cache, an assignment's scratch, a mission's room -- is a
// directory of ONE volume (the workforce volume), mounted into a container by a volume SUBPATH, never as a whole. How
// a quota is held is chosen by a probe that TRIES each mechanism in order on this host and keeps the first whose
// over-quota write the kernel REFUSED (and this build implements):
//
//   1 xfs-project      the runtime's own volume path is XFS mounted with project quotas: a project quota per area
//   2 xfs-loop-pool    a pool image (ORBIT_WEB_WORKFORCE_POOL_SIZE) on a loop device, XFS with prjquota
//   3 btrfs-qgroup     the same pool, btrfs: a subvolume per area with a qgroup limit
//   4 loop-per-volume  an image per area (probed and reported; not used for areas by this build)
//   5 measured         plain directories, measured: SOFT_MONITORED, never shown as isolation
//
// The pool's loop device and filesystem are made by a privileged storage HELPER the allocator runs (network none); the
// runtime itself mounts the pool (a local volume over the loop device), so nothing is propagated from a container to
// the host. The helper only ever touches paths built from ids, and never through a link (scripts/helper-sh.ts); an
// employee's own bytes are moved by an unprivileged storage WORKER that mounts nothing but that employee's places.
import { randomBytes } from "node:crypto";
import type { EnforcementLevel, StorageMechanism } from "@orbit-web/contracts";
import type { SandboxConfig } from "../config/sandbox-config.js";
import { isAreaPath } from "../contexts/execution/infrastructure/sandbox/ids.js";
import { TOOL_PLANE } from "../contexts/execution/infrastructure/sandbox/layout.js";
import { chooseMechanism, hostProtectionOf, IMPLEMENTED, MECHANISM_ORDER, type CandidateResult } from "../contexts/execution/infrastructure/sandbox/storage-policy.js";
import { execIn, failure, runOnce, text, type ExecOutcome } from "./containers.js";
import type { DockerEngine } from "./docker/engine.js";
import { HELPER_SH } from "./scripts/helper-sh.js";
import { nodeScript, writeProbeScript } from "./scripts/node-scripts.js";
import { MiB, roleLabels, storageHelperBody, storageWorkerBody, type VolumeMount } from "./specs.js";

export const MECHANISM_LABEL = "orbit-web.mechanism";
const POOL_IMAGE = "pool.img";
const PROBE_QUOTA = 16 * MiB;
// The places a probe's over-quota write goes (inside the probe volume, or the real pool).
const PROBE_AREA = "probe/area";

export interface StorageState {
  mechanism: StorageMechanism;
  perArea: EnforcementLevel;
  hostProtection: EnforcementLevel;
  // How each area is held: the over-quota write that was refused (HARD), or why nothing refuses one.
  areaEvidence: string;
  hostEvidence: string;
  // Every candidate tried, in order, with what happened.
  candidates: CandidateResult[];
  pool: { device: string; sizeMiB: number; preallocated: boolean } | null;
  volume: string | null;
  probedAt: string;
}

const POOL_FS: Partial<Record<StorageMechanism, { fs: "btrfs" | "xfs"; o: string; probeMiB: number }>> = {
  "xfs-loop-pool": { fs: "xfs", o: "prjquota,noatime,nodiscard", probeMiB: 320 },
  "btrfs-qgroup": { fs: "btrfs", o: "noatime,nodiscard", probeMiB: 256 },
};

const parseKv = (line: string): Record<string, string> => Object.fromEntries(line.trim().split(/\s+/).map((kv) => kv.split("=") as [string, string]));

// A write past a quota: refused by the kernel (HARD) when it stopped at or below the quota (plus a little the
// filesystem may round up) with "Disk quota exceeded" or "No space left on device".
export function quotaHeld(r: { written: number; code: string | null }, quotaBytes: number): boolean {
  return (r.code === "EDQUOT" || r.code === "ENOSPC") && r.written <= quotaBytes + MiB;
}

export class WorkforceStorage {
  state: StorageState | null = null;
  private helperId: string | null = null;
  private ensuring: Promise<StorageState> | null = null;
  // Area creations are serialized (an XFS project id is allocated from a counter).
  private areaChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly engine: DockerEngine,
    private readonly config: SandboxConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get names() {
    return this.config.names;
  }

  // ---- containers ----------------------------------------------------------------------------------------------------

  // A helper for one operation (the pool's loop device, a probe): privileged, network none, gone after it.
  private helperOnce(mounts: VolumeMount[], args: string[], stdin: Buffer | null = null, timeoutMs = 120_000): Promise<ExecOutcome> {
    return runOnce(this.engine, this.names.prefix, storageHelperBody({ image: this.config.images.storageHelper, prefix: this.names.prefix, mounts, role: "storage-helper", seconds: 600 }), ["sh", "-c", HELPER_SH, "orbit-helper", ...args], { stdin, timeoutMs, maxOutputBytes: 1024 * 1024 });
  }

  // The long-running helper over the workforce volume (/pool) and the pool's store (/store).
  async helper(args: string[], stdin: Buffer | null = null, timeoutMs = 120_000): Promise<ExecOutcome> {
    if (this.helperId === null) throw new Error("the storage helper is not running: the storage was not set up");
    return execIn(this.engine, this.helperId, ["sh", "-c", HELPER_SH, "orbit-helper", ...args], { stdin, timeoutMs, maxOutputBytes: 4 * 1024 * 1024 });
  }

  private async mustHelper(args: string[], what: string, stdin: Buffer | null = null): Promise<string> {
    const r = await this.helper(args, stdin);
    if (r.code !== 0) throw new Error(failure(what, r));
    return text(r.stdout);
  }

  // An employee's own data, as the employee: nothing else mounted, no network, no capability.
  async worker(mounts: VolumeMount[], cmd: string[], stdin: Buffer | null = null, timeoutMs = 600_000): Promise<ExecOutcome> {
    return runOnce(this.engine, this.names.prefix, storageWorkerBody({ image: this.config.images.workstation, prefix: this.names.prefix, mounts }), cmd, { stdin, timeoutMs, maxOutputBytes: 16 * 1024 * 1024, user: `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}` });
  }

  private async startHelper(mounts: VolumeMount[]): Promise<void> {
    const name = `${this.names.prefix}-storage-helper`;
    await this.engine.containerRemove(name, true);
    const created = await this.engine.containerCreate(name, storageHelperBody({ image: this.config.images.storageHelper, prefix: this.names.prefix, mounts }));
    if (created === null) throw new Error(`could not create ${name}: a container of that name appeared meanwhile`);
    await this.engine.containerStart(created.id);
    this.helperId = created.id;
  }

  // The over-quota write: as the employee, into an area whose quota was just set.
  private async overQuotaWrite(volume: string, subpath: string, quotaBytes: number): Promise<{ written: number; code: string | null }> {
    const r = await this.worker([{ volume, subpath, target: "/probe", readOnly: false }], ["node", "-e", nodeScript(writeProbeScript), "/probe/.orbit-quota-probe", String(quotaBytes * 3)]);
    if (r.code !== 0) throw new Error(failure("the over-quota write", r));
    return JSON.parse(text(r.stdout)) as { written: number; code: string | null };
  }

  private writeEvidence(mechanism: StorageMechanism, w: { written: number; code: string | null }, where: string): string {
    const said = `${mechanism}: a write by uid ${TOOL_PLANE.uid} into a ${PROBE_QUOTA / MiB} MiB area of ${where}`;
    return quotaHeld(w, PROBE_QUOTA) ? `${said} was REFUSED by the kernel at ${w.written} bytes (${w.code}) at ${this.now().toISOString()}` : `${said} was NOT refused: ${w.written} bytes written (${w.code ?? "no error"})`;
  }

  // ---- the probe -----------------------------------------------------------------------------------------------------

  ensure(force = false): Promise<StorageState> {
    if (!force && this.state !== null) return Promise.resolve(this.state);
    if (this.ensuring === null) {
      this.ensuring = this.probeAndSetUp().finally(() => {
        this.ensuring = null;
      });
    }
    return this.ensuring;
  }

  private async probeAndSetUp(): Promise<StorageState> {
    const missing = [];
    for (const [what, ref] of [["storage helper", this.config.images.storageHelper], ["workstation", this.config.images.workstation]] as const) if ((await this.engine.imageInspect(ref)) === null) missing.push(`${what} image ${ref}`);
    if (missing.length > 0) {
      this.state = this.none(`the container runtime has no ${missing.join(" and no ")}: build the images (docker/Dockerfile targets storage-helper and workstation)`);
      return this.state;
    }
    const existing = await this.engine.volumeInspect(this.names.workforceVolume);
    const recorded = existing?.Labels?.[MECHANISM_LABEL] as StorageMechanism | undefined;
    if (existing !== null && recorded !== undefined && MECHANISM_ORDER.includes(recorded)) {
      this.state = await this.setUp(recorded, [{ mechanism: recorded, outcome: "hard", evidence: `the workforce volume already uses ${recorded}; re-verified below` }]);
      return this.state;
    }
    if (existing !== null) {
      this.state = this.none(`a volume named ${this.names.workforceVolume} exists without the allocator's label: it is not used (remove it, or name another with ORBIT_WEB_WORKFORCE_VOLUME)`);
      return this.state;
    }
    const results: CandidateResult[] = [];
    let chosen: StorageMechanism | null = null;
    for (const mechanism of MECHANISM_ORDER) {
      if (mechanism === "measured") break;
      if (chosen !== null) {
        results.push({ mechanism, outcome: "not_tried", evidence: `${chosen} was chosen first` });
        continue;
      }
      const r = await this.tryCandidate(mechanism);
      results.push(r);
      if (r.outcome === "hard" && IMPLEMENTED.has(mechanism)) chosen = mechanism;
    }
    this.state = await this.setUp(chosen ?? "measured", results);
    return this.state;
  }

  private none(reason: string): StorageState {
    return { mechanism: "none", perArea: "UNSUPPORTED", hostProtection: "UNSUPPORTED", areaEvidence: reason, hostEvidence: reason, candidates: [], pool: null, volume: null, probedAt: this.now().toISOString() };
  }

  // One candidate, on a throwaway volume (a tiny pool image for the loop mechanisms): set a quota, write past it.
  private async tryCandidate(mechanism: StorageMechanism): Promise<CandidateResult> {
    const probeVolume = `${this.names.prefix}-probe-${mechanism}`;
    const store: VolumeMount = { volume: this.names.workforceStoreVolume, subpath: null, target: "/store", readOnly: false };
    const image = `probe-${mechanism}.img`;
    const onPool: VolumeMount = { volume: probeVolume, subpath: null, target: "/pool", readOnly: false };
    try {
      await this.engine.volumeRemove(probeVolume).catch(() => undefined);
      if (mechanism === "xfs-project") {
        await this.engine.volumeCreate({ Name: probeVolume, Labels: roleLabels(this.names.prefix, "probe") });
        const fstype = await this.helperOnce([onPool], ["fstype"]);
        const [type, options] = text(fstype.stdout).split("\n");
        if (type !== "xfs") return { mechanism, outcome: "failed", evidence: `the runtime's volume path is ${type ?? "unknown"}, not XFS` };
        if (!/(^|,)(prjquota|pquota|pqnoenforce)(,|$)/.test(options ?? "")) return { mechanism, outcome: "failed", evidence: `the runtime's volume path is XFS without project quotas (mounted ${options ?? "?"})` };
      } else {
        const fs = mechanism === "loop-per-volume" ? { fs: "ext4", o: "noatime", probeMiB: 64 } : POOL_FS[mechanism];
        if (fs === undefined) return { mechanism, outcome: "failed", evidence: "not a probe this build knows" };
        await this.ensureStore();
        const att = await this.helperOnce([store], ["pool-attach", image, String(fs.probeMiB), "0", fs.fs, "-"]);
        if (att.code !== 0) return { mechanism, outcome: "failed", evidence: failure("attaching a loop device", att) };
        const { dev } = parseKv(text(att.stdout));
        await this.engine.volumeCreate({ Name: probeVolume, DriverOpts: { type: fs.fs, device: dev as string, o: fs.o }, Labels: roleLabels(this.names.prefix, "probe") });
      }
      const setup = await this.helperOnce([onPool], ["init", mechanism === "loop-per-volume" ? "measured" : mechanism]).catch((err: unknown) => ({ code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(err instanceof Error ? err.message : String(err)), timedOut: false, truncated: false }));
      if (setup.code !== 0) return { mechanism, outcome: "failed", evidence: failure("mounting it", setup) };
      const area = await this.helperOnce([onPool], ["area", mechanism === "loop-per-volume" ? "measured" : mechanism, PROBE_AREA, String(PROBE_QUOTA), String(TOOL_PLANE.uid), String(TOOL_PLANE.gid), "0700"]);
      if (area.code !== 0) return { mechanism, outcome: "failed", evidence: failure("setting a quota", area) };
      // A loop image per area: the area IS the filesystem, so the write is held by its size (the image's, not 16 MiB).
      const limit = mechanism === "loop-per-volume" ? 64 * MiB : PROBE_QUOTA;
      const w = await this.overQuotaWrite(probeVolume, PROBE_AREA, limit);
      if (!quotaHeld(w, limit)) return { mechanism, outcome: "not_enforced", evidence: `${w.written} bytes written past a ${limit / MiB} MiB quota (${w.code ?? "no error"})` };
      if (!IMPLEMENTED.has(mechanism)) return { mechanism, outcome: "not_implemented", evidence: `supported here (refused at ${w.written} bytes, ${w.code}), not used for areas by this build` };
      return { mechanism, outcome: "hard", evidence: `refused at ${w.written} bytes (${w.code})` };
    } catch (err) {
      return { mechanism, outcome: "failed", evidence: err instanceof Error ? err.message.slice(0, 600) : String(err) };
    } finally {
      await this.engine.volumeRemove(probeVolume).catch(() => undefined);
      if (mechanism !== "xfs-project") await this.helperOnce([store], ["pool-delete", image]).catch(() => undefined);
    }
  }

  private async ensureStore(): Promise<void> {
    if ((await this.engine.volumeInspect(this.names.workforceStoreVolume)) === null) await this.engine.volumeCreate({ Name: this.names.workforceStoreVolume, Labels: roleLabels(this.names.prefix, "storage-helper") });
  }

  // The real workforce volume for the chosen mechanism, the long-running helper over it, and the over-quota write again
  // -- on the real pool, so the evidence is about the areas employees will use.
  private async setUp(mechanism: StorageMechanism, candidates: CandidateResult[]): Promise<StorageState> {
    const store: VolumeMount = { volume: this.names.workforceStoreVolume, subpath: null, target: "/store", readOnly: false };
    let pool: StorageState["pool"] = null;
    try {
      const fs = POOL_FS[mechanism];
      const existing = await this.engine.volumeInspect(this.names.workforceVolume);
      if (fs !== undefined) {
        await this.ensureStore();
        const preferred = existing?.Options?.device ?? "-";
        const att = await this.helperOnce([store], ["pool-attach", POOL_IMAGE, String(this.config.pool.sizeMiB), this.config.pool.preallocate ? "1" : "0", fs.fs, preferred], null, 600_000);
        if (att.code !== 0) throw new Error(failure("attaching the pool", att));
        const kv = parseKv(text(att.stdout));
        const device = kv.dev as string;
        const sizeMiB = Math.floor(Number(kv.bytes) / MiB);
        pool = { device, sizeMiB, preallocated: Number(kv.allocated) >= Number(kv.bytes) };
        if (existing !== null && existing.Options?.device !== device) {
          // The loop device changed (a restart of the host): the volume's definition names the old one.
          if ((await this.engine.volumeRemove(this.names.workforceVolume)) === "in_use") throw new Error(`the pool is now ${device} but containers still use the volume made for ${existing.Options?.device ?? "?"}`);
        }
        if (existing === null || existing.Options?.device !== device) {
          await this.engine.volumeCreate({ Name: this.names.workforceVolume, DriverOpts: { type: fs.fs, device, o: fs.o }, Labels: { ...roleLabels(this.names.prefix, "storage-helper"), [MECHANISM_LABEL]: mechanism } });
        }
        await this.startHelper([{ volume: this.names.workforceVolume, subpath: null, target: "/pool", readOnly: false }, store]);
      } else {
        if (existing === null) await this.engine.volumeCreate({ Name: this.names.workforceVolume, Labels: { ...roleLabels(this.names.prefix, "storage-helper"), [MECHANISM_LABEL]: mechanism } });
        await this.startHelper([{ volume: this.names.workforceVolume, subpath: null, target: "/pool", readOnly: false }]);
      }
      await this.mustHelper(["init", mechanism], "setting up the workforce volume");
      const host = hostProtectionOf(mechanism, pool);
      if (mechanism === "measured") {
        const choice = chooseMechanism(candidates, true);
        return { mechanism, perArea: "SOFT_MONITORED", hostProtection: host.level, areaEvidence: `measured: each area's use is read (du) and nothing refuses a write past its quota. Tried: ${choice.evidence || "nothing"}`, hostEvidence: host.evidence, candidates, pool, volume: this.names.workforceVolume, probedAt: this.now().toISOString() };
      }
      await this.mustHelper(["area", mechanism, PROBE_AREA, String(PROBE_QUOTA), String(TOOL_PLANE.uid), String(TOOL_PLANE.gid), "0700"], "setting a probe quota on the workforce volume");
      const w = await this.overQuotaWrite(this.names.workforceVolume, PROBE_AREA, PROBE_QUOTA);
      const held = quotaHeld(w, PROBE_QUOTA);
      return {
        mechanism,
        perArea: held ? "HARD_ENFORCED" : "UNSUPPORTED",
        hostProtection: host.level,
        areaEvidence: this.writeEvidence(mechanism, w, pool !== null ? `the ${pool.sizeMiB} MiB workforce pool (${pool.device})` : "the workforce volume"),
        hostEvidence: host.evidence,
        candidates,
        pool,
        volume: this.names.workforceVolume,
        probedAt: this.now().toISOString(),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 800) : String(err);
      return { ...this.none(`setting up ${mechanism} failed: ${reason}`), candidates: [...candidates, { mechanism, outcome: "failed", evidence: reason }] };
    }
  }

  // ---- areas -------------------------------------------------------------------------------------------------------

  private get mechanism(): StorageMechanism {
    if (this.state === null || this.state.volume === null) throw new Error(`no workforce storage: ${this.state?.areaEvidence ?? "not probed"}`);
    return this.state.mechanism;
  }

  get volume(): string {
    if (this.state?.volume === null || this.state?.volume === undefined) throw new Error(`no workforce storage: ${this.state?.areaEvidence ?? "not probed"}`);
    return this.state.volume;
  }

  // An area with its quota (0: none), owned as given; made once, its quota re-applied on every call.
  ensureArea(path: string, quotaBytes: number, owner: "root" | "employee", mode = "0700"): Promise<void> {
    if (!isAreaPath(path)) return Promise.reject(new Error(`not an area path: ${path}`));
    const [uid, gid] = owner === "root" ? [0, 0] : [TOOL_PLANE.uid, TOOL_PLANE.gid];
    const run = this.areaChain.then(() => this.mustHelper(["area", this.mechanism, path, String(quotaBytes), String(uid), String(gid), mode], `making the area ${path}`));
    this.areaChain = run.catch(() => undefined);
    return run.then(() => undefined);
  }

  async ensureDir(path: string, owner: "root" | "employee", mode = "0700"): Promise<void> {
    if (!isAreaPath(path)) throw new Error(`not an area path: ${path}`);
    const [uid, gid] = owner === "root" ? [0, 0] : [TOOL_PLANE.uid, TOOL_PLANE.gid];
    await this.mustHelper(["dir", path, String(uid), String(gid), mode], `making ${path}`);
  }

  // The area's use and its limit as the mechanism holds it (null: no such area).
  async usage(path: string): Promise<{ usedBytes: number; limitBytes: number } | null> {
    const r = await this.helper(["usage", this.mechanism, path]);
    if (r.code === 3) return null;
    if (r.code !== 0) throw new Error(failure(`reading the use of ${path}`, r));
    const [used, limit] = text(r.stdout).split(/\s+/).map(Number);
    return { usedBytes: used ?? 0, limitBytes: limit ?? 0 };
  }

  async freeze(path: string): Promise<void> {
    await this.mustHelper(["freeze", this.mechanism, path], `freezing ${path}`);
  }

  async removeArea(path: string): Promise<void> {
    await this.mustHelper(["remove", this.mechanism, path], `removing ${path}`);
  }

  // The names of the directories in `path` (none when it is not there).
  async subdirs(path: string): Promise<string[]> {
    const out = await this.mustHelper(["subdirs", path], `listing ${path}`);
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async removeDir(path: string): Promise<void> {
    await this.mustHelper(["rmdir", path], `removing ${path}`);
  }

  async put(path: string, bytes: Buffer): Promise<void> {
    await this.mustHelper(["put", path], `writing ${path}`, bytes);
  }

  async get(path: string): Promise<Buffer | null> {
    const r = await this.helper(["get", path]);
    if (r.code === 3) return null;
    if (r.code !== 0) throw new Error(failure(`reading ${path}`, r));
    return r.stdout;
  }

  // A marker in a place no attempt may see: a new file, with a random name, readable by anyone who could see it.
  async plant(dir: string): Promise<{ path: string; name: string; nonce: string }> {
    const name = `.orbit-canary-${randomBytes(8).toString("hex")}`;
    const nonce = randomBytes(16).toString("hex");
    await this.mustHelper(["plant", `${dir}/${name}`, nonce], `planting a marker in ${dir}`);
    return { path: `${dir}/${name}`, name, nonce };
  }

  async unplant(path: string): Promise<void> {
    await this.helper(["unplant", path]).catch(() => undefined);
  }

  // accounts/<orbitId>/employees/<employeeId> of every employee with a desk.
  async employees(): Promise<string[]> {
    return (await this.mustHelper(["employees"], "listing the desks")).split("\n").filter((l) => l.length > 0);
  }

  async capacity(): Promise<{ sizeBytes: number; availableBytes: number } | null> {
    const r = await this.helper(["df"]).catch(() => null);
    if (r === null || r.code !== 0) return null;
    const [size, avail] = text(r.stdout).split(/\s+/).map(Number);
    return size === undefined || avail === undefined || !Number.isFinite(size) ? null : { sizeBytes: size, availableBytes: avail };
  }

  // Tests and maintenance: the helper stopped, the pool's loop device detached, both volumes and the image removed.
  async destroy(): Promise<void> {
    await this.engine.containerRemove(`${this.names.prefix}-storage-helper`, true).catch(() => undefined);
    this.helperId = null;
    const volume = await this.engine.volumeInspect(this.names.workforceVolume);
    // On the host's own filesystem, an archived desk is immutable (chattr): thawed first, or the runtime cannot delete it.
    if (volume !== null && volume.Options?.device === undefined) await this.helperOnce([{ volume: this.names.workforceVolume, subpath: null, target: "/pool", readOnly: false }], ["thaw-all"]).catch(() => undefined);
    if (volume !== null && (await this.engine.volumeRemove(this.names.workforceVolume)) === "in_use") throw new Error(`${this.names.workforceVolume} is still used by a container: remove the attempts first`);
    if ((await this.engine.volumeInspect(this.names.workforceStoreVolume)) !== null) {
      await this.helperOnce([{ volume: this.names.workforceStoreVolume, subpath: null, target: "/store", readOnly: false }], ["pool-delete", POOL_IMAGE]).catch(() => undefined);
      await this.engine.volumeRemove(this.names.workforceStoreVolume).catch(() => undefined);
    }
    this.state = null;
  }
}
