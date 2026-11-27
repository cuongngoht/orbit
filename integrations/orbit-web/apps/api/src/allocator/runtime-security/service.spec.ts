// THE SECURITY PLANE'S SERVICE (ADR 0063), against a fake kernel that behaves the way the proof of concept saw a real one
// behave: a sensor that exports one line per exec, policies that refuse an exec only inside the namespaces they name, a
// monitor mode whose events still say OVERRIDE, a restart that drops every policy. The same guarantees are proven again
// on a real kernel by tests/sandbox/runtime-security.spec.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { RuntimeControlId, RuntimeMode } from "@orbit-web/governance-core";
import type { InstalledPolicy, RuntimeSecurityBackend, SensorStatus } from "./backend.js";
import { CANARY_PATH, type CompiledPolicy } from "./policy.js";
import { classify, type EventFact } from "../../contexts/runtime-security/domain/rules.js";
import { RuntimeSecurityService, type PlaneRuntime, type ProtectRequest } from "./service.js";

const TOOL = "a".repeat(64);
const MODEL = "b".repeat(64);
const OTHER = "c".repeat(64);

class FakeKernel implements RuntimeSecurityBackend, PlaneRuntime {
  readonly kind = "tetragon" as const;
  containers = new Map<string, { mnt: string; running: boolean; startedAt: string }>([
    [TOOL, { mnt: "4026533001", running: true, startedAt: "s1" }],
    [MODEL, { mnt: "4026533002", running: true, startedAt: "s2" }],
    [OTHER, { mnt: "4026533003", running: true, startedAt: "s0" }],
  ]);
  // A plane started again: new namespaces, a new start time.
  restartPlane(id: string): void {
    const c = this.containers.get(id);
    if (c !== undefined) this.containers.set(id, { mnt: String(Number(c.mnt) + 100), running: true, startedAt: `${c.startedAt}-again` });
  }
  installed = new Map<string, { policy: CompiledPolicy; mode: "enforce" | "monitor" }>();
  status_: SensorStatus = { state: "HEALTHY", generation: "g1", since: "t", version: "v1.8.0", image: "tetragon", detail: "ok" };
  lines: string[] = [];
  // A policy that loads and lists but binds nothing: what only a probe can expose.
  bindsNothing = false;
  failRemove = false;
  // A stop the runtime acknowledged that did not take: the container still runs.
  stopHeld = false;
  stopped: string[] = [];
  private n = 0;

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
    if (this.failRemove) return Promise.resolve({ ok: false, detail: "sensor down" });
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
  restartSensor(): void {
    this.installed.clear();
    this.status_ = { ...this.status_, generation: `g${Number(this.status_.generation?.slice(1) ?? 1) + 1}` };
  }

  private line(kind: "process_exec" | "process_lsm", containerId: string, extra: Record<string, unknown>): void {
    this.n += 1;
    const c = this.containers.get(containerId);
    const process = { exec_id: `e${this.n}`, parent_exec_id: "p0", pid: 100 + this.n, binary: extra.binary ?? "/usr/bin/sh", docker: containerId.slice(0, 31), ns: { mnt: { inum: Number(c?.mnt ?? 0) } } };
    this.lines.push(JSON.stringify({ [kind]: { process, ...extra, binary: undefined }, time: `2026-11-26T12:00:${String(this.n).padStart(2, "0")}.000Z` }));
  }

