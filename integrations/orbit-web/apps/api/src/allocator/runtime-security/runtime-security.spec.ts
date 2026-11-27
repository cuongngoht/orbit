// THE SECURITY PLANE'S PURE PARTS (ADR 0063): the policy compiler, the sensor's event parser, the workload registry and
// the watchdog's decision -- each from what the proof of concept saw a real Tetragon v1.8.0 say on a real kernel
// (tests/runtime-security/results/0.8.1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CANARY_PATH, compileAttemptPolicy, isOrbitPolicy, policyNameOf, PolicyCompileError } from "./policy.js";
import { WorkloadRegistry, type WorkloadInit } from "./registry.js";
import { parseSensorLine, SENSOR_LINE_MAX } from "./sensor-events.js";
import { decide, type WatchSnapshot } from "./watchdog.js";

const TOOL = "4fa029fa2246425783f62f3182751fcdd8d6b241f04c7a9efb50017f585eb4bb";
const MODEL = "8d3d8e2dbbe23c77e17cb7052a80dae1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5";
const planes = [
  { plane: "tool-plane" as const, containerId: TOOL, mntNs: "4026533515" },
  { plane: "model-plane" as const, containerId: MODEL, mntNs: "4026533517" },
];

// ---- the compiler ---------------------------------------------------------------------------------------------------

test("an attempt's policy: one deterministic name per dispatch key and container pair, never another attempt's", () => {
  const a = policyNameOf("asg-1:1", [TOOL, MODEL]);
  assert.match(a, /^orbit-a-[0-9a-f]{12}-[0-9a-f]{12}$/);
  assert.equal(policyNameOf("asg-1:1", [TOOL, MODEL]), a);
  assert.notEqual(policyNameOf("asg-1:2", [TOOL, MODEL]), a, "a new attempt, a new name");
  assert.notEqual(policyNameOf("asg-1:1", [MODEL, TOOL]), a, "recreated containers, a new name");
  assert.equal(isOrbitPolicy(a), true);
  assert.equal(isOrbitPolicy("orbit-canary-host"), true);
  assert.equal(isOrbitPolicy("someone-elses"), false);
});

