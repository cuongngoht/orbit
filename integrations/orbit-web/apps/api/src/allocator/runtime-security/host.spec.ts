// THE HOST'S OWN PROOF AND ITS RESTART (ADR 0063): the host canary, the probe a worker's admission reads, and what an
// allocator that starts again does with the attempts it finds -- against a fake host that is both the container runtime
// and the sensor, behaving as the proof of concept saw the real ones behave (a policy refuses only in the namespaces it
// names; a restarted container has a new namespace; a sensor may not be ready yet).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadSandboxConfig } from "../../config/sandbox-config.js";
import type { DockerEngine } from "../docker/engine.js";
import type { InstalledPolicy, RuntimeSecurityBackend, SensorStatus } from "./backend.js";
import { HostSecurity, SECURITY_LABELS } from "./host.js";
import { CANARY_PATH, CANARY_POLICY, type CompiledPolicy } from "./policy.js";

interface Box {
  id: string;
  name: string;
  labels: Record<string, string>;
  running: boolean;
  startedAt: string;
  mnt: string;
}

class FakeHost implements RuntimeSecurityBackend {
  readonly kind = "tetragon" as const;
  boxes = new Map<string, Box>();
  installed = new Map<string, { policy: CompiledPolicy; mode: "enforce" | "monitor" }>();
  status_: SensorStatus = { state: "HEALTHY", generation: "g1", since: "t", version: "v1.8.0", image: "tetragon", detail: "ok" };
  lines: string[] = [];
  listFails = false;
  private n = 0;
  private execs = new Map<string, { id: string; cmd: string[] }>();