  // The policy, if any, that names this container's namespace for this path.
  private matching(containerId: string, path: string): { name: string; mode: "enforce" | "monitor" } | null {
    if (this.bindsNothing) return null;
    const mnt = this.containers.get(containerId)?.mnt ?? "";
    for (const { policy, mode } of this.installed.values()) {
      if (!policy.inodes.includes(mnt)) continue;
      const lines = policy.yaml.split("    - matchNamespaces:").slice(1);
      for (const s of lines) if (s.includes(`"${mnt}"`) && (s.includes(`"${path}"`) || [...s.matchAll(/"(\/[^"]*\/)"/g)].some((m) => m[1] !== undefined && path.startsWith(m[1])))) return { name: policy.name, mode };
    }
    return null;
  }

  exec(containerId: string, argv: string[]): Promise<{ code: number | null; out: string }> {
    const c = this.containers.get(containerId);
    if (c === undefined || !c.running) return Promise.resolve({ code: null, out: "no such container" });
    if (argv[0] === "readlink") {
      this.line("process_exec", containerId, { binary: "/usr/bin/readlink" });
      return Promise.resolve({ code: 0, out: `mnt:[${c.mnt}]` });
    }
    const path = argv[0] === "sh" ? (argv[2] ?? "").split(";")[0]?.trim() ?? "" : argv[0] ?? "";
    const hit = this.matching(containerId, path);
    if (hit !== null) this.line("process_lsm", containerId, { function_name: "bprm_check_security", policy_name: hit.name, args: [{ linux_binprm_arg: { path } }], action: "KPROBE_ACTION_OVERRIDE" });
    if (hit?.mode === "enforce") return Promise.resolve({ code: 0, out: `sh: 1: ${path}: Operation not permitted\nrc=126` });
    this.line("process_exec", containerId, { binary: path });
    return Promise.resolve({ code: 0, out: "rc=0" });
  }
  stop(containerId: string): Promise<void> {
    const c = this.containers.get(containerId);
    if (c !== undefined && !this.stopHeld) c.running = false;
    this.stopped.push(containerId);
    return Promise.resolve();
  }
  inspect(containerId: string): Promise<{ running: boolean; startedAt: string } | null> {
    const c = this.containers.get(containerId);
    return Promise.resolve(c === undefined ? null : { running: c.running, startedAt: c.startedAt });
  }
}

let clock = 1_000_000;
const now = () => clock;
const service = (k: FakeKernel, floor: RuntimeMode = "disabled", backend: RuntimeSecurityBackend = k) => new RuntimeSecurityService({ backend, runtime: k, floor, containAfterMs: 15_000, freshMs: 60_000, canaryMaxAgeMs: 90_000, sensorWaitMs: 200, pollMs: 1, now });
const request = (mode: RuntimeMode, controls: RuntimeControlId[] = ["exec.shared-areas"], over: Partial<ProtectRequest> = {}): ProtectRequest => ({
  dispatchKey: "asg-1:1",
  runKind: "assignment",
  runId: "run-1",
  accountId: "acc-a",
  employeeId: "emp-1",
  assignmentId: "asg-1",
  sessionId: null,
  fence: 1,
  requested: { mode, controls },
  planes: [
    { plane: "tool-plane", containerId: TOOL, startedAt: "s1", user: "20001:20001" },
    { plane: "model-plane", containerId: MODEL, startedAt: "s2", user: "10001:10001" },
  ],
  ...over,
});

test("enforce: identity bound by the plane AND the sensor, the policy read back, the canary refused in both planes -- then, and only then, the gate opens", async () => {
  const k = new FakeKernel();
  const s = service(k);
  s.canaryProven(clock);
  const e = await s.protect(request("enforce"));
  assert.equal(e.state, "VERIFIED", JSON.stringify(e.checks));
  assert.equal(e.mode, "enforce");
  assert.deepEqual(e.planes.map((p) => [p.mntNs, p.sensorMntNs]), [["4026533001", "4026533001"], ["4026533002", "4026533002"]]);
  assert.ok(e.checks.every((c) => c.ok), JSON.stringify(e.checks));
  assert.ok(e.policy !== null && e.digest !== null);
  assert.equal(k.installed.get(e.policy ?? "")?.mode, "enforce");
  assert.deepEqual(s.gate("asg-1:1"), { open: true, reason: "" });
  const opened = s.open("asg-1:1");
  assert.equal(opened.state, "PROTECTED");
  assert.ok(opened.freshUntil !== null && Date.parse(opened.freshUntil) > clock);
});

test("enforce with no backend, or a sensor that is down: never opened, and never quietly observed instead", async () => {
  const k = new FakeKernel();
  const { DisabledBackend } = await import("./backend.js");
  const none = service(k, "disabled", new DisabledBackend());
  const e = await none.protect(request("enforce"));
  assert.equal(e.state, "UNKNOWN");
  assert.match(e.detail, /no runtime security backend/i);
  assert.equal(none.gate("asg-1:1").open, false);
  assert.throws(() => none.open("asg-1:1"), /runtime_protection_not_established/);
  const down = new FakeKernel();
  down.status_ = { ...down.status_, state: "UNAVAILABLE", generation: null };
  const s = service(down);
  assert.equal((await s.protect(request("enforce"))).state, "UNKNOWN");
  assert.equal(s.gate("asg-1:1").open, false);
});

test("a policy that loads and lists but binds nothing is caught by the canary: the gate stays shut", async () => {
  const k = new FakeKernel();
  k.bindsNothing = true;
  const s = service(k);
  s.canaryProven(clock);
  const e = await s.protect(request("enforce"));
  assert.equal(e.state, "UNKNOWN");
  assert.ok(e.checks.some((c) => c.name === "canary_refused" && !c.ok), JSON.stringify(e.checks));
  assert.equal(s.gate("asg-1:1").open, false);
});

test("the deployment's floor applies in the allocator too: a request that asks for nothing is still enforced", async () => {
  const k = new FakeKernel();
  const s = service(k, "enforce");
  s.canaryProven(clock);
  const e = await s.protect(request("disabled", []));
  assert.equal(e.requestedMode, "disabled");
  assert.equal(e.mode, "enforce");
  assert.equal(e.state, "VERIFIED");
});

test("disabled: nothing installed, nothing claimed, the gate open as in 0.8.0", async () => {
  const k = new FakeKernel();
  const s = service(k);
  const e = await s.protect(request("disabled", []));
  assert.equal(e.state, "UNREGISTERED");
  assert.equal(k.installed.size, 0);
  assert.equal(s.gate("asg-1:1").open, true);
});

test("observe: the policy is installed in monitor mode, a match is a VIOLATION_DETECTED and the operation ran; a canary is never forwarded", async () => {
  const k = new FakeKernel();
  const s = service(k);
  const e = await s.protect(request("observe"));
  assert.equal(e.state, "OBSERVING", JSON.stringify(e.checks));
  assert.equal(k.installed.get(e.policy ?? "")?.mode, "monitor");
  assert.equal(s.gate("asg-1:1").open, true);
  await k.exec(TOOL, ["sh", "-c", "/team/x.sh; echo rc=$?"]);
  s.ingest();
  const { events } = s.pull({ epoch: null, seq: 0 }, 100);
  const match = events.filter((x) => x.kind === "control.match");
  assert.equal(match.length, 1);
  assert.equal(match[0]?.outcome, "VIOLATION_DETECTED");
  assert.equal(match[0]?.control, "exec.shared-areas");
  assert.equal(match[0]?.accountId, "acc-a");
  assert.ok(!events.some((x) => x.path === CANARY_PATH), "the canary's own probes are not telemetry");
});

test("enforce: a match is OPERATION_PREVENTED, attributed to its account, run and plane", async () => {
  const k = new FakeKernel();
  const s = service(k);
  s.canaryProven(clock);
  await s.protect(request("enforce"));
  s.open("asg-1:1");
  const r = await k.exec(MODEL, ["sh", "-c", "/connection/payload; echo rc=$?"]);
  assert.match(r.out, /rc=126/);
  s.ingest();
  const m = s.pull({ epoch: null, seq: 0 }, 100).events.filter((x) => x.kind === "control.match");
  assert.deepEqual(m.map((x) => [x.outcome, x.plane, x.runId, x.path]), [["OPERATION_PREVENTED", "model-plane", "run-1", "/connection/payload"]]);
});

test("a stale policy still holding this attempt's namespace inode is removed before the attempt is bound", async () => {
  const k = new FakeKernel();
  const s = service(k);
  s.canaryProven(clock);
  const first = await s.protect(request("enforce"));
  k.failRemove = true;
  const released = await s.release("asg-1:1");
  assert.equal(released.policyRemoved, false);
  k.failRemove = false;
  // The kernel hands the same inodes to the next attempt's containers.
  const second = await s.protect(request("enforce", ["exec.shared-areas"], { dispatchKey: "asg-1:2", runId: "run-2", planes: [{ plane: "tool-plane", containerId: TOOL, startedAt: "s3", user: "20001:20001" }, { plane: "model-plane", containerId: MODEL, startedAt: "s4", user: "10001:10001" }] }));
  assert.equal(second.state, "VERIFIED");
  assert.equal(k.installed.has(first.policy ?? ""), false, "the stale policy was reaped first");
  assert.ok(second.checks.some((c) => c.name === "no_stale_policy" && c.ok));
});

test("protection that cannot be re-proven is lost at once -- the gate shuts -- and both planes are stopped after the deadline", async () => {
  const k = new FakeKernel();
  const s = service(k);
  s.canaryProven(clock);
  await s.protect(request("enforce"));
  s.open("asg-1:1");
  k.restartSensor();
  await s.watch();
  assert.equal(s.evidence("asg-1:1")?.state, "UNKNOWN");
  assert.equal(s.evidence("asg-1:1")?.freshUntil, null);
  assert.equal(s.gate("asg-1:1").open, false);
  assert.deepEqual(k.stopped, []);
  clock += 15_000;
  s.canaryProven(clock);
  await s.watch();
  assert.equal(s.evidence("asg-1:1")?.state, "CONTAINED");
  assert.deepEqual(k.stopped.sort(), [MODEL, TOOL].sort());
  // Contained once: a second pass does nothing more.
  await s.watch();
  assert.equal(k.stopped.length, 2);
});

test("an observed attempt is never contained: the sensor restarts, its policy is put back", async () => {
  const k = new FakeKernel();
  const s = service(k);
  await s.protect(request("observe"));
  k.restartSensor();
  await s.watch();
  assert.equal(k.stopped.length, 0);
  assert.equal(s.evidence("asg-1:1")?.state, "OBSERVING");
  assert.equal(k.installed.size, 1, "re-applied under the new generation");
});

test("release removes the policy and reads it gone; the workload's late events stay its own", async () => {
  const k = new FakeKernel();
  const s = service(k);
  s.canaryProven(clock);
  const e = await s.protect(request("enforce"));
  const r = await s.release("asg-1:1");
  assert.deepEqual(r, { policyRemoved: true, detail: `${e.policy} removed and read back gone` });
  assert.equal(k.installed.size, 0);
  assert.equal(s.evidence("asg-1:1")?.state, "CLEANED_UP");
  await k.exec(TOOL, ["true"]);
  s.ingest();
  assert.ok(s.pull({ epoch: null, seq: 0 }, 100).events.some((x) => x.kind === "process.exec" && x.runId === "run-1"));
});

test("telemetry: an event from a container Orbit did not make is counted and dropped; the pull is a cursor with an epoch, and an overflow is said", async () => {
  const k = new FakeKernel();
  const s = new RuntimeSecurityService({ backend: k, runtime: k, floor: "disabled", containAfterMs: 15_000, freshMs: 60_000, canaryMaxAgeMs: 90_000, sensorWaitMs: 200, pollMs: 1, now, ringSize: 5 });
  await s.protect(request("observe"));
  s.pull({ epoch: null, seq: 0 }, 1000);
  await k.exec(OTHER, ["true"]);
  s.ingest();
  const p = s.pull({ epoch: null, seq: 0 }, 1000);
  assert.equal(p.unattributed >= 1, true);
  assert.ok(p.events.every((x) => x.accountId === "acc-a"));
  for (let i = 0; i < 9; i += 1) await k.exec(TOOL, ["true"]);
  s.ingest();
  const late = s.pull({ epoch: p.epoch, seq: 0 }, 1000);
  assert.ok(late.lost > 0, "events the ring no longer holds are said lost, never skipped silently");
  const again = s.pull({ epoch: "an-older-epoch", seq: 999 }, 1000);
  assert.equal(again.reset, true, "a restarted allocator's numbering starts over, and says so");
});

test("a plane restarted under a proven attempt (new namespaces) is lost protection, then contained -- never a stale VERIFIED", async () => {
  const k = new FakeKernel();
  const s = service(k);
  s.canaryProven(clock);
  await s.protect(request("enforce"));
  s.open("asg-1:1");
  k.restartPlane(TOOL);
  await s.watch();
  assert.equal(s.evidence("asg-1:1")?.state, "UNKNOWN");
  assert.match(s.evidence("asg-1:1")?.detail ?? "", /restarted/);
  assert.equal(s.gate("asg-1:1").open, false);
  clock += 15_000;
  s.canaryProven(clock);
  await s.watch();
  assert.equal(s.evidence("asg-1:1")?.state, "CONTAINED");
});

// WHAT THE REAL SENSOR SAID (tests/fixtures/tetragon-1.8.0/exec-lifecycle.jsonl): Tetragon v1.8.0's export on Docker
// Desktop, its container ids and namespaces mapped onto this kernel's two planes and nothing else changed, for the
// allocator's own execs into a tool and a model plane (readlink, the canary through sh, node), runc's re-exec of itself
// before it joins a container (in the HOST's mount namespace: every docker exec makes one), and a workload's own
// memory-only execs (by path and by descriptor) and a shell a process inside the model plane started. Replayed through
// the allocator and judged by the API's rules -- the one place each half is decided.
const REPLAY = readFileSync(join(process.cwd(), "tests", "fixtures", "tetragon-1.8.0", "exec-lifecycle.jsonl"), "utf8").trim().split("\n");

test("replayed from the real sensor: runc's own re-exec and the allocator's own execs raise nothing; the workload's fileless execs and its model-plane shell do", async () => {
  const k = new FakeKernel();
  const s = service(k);
  await s.protect(request("observe"));
  s.ingest();
  const before = s.pull({ epoch: null, seq: 0 }, 10_000);
  k.lines.push(...REPLAY);
  s.ingest();
  const { events } = s.pull({ epoch: before.epoch, seq: before.next }, 10_000);
  assert.ok(!events.some((x) => x.binary === "/proc/self/fd/6"), "runc's own re-exec is never the workload's");
  const judged = events.map((x) => ({ x, c: classify({ kind: x.kind as EventFact["kind"], outcome: x.outcome, plane: x.plane, binary: x.binary, path: x.path, control: x.control, runKind: x.runKind, parentBinary: x.parentBinary }) }));
  assert.deepEqual(
    judged.filter(({ c }) => c.severity !== "INFO").map(({ x, c }) => [c.kind, x.plane, x.binary]),
    [
      ["exec.fileless", "tool-plane", "/proc/self/fd/3"],
      ["exec.fileless", "tool-plane", "/dev/fd/3"],
      ["exec.model_plane", "model-plane", "/bin/sh"],
    ],
  );
});

test("a containment that did not take is tried again at the next watch until both planes read back stopped", async () => {
  const k = new FakeKernel();
  const s = service(k);
  s.canaryProven(clock);
  await s.protect(request("enforce"));
  s.open("asg-1:1");
  k.restartSensor();
  await s.watch();
  clock += 15_000;
  s.canaryProven(clock);
  k.stopHeld = true;
  await s.watch();
  assert.equal(s.evidence("asg-1:1")?.state, "CONTAINING", "a stop that did not take is not a containment");
  k.stopHeld = false;
  await s.watch();
  assert.equal(s.evidence("asg-1:1")?.state, "CONTAINED");
  assert.equal(k.containers.get(TOOL)?.running, false);
  assert.equal(k.containers.get(MODEL)?.running, false);
});

test("a flood never evicts what matters: information goes first when the ring is full, and what was evicted is counted exactly", async () => {
  const k = new FakeKernel();
  const s = new RuntimeSecurityService({ backend: k, runtime: k, floor: "disabled", containAfterMs: 15_000, freshMs: 60_000, canaryMaxAgeMs: 90_000, sensorWaitMs: 200, pollMs: 1, now, ringSize: 100 });
  await s.protect(request("observe"));
  s.ingest();
  const start = s.pull({ epoch: null, seq: 0 }, 10_000);
  // An employee runs a program from memory, then floods the sensor with short-lived processes to push it out.
  const line = (n: number, binary: string) => JSON.stringify({ process_exec: { process: { exec_id: `flood-${n}`, parent_exec_id: "p0", pid: 5000 + n, binary, docker: TOOL.slice(0, 31), ns: { mnt: { inum: 4026533001 } } }, parent: { binary: "/usr/bin/python3" } }, time: `2026-11-27T01:00:00.${String(n).padStart(6, "0")}Z` });
  k.lines.push(line(0, "/proc/self/fd/3"), ...Array.from({ length: 500 }, (_, i) => line(i + 1, "/usr/bin/true")));
  s.ingest();
  const p = s.pull({ epoch: start.epoch, seq: start.next }, 10_000);
  assert.ok(p.events.some((e) => e.binary === "/proc/self/fd/3"), "the memory-only exec survived the flood");
  assert.equal(p.events.length + p.lost, 501, "every event of the range is either returned or counted lost");
  assert.ok(p.lost > 0);
});

test("a released attempt's record goes once it has been reported long enough: the pull is the size of what is live", async () => {
  const k = new FakeKernel();
  const s = service(k);
  await s.protect(request("observe"));
  await s.release("asg-1:1");
  assert.equal(s.protections().find((p) => p.dispatchKey === "asg-1:1")?.state, "CLEANED_UP", "said cleaned up first");
  clock += 9 * 60_000;
  await s.watch();
  assert.equal(s.protections().length, 1, "still reported for a while");
  clock += 2 * 60_000;
  await s.watch();
  assert.deepEqual(s.protections(), [], "then gone, with what was kept for it");
  assert.deepEqual(s.exportRecords(), []);
});