test("the compiled policy names each plane's namespace in every selector, the canary in both, and is the same bytes every time", () => {
  const p = compileAttemptPolicy({ dispatchKey: "asg-1:1", planes, controls: ["exec.shared-areas"] });
  assert.equal(p.yaml, compileAttemptPolicy({ dispatchKey: "asg-1:1", planes, controls: ["exec.shared-areas"] }).yaml);
  assert.match(p.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(p.inodes, ["4026533515", "4026533517"]);
  // Every selector carries a namespace: none can match the host.
  const selectors = p.yaml.split("    - matchNamespaces:").slice(1);
  assert.equal(selectors.length, 3, "the tool plane's areas, the model plane's area, the canary");
  for (const s of selectors) assert.match(s, /namespace: Mnt\n\s+operator: In\n\s+values: \["\d+"(, "\d+")?\]/);
  assert.ok(p.yaml.includes('values: ["/team/", "/output/", "/input/"]'));
  assert.ok(p.yaml.includes('values: ["/connection/"]'));
  assert.ok(p.yaml.includes(`values: ["${CANARY_PATH}"]`));
  assert.ok(p.yaml.includes('values: ["4026533515", "4026533517"]'), "the canary in both planes");
  assert.ok(p.yaml.includes("hook: bprm_check_security"));
  assert.ok(p.yaml.includes("action: Override") && p.yaml.includes("argError: -1"));
  // No control: the canary alone (a policy whose binding a probe can still prove).
  const bare = compileAttemptPolicy({ dispatchKey: "asg-1:1", planes, controls: [] });
  assert.equal(bare.yaml.split("    - matchNamespaces:").length - 1, 1);
});

test("the compiler refuses what would widen the policy, rather than guess", () => {
  const refuses = (over: Partial<Parameters<typeof compileAttemptPolicy>[0]>, re: RegExp) => assert.throws(() => compileAttemptPolicy({ dispatchKey: "asg-1:1", planes, controls: ["exec.shared-areas"], ...over }), (e: unknown) => e instanceof PolicyCompileError && re.test(e.message));
  refuses({ planes: [] }, /both planes/);
  refuses({ planes: [planes[0]] }, /both planes/);
  refuses({ planes: [planes[0], { ...planes[1], mntNs: "" }] }, /namespace/);
  refuses({ planes: [planes[0], { ...planes[1], mntNs: "4026533515 or 1" }] }, /namespace/);
  refuses({ planes: [planes[0], { ...planes[1], mntNs: "4026533515" }] }, /share/);
  refuses({ planes: [planes[0], { ...planes[1], plane: "tool-plane" }] }, /both planes/);
  refuses({ controls: ["exec.everything" as never] }, /control/);
  refuses({ dispatchKey: "" }, /dispatch key/);
});

// ---- the sensor's events -------------------------------------------------------------------------------------------

const EXEC = `{"process_exec":{"process":{"exec_id":"YzY1ZTlhMjEwNGE5Ojg2MjEyMTc2OTQzNDg6MTE5MjQ=","pid":11924,"uid":20001,"cwd":"/work","binary":"/usr/bin/sh","arguments":"-c secret","flags":"execve","start_time":"2026-11-26T15:53:09.665592293Z","docker":"4fa029fa2246425783f62f3182751fc","parent_exec_id":"YzY1ZTlhMjEwNGE5Ojg2MjEyMTcyODE2NDA6MTE5MTg=","ns":{"mnt":{"inum":4026533515}}},"parent":{"exec_id":"YzY1ZTlhMjEwNGE5Ojg2MjEyMTcyODE2NDA6MTE5MTg=","binary":"/usr/bin/runc","arguments":"init"}},"node_name":"c65e9a2104a9","time":"2026-11-26T15:53:09.665707459Z"}`;
const EXIT = `{"process_exit":{"process":{"exec_id":"YzY1ZTlhMjEwNGE5Ojg2MjEyMTc2OTQzNDg6MTE5MjQ=","pid":11924,"binary":"/usr/bin/sh","docker":"4fa029fa2246425783f62f3182751fc","parent_exec_id":"YzY1"},"status":3,"signal":"SIGKILL"},"time":"2026-11-26T15:53:10.0Z"}`;
const OVERRIDE = `{"process_lsm":{"process":{"exec_id":"YzY1X2E=","pid":11925,"binary":"/usr/bin/sh","docker":"4fa029fa2246425783f62f3182751fc","ns":{"mnt":{"inum":4026533515}}},"function_name":"bprm_check_security","policy_name":"orbit-a-111111111111-222222222222","args":[{"linux_binprm_arg":{"path":"/team/x.sh","permission":"-rwxr-xr-x"}}],"action":"KPROBE_ACTION_OVERRIDE"},"time":"2026-11-26T15:53:11.0Z"}`;
const RUNC = `{"process_lsm":{"process":{"exec_id":"YzY1X2I=","pid":11918,"uid":0,"binary":"/usr/bin/runc","ns":{"mnt":{"inum":4026531832,"is_host":true}}},"function_name":"bprm_check_security","policy_name":"orbit-a-111111111111-222222222222","args":[{"linux_binprm_arg":{"path":"${CANARY_PATH}","permission":"-rwxr-xr-x"}}],"action":"KPROBE_ACTION_OVERRIDE"},"time":"2026-11-26T15:53:12.0Z"}`;

test("the sensor's lines become facts: an exec, an exit, a hook that matched -- and never a process's arguments", () => {
  const e = parseSensorLine(EXEC);
  assert.equal(e?.kind, "exec");
  assert.equal(e?.dockerPrefix, "4fa029fa2246425783f62f3182751fc");
  assert.equal(e?.binary, "/usr/bin/sh");
  assert.equal(e?.parentBinary, "/usr/bin/runc");
  assert.equal(e?.mntNs, "4026533515");
  assert.equal(e?.uid, 20001);
  assert.ok(!JSON.stringify(e).includes("secret") && !JSON.stringify(e).includes("init"), "arguments never survive the parser");
  const x = parseSensorLine(EXIT);
  assert.equal(x?.kind, "exit");
  assert.equal(x?.exitCode, 3);
  assert.equal(x?.signal, "SIGKILL");
  const o = parseSensorLine(OVERRIDE);
  assert.equal(o?.kind, "hook");
  assert.equal(o?.action, "override");
  assert.equal(o?.policy, "orbit-a-111111111111-222222222222");
  assert.equal(o?.path, "/team/x.sh");
  const r = parseSensorLine(RUNC);
  assert.equal(r?.dockerPrefix, null, "runc's own exec into a container carries no container id");
  assert.equal(r?.hostNs, true);
  assert.equal(parseSensorLine(OVERRIDE.replace("KPROBE_ACTION_OVERRIDE", "KPROBE_ACTION_POST"))?.action, "post");
});

test("a line the parser cannot trust is dropped whole: not JSON, too long, of a kind nobody asked for", () => {
  assert.equal(parseSensorLine("not json"), null);
  assert.equal(parseSensorLine(`{"process_exec":${"x".repeat(SENSOR_LINE_MAX)}}`), null);
  assert.equal(parseSensorLine(`{"process_loader":{"process":{}}}`), null);
  assert.equal(parseSensorLine(`[]`), null);
  // Long values are cut, never carried whole.
  const long = parseSensorLine(EXEC.replace('"/usr/bin/sh"', JSON.stringify(`/w/${"a".repeat(10_000)}`)));
  assert.ok((long?.binary?.length ?? 0) <= 1024);
});

// ---- the registry ---------------------------------------------------------------------------------------------------

const workload = (over: Partial<WorkloadInit> = {}): WorkloadInit => ({
  dispatchKey: "asg-1:1",
  runKind: "assignment",
  accountId: "acc-a",
  runId: "run-1",
  employeeId: "emp-1",
  assignmentId: "asg-1",
  sessionId: null,
  fence: 1,
  mode: "enforce",
  controls: ["exec.shared-areas"],
  planes: planes.map((p) => ({ plane: p.plane, containerId: p.containerId, startedAt: "2026-11-26T15:53:00Z" })),
  ...over,
});

test("an event is attributed by the container it came from, to that workload's account, run and plane -- else to nobody", () => {
  const reg = new WorkloadRegistry();
  reg.register(workload());
  reg.register(workload({ dispatchKey: "asg-9:1", accountId: "acc-b", runId: "run-9", planes: [{ plane: "tool-plane", containerId: "b".repeat(64), startedAt: "x" }, { plane: "model-plane", containerId: "c".repeat(64), startedAt: "x" }] }));
  const hit = reg.attribute({ dockerPrefix: TOOL.slice(0, 31), policy: null });
  assert.equal(hit?.workload.accountId, "acc-a");
  assert.equal(hit?.plane, "tool-plane");
  assert.equal(reg.attribute({ dockerPrefix: "b".repeat(31), policy: null })?.workload.accountId, "acc-b");
  assert.equal(reg.attribute({ dockerPrefix: "d".repeat(31), policy: null }), null, "a container nobody made here belongs to no account");
  assert.equal(reg.attribute({ dockerPrefix: null, policy: null }), null);
});

test("runc's own exec into a container is attributed by the policy that matched it; a container and a policy that disagree are a mismatch", () => {
  const reg = new WorkloadRegistry();
  reg.register(workload());
  reg.bindPolicy("asg-1:1", { name: "orbit-a-111111111111-222222222222", inodes: ["4026533515", "4026533517"], digest: "d" });
  const byPolicy = reg.attribute({ dockerPrefix: null, policy: "orbit-a-111111111111-222222222222" });
  assert.equal(byPolicy?.workload.dispatchKey, "asg-1:1");
  assert.equal(byPolicy?.plane, null);
  reg.register(workload({ dispatchKey: "asg-9:1", accountId: "acc-b", planes: [{ plane: "tool-plane", containerId: "b".repeat(64), startedAt: "x" }, { plane: "model-plane", containerId: "c".repeat(64), startedAt: "x" }] }));
  const mixed = reg.attribute({ dockerPrefix: "b".repeat(31), policy: "orbit-a-111111111111-222222222222" });
  assert.equal(mixed?.mismatch, true, "acc-b's container matched acc-a's policy: an identity mismatch, never silently either");
});

test("a removed workload leaves a tombstone: its late events are still its own, and no new workload inherits its mapping", () => {
  const reg = new WorkloadRegistry({ tombstoneMs: 60_000, now: () => 1_000 });
  reg.register(workload());
  reg.retire("asg-1:1");
  assert.equal(reg.attribute({ dockerPrefix: TOOL.slice(0, 31), policy: null })?.workload.runId, "run-1");
  assert.equal(reg.attribute({ dockerPrefix: TOOL.slice(0, 31), policy: null })?.retired, true);
  assert.equal(reg.live().length, 0);
});

test("before binding, every other policy holding the same namespace inode is found -- inodes are reused at once", () => {
  const reg = new WorkloadRegistry();
  reg.register(workload({ dispatchKey: "old:1" }));
  reg.bindPolicy("old:1", { name: "orbit-a-000000000000-000000000000", inodes: ["4026533515"], digest: "d0" });
  reg.retire("old:1");
  reg.register(workload({ dispatchKey: "asg-1:1" }));
  assert.deepEqual(reg.policiesHolding(["4026533515", "4026533999"], "asg-1:1"), ["orbit-a-000000000000-000000000000"]);
  assert.deepEqual(reg.policiesHolding(["4026533999"], "asg-1:1"), []);
});

// ---- the watchdog ---------------------------------------------------------------------------------------------------

const snap = (over: Partial<WatchSnapshot> = {}): WatchSnapshot => ({
  now: 100_000,
  containAfterMs: 15_000,
  freshMs: 60_000,
  canaryMaxAgeMs: 90_000,
  sensor: { state: "HEALTHY", generation: "g1" },
  canary: { provenAt: 95_000 },
  installed: [{ name: "orbit-a-1", state: "TP_STATE_ENABLED", mode: "enforce" }],
  workloads: [{ dispatchKey: "asg-1:1", mode: "enforce", state: "PROTECTED", policy: "orbit-a-1", sensorGeneration: "g1", lostSince: null }],
  ...over,
});

test("the watchdog renews proof that still holds, and nothing else", () => {
  assert.deepEqual(decide(snap()), [{ type: "renew", dispatchKey: "asg-1:1", freshUntil: 160_000 }]);
});

test("protection that cannot be re-proven is LOST at once, and contained only after the deadline (never before)", () => {
  for (const [why, over] of [
    ["sensor restarted", { sensor: { state: "HEALTHY", generation: "g2" } }],
    ["sensor gone", { sensor: { state: "UNAVAILABLE", generation: null } }],
    ["policy gone", { installed: [] }],
    ["policy disabled", { installed: [{ name: "orbit-a-1", state: "TP_STATE_DISABLED", mode: "enforce" }] }],
    ["policy in monitor mode", { installed: [{ name: "orbit-a-1", state: "TP_STATE_ENABLED", mode: "monitor" }] }],
    ["canary stale", { canary: { provenAt: 5_000 } }],
    ["installed list unreadable", { installed: null }],
  ] as const) {
    const first = decide(snap(over as Partial<WatchSnapshot>));
    assert.equal(first.length, 1, why);
    assert.equal(first[0]?.type, "lost", why);
    const later = decide(snap({ ...(over as Partial<WatchSnapshot>), workloads: [{ dispatchKey: "asg-1:1", mode: "enforce", state: "PROTECTED", policy: "orbit-a-1", sensorGeneration: "g1", lostSince: 100_000 - 14_000 }] }));
    assert.equal(later.length, 0, `${why}: still inside the deadline`);
    const due = decide(snap({ ...(over as Partial<WatchSnapshot>), workloads: [{ dispatchKey: "asg-1:1", mode: "enforce", state: "PROTECTED", policy: "orbit-a-1", sensorGeneration: "g1", lostSince: 100_000 - 15_000 }] }));
    assert.deepEqual(due.map((a) => a.type), ["contain"], `${why}: the deadline passed`);
  }
});

test("an observed workload is never contained: a faltering sensor makes it DEGRADED, and a healthy one re-applies its policy", () => {
  const observed = [{ dispatchKey: "obs:1", mode: "observe" as const, state: "OBSERVING" as const, policy: "orbit-a-2", sensorGeneration: "g1", lostSince: null }];
  assert.deepEqual(decide(snap({ workloads: observed, installed: [{ name: "orbit-a-2", state: "TP_STATE_ENABLED", mode: "monitor" }] })), [{ type: "renew", dispatchKey: "obs:1", freshUntil: 160_000 }]);
  assert.deepEqual(decide(snap({ workloads: observed, sensor: { state: "UNAVAILABLE", generation: null } })).map((a) => a.type), ["degrade"]);
  assert.deepEqual(decide(snap({ workloads: observed, installed: [], sensor: { state: "HEALTHY", generation: "g2" } })).map((a) => a.type), ["reapply"]);
});

test("a policy no live workload owns is reaped; a policy that is not Orbit's is never touched", () => {
  const actions = decide(snap({ installed: [{ name: "orbit-a-1", state: "TP_STATE_ENABLED", mode: "enforce" }, { name: "orbit-a-gone", state: "TP_STATE_ENABLED", mode: "enforce" }, { name: "operators-own", state: "TP_STATE_ENABLED", mode: "enforce" }] }));
  assert.deepEqual(actions.filter((a) => a.type === "reap"), [{ type: "reap", policy: "orbit-a-gone" }]);
});

test("a workload contained (read back stopped) is left to its containment, never decided twice", () => {
  const actions = decide(snap({ workloads: [{ dispatchKey: "asg-1:1", mode: "enforce", state: "CONTAINED", policy: "orbit-a-1", sensorGeneration: "g1", lostSince: 1 }], installed: [] }));
  assert.deepEqual(actions, []);
});

test("a containment not read back yet is carried out again at every watch -- one failed stop never leaves an attempt running", () => {
  const actions = decide(snap({ workloads: [{ dispatchKey: "asg-1:1", mode: "enforce", state: "CONTAINING", policy: "orbit-a-1", sensorGeneration: "g1", lostSince: 1 }], installed: [] }));
  assert.deepEqual(actions.map((a) => [a.type, "dispatchKey" in a ? a.dispatchKey : null]), [["contain", "asg-1:1"]]);
});

test("a plane that restarted since its protection was proven has new namespaces: protection is LOST (never a stale binding)", () => {
  const restarted = { dispatchKey: "asg-1:1", mode: "enforce" as const, state: "PROTECTED" as const, policy: "orbit-a-1", sensorGeneration: "g1", lostSince: null, restarted: true };
  assert.deepEqual(decide(snap({ workloads: [restarted] })).map((a) => a.type), ["lost"]);
  const observed = { ...restarted, dispatchKey: "obs:1", mode: "observe" as const, state: "OBSERVING" as const, policy: "orbit-a-2" };
  assert.deepEqual(decide(snap({ workloads: [observed], installed: [{ name: "orbit-a-2", state: "TP_STATE_ENABLED", mode: "monitor" }] })).map((a) => a.type), ["degrade"], "observation must be bound again: degraded, never re-applied to the old namespace");
});
