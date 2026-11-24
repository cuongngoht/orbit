// THE PROCESS PROVIDER -- DEVELOPMENT ONLY (ADR 0061). No container runtime: an employee's areas are directories under
// <data>/workforce (the same layout as the workforce volume), the CLI is a local child process, nothing is limited and
// nothing is isolated. It says so: its attestation is `not_isolated`, it never runs a shell (exec is refused), and its
// storage is SOFT_MONITORED (measured). The file operations still hold every path to the workspace's own places, through
// links. The compose files never use it.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync, writeSync, chmodSync, constants as fsConstants } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDeskDir, checkDeskPath, DESK_LIMITS, type UsageView } from "@orbit-web/contracts";
import { contained } from "../../../../common/workspace-path.js";
import type { ProcessPort } from "../../../../infra/process/process.port.js";
import type { AreaState, AttemptEvidence, AttemptHandle, AttemptSpec, AttemptStatus, DeskCleaned, DeskCleanOrder, DeskListing, DeskRead, ExecRequest, ExecResult, FileEntry, HostCapabilities, ProvisionResult, SandboxIds } from "../../application/sandbox.port.js";
import type { SandboxProvider } from "../../application/sandbox.port.js";
import { AllocatorError, CHANGED_PATHS, checkAttemptSpec, checkDeskOrder, checkInputName, checkQuotas, checkSandboxIds, checkToolPath, deskRefusal, FILE_ROOTS, intIn, MAX_FILE_BYTES, type PublishResult } from "./allocator-protocol.js";
import { attemptHash, cacheArea, checkDispatchKey, checkId, connectionSubpath, deskArea, employeeDir, sandboxMeta, SCRATCH_DIRS, scratchArea, teamArea, workspaceMeta, assignmentDir, type EmployeeIds } from "./ids.js";
import { deskScript, nodeScript, syncScript } from "../../../../allocator/scripts/node-scripts.js";

const MiB = 1024 * 1024;
const NOT_ISOLATED = "development provider: the CLI runs as a local process beside Orbit Web, with no container, no limit and no isolation -- no shell is granted, file tools only";

// The Orbit tool bridge, as built beside this file (dist/bridge/main.js).
const BRIDGE_MAIN = fileURLToPath(new URL("../../../../bridge/main.js", import.meta.url));

export interface ProcessProviderOptions {
  // Orbit Web's data directory: <data>/workforce holds the areas, <data>/connections the connections' homes.
  dataRoot: string;
  // How the CLI is started (a local child).
  process: ProcessPort;
  readInput?: (storePath: string) => Promise<Buffer>;
  now?: () => Date;
}

interface AttemptRecordFile {
  dispatchKey: string;
  runId: string;
  ids: EmployeeIds;
  assignmentId: string;
  teamRoomId: string | null;
  connectionHome: string;
  createdAt: string;
  stopped: boolean;
}

