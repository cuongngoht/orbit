// AN EMPLOYEE'S ATTEMPT IN REAL CONTAINERS (ADR 0061): the allocator against this host's container runtime, the
// container provider over it. Every claim here is read from the runtime and the kernel, never from a stored value:
// limits applied (docker inspect) and observed (the container's cgroup files) and behaving (an OOM kill, a fork loop
// stopped); storage refusing a write past its quota (or said to be SOFT/UNSUPPORTED, with why); the connection's login
// and another employee's desk invisible from the tool plane; no way out but the proxy; one attempt per dispatch key,
// found again by a fresh process, stopped and removed -- removal read back. Skipped, saying why, without a runtime.
//
//   npm run test:sandbox -w @orbit-web/api
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test, type TestContext } from "node:test";
import { DEFAULT_PRESETS, type ResourceProfile } from "@orbit-web/contracts";
import { Allocator } from "../../src/allocator/allocator.js";
import { allocatorServer } from "../../src/allocator/server.js";
import type { AttemptHandle, AttemptSpec, HostCapabilities } from "../../src/contexts/execution/application/sandbox.port.js";
import { AllocatorClient } from "../../src/contexts/execution/infrastructure/sandbox/allocator-client.js";
import { AllocatorError } from "../../src/contexts/execution/infrastructure/sandbox/allocator-protocol.js";
import type { ContainerSandboxProvider } from "../../src/contexts/execution/infrastructure/sandbox/container-provider.js";
import { attemptNetworks, runnerToken } from "../../src/contexts/execution/infrastructure/sandbox/ids.js";
import { RunnerProcessPort } from "../../src/infra/process/runner-port.js";
import { createLab, dockerUnavailable, ensureImages, type Lab } from "./harness.js";

const skip = await dockerUnavailable();
if (skip !== null) process.stdout.write(`\n# the sandbox suite is SKIPPED: ${skip}. It needs a container runtime (Docker) on this machine.\n\n`);

const MiB = 1024 * 1024;
// Small limits, so the behaviour tests are quick: 1 vCPU, 512 MiB, 128 PIDs, the smallest desk and scratch the contract
// allows (256 MiB), a 32 MiB cache.
const resources: ResourceProfile = { ...(DEFAULT_PRESETS[0] as { profile: ResourceProfile }).profile, cpuMillis: 1000, memoryMiB: 512, pidsLimit: 128, scratchStorageMiB: 256, cacheStorageMiB: 32, deskStorageMiB: 256 };

const run = (_lab: Lab, p: ContainerSandboxProvider, h: AttemptHandle, script: string, timeoutMs = 60_000) => p.exec(h, { argv: ["sh", "-c", script], timeoutMs, maxOutputBytes: 1024 * 1024 });

