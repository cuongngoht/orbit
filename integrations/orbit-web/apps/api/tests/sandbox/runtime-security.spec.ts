// RUNTIME SECURITY ON A REAL KERNEL (ADR 0063): the real allocator, a real pinned Tetragon sensor, the employee images
// built from this tree (the canary baked in), two accounts. Nothing here is mocked: what the kernel refused is read from
// the exit status, the errno and a marker the program would have written; what the sensor saw is read from its export;
// what the allocator holds is read from its own records and the sensor's `tracingpolicy list`. Skipped without a container
// runtime; the enforcement cases are skipped, said so, where the kernel has no BPF LSM.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test, type TestContext } from "node:test";
import { DEFAULT_PRESETS, type ProtectionEvidence, type ResourceProfile } from "@orbit-web/contracts";
import { execIn, text } from "../../src/allocator/containers.js";
import { TETRAGON_ARGS, TETRAGON_IMAGE, TETRAGON_SOCKET } from "../../src/allocator/runtime-security/tetragon.js";
import type { AttemptHandle, AttemptSpec } from "../../src/contexts/execution/application/sandbox.port.js";
import type { ContainerSandboxProvider } from "../../src/contexts/execution/infrastructure/sandbox/container-provider.js";
import type { WireRuntimeEvent } from "../../src/contexts/execution/infrastructure/sandbox/runtime-security-wire.js";
import { createLab, dockerUnavailable, ensureImages, type Lab } from "./harness.js";

const skip = await dockerUnavailable();
if (skip !== null) process.stdout.write(`\n# the runtime security suite is SKIPPED: ${skip}.\n\n`);