  add(name: string, labels: Record<string, string> = {}, running = true): Box {
    this.n += 1;
    const b = { id: `${String(this.n).padStart(2, "0")}${"f".repeat(62)}`, name, labels, running, startedAt: `s${this.n}`, mnt: String(4026534000 + this.n) };
    this.boxes.set(b.id, b);
    return b;
  }
  restart(name: string): void {
    const b = [...this.boxes.values()].find((x) => x.name === name);
    if (b === undefined) return;
    this.n += 1;
    b.mnt = String(4026534000 + this.n);
    b.startedAt = `s${this.n}`;
    b.running = true;
  }
  private find(nameOrId: string): Box | undefined {
    return this.boxes.get(nameOrId) ?? [...this.boxes.values()].find((x) => x.name === nameOrId);
  }
  // ---- the engine ----
  containerInspect(nameOrId: string): Promise<unknown> {
    const b = this.find(nameOrId);
    return Promise.resolve(b === undefined ? null : { Id: b.id, Name: `/${b.name}`, State: { Running: b.running, StartedAt: b.startedAt }, Config: { Labels: b.labels } });
  }
  containerCreate(name: string, body: { Labels?: Record<string, string> }): Promise<string> {
    return Promise.resolve(this.add(name, body.Labels ?? {}, false).id);
  }
  containerStart(id: string): Promise<void> {
    const b = this.find(id);
    if (b !== undefined) b.running = true;
    return Promise.resolve();
  }
  containerStop(id: string): Promise<void> {
    const b = this.find(id);
    if (b !== undefined) b.running = false;
    return Promise.resolve();
  }
  containerList(labels: Record<string, string | null>): Promise<{ Id: string; Names: string[]; Labels: Record<string, string>; State: string }[]> {
    if (this.listFails) return Promise.reject(new Error("the runtime does not answer"));
    const fits = (b: Box) => Object.entries(labels).every(([k, v]) => (v === null ? k in b.labels : b.labels[k] === v));
    return Promise.resolve([...this.boxes.values()].filter(fits).map((b) => ({ Id: b.id, Names: [`/${b.name}`], Labels: b.labels, State: b.running ? "running" : "exited" })));
  }
  execFails = false;
  execCreate(id: string, config: { Cmd: string[] }): Promise<string> {
    if (this.execFails) return Promise.reject(new Error("the runtime refused the exec"));
    this.n += 1;
    const execId = `x${this.n}`;
    this.execs.set(execId, { id, cmd: config.Cmd });
    return Promise.resolve(execId);
  }
  execStart(execId: string, run: { onStdout: (b: Buffer) => void; onStderr: (b: Buffer) => void }): Promise<{ timedOut: boolean; truncatedStream: boolean }> {
    const x = this.execs.get(execId);
    const b = x === undefined ? undefined : this.find(x.id);
    if (x !== undefined && b !== undefined && b.running) run.onStdout(Buffer.from(this.run(b, x.cmd)));
    return Promise.resolve({ timedOut: false, truncatedStream: false });
  }
  execInspect(): Promise<{ ExitCode: number | null; Running: boolean; Pid: number }> {
    return Promise.resolve({ ExitCode: 0, Running: false, Pid: 1 });
  }
  private line(kind: "process_exec" | "process_lsm", b: Box, extra: Record<string, unknown>): void {
    this.n += 1;
    const process = { exec_id: `e${this.n}`, parent_exec_id: "p0", pid: 100 + this.n, binary: extra.binary ?? "/usr/bin/sh", docker: b.id.slice(0, 31), ns: { mnt: { inum: Number(b.mnt) } } };
    this.lines.push(JSON.stringify({ [kind]: { process, ...extra, binary: undefined }, time: new Date(Date.UTC(2026, 10, 27, 0, 0, this.n % 60)).toISOString() }));
  }
  private refuses(b: Box, path: string): string | null {
    for (const { policy } of this.installed.values()) if (policy.inodes.includes(b.mnt) && policy.yaml.includes(`"${path}"`)) return policy.name;
    return null;
  }
  private run(b: Box, cmd: string[]): string {
    if (cmd[0] === "readlink") return `mnt:[${b.mnt}]`;
    if (cmd[0] === "python3") {
      this.line("process_exec", b, { binary: "/proc/self/fd/3" });
      return "";
    }
    const path = cmd[0] === "sh" ? ((cmd[2] ?? "").split(";")[0]?.trim() ?? "") : (cmd[0] ?? "");
    const hit = path === CANARY_PATH ? this.refuses(b, path) : null;
    if (hit !== null) {
      this.line("process_lsm", b, { function_name: "bprm_check_security", policy_name: hit, args: [{ linux_binprm_arg: { path } }], action: "KPROBE_ACTION_OVERRIDE" });
      return `sh: 1: ${path}: Operation not permitted\nrc=126`;
    }
    this.line("process_exec", b, { binary: path });
    return "rc=0";
  }
  // ---- the sensor ----
  status() {
    return Promise.resolve({ ...this.status_ });
  }
  policies(): Promise<InstalledPolicy[] | null> {
    if (this.status_.state !== "HEALTHY") return Promise.resolve(null);
    return Promise.resolve([...this.installed.values()].map(({ policy, mode }) => ({ name: policy.name, state: "TP_STATE_ENABLED", mode, kernelMemoryBytes: 1, overrides: 0 })));
  }
  apply(policy: CompiledPolicy, mode: "enforce" | "monitor") {
    if (this.status_.state !== "HEALTHY") return Promise.resolve({ ok: false, detail: "sensor down" });
    this.installed.set(policy.name, { policy, mode });
    return Promise.resolve({ ok: true, detail: "added" });
  }
  remove(name: string) {
    this.installed.delete(name);
    return Promise.resolve({ ok: true, detail: "deleted" });
  }
  readLines() {
    const lines = this.lines;
    this.lines = [];
    return { lines, gap: false };
  }
  resources() {
    return Promise.resolve({ cpuPercent: 1, memoryMiB: 100 });
  }
}

let clock = Date.parse("2026-11-27T01:00:00.000Z");

function setup(): { host: FakeHost; security: HostSecurity; stateDir: string; logged: string[] } {
  const stateDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "rs-host-"));
  const base = loadSandboxConfig({ ORBIT_WEB_RUNTIME_SECURITY: "tetragon", ORBIT_WEB_RUNTIME_SECURITY_FLOOR: "disabled" });
  const config = { ...base, allocatorServer: { ...base.allocatorServer, stateDir } };
  const host = new FakeHost();
  const logged: string[] = [];
  const security = new HostSecurity({ engine: host as unknown as DockerEngine, config, now: () => new Date(clock), backend: host, log: (line: string) => logged.push(line) });
  return { host, security, stateDir, logged };
}