const duBytes = (p: string): number => {
  let total = 0;
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const full = join(d, n);
      const st = lstatSync(full, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  if (existsSync(p)) walk(p);
  return total;
};

export class ProcessSandboxProvider implements SandboxProvider {
  readonly kind = "process" as const;
  private readonly root: string;
  private readonly now: () => Date;

  constructor(private readonly o: ProcessProviderOptions) {
    this.root = join(o.dataRoot, "workforce");
    this.now = o.now ?? (() => new Date());
  }

  private at(rel: string): string {
    const p = join(this.root, rel);
    if (!contained(this.root, p)) throw new AllocatorError("bad_request", `${rel} leads outside the workforce directory`);
    return p;
  }

  private readJson<T>(rel: string): T | null {
    const p = this.at(rel);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
  }

  private writeJson(rel: string, value: unknown): void {
    const p = this.at(rel);
    mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.tmp-${randomBytes(4).toString("hex")}`;
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    renameSync(tmp, p);
  }

  async probe(): Promise<HostCapabilities> {
    const probedAt = this.now().toISOString();
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    let storageMiB: number | null = null;
    try {
      const s = statfsSync(this.root);
      storageMiB = Math.floor((s.bavail * s.bsize) / MiB);
    } catch {
      // unknown
    }
    return {
      provider: "process",
      runtime: { reachable: true, version: process.version, cgroup: null, detail: NOT_ISOLATED },
      limits: { cpu: "UNSUPPORTED", memory: "UNSUPPORTED", pids: "UNSUPPORTED", evidence: "the process provider applies no limit" },
      storage: { mechanism: "measured", perArea: "SOFT_MONITORED", hostProtection: "UNSUPPORTED", evidence: `development only: the areas are directories under ${this.root}, measured; nothing refuses a write past a quota`, probedAt },
      host: { cpuMillis: availableParallelism() * 1000, memoryMiB: Math.floor(totalmem() / MiB), storageMiB },
      shellPossible: false,
      probedAt,
    };
  }

  private area(area: AreaState["area"], quotaMiB: number, path: string): AreaState {
    return { area, quotaMiB, level: "SOFT_MONITORED", evidence: "measured (development provider): nothing refuses a write past the quota", usedMiB: Math.round((duBytes(this.at(path)) / MiB) * 100) / 100 };
  }

  async provisionEmployee(idsIn: SandboxIds, quotasIn: { deskMiB: number; cacheMiB: number }): Promise<ProvisionResult> {
    const ids = checkSandboxIds(idsIn);
    const quotas = checkQuotas(quotasIn);
    const existing = this.readJson<{ sandboxId: string; archived: boolean }>(sandboxMeta(ids));
    if (existing !== null && existing.sandboxId !== ids.sandboxId) return { state: "FAILED", areas: [], reason: `this employee's sandbox is ${existing.sandboxId}, not ${ids.sandboxId}` };
    if (existing?.archived) return { state: "FAILED", areas: [], reason: "the employee is archived" };
    for (const d of ["files/toolbox/skills", "files/toolbox/scripts"]) mkdirSync(this.at(`${deskArea(ids)}/${d}`), { recursive: true, mode: 0o700 });
    if (this.readJson(`${deskArea(ids)}/version`) === null) this.writeJson(`${deskArea(ids)}/version`, { version: 0, by: null, from: null, changed: [] });
    if (quotas.cacheMiB > 0) mkdirSync(this.at(cacheArea(ids)), { recursive: true, mode: 0o700 });
    for (const dir of [`${deskArea(ids)}/files`, ...(quotas.cacheMiB > 0 ? [cacheArea(ids)] : [])]) {
      const probe = join(this.at(dir), `.orbit-write-test-${randomBytes(6).toString("hex")}`);
      writeFileSync(probe, randomBytes(64 * 1024), { flag: "wx" });
      rmSync(probe);
    }
    this.writeJson(sandboxMeta(ids), { ...ids, ...quotas, state: "READY", archived: false, createdAt: this.now().toISOString() });
    const areas = [this.area("desk", quotas.deskMiB, deskArea(ids))];
    if (quotas.cacheMiB > 0) areas.push(this.area("cache", quotas.cacheMiB, cacheArea(ids)));
    return { state: "READY", areas, reason: null };
  }

  async archiveEmployee(idsIn: SandboxIds): Promise<void> {
    const ids = checkSandboxIds(idsIn);
    const record = this.readJson<Record<string, unknown>>(sandboxMeta(ids));
    if (record === null) throw new AllocatorError("not_found", "no such sandbox");
    this.writeJson(sandboxMeta(ids), { ...record, archived: true });
  }

  async measure(idsIn: SandboxIds): Promise<AreaState[]> {
    const ids = checkSandboxIds(idsIn);
    const record = this.readJson<{ deskMiB: number; cacheMiB: number }>(sandboxMeta(ids));
    if (record === null) throw new AllocatorError("not_found", "no such sandbox");
    return [this.area("desk", record.deskMiB, deskArea(ids)), ...(record.cacheMiB > 0 ? [this.area("cache", record.cacheMiB, cacheArea(ids))] : [])];
  }

  private sync(mode: "seed" | "publish", src: string, dst: string): { code: number | null; out: Record<string, unknown> } {
    const r = spawnSync(process.execPath, ["-e", nodeScript(syncScript), mode, src, dst, String(CHANGED_PATHS)], { encoding: "utf8", maxBuffer: 64 * MiB });
    try {
      return { code: r.status, out: JSON.parse(r.stdout) as Record<string, unknown> };
    } catch {
      return { code: r.status, out: { error: r.stderr } };
    }
  }

  async prepareWorkspace(idsIn: SandboxIds, assignmentIdIn: string, scratchMiBIn: number): Promise<AreaState> {
    const ids = checkSandboxIds(idsIn);
    const assignmentId = checkId(assignmentIdIn, "assignmentId");
    const scratchMiB = intIn(scratchMiBIn, 16, 4 * 1024 * 1024, "scratchMiB");
    const record = this.readJson<{ sandboxId: string; archived: boolean }>(sandboxMeta(ids));
    if (record === null || record.sandboxId !== ids.sandboxId || record.archived) throw new AllocatorError("conflict", "the employee's sandbox is not READY");
    const scratch = scratchArea(ids, assignmentId);
    for (const d of SCRATCH_DIRS) mkdirSync(this.at(`${scratch}/${d}`), { recursive: true, mode: 0o700 });
    if (this.readJson(workspaceMeta(ids, assignmentId)) === null) {
      const desk = this.readJson<{ version: number }>(`${deskArea(ids)}/version`);
      const r = this.sync("seed", this.at(`${deskArea(ids)}/files`), this.at(`${scratch}/work`));
      if (r.code !== 0) throw new Error(`seeding the workspace failed: ${JSON.stringify(r.out)}`);
      this.writeJson(workspaceMeta(ids, assignmentId), { assignmentId, seededFromDeskVersion: desk?.version ?? 0, scratchMiB, createdAt: this.now().toISOString() });
    }
    return this.area("scratch", scratchMiB, scratch);
  }

  async publishWorkspace(idsIn: SandboxIds, assignmentIdIn: string, expectedIn: number): Promise<PublishResult> {
    const ids = checkSandboxIds(idsIn);
    const assignmentId = checkId(assignmentIdIn, "assignmentId");
    const expected = intIn(expectedIn, 0, Number.MAX_SAFE_INTEGER, "expectedDeskVersion");
    const desk = this.readJson<{ version: number; by: string | null; from: number | null; changed: string[]; changedTotal: number }>(`${deskArea(ids)}/version`) ?? { version: 0, by: null, from: null, changed: [], changedTotal: 0 };
    if (desk.by === assignmentId) return { published: true, deskVersion: desk.version, changed: desk.changed, changedTotal: desk.changedTotal, reason: null };
    if (desk.version !== expected) return { published: false, deskVersion: desk.version, changed: [], changedTotal: 0, reason: `the desk is at version ${desk.version}, not ${expected}: it changed after this assignment's workspace was prepared` };
    if (this.readJson(workspaceMeta(ids, assignmentId)) === null) return { published: false, deskVersion: desk.version, changed: [], changedTotal: 0, reason: "this assignment has no workspace" };
    const r = this.sync("publish", this.at(`${scratchArea(ids, assignmentId)}/work`), this.at(`${deskArea(ids)}/files`));
    if (r.code !== 0) return { published: false, deskVersion: desk.version, changed: [], changedTotal: 0, reason: String(r.out.reason ?? r.out.error ?? "the publish failed") };
    const changed = ((r.out.changed as string[] | undefined) ?? []).slice(0, CHANGED_PATHS);
    const changedTotal = Number(r.out.changedTotal ?? changed.length);
    this.writeJson(`${deskArea(ids)}/version`, { version: desk.version + 1, by: assignmentId, from: expected, changed, changedTotal });
    return { published: true, deskVersion: desk.version + 1, changed, changedTotal, reason: null };
  }

  async deleteEmployee(idsIn: SandboxIds): Promise<{ gone: boolean; detail: string }> {
    const ids = checkSandboxIds(idsIn);
    const dir = this.at(employeeDir(ids));
    rmSync(dir, { recursive: true, force: true });
    return existsSync(dir) ? { gone: false, detail: "the employee's directory is still there" } : { gone: true, detail: "the employee's directory is gone (read back)" };
  }

  async removeWorkspace(idsIn: SandboxIds, assignmentIdIn: string): Promise<{ gone: boolean; detail: string }> {
    const ids = checkSandboxIds(idsIn);
    const assignmentId = checkId(assignmentIdIn, "assignmentId");
    const dir = this.at(assignmentDir(ids, assignmentId));
    rmSync(dir, { recursive: true, force: true });
    return existsSync(dir) ? { gone: false, detail: "the workspace is still there" } : { gone: true, detail: "the workspace's directory is gone (read back)" };
  }

  // ---- a person looking into the desk, and cleaning it up: the storage worker's program, run here ------------------

  private deskRun(args: string[], stdin = ""): { code: number | null; out: string; said: string } {
    const r = spawnSync(process.execPath, ["-e", nodeScript(deskScript), ...args], { encoding: "utf8", input: stdin, maxBuffer: 64 * MiB });
    return { code: r.status, out: r.stdout, said: r.stderr };
  }

  private ownSandbox(ids: SandboxIds): { cacheMiB: number; archived: boolean } {
    const record = this.readJson<{ sandboxId: string; cacheMiB: number; archived: boolean }>(sandboxMeta(ids));
    if (record === null || record.sandboxId !== ids.sandboxId) throw new AllocatorError("not_found", "no such sandbox");
    return record;
  }

  private deskVersionOf(ids: SandboxIds): number {
    return this.readJson<{ version: number }>(`${deskArea(ids)}/version`)?.version ?? 0;
  }

  async listDesk(idsIn: SandboxIds, dirIn: string, maxEntriesIn: number): Promise<DeskListing> {
    const ids = checkSandboxIds(idsIn);
    const dir = checkDeskDir(dirIn);
    if (dir === null) throw new AllocatorError("bad_request", "dir is not a folder of the desk");
    const maxEntries = intIn(maxEntriesIn, 1, 10_000, "maxEntries");
    this.ownSandbox(ids);
    const deskVersion = this.deskVersionOf(ids);
    const r = this.deskRun(["list", this.at(`${deskArea(ids)}/files`), dir, String(maxEntries)]);
    if (r.code !== 0) throw deskRefusal(r.code, r.said, `listing ${dir === "" ? "the desk" : dir}`);
    return { deskVersion, ...(JSON.parse(r.out) as Omit<DeskListing, "deskVersion">) };
  }

  async readDesk(idsIn: SandboxIds, pathIn: string, maxBytesIn: number): Promise<DeskRead> {
    const ids = checkSandboxIds(idsIn);
    const path = checkDeskPath(pathIn);
    if (path === null) throw new AllocatorError("bad_request", "path is not a file of the desk");
    const maxBytes = intIn(maxBytesIn, 0, DESK_LIMITS.readBytes, "maxBytes");
    this.ownSandbox(ids);
    const deskVersion = this.deskVersionOf(ids);
    const r = this.deskRun(["read", this.at(`${deskArea(ids)}/files`), path, String(maxBytes)]);
    if (r.code !== 0) throw deskRefusal(r.code, r.said, `reading ${path}`);
    const o = JSON.parse(r.out) as { bytes: number; base64: string; truncated: boolean; modifiedAt: string };
    return { deskVersion, bytes: o.bytes, data: Buffer.from(o.base64, "base64"), truncated: o.truncated, modifiedAt: o.modifiedAt };
  }

  // As the allocator does: never while a workspace of the employee exists (an attempt here always has one), never at
  // another version of the desk than the one the person chose at; the version does not move.
  async cleanDesk(idsIn: SandboxIds, orderIn: DeskCleanOrder, expectedIn: number): Promise<DeskCleaned> {
    const ids = checkSandboxIds(idsIn);
    const order = checkDeskOrder(orderIn);
    const expected = intIn(expectedIn, 0, Number.MAX_SAFE_INTEGER, "expectedDeskVersion");
    const record = this.ownSandbox(ids);
    if (record.archived) throw new AllocatorError("conflict", "the employee is archived: its desk is read only");
    const deskVersion = this.deskVersionOf(ids);
    if (deskVersion !== expected) throw new AllocatorError("conflict", `the desk is at version ${deskVersion}, not ${expected}: accepted work reached it since it was read`);
    const assignments = this.at(`${employeeDir(ids)}/assignments`);
    const workspaces = existsSync(assignments) ? readdirSync(assignments) : [];
    if (workspaces.length > 0) throw new AllocatorError("conflict", `a workspace of this employee's work still exists (assignment ${workspaces[0]}): what it holds could still reach the desk`);
    const cache = order.cache && record.cacheMiB > 0;
    const r = this.deskRun(["clean", this.at(`${deskArea(ids)}/files`), cache ? this.at(cacheArea(ids)) : ""], JSON.stringify(order));
    if (r.code !== 0) throw deskRefusal(r.code, r.said, "cleaning the desk");
    return { ...(JSON.parse(r.out) as Omit<DeskCleaned, "deskVersion">), deskVersion };
  }

  private attemptDir(dispatchKey: string): string {
    return this.at(`attempts/${attemptHash(checkDispatchKey(dispatchKey))}`);
  }

  private handleOf(r: AttemptRecordFile): AttemptHandle {
    const home = join(this.o.dataRoot, connectionSubpath(r.ids.orbitId, r.connectionHome));
    if (!contained(join(this.o.dataRoot, "connections"), home)) throw new AllocatorError("bad_request", "the connection's home leads outside the connections room");
    return {
      runId: r.runId,
      dispatchKey: r.dispatchKey,
      toolPlane: this.at(`${scratchArea(r.ids, r.assignmentId)}/work`),
      modelPlane: null,
      provider: "process",
      createdAt: r.createdAt,
      modelPlaneHome: home,
      modelPlaneCwd: join(this.attemptDir(r.dispatchKey), "cwd"),
      bridgeCommand: { command: process.execPath, args: [BRIDGE_MAIN] },
    };
  }

  async startAttempt(specIn: AttemptSpec): Promise<AttemptHandle> {
    const spec = checkAttemptSpec({ ...specIn, inputs: [] });
    const dir = this.attemptDir(spec.dispatchKey);
    const existing = existsSync(join(dir, "attempt.json")) ? (JSON.parse(readFileSync(join(dir, "attempt.json"), "utf8")) as AttemptRecordFile) : null;
    if (existing !== null) {
      if (existing.runId !== spec.runId || existing.ids.employeeId !== spec.employeeId) throw new AllocatorError("conflict", `the dispatch key ${spec.dispatchKey} belongs to another run`);
      return this.handleOf(existing);
    }
    if (this.readJson(workspaceMeta(spec, spec.assignmentId)) === null) throw new AllocatorError("conflict", "the assignment's workspace was not prepared");
    const input = this.at(`${scratchArea(spec, spec.assignmentId)}/input`);
    for (const name of readdirSync(input)) rmSync(join(input, name), { recursive: true, force: true });
    for (const i of specIn.inputs) {
      if (this.o.readInput === undefined) throw new AllocatorError("bad_request", "this provider was given no way to read inputs");
      writeFileSync(join(input, checkInputName(i.name)), await this.o.readInput(i.storePath), { flag: "wx", mode: 0o444 });
    }
    if (spec.teamRoom !== null) mkdirSync(this.at(teamArea(spec.orbitId, spec.teamRoom.id)), { recursive: true, mode: 0o700 });
    mkdirSync(join(dir, "cwd"), { recursive: true, mode: 0o700 });
    const record: AttemptRecordFile = { dispatchKey: spec.dispatchKey, runId: spec.runId, ids: { orbitId: spec.orbitId, employeeId: spec.employeeId, sandboxId: spec.sandboxId }, assignmentId: spec.assignmentId, teamRoomId: spec.teamRoom?.id ?? null, connectionHome: spec.modelPlane.connectionHome, createdAt: this.now().toISOString(), stopped: false };
    writeFileSync(join(dir, "attempt.json"), JSON.stringify(record), { mode: 0o600 });
    return this.handleOf(record);
  }

  private record(dispatchKey: string): AttemptRecordFile | null {
    const p = join(this.attemptDir(dispatchKey), "attempt.json");
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as AttemptRecordFile) : null;
  }

  async find(dispatchKey: string): Promise<AttemptStatus | null> {
    const r = this.record(dispatchKey);
    if (r === null) return null;
    return { handle: this.handleOf(r), toolPlaneRunning: !r.stopped, modelPlaneRunning: false, oomKilled: { modelPlane: false, toolPlane: false } };
  }

  async attest(): Promise<AttemptEvidence> {
    const checkedAt = this.now().toISOString();
    return { attestation: { provider: "process", state: "not_isolated", shell: false, detail: NOT_ISOLATED, checks: [{ name: "isolation", ok: false, detail: NOT_ISOLATED }], checkedAt }, applied: null, observed: null };
  }

  modelPlane(): ProcessPort {
    return this.o.process;
  }

  async exec(_handle: AttemptHandle, _req: ExecRequest): Promise<ExecResult> {
    throw new AllocatorError("shell_refused", NOT_ISOLATED);
  }

  // A tool path (an area of FILE_AREAS, or /toolbox) as a directory of this attempt, held inside the area it names, through
  // links too. To `write`, an area it may only read (/input: what was handed to it) is refused before anything is touched.
  private place(handle: AttemptHandle, path: string, write = false): { abs: string; root: string } {
    const r = this.record(handle.dispatchKey);
    if (r === null) throw new AllocatorError("not_found", "no such attempt");
    const tool = checkToolPath(path, { write });
    const scratch = this.at(scratchArea(r.ids, r.assignmentId));
    const roots: Record<string, string | null> = { "/work": join(scratch, "work"), "/output": join(scratch, "output"), "/input": join(scratch, "input"), "/team": r.teamRoomId === null ? null : this.at(teamArea(r.ids.orbitId, r.teamRoomId)) };
    const top = FILE_ROOTS.find((k) => tool === k || tool.startsWith(`${k}/`)) as string;
    const root = roots[top];
    if (root === null || root === undefined) throw new AllocatorError("bad_request", `${top} is not part of this attempt`);
    const abs = join(root, relative(top, tool));
    if (!contained(root, abs)) throw new AllocatorError("bad_request", "the path leads out of the workspace through a link");
    return { abs, root };
  }

  async readFile(handle: AttemptHandle, path: string, maxBytesIn: number): Promise<Buffer | null> {
    const maxBytes = intIn(maxBytesIn, 0, MAX_FILE_BYTES, "maxBytes");
    const { abs } = this.place(handle, path);
    if (!existsSync(abs)) return null;
    const st = statSync(abs);
    if (!st.isFile()) throw new AllocatorError("bad_request", "not a file");
    if (st.size > maxBytes) throw new AllocatorError("file_too_large", `the file is larger than allowed (${st.size} bytes)`);
    const fd = openSync(realpathSync(abs), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      return readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  async writeFile(handle: AttemptHandle, path: string, bytes: Buffer): Promise<void> {
    if (bytes.length > MAX_FILE_BYTES) throw new AllocatorError("file_too_large", "a file of at most 64 MiB");
    const { abs, root } = this.place(handle, path, true);
    if (abs === root) throw new AllocatorError("bad_request", "not a file path");
    // The missing directories, one at a time, none made through a link that leads out.
    let dir = root;
    for (const seg of relative(root, dirname(abs)).split("/").filter((s) => s.length > 0)) {
      dir = join(dir, seg);
      const st = lstatSync(dir, { throwIfNoEntry: false });
      if (st === undefined) mkdirSync(dir, { mode: 0o755 });
      else if (st.isSymbolicLink() && !contained(root, dir)) throw new AllocatorError("bad_request", "the directory leads out of the workspace through a link");
      else if (!st.isSymbolicLink() && !st.isDirectory()) throw new AllocatorError("bad_request", "a part of the path is not a directory");
    }
    if (!contained(root, dirname(abs))) throw new AllocatorError("bad_request", "the directory leads out of the workspace through a link");
    const st = lstatSync(abs, { throwIfNoEntry: false });
    if (st?.isSymbolicLink()) throw new AllocatorError("bad_request", "the file is a link");
    if (st?.isDirectory()) throw new AllocatorError("bad_request", "a directory is in the way");
    const tmp = join(dirname(abs), `.orbit-write-${randomBytes(6).toString("hex")}`);
    const fd = openSync(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o644);
    try {
      writeSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o644);
    renameSync(tmp, abs);
  }

  async list(handle: AttemptHandle, dir: string, maxEntriesIn: number): Promise<FileEntry[]> {
    const maxEntries = intIn(maxEntriesIn, 1, 10_000, "maxEntries");
    const { abs, root } = this.place(handle, dir);
    if (!existsSync(abs)) throw new AllocatorError("not_found", `${dir} does not exist`);
    if (!statSync(abs).isDirectory()) throw new AllocatorError("bad_request", "not a directory");
    const real = realpathSync(abs);
    const realRoot = realpathSync(root);
    return readdirSync(real)
      .sort()
      .slice(0, maxEntries)
      .flatMap((name) => {
        const st = lstatSync(join(real, name), { throwIfNoEntry: false });
        if (st === undefined) return [];
        return [{ path: relative(realRoot, join(real, name)), type: st.isSymbolicLink() ? ("symlink" as const) : st.isDirectory() ? ("dir" as const) : st.isFile() ? ("file" as const) : ("other" as const), size: st.isFile() ? st.size : 0 }];
      });
  }

  async usage(handle: AttemptHandle): Promise<{ modelPlane: UsageView | null; toolPlane: UsageView | null }> {
    const r = this.record(handle.dispatchKey);
    if (r === null) return { modelPlane: null, toolPlane: null };
    const disk = Math.round((duBytes(this.at(scratchArea(r.ids, r.assignmentId))) / MiB) * 100) / 100;
    return { modelPlane: null, toolPlane: { cpuSeconds: null, memoryCurrentMiB: null, memoryPeakMiB: null, oomKilled: false, pidsPeak: null, diskUsedMiB: disk, networkBytesIn: null, networkBytesOut: null, sampledAt: this.now().toISOString() } };
  }

  async stop(handle: AttemptHandle): Promise<void> {
    const r = this.record(handle.dispatchKey);
    if (r !== null) writeFileSync(join(this.attemptDir(handle.dispatchKey), "attempt.json"), JSON.stringify({ ...r, stopped: true }), { mode: 0o600 });
  }

  async remove(handle: AttemptHandle): Promise<{ gone: boolean; detail: string }> {
    const dir = this.attemptDir(handle.dispatchKey);
    rmSync(dir, { recursive: true, force: true });
    return existsSync(dir) ? { gone: false, detail: "the attempt's directory is still there" } : { gone: true, detail: "the attempt's directory is gone (read back)" };
  }
}