describe("an employee's attempt in real containers", { skip: skip ?? false, timeout: 30 * 60_000 }, () => {
  let lab: Lab;
  let provider: ContainerSandboxProvider;
  let caps: HostCapabilities;
  let handle: AttemptHandle;
  const timings: string[] = [];
  const idsA = () => ({ orbitId: lab.orbitA, employeeId: "emp-a", sandboxId: "sbx-a" });
  const idsB = () => ({ orbitId: lab.orbitB, employeeId: "emp-b", sandboxId: "sbx-b" });
  const spec = (ids: { orbitId: string; employeeId: string; sandboxId: string }, key: string, assignmentId: string, over: Partial<AttemptSpec> = {}): AttemptSpec => ({
    ...ids,
    runId: `run-${key.replace(/[^A-Za-z0-9]/g, "")}`,
    dispatchKey: key,
    fence: 1,
    assignmentId,
    resources,
    modelPlane: { cpuMillis: 500, memoryMiB: 256, connectionHome: `${ids.orbitId}/conn-1`, env: {} },
    egress: { proxyHost: "egress", proxyPort: 3128, runToken: lab.runToken },
    bridge: { url: "http://egress:3128/tools", runToken: lab.runToken },
    inputs: [{ name: "brief.txt", storePath: "objects/brief" }],
    teamRoom: null,
    ...over,
  });
  const timed = async <T>(what: string, f: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await f();
    } finally {
      timings.push(`${what} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  };

  before(async () => {
    await timed("images (cached build)", () => ensureImages());
    lab = await timed("lab", () => createLab());
    provider = lab.provider();
  });
  after(async () => {
    if (lab) await timed("cleanup", () => lab.cleanup());
    process.stdout.write(`# timings: ${timings.join(" · ")}\n`);
  });

  test("the probe says what this host enforces, each with its evidence", async (t: TestContext) => {
    caps = await timed("probe", () => provider.probe(true));
    t.diagnostic(`runtime: ${caps.runtime.detail}`);
    t.diagnostic(`limits: cpu ${caps.limits.cpu}, memory ${caps.limits.memory}, pids ${caps.limits.pids} -- ${caps.limits.evidence}`);
    t.diagnostic(`storage: ${caps.storage.mechanism}, per area ${caps.storage.perArea}, host ${caps.storage.hostProtection} -- ${caps.storage.evidence}`);
    assert.equal(caps.runtime.reachable, true);
    assert.deepEqual([caps.limits.cpu, caps.limits.memory, caps.limits.pids], ["HARD_ENFORCED", "HARD_ENFORCED", "HARD_ENFORCED"]);
    if (caps.storage.perArea === "HARD_ENFORCED") assert.match(caps.storage.evidence, /REFUSED by the kernel/);
    else assert.match(caps.storage.evidence, /measured|not refused|failed|UNSUPPORTED|no workforce/i);
    assert.ok(caps.host.cpuMillis !== null && caps.host.memoryMiB !== null);
    // A pool is preallocated by default: filling it cannot fill the host disk.
    if (caps.storage.mechanism === "btrfs-qgroup" || caps.storage.mechanism === "xfs-loop-pool") assert.equal(caps.storage.hostProtection, "HARD_ENFORCED", caps.storage.evidence);
  });

  test("a Personal Sandbox is READY with its areas' levels and evidence, and provisioning again finds it", async () => {
    const a = await timed("provision A", () => provider.provisionEmployee(idsA(), { deskMiB: resources.deskStorageMiB, cacheMiB: resources.cacheStorageMiB }));
    assert.equal(a.state, "READY", a.reason ?? "");
    assert.deepEqual(a.areas.map((x) => [x.area, x.quotaMiB, x.level]), [["desk", 256, caps.storage.perArea], ["cache", 32, caps.storage.perArea]]);
    assert.equal((await provider.provisionEmployee(idsA(), { deskMiB: 256, cacheMiB: 32 })).state, "READY");
    assert.equal((await provider.provisionEmployee({ ...idsA(), sandboxId: "sbx-other" }, { deskMiB: 256, cacheMiB: 32 })).state, "FAILED");
    assert.equal((await provider.provisionEmployee(idsB(), { deskMiB: 256, cacheMiB: 0 })).state, "READY");
  });

  test("one dispatch key is one attempt: a second start returns the first", async () => {
    await timed("prepare workspace", () => provider.prepareWorkspace(idsA(), "asg-a", resources.scratchStorageMiB));
    handle = await timed("start attempt", () => provider.startAttempt(spec(idsA(), "run-a:1", "asg-a")));
    const again = await provider.startAttempt(spec(idsA(), "run-a:1", "asg-a"));
    assert.deepEqual([again.toolPlane, again.modelPlane], [handle.toolPlane, handle.modelPlane]);
    assert.deepEqual([handle.modelPlaneHome, handle.modelPlaneCwd], ["/connection", "/workdir"]);
    const list = await lab.engine.containerList({ "orbit-web.dispatch-key": "run-a:1" });
    assert.equal(list.length, 2);
    await assert.rejects(provider.startAttempt(spec(idsA(), "run-a:1", "asg-a", { runId: "run-intruder" })), /another run/);
  });

  test("the attestation holds every check -- limits applied and observed, mounts, canaries, no way out, storage", async (t: TestContext) => {
    const e = await timed("attest", () => provider.attest(handle, spec(idsA(), "run-a:1", "asg-a")));
    for (const c of e.attestation.checks) t.diagnostic(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail ?? ""}`);
    const failed = e.attestation.checks.filter((c) => !c.ok).map((c) => c.name);
    const storageFails = caps.storage.perArea === "HARD_ENFORCED" ? [] : ["storage_enforcement"];
    assert.deepEqual(failed, storageFails);
    assert.equal(e.attestation.shell, storageFails.length === 0);
    for (const name of ["attempt_networks", "tool_plane_limits_applied", "tool_plane_limits_observed", "model_plane_limits_observed", "tool_plane_mounts", "tool_plane_mount_roots", "model_plane_mounts", "no_managed_settings", "credential_canary", "sibling_desk_canary", "no_docker_socket", "direct_egress", "public_dns", "no_database", "no_model_plane", "tmp_quota"]) assert.ok(e.attestation.checks.some((c) => c.name === name && c.ok), name);
    assert.deepEqual(e.applied && [e.applied.cpuMillis, e.applied.memoryMiB, e.applied.pidsLimit], [1000, 512, 128]);
    assert.deepEqual(e.observed && [e.observed.cpuQuota, e.observed.memoryLimit, e.observed.pidsMax], ["100000/100000", String(512 * MiB), "128"]);
  });

  test("the model plane runs a scripted CLI through its runner, streaming; another attempt's token opens nothing", async () => {
    const port = provider.modelPlane(handle);
    const child = port.spawn("node", ["-e", "process.stdin.on('data',d=>process.stdout.write(String(d).toUpperCase())); process.stdin.on('end',()=>{require('fs').readFileSync(process.env.CLAUDE_CONFIG_DIR+'/.credentials.json');process.stdout.write('|'+process.cwd()+'|'+process.env.HOME);process.exit(0)})"], { cwd: handle.modelPlaneCwd, env: { HOME: handle.modelPlaneCwd, CLAUDE_CONFIG_DIR: `${handle.modelPlaneHome}/claude` } });
    let out = "";
    child.onStdout((c) => (out += c));
    child.write("hello ");
    await new Promise((r) => setTimeout(r, 200));
    child.write("plane");
    child.closeInput();
    const exit = await child.exited;
    assert.deepEqual([exit.code, out], [0, "HELLO PLANE|/workdir|/workdir"]);
    // The model-plane image of the Dockerfile's own target: the CLI as the worker starts it -- its environment names no
    // PATH (the image's, passed on by the runner), a read-only root, the connection's home.
    if (process.env.ORBIT_WEB_SANDBOX_TEST_MODEL_PLANE) {
      const v = await port.run("claude", ["--version"], { cwd: handle.modelPlaneCwd, env: { HOME: handle.modelPlaneCwd, LANG: "C.UTF-8", NO_COLOR: "1", CLAUDE_CONFIG_DIR: `${handle.modelPlaneHome}/claude` }, timeoutMs: 60_000 });
      assert.match(v.stdout, /Claude Code/, `${v.stdout} ${v.stderr} ${v.spawnError ?? ""}`);
    }
    const ip = (await lab.engine.containerInspect(handle.modelPlane as string))?.NetworkSettings.Networks?.[attemptNetworks(lab.prefix, "run-a:1").model]?.IPAddress as string;
    const other = await new RunnerProcessPort(ip, 7070, runnerToken(lab.secret, "run-b:1")).run("node", ["-e", "process.stdout.write('ran')"], { cwd: "/workdir", env: {}, timeoutMs: 10_000 });
    assert.deepEqual([other.stdout, other.spawnError], ["", "ERUNNERLOST"]);
  });

  test("the tool plane: an argument list, its own user, a full toolchain; inputs read-only; HOME on the scratch", async () => {
    const r = await run(lab, provider, handle, "id -u; python3 -c 'import sys; print(sys.version_info[0])'; node -e 'console.log(1+1)'; git --version | cut -d' ' -f1; cat /input/brief.txt; echo; echo x > /input/new 2>/dev/null || echo ro; echo $HOME; touch /usr/x 2>/dev/null || echo rootro; ls -ld /toolbox | cut -c1");
    assert.deepEqual(r.stdout.trim().split("\n"), ["20001", "3", "2", "git", "input:objects/brief", "ro", "/home/employee", "rootro", "l"]);
    const argv = await provider.exec(handle, { argv: ["printf", "%s|", "; rm -rf /work", "$(id)"], timeoutMs: 5000, maxOutputBytes: 1000 });
    assert.equal(argv.stdout, "; rm -rf /work|$(id)|");
    const slow = await provider.exec(handle, { argv: ["sleep", "30"], timeoutMs: 800, maxOutputBytes: 100 });
    assert.equal(slow.timedOut, true);
  });

  test("the connection's login is unreadable from the tool plane: not mounted, not found anywhere", async () => {
    const r = await run(lab, provider, handle, `ls /connection 2>&1; grep -rl ${lab.credential} /work /output /input /home /tmp /cache /team /data /mnt /var /run /connection 2>/dev/null | head -3; echo end`);
    assert.match(r.stdout, /No such file or directory/);
    assert.ok(r.stdout.trim().endsWith("end"));
    assert.doesNotMatch(r.stdout, /credentials/);
  });

  test("no way out but the proxy: a direct connection and a public name fail; the proxy answers with the run's token only", async () => {
    const direct = await run(lab, provider, handle, "node -e \"require('net').connect(443,'1.1.1.1').on('connect',()=>console.log('OPEN')).on('error',e=>console.log(e.code))\"; getent hosts example.com || echo nodns");
    assert.doesNotMatch(direct.stdout, /OPEN/);
    assert.match(direct.stdout, /nodns/);
    const through = await run(lab, provider, handle, "curl -sS -m 10 http://origin.test/hello; echo; curl -sS -m 10 -o /dev/null -w '%{http_code}' -x http://run:wrong-token@egress:3128 http://origin.test/x; echo; curl -sS -m 10 -o /dev/null -w '%{http_code}' http://elsewhere.test/");
    assert.deepEqual(through.stdout.trim().split("\n"), ["origin-ok /hello", "407", "403"]);
    const db = await run(lab, provider, handle, `node -e "require('net').connect(5432,'${lab.databaseIp}').on('connect',()=>console.log('OPEN')).on('error',e=>console.log(e.code)).setTimeout(3000,function(){console.log('TIMEOUT');this.destroy()})"`);
    assert.doesNotMatch(db.stdout, /OPEN/);
  });

  test("files: binary-safe, held to /work, /output, /team and /toolbox through links", async () => {
    const bytes = Buffer.from([...Array(256).keys()]);
    await provider.writeFile(handle, "/toolbox/scripts/bytes.bin", bytes);
    assert.deepEqual(await provider.readFile(handle, "toolbox/scripts/bytes.bin", 1000), bytes);
    await provider.writeFile(handle, "/output/report.md", Buffer.from("# done\n"));
    assert.deepEqual((await provider.list(handle, "/output", 10)).map((f) => [f.path, f.type, f.size]), [["report.md", "file", 7]]);
    assert.equal(await provider.readFile(handle, "/work/missing", 10), null);
    await run(lab, provider, handle, "ln -s /etc/passwd /work/link; ln -s /input /work/indir; ln -s / /work/root");
    for (const p of ["link", "indir/brief.txt", "root/etc/passwd"]) await assert.rejects(provider.readFile(handle, p, 10_000), (e: unknown) => e instanceof AllocatorError && e.code === "bad_request", p);
    await assert.rejects(provider.writeFile(handle, "root/tmp/planted", Buffer.from("x")), (e: unknown) => e instanceof AllocatorError && e.code === "bad_request");
    await assert.rejects(provider.readFile(handle, "/cache/x", 10), /inside \/work/);
    await assert.rejects(provider.readFile(handle, "../etc/passwd", 10), /inside \/work/);
    await assert.rejects(provider.readFile(handle, "toolbox/scripts/bytes.bin", 10), (e: unknown) => e instanceof AllocatorError && e.code === "file_too_large");
    await run(lab, provider, handle, "rm -f /work/link /work/indir /work/root");
  });

  test(`the scratch quota (${resources.scratchStorageMiB} MiB) refuses a write past it -- or the level says it is not enforced`, async (t: TestContext) => {
    const r = await run(lab, provider, handle, `python3 -c "
import os
n = 0
try:
    with open('/work/fill', 'wb') as f:
        for _ in range(${resources.scratchStorageMiB * 2}):
            n += f.write(b'0' * 1048576)
            f.flush(); os.fsync(f.fileno())
    print(n, 'none')
except OSError as e:
    print(n, e.errno)
"; rm -f /work/fill`);
    const [written, errno] = r.stdout.trim().split(" ");
    t.diagnostic(`a write into /work stopped at ${written} bytes (errno ${errno}); storage per area: ${caps.storage.perArea}`);
    if (caps.storage.perArea === "HARD_ENFORCED") {
      assert.ok(errno === "122" || errno === "28", `refused by the kernel (EDQUOT 122 / ENOSPC 28): ${r.stdout}`);
      assert.ok(Number(written) <= (resources.scratchStorageMiB + 1) * MiB);
    } else assert.equal(errno, "none");
  });

  test("an allocation past the memory limit is OOM-killed, and reported", async () => {
    const r = await run(lab, provider, handle, "python3 -c 'b = chr(120) * (1024*1024*1024); print(len(b))'");
    assert.equal(r.code, 137, `${r.stdout} ${r.stderr}`);
    assert.equal(r.signal, "SIGKILL");
    const found = await provider.find(handle.dispatchKey);
    assert.deepEqual(found?.oomKilled, { toolPlane: true, modelPlane: false });
    const u = await provider.usage(handle);
    assert.equal(u.toolPlane?.oomKilled, true);
    assert.ok((u.toolPlane?.memoryPeakMiB ?? 0) >= 400, `peak ${u.toolPlane?.memoryPeakMiB}`);
    assert.equal(u.modelPlane?.oomKilled, false);
  });

  test(`a fork loop stops at the PID limit (${resources.pidsLimit})`, async (t: TestContext) => {
    const r = await run(lab, provider, handle, `python3 -c "
import os, signal, time
pids = []
err = None
try:
    while True:
        p = os.fork()
        if p == 0:
            os.close(1); os.close(2)
            time.sleep(60)
            os._exit(0)
        pids.append(p)
except OSError as e:
    err = e.errno
for p in pids: os.kill(p, signal.SIGKILL)
for p in pids: os.waitpid(p, 0)
print(len(pids), err)
"`);
    const [forked, errno] = r.stdout.trim().split(" ");
    t.diagnostic(`forked ${forked} children before the kernel said errno ${errno}`);
    assert.equal(errno, "11", "EAGAIN from the PID limit");
    assert.ok(Number(forked) < resources.pidsLimit);
  });

  test("employee A's desk is unreadable from employee B's attempt, over the signed wire", async () => {
    const marker = `desk-of-a-${randomBytes(6).toString("hex")}`;
    await provider.writeFile(handle, "/work/private.txt", Buffer.from(marker));
    const published = await provider.publishWorkspace(idsA(), "asg-a", 0);
    assert.deepEqual([published.published, published.deskVersion], [true, 1]);
    // B's whole attempt through the allocator's HTTP door, signed.
    const server = allocatorServer(lab.allocator, lab.secret);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const { port } = server.address() as { port: number };
      const viaWire = lab.provider(new AllocatorClient(`http://127.0.0.1:${port}`, lab.secret));
      await viaWire.prepareWorkspace(idsB(), "asg-b", 256);
      const hb = await viaWire.startAttempt(spec(idsB(), "run-b:1", "asg-b"));
      const e = await viaWire.attest(hb, spec(idsB(), "run-b:1", "asg-b"));
      assert.equal(e.attestation.checks.find((c) => c.name === "sibling_desk_canary")?.ok, true);
      const r = await run(lab, viaWire, hb, `grep -rl ${marker} /work /output /input /home /tmp /cache /team /data /mnt /var /run 2>/dev/null | head -3; ls /work; echo end`);
      assert.doesNotMatch(r.stdout, /private\.txt|work\/|desk/);
      assert.equal((await viaWire.readFile(hb, "/work/private.txt", 100)), null);
      assert.equal((await viaWire.remove(hb)).gone, true);
      assert.equal((await viaWire.removeWorkspace(idsB(), "asg-b")).gone, true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  // ADR 0061 §9: a mission's team has one room per department. The room an attempt is given is mounted at /team and
  // no other: what one department's attempt left there is not in another's, and the next attempt of the same
  // department finds it as it was left.
  test("a team room reaches only the attempts given it: one department's room is not another's", async () => {
    const research = { id: randomUUID(), quotaMiB: 64 };
    const finance = { id: randomUUID(), quotaMiB: 64 };
    const marker = `research-only-${randomBytes(6).toString("hex")}`;
    await provider.prepareWorkspace(idsB(), "asg-room-r", 256);
    const r = await timed("start (Research's room)", () => provider.startAttempt(spec(idsB(), "run-room-r:1", "asg-room-r", { teamRoom: research })));
    const attested = await provider.attest(r, spec(idsB(), "run-room-r:1", "asg-room-r", { teamRoom: research }));
    for (const name of ["tool_plane_mounts", "tool_plane_mount_roots", "model_plane_mounts"]) assert.ok(attested.attestation.checks.some((c) => c.name === name && c.ok), name);
    await provider.writeFile(r, "/team/notes.md", Buffer.from(marker));
    assert.equal((await provider.remove(r)).gone, true);
    await provider.prepareWorkspace(idsB(), "asg-room-f", 256);
    const f = await timed("start (Finance's room)", () => provider.startAttempt(spec(idsB(), "run-room-f:1", "asg-room-f", { teamRoom: finance })));
    const seen = await run(lab, provider, f, `ls -A /team; grep -rl ${marker} /work /output /input /home /tmp /cache /team /data /mnt /var /run 2>/dev/null | head -3; echo end`);
    assert.doesNotMatch(seen.stdout, /notes\.md|research-only/);
    assert.equal(await provider.readFile(f, "/team/notes.md", 1000), null);
    assert.equal((await provider.remove(f)).gone, true);
    await provider.prepareWorkspace(idsB(), "asg-room-r2", 256);
    const r2 = await provider.startAttempt(spec(idsB(), "run-room-r:2", "asg-room-r2", { teamRoom: research }));
    assert.equal((await provider.readFile(r2, "/team/notes.md", 1000))?.toString(), marker);
    assert.equal((await provider.remove(r2)).gone, true);
    for (const a of ["asg-room-r", "asg-room-f", "asg-room-r2"]) await provider.removeWorkspace(idsB(), a);
  });

  test("two attempts cannot reach each other's ports or runners -- each plane has a network of its own -- yet both reach the proxy", async (t: TestContext) => {
    const specB = spec(idsB(), "run-b:3", "asg-b3");
    await provider.prepareWorkspace(idsB(), "asg-b3", 256);
    const hb = await timed("start B (isolation)", () => provider.startAttempt(specB));
    const ipOf = async (container: string, network: string) => (await lab.engine.containerInspect(container))?.NetworkSettings.Networks?.[network]?.IPAddress ?? "";
    const netsA = attemptNetworks(lab.prefix, handle.dispatchKey);
    const netsB = attemptNetworks(lab.prefix, hb.dispatchKey);
    const toolA = await ipOf(handle.toolPlane, netsA.tool);
    const modelA = await ipOf(handle.modelPlane as string, netsA.model);
    t.diagnostic(`A: tool plane ${toolA} on ${netsA.tool}, model plane ${modelA} on ${netsA.model}; B on ${netsB.tool} and ${netsB.model}`);
    // A listens; it answers itself.
    const listen = await run(lab, provider, handle, "setsid node -e \"require('net').createServer(s=>s.end('A-listens')).listen(8000,'0.0.0.0')\" >/dev/null 2>&1 & sleep 1; node -e \"require('net').connect(8000,'127.0.0.1').on('data',d=>process.stdout.write(String(d)))\"");
    assert.equal(listen.stdout, "A-listens");
    const probe = (host: string, port: number) => `node -e "const s=require('net').connect(${port},'${host}');s.setTimeout(3000,()=>{console.log('TIMEOUT');s.destroy()});s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('error',e=>console.log(e.code))"`;
    // B's tool plane cannot reach A's listening port; B's model plane cannot reach A's runner.
    const fromB = await run(lab, provider, hb, probe(toolA, 8000));
    assert.doesNotMatch(fromB.stdout, /CONNECTED/, fromB.stdout);
    const fromModelB = await provider.modelPlane(hb).run("node", ["-e", `const s=require('net').connect(7070,'${modelA}');s.setTimeout(3000,()=>{console.log('TIMEOUT');s.destroy()});s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('error',e=>console.log(e.code))`], { cwd: "/workdir", env: {}, timeoutMs: 15_000 });
    assert.doesNotMatch(fromModelB.stdout, /CONNECTED/, fromModelB.stdout);
    t.diagnostic(`B -> A's port 8000: ${fromB.stdout.trim()}; B's model plane -> A's runner: ${fromModelB.stdout.trim()}`);
    // Both still reach the proxy (Orbit Web's container, on each of their networks) -- tool planes and model planes alike.
    for (const h of [handle, hb]) assert.equal((await run(lab, provider, h, "curl -sS -m 10 http://origin.test/both")).stdout, "origin-ok /both");
    for (const h of [handle, hb]) assert.match((await provider.modelPlane(h).run("node", ["-e", "const s=require('net').connect(3128,'egress');s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('error',e=>console.log(e.code))"], { cwd: "/workdir", env: {}, timeoutMs: 15_000 })).stdout, /CONNECTED/);
    // Each network: its plane and the proxy, nothing else.
    const control = await lab.engine.containerInspect(`${lab.prefix}-proxy`);
    for (const [net, own] of [[netsB.tool, hb.toolPlane], [netsB.model, hb.modelPlane as string]] as const) assert.deepEqual(Object.keys((await lab.engine.networkInspect(net))?.Containers ?? {}).sort(), [own, control?.Id ?? ""].sort());
    // A crash right after the networks were made, before the containers: recovery finds what is left, and removes it.
    await lab.engine.containerRemove(hb.toolPlane, true);
    await lab.engine.containerRemove(hb.modelPlane as string, true);
    const left = await provider.find(hb.dispatchKey);
    assert.ok(left !== null, "networks without their containers are still found");
    assert.deepEqual([left.handle.toolPlane, left.handle.modelPlane, left.toolPlaneRunning], ["", null, false]);
    assert.equal((await provider.remove(left.handle)).gone, true);
    assert.deepEqual([await lab.engine.networkInspect(netsB.tool), await lab.engine.networkInspect(netsB.model)], [null, null]);
    assert.equal(await provider.find(hb.dispatchKey), null);
    assert.equal((await provider.removeWorkspace(idsB(), "asg-b3")).gone, true);
  });

  test("publish: refused on a stale desk version; the same assignment's retry gets its answer again", async () => {
    const stale = await provider.publishWorkspace(idsA(), "asg-other", 0);
    assert.deepEqual([stale.published, stale.deskVersion], [false, 1]);
    assert.match(stale.reason ?? "", /version 1, not 0/);
    const retry = await provider.publishWorkspace(idsA(), "asg-a", 0);
    assert.deepEqual([retry.published, retry.deskVersion], [true, 1]);
    assert.ok(retry.changed.includes("private.txt"));
  });

  test("a worker crash: a fresh allocator and provider find the attempt, stop it and remove it -- verified", async () => {
    const reborn = lab.provider(new Allocator({ config: lab.config, secret: lab.secret, engine: lab.engine }));
    const found = await timed("find after restart", () => reborn.find(handle.dispatchKey));
    assert.ok(found !== null);
    assert.deepEqual([found.handle.toolPlane, found.handle.modelPlane, found.toolPlaneRunning, found.modelPlaneRunning], [handle.toolPlane, handle.modelPlane, true, true]);
    const r = await reborn.modelPlane(found.handle).run("node", ["-e", "process.stdout.write('alive')"], { cwd: "/workdir", env: {}, timeoutMs: 10_000 });
    assert.equal(r.stdout, "alive");
    await timed("stop", () => reborn.stop(found.handle, 2000));
    const stopped = await reborn.find(handle.dispatchKey);
    assert.deepEqual([stopped?.toolPlaneRunning, stopped?.modelPlaneRunning], [false, false]);
    const removed = await timed("remove", () => reborn.remove(found.handle));
    assert.equal(removed.gone, true, removed.detail);
    assert.equal(await lab.engine.containerInspect(handle.toolPlane), null);
    assert.equal(await lab.engine.containerInspect(handle.modelPlane as string), null);
    assert.equal(await reborn.find(handle.dispatchKey), null);
    const nets = attemptNetworks(lab.prefix, handle.dispatchKey);
    assert.deepEqual([await lab.engine.networkInspect(nets.tool), await lab.engine.networkInspect(nets.model)], [null, null], "the attempt's networks went with it");
  });

  test("the workspace is removed (read back), and removing it again answers gone", async () => {
    assert.equal((await provider.removeWorkspace(idsA(), "asg-a")).gone, true);
    assert.equal((await provider.removeWorkspace(idsA(), "asg-a")).gone, true);
    const areas = await provider.measure(idsA());
    assert.deepEqual(areas.map((a) => a.area), ["desk", "cache"]);
  });

  test("a person looks into a desk -- links listed, never followed -- and cleans it only with no workspace left, at its version; the version does not move", async () => {
    // An employee of its own, so what earlier tests left behind does not decide this one.
    const idsC = () => ({ orbitId: lab.orbitA, employeeId: "emp-c", sandboxId: "sbx-c" });
    const code = (c: string) => (e: unknown) => e instanceof AllocatorError && e.code === c;
    assert.equal((await timed("provision C", () => provider.provisionEmployee(idsC(), { deskMiB: 256, cacheMiB: 32 }))).state, "READY");
    // A work tree that leaves links and a big folder on the desk -- and, while it exists, no clean.
    await provider.prepareWorkspace(idsC(), "asg-c", 256);
    await assert.rejects(provider.cleanDesk(idsC(), { remove: ["private.txt"], empty: false, cache: false }, 0), (e: unknown) => code("conflict")(e) && /workspace/.test((e as Error).message));
    const hc = await timed("start attempt (desk)", () => provider.startAttempt(spec(idsC(), "run-c:1", "asg-c")));
    const w = await run(lab, provider, hc, "echo desk-of-c > /work/private.txt && ln -s /etc/passwd /work/passwd-link && ln -s /etc /work/etc-link && mkdir -p /work/big && head -c 2000000 /dev/zero > /work/big/zeros.bin && echo ok");
    assert.match(w.stdout, /ok/, w.stderr);
    await provider.stop(hc, 1000);
    assert.equal((await provider.remove(hc)).gone, true);
    assert.equal((await provider.publishWorkspace(idsC(), "asg-c", 0)).deskVersion, 1);
    assert.equal((await provider.removeWorkspace(idsC(), "asg-c")).gone, true);

    const top = await timed("list the desk", () => provider.listDesk(idsC(), "", 100));
    const byName = new Map(top.entries.map((e) => [e.name, e]));
    assert.deepEqual([top.deskVersion, top.entries[0]?.name], [1, "big"], "the biggest first");
    assert.deepEqual([byName.get("big")?.type, byName.get("big")?.bytes, byName.get("big")?.files], ["dir", 2_000_000, 1]);
    assert.deepEqual([byName.get("passwd-link")?.type, byName.get("passwd-link")?.target, byName.get("passwd-link")?.bytes], ["link", "/etc/passwd", 0]);
    await assert.rejects(provider.readDesk(idsC(), "passwd-link", 100), code("bad_request"));
    await assert.rejects(provider.readDesk(idsC(), "etc-link/passwd", 100), code("bad_request"));
    await assert.rejects(provider.listDesk(idsC(), "etc-link", 100), code("bad_request"));
    assert.equal((await timed("read a file", () => provider.readDesk(idsC(), "private.txt", 100))).data.toString("utf8"), "desk-of-c\n");

    const before = (await provider.measure(idsC())).find((a) => a.area === "desk")?.usedMiB ?? null;
    await assert.rejects(provider.cleanDesk(idsC(), { remove: ["big", "passwd-link"], empty: false, cache: true }, 0), code("conflict"));
    const cleaned = await timed("clean the desk", () => provider.cleanDesk(idsC(), { remove: ["big", "passwd-link"], empty: false, cache: true }, 1));
    assert.deepEqual([cleaned.removed, cleaned.paths, cleaned.missing, cleaned.cacheEmptied, cleaned.deskVersion], [3, ["big", "passwd-link"], [], true, 1]);
    const left = (await provider.listDesk(idsC(), "", 100)).entries.map((e) => e.name);
    assert.deepEqual([left.includes("big"), left.includes("passwd-link"), left.includes("etc-link"), left.includes("private.txt"), left.includes("toolbox")], [false, false, true, true, true]);
    const after = (await provider.measure(idsC())).find((a) => a.area === "desk")?.usedMiB ?? null;
    if (before !== null && after !== null) assert.ok(after < before, `the desk's measured use went down (${before} → ${after} MiB)`);
  });

  test("an archived employee's sandbox is frozen: no new workspace", async () => {
    await provider.archiveEmployee(idsB());
    await assert.rejects(provider.prepareWorkspace(idsB(), "asg-b2", 256), /archived/);
    assert.equal((await provider.provisionEmployee(idsB(), { deskMiB: 256, cacheMiB: 0 })).state, "FAILED");
  });
});