const prevent = (caps: { capability: string; state: string }[]) => caps.find((c) => c.capability === "prevent.exec")?.state;

test("the host canary is bound again to its container's new namespace when that container started again", async () => {
  const { host, security, stateDir } = setup();
  try {
    assert.equal(prevent(await security.proveCanary(false)), "SUPPORTED");
    host.restart(`${loadSandboxConfig({}).names.prefix}-rs-canary-in`);
    assert.equal(prevent(await security.proveCanary(false)), "SUPPORTED", "proven again on the container's new namespace");
    const inside = [...host.boxes.values()].find((b) => b.name.endsWith("-rs-canary-in"));
    assert.deepEqual(host.installed.get(CANARY_POLICY)?.policy.inodes, [inside?.mnt], "the policy names the new namespace, and only it");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("what the host proves every 30 s is what its probe says: a sensor that was not ready at start is not held against it", async () => {
  const { host, security, stateDir } = setup();
  try {
    host.status_ = { ...host.status_, state: "UNAVAILABLE", detail: "starting" };
    const first = await security.probe({ KernelVersion: "7.0.14", Architecture: "aarch64", OperatingSystem: "Docker Desktop" });
    assert.equal(prevent(first.capabilities), "UNKNOWN");
    host.status_ = { ...host.status_, state: "HEALTHY", detail: "ok" };
    await security.proveCanary(false);
    const now = security.current(first);
    assert.equal(prevent(now.capabilities), "SUPPORTED");
    assert.equal(now.sensor.state, "HEALTHY");
    assert.equal(now.capabilities.find((c) => c.capability === "observe.fileless")?.state, "UNKNOWN", "what was not proven again stays as it was said");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("after a restart, an enforced attempt the allocator holds no record of is contained -- never left running unprotected", async () => {
  const { host, security, stateDir } = setup();
  try {
    const labels = (role: string) => ({ "orbit-web.sandbox": "1", "orbit-web.role": role, "orbit-web.dispatch-key": "asg-9:1", "orbit-web.account": "acc-a", "orbit-web.run": "run-9", [SECURITY_LABELS.mode]: "enforce" });
    const tool = host.add("attempt-tool", labels("tool-plane"));
    const model = host.add("attempt-model", labels("model-plane"));
    const observed = host.add("attempt-observed", { ...labels("tool-plane"), "orbit-web.dispatch-key": "asg-8:1", [SECURITY_LABELS.mode]: "observe" });
    await security.begin();
    assert.equal(tool.running, false);
    assert.equal(model.running, false);
    assert.equal(observed.running, true, "observation is never containment");
  } finally {
    security.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a restart whose restore fails still runs the watchdog, the ingest and the canary -- and says why", async () => {
  const { host, security, stateDir, logged } = setup();
  try {
    writeFileSync(join(stateDir, "runtime-security"), "not a directory");
    host.listFails = true;
    await security.begin();
    assert.equal(security.running, true);
    assert.ok(logged.some((l) => /could not be restored/.test(l)), logged.join("\n"));
  } finally {
    security.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a proof that failed is never held as the last one: what it could not prove is said UNKNOWN", async () => {
  const { host, security, stateDir } = setup();
  try {
    const first = await security.probe({ KernelVersion: "7.0.14", Architecture: "aarch64", OperatingSystem: "Docker Desktop" });
    assert.equal(prevent(first.capabilities), "SUPPORTED");
    host.execFails = true;
    await security.proveCanary(true).catch(() => undefined);
    assert.equal(prevent(security.current(first).capabilities), "UNKNOWN");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a proof not taken again lately is not said to hold: the host is UNKNOWN until it is proven again", async () => {
  const { security, stateDir } = setup();
  try {
    const first = await security.probe({ KernelVersion: "7.0.14", Architecture: "aarch64", OperatingSystem: "Docker Desktop" });
    assert.equal(prevent(security.current(first).capabilities), "SUPPORTED");
    clock += 80_000;
    const stale = security.current(first).capabilities;
    assert.ok(stale.every((c) => c.state === "UNKNOWN"), JSON.stringify(stale.map((c) => [c.capability, c.state])));
    await security.proveCanary(true);
    assert.equal(prevent(security.current(first).capabilities), "SUPPORTED", "proven again");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