const resources: ResourceProfile = { ...(DEFAULT_PRESETS[0] as { profile: ResourceProfile }).profile, cpuMillis: 1000, memoryMiB: 512, pidsLimit: 128, scratchStorageMiB: 256, cacheStorageMiB: 32, deskStorageMiB: 256 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runtime security on a real kernel: one sensor, two accounts, prevention scoped to one attempt", { skip: skip ?? false, timeout: 30 * 60_000 }, () => {
  let lab: Lab;
  let provider: ContainerSandboxProvider;
  let sensor = "";
  let events = "";
  let prevention = false;
  const idsA = () => ({ orbitId: lab.orbitA, employeeId: "emp-a", sandboxId: "sbx-a" });
  const idsB = () => ({ orbitId: lab.orbitB, employeeId: "emp-b", sandboxId: "sbx-b" });
  const spec = (ids: { orbitId: string; employeeId: string; sandboxId: string }, key: string, assignmentId: string, mode: "disabled" | "observe" | "enforce"): AttemptSpec => ({
    ...ids,
    runId: `run-${key.replace(/[^A-Za-z0-9]/g, "")}`,
    dispatchKey: key,
    fence: 1,
    assignmentId,
    resources,
    modelPlane: { cpuMillis: 500, memoryMiB: 256, connectionHome: `${ids.orbitId}/conn-1`, env: {} },
    egress: { proxyHost: "egress", proxyPort: 3128, runToken: lab.runToken },
    bridge: { url: "http://egress:3128/tools", runToken: lab.runToken },
    inputs: [],
    teamRoom: null,
    runtimeSecurity: { mode, controls: ["exec.shared-areas"] },
  });
  const start = async (ids: ReturnType<typeof idsA>, key: string, assignmentId: string, mode: "disabled" | "observe" | "enforce"): Promise<AttemptHandle> => {
    await provider.prepareWorkspace(ids, assignmentId, 256);
    return provider.startAttempt(spec(ids, key, assignmentId, mode));
  };
  // A script written into /output that leaves a marker in /tmp only if it runs: read back from the plane, never the sensor.
  const runFromOutput = async (h: AttemptHandle, tag: string) => {
    const r = await provider.exec(h, { argv: ["sh", "-c", `rm -f /tmp/ran-${tag}; printf '#!/bin/sh\\ntouch /tmp/ran-${tag}\\n' > /output/x-${tag}.sh; chmod +x /output/x-${tag}.sh; /output/x-${tag}.sh; echo "rc=$?"; test -e /tmp/ran-${tag} && echo MARKER || echo NOMARKER`], timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
    return { rc: Number(/rc=(\d+)/.exec(r.stdout)?.[1] ?? -1), ran: /\bMARKER\b/.test(r.stdout), eperm: /not permitted/i.test(r.stdout + r.stderr) };
  };
  const pulled: WireRuntimeEvent[] = [];
  const pull = async (): Promise<WireRuntimeEvent[]> => {
    const p = await lab.allocator.runtimeSecurityPull({ epoch: null, seq: 0 }, 5000);
    for (const e of p.events) if (!pulled.some((x) => x.seq === e.seq)) pulled.push(e);
    return pulled;
  };
  const tetra = (args: string[]) => execIn(lab.engine, sensor, ["tetra", "--server-address", TETRAGON_SOCKET, ...args], { timeoutMs: 30_000, maxOutputBytes: 4 * 1024 * 1024 });
  const sensorReady = async () => {
    for (let i = 0; i < 120; i += 1) {
      const s = await tetra(["status"]).catch(() => null);
      if (s !== null && s.code === 0 && /running/i.test(text(s.stdout))) return;
      await sleep(500);
    }
    throw new Error("the sensor did not report running");
  };
  const evidence = (h: AttemptHandle): ProtectionEvidence | null => lab.allocator.security.service.evidence(h.dispatchKey);

  before(async () => {
    await ensureImages();
    if (spawnSync("docker", ["image", "inspect", TETRAGON_IMAGE]).status !== 0) spawnSync("docker", ["pull", TETRAGON_IMAGE], { stdio: "ignore" });
    events = mkdtempSync(join(tmpdir(), "ow-rs-events-"));
    const engine = (await import("../../src/allocator/docker/engine.js")).DockerEngine;
    const probeEngine = new engine(process.env.ORBIT_WEB_DOCKER_SOCKET ?? "/var/run/docker.sock");
    sensor = `owt-rs-sensor-${Date.now().toString(36)}`;
    const made = await probeEngine.containerCreate(sensor, { Image: TETRAGON_IMAGE, Cmd: [...TETRAGON_ARGS], Labels: { "orbit-web.test": sensor }, HostConfig: { Privileged: true, PidMode: "host", CgroupnsMode: "host", NetworkMode: "none", Binds: ["/sys/kernel:/sys/kernel", `${events}:/var/log/tetragon`] } });
    if (made === null) throw new Error("the sensor container already exists");
    await probeEngine.containerStart(made.id);
    lab = await createLab({ ORBIT_WEB_RUNTIME_SECURITY: "tetragon", ORBIT_WEB_RUNTIME_SECURITY_SENSOR: sensor, ORBIT_WEB_RUNTIME_SECURITY_EVENTS_DIR: events, ORBIT_WEB_RUNTIME_SECURITY_CONTAIN_AFTER_MS: "3000" });
    await sensorReady();
    provider = lab.provider();
    for (const ids of [idsA(), idsB()]) assert.equal((await provider.provisionEmployee(ids, { deskMiB: 256, cacheMiB: 32 })).state, "READY");
  });

  after(async () => {
    if (lab) await lab.cleanup();
    if (sensor !== "") spawnSync("docker", ["rm", "-f", sensor], { stdio: "ignore" });
    if (events !== "") rmSync(events, { recursive: true, force: true });
  });

  test("the probe PROVES what this host can do: observation, prevention, a scope that is not the host's, a fileless exec seen", async (t: TestContext) => {
    const caps = await provider.probe(true);
    const rs = caps.runtimeSecurity;
    assert.ok(rs !== undefined);
    for (const c of rs.capabilities) t.diagnostic(`${c.capability}: ${c.state} -- ${c.detail}`);
    t.diagnostic(`sensor ${rs.sensor.state} ${rs.backendVersion ?? "?"} · host ${rs.hostKind} · kernel ${rs.kernel}`);
    assert.equal(rs.backend, "tetragon");
    assert.equal(rs.sensor.state, "HEALTHY");
    const state = Object.fromEntries(rs.capabilities.map((c) => [c.capability, c.state]));
    assert.equal(state["observe.process"], "SUPPORTED");
    assert.equal(state["scope.workload"], "SUPPORTED");
    assert.equal(state["observe.fileless"], "SUPPORTED");
    prevention = state["prevent.exec"] === "SUPPORTED";
    if (!prevention) t.diagnostic(`prevention is ${state["prevent.exec"]} on this kernel: the enforcement cases below are skipped, said so`);
  });

  test("disabled is Orbit Web 0.8.0: nothing installed, the attempt opens, a script in /output runs", async () => {
    const h = await start(idsA(), "rs-dis:1", "asg-dis", "disabled");
    assert.equal(h.protection?.state, "UNREGISTERED");
    const opened = await provider.open(h);
    assert.equal(opened.protection?.mode, "disabled");
    const r = await runFromOutput(h, "dis");
    assert.deepEqual([r.rc, r.ran], [0, true]);
    assert.equal(((await tetra(["tracingpolicy", "list", "-o", "json"])).stdout.toString().match(/orbit-a-/g) ?? []).length, 0, "no attempt policy for a disabled attempt");
    assert.equal((await provider.remove(h)).gone, true);
  });

  test("enforce: proven before it opens; nothing runs before; then a script in /output is PREVENTED, and only for this attempt", async (t: TestContext) => {
    if (!prevention) return t.skip("no BPF LSM prevention on this kernel");
    const a = await start(idsA(), "rs-enf:1", "asg-enf", "enforce");
    const e = evidence(a);
    for (const c of e?.checks ?? []) t.diagnostic(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail ?? ""}`);
    assert.equal(e?.state, "VERIFIED", e?.detail);
    assert.ok(e?.planes.every((p) => p.mntNs !== null && p.mntNs === p.sensorMntNs), "the plane and the sensor agree on each namespace");
    // Nothing the employee runs starts before the gate: no shell, no runner credential.
    await assert.rejects(provider.exec(a, { argv: ["true"], timeoutMs: 5_000, maxOutputBytes: 1024 }), /runtime_protection_not_established/);
    assert.throws(() => provider.modelPlane(a), /not been opened/);
    const opened = await provider.open(a);
    assert.equal(opened.protection?.state, "PROTECTED");
    // The policy, read back by the harness itself from the sensor.
    const listed = JSON.parse((await tetra(["tracingpolicy", "list", "-o", "json"])).stdout.toString()) as { policies: { name: string; state: string; mode: string }[] };
    assert.ok(listed.policies.some((p) => p.name === e?.policy && p.state === "TP_STATE_ENABLED" && p.mode === "TP_MODE_ENFORCE"));
    // B (another account), observed: the same operation in its own attempt still runs.
    const b = await start(idsB(), "rs-obs:1", "asg-obs", "observe");
    assert.equal(b.protection?.state, "OBSERVING", b.protection?.detail);
    await provider.open(b);
    const inA = await runFromOutput(a, "enf");
    const inB = await runFromOutput(b, "obs");
    assert.deepEqual([inA.rc, inA.ran, inA.eperm], [126, false, true], "prevented in A: EPERM, exit 126, the marker never written");
    assert.deepEqual([inB.rc, inB.ran], [0, true], "B is outside A's policy: it ran (and was only reported)");
    // The model plane is told apart from the tool plane, and held too.
    const m = await execIn(lab.engine, a.modelPlane as string, ["sh", "-c", 'printf "#!/bin/sh\\necho x\\n" > /connection/x.sh; chmod +x /connection/x.sh; /connection/x.sh; echo "rc=$?"'], { user: "10001:10001", timeoutMs: 15_000, maxOutputBytes: 8192 });
    assert.match(`${text(m.stdout)} ${text(m.stderr)}`, /rc=126/);
    await sleep(1500);
    const seen = await pull();
    const prevented = seen.filter((x) => x.kind === "control.match" && x.outcome === "OPERATION_PREVENTED");
    const detected = seen.filter((x) => x.kind === "control.match" && x.outcome === "VIOLATION_DETECTED");
    t.diagnostic(`pulled ${seen.length} events: ${prevented.length} prevented, ${detected.length} detected`);
    assert.ok(prevented.some((x) => x.accountId === lab.orbitA && x.runId === "run-rsenf1" && x.plane === "tool-plane" && x.path === "/output/x-enf.sh" && x.control === "exec.shared-areas"));
    assert.ok(prevented.some((x) => x.accountId === lab.orbitA && x.plane === "model-plane" && x.path === "/connection/x.sh"));
    assert.ok(detected.some((x) => x.accountId === lab.orbitB && x.runId === "run-rsobs1" && x.path === "/output/x-obs.sh"), "observe reports the match and calls it a detection");
    // Tenant isolation of telemetry: every event of A's runs is A's, every event of B's runs is B's.
    for (const x of seen) {
      if (x.runId === "run-rsenf1") assert.equal(x.accountId, lab.orbitA);
      if (x.runId === "run-rsobs1") assert.equal(x.accountId, lab.orbitB);
    }
    assert.ok(seen.some((x) => x.kind === "process.exec" && x.runId === "run-rsobs1" && x.plane === "tool-plane"), "B's processes are observed");
    // The canary's own probes never show up as anyone's telemetry.
    assert.ok(!seen.some((x) => x.binary?.endsWith("runtime-canary") || x.path?.endsWith("runtime-canary")));
    // Cleanup: the policy goes first and is read back gone.
    const name = e?.policy as string;
    const removed = await provider.remove(a);
    assert.equal(removed.gone, true);
    assert.match(removed.detail, /removed and read back gone/);
    assert.ok(!(await tetra(["tracingpolicy", "list", "-o", "json"])).stdout.toString().includes(name));
    assert.equal((await provider.remove(b)).gone, true);
  });

  test("policy drift: the attempt's policy removed behind the allocator's back -- lost at once, both planes contained after the deadline", async (t: TestContext) => {
    if (!prevention) return t.skip("no BPF LSM prevention on this kernel");
    const a = await start(idsA(), "rs-drift:1", "asg-drift", "enforce");
    await provider.open(a);
    lab.allocator.security.service.canaryProven(Date.now());
    await tetra(["tracingpolicy", "delete", evidence(a)?.policy as string]);
    await lab.allocator.security.service.watch();
    assert.equal(evidence(a)?.state, "UNKNOWN", "lost: nobody may call it protected");
    await assert.rejects(provider.exec(a, { argv: ["true"], timeoutMs: 5_000, maxOutputBytes: 1024 }), /runtime_protection_not_established/);
    await sleep(3200);
    lab.allocator.security.service.canaryProven(Date.now());
    await lab.allocator.security.service.watch();
    assert.equal(evidence(a)?.state, "CONTAINED", evidence(a)?.detail);
    const found = await provider.find(a.dispatchKey);
    assert.deepEqual([found?.toolPlaneRunning, found?.modelPlaneRunning], [false, false], "both planes stopped, read back");
    assert.equal((await provider.remove(a)).gone, true);
  });

  test("a sensor restart drops every policy: an enforced attempt is contained, an observed one gets its policy back", async (t: TestContext) => {
    if (!prevention) return t.skip("no BPF LSM prevention on this kernel");
    const enforced = await start(idsA(), "rs-rst:1", "asg-rst", "enforce");
    await provider.open(enforced);
    const observed = await start(idsB(), "rs-rst-obs:1", "asg-rst-obs", "observe");
    await provider.open(observed);
    await lab.engine.containerStop(sensor, 5);
    await lab.engine.containerStart(sensor);
    await sensorReady();
    lab.allocator.security.service.canaryProven(Date.now());
    await lab.allocator.security.service.watch();
    assert.equal(evidence(enforced)?.state, "UNKNOWN");
    assert.equal(evidence(observed)?.state, "OBSERVING", evidence(observed)?.detail);
    await sleep(3200);
    lab.allocator.security.service.canaryProven(Date.now());
    await lab.allocator.security.service.watch();
    assert.equal(evidence(enforced)?.state, "CONTAINED");
    const list = (await tetra(["tracingpolicy", "list", "-o", "json"])).stdout.toString();
    assert.ok(list.includes(evidence(observed)?.policy as string), "the observed attempt's policy is installed again");
    for (const h of [enforced, observed]) assert.equal((await provider.remove(h)).gone, true);
  });

  test("with the sensor down, an enforced attempt is never opened -- and never quietly observed instead", async (t: TestContext) => {
    if (!prevention) return t.skip("no BPF LSM prevention on this kernel");
    await lab.engine.containerStop(sensor, 5);
    try {
      const a = await start(idsA(), "rs-down:1", "asg-down", "enforce");
      assert.equal(evidence(a)?.state, "UNKNOWN");
      assert.equal(evidence(a)?.mode, "enforce");
      await assert.rejects(provider.open(a), /runtime_protection_not_established/);
      assert.equal((await provider.remove(a)).gone, true);
    } finally {
      await lab.engine.containerStart(sensor);
      await sensorReady();
    }
  });
});
