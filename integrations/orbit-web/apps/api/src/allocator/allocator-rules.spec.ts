// THE ALLOCATOR'S RULES, without a container runtime: how the kernel's cgroup files are read, how Docker's multiplexed
// stream is split, what every container it would create looks like (hardening, mounts, limits), what the attestation
// checks find wrong, how the desk is copied (links never followed, `.orbit/` never carried), and the signed HTTP door.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type ResourceProfile } from "@orbit-web/contracts";
import { AllocatorClient } from "../contexts/execution/infrastructure/sandbox/allocator-client.js";
import { AllocatorError, type AllocatorApi } from "../contexts/execution/infrastructure/sandbox/allocator-protocol.js";
import { MODEL_PLANE } from "../contexts/execution/infrastructure/sandbox/layout.js";
import { check, hardeningProblems, mountProblems, mountRootProblems, parseMountInfo } from "./attest-checks.js";
import { cgroupUsage, limitsMatch, observedLimits } from "./cgroup.js";
import type { ContainerInspect } from "./docker/engine.js";
import { demuxAll, StdStreamDemuxer } from "./docker/stdstream.js";
import { deskScript, nodeScript, syncScript } from "./scripts/node-scripts.js";
import { allocatorServer } from "./server.js";
import { MiB, modelPlaneBody, sessionPlaneBody, toolPlaneBody, toolPlaneMounts } from "./specs.js";
import { quotaHeld, WorkforceStorage } from "./storage.js";

const profile = (DEFAULT_PRESETS[2] as { profile: ResourceProfile }).profile;

test("cgroup v1 and v2: the limits the kernel enforces, the use, the peaks and the OOM kills", () => {
  const v1 = { version: "v1" as const, files: { "cpu.cfs_quota_us": "200000", "cpu.cfs_period_us": "100000", "memory.limit_in_bytes": String(4096 * MiB), "pids.max": "1024", "memory.usage_in_bytes": String(10 * MiB), "memory.max_usage_in_bytes": String(64 * MiB), "memory.oom_control": "oom_kill_disable 0\nunder_oom 0\noom_kill 2", "cpuacct.usage": "1500000000", "pids.current": "7" } };
  assert.deepEqual(observedLimits(v1), { cpuQuota: "200000/100000", memoryLimit: String(4096 * MiB), pidsMax: "1024", cpuMillis: 2000, memoryBytes: 4096 * MiB, pids: 1024 });
  assert.deepEqual(limitsMatch(observedLimits(v1), profile), []);
  assert.deepEqual(cgroupUsage(v1), { cpuSeconds: 1.5, memoryCurrentBytes: 10 * MiB, memoryPeakBytes: 64 * MiB, oomKills: 2, pidsCurrent: 7, pidsPeak: null });
  const unlimited = observedLimits({ version: "v1", files: { "cpu.cfs_quota_us": "-1", "cpu.cfs_period_us": "100000", "memory.limit_in_bytes": "9223372036854771712", "pids.max": "max" } });
  assert.deepEqual([unlimited.cpuQuota, unlimited.memoryLimit, unlimited.cpuMillis, unlimited.memoryBytes, unlimited.pids], ["max", "max", null, null, null]);
  assert.equal(limitsMatch(unlimited, profile).length, 3);
  const v2 = { version: "v2" as const, files: { "cpu.max": "50000 100000", "memory.max": String(96 * MiB), "pids.max": "64", "memory.current": "1048576", "memory.peak": "2097152", "memory.events": "low 0\nhigh 0\nmax 3\noom 1\noom_kill 1", "cpu.stat": "usage_usec 2500000\nuser_usec 1", "pids.current": "3", "pids.peak": "9" } };
  assert.deepEqual(observedLimits(v2), { cpuQuota: "50000/100000", memoryLimit: String(96 * MiB), pidsMax: "64", cpuMillis: 500, memoryBytes: 96 * MiB, pids: 64 });
  assert.deepEqual(cgroupUsage(v2), { cpuSeconds: 2.5, memoryCurrentBytes: 1048576, memoryPeakBytes: 2097152, oomKills: 1, pidsCurrent: 3, pidsPeak: 9 });
  assert.equal(observedLimits({ version: "v2", files: { "cpu.max": "max 100000" } }).cpuQuota, "max");
});

test("Docker's multiplexed stream: frames split across chunks, bytes kept as bytes", () => {
  const frame = (kind: number, payload: Buffer) => Buffer.concat([Buffer.from([kind, 0, 0, 0]), Buffer.from([0, 0, 0, 0].map((_, i) => (payload.length >>> (8 * (3 - i))) & 0xff)), payload]);
  const whole = Buffer.concat([frame(1, Buffer.from([0, 255, 10])), frame(2, Buffer.from("warn")), frame(1, Buffer.from("tail"))]);
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const d = new StdStreamDemuxer((s, b) => (s === "stdout" ? out : err).push(Buffer.from(b)));
  for (let i = 0; i < whole.length; i += 3) d.push(whole.subarray(i, i + 3));
  assert.deepEqual([Buffer.concat(out), Buffer.concat(err).toString()], [Buffer.from([0, 255, 10, ...Buffer.from("tail")]), "warn"]);
  assert.equal(d.leftover, 0);
  assert.deepEqual(demuxAll(whole).stderr.toString(), "warn");
});

describe("the containers an attempt is made of", () => {
  const egress = { proxyHost: "orbit-web", proxyPort: 3128, runToken: "tok_123456789" };
  const tool = toolPlaneBody({ image: "ws:1", network: "orbit-web-sandbox", workforceVolume: "orbit-web-workforce", labels: { a: "b" }, areas: { scratch: "accounts/o/employees/e/assignments/a/scratch", cache: "accounts/o/employees/e/cache", team: null }, resources: profile, egress });
  const model = modelPlaneBody({ image: "mp:1", network: "orbit-web-model", dataVolume: "orbit-web_orbit-web-data", connectionSubpath: "connections/o/c", labels: { a: "b" }, cpuMillis: 500, memoryMiB: 1024, runnerToken: "r".repeat(64), env: { ANTHROPIC_API_KEY: "sk-x" } });

  test("the tool plane: no privilege or capability, read-only root, the employee's user, its own areas, the profile's limits, no swap", () => {
    const h = tool.HostConfig;
    assert.deepEqual([h.Privileged, h.ReadonlyRootfs, h.CapDrop, h.CapAdd, h.SecurityOpt, tool.User], [false, true, ["ALL"], [], ["no-new-privileges:true"], "20001:20001"]);
    assert.deepEqual([h.NanoCpus, h.Memory, h.MemorySwap, h.PidsLimit], [profile.cpuMillis * 1e6, profile.memoryMiB * MiB, profile.memoryMiB * MiB, profile.pidsLimit]);
    assert.deepEqual(h.Tmpfs, { "/tmp": "rw,nosuid,nodev,size=512m,mode=1777" });
    assert.deepEqual([h.NetworkMode, h.Dns], ["orbit-web-sandbox", ["127.0.0.1"]]);
    assert.deepEqual(h.Mounts.map((m) => `${m.Target}<-${m.VolumeOptions.Subpath}${m.ReadOnly ? ":ro" : ""}`), ["/work<-accounts/o/employees/e/assignments/a/scratch/work", "/output<-accounts/o/employees/e/assignments/a/scratch/output", "/input<-accounts/o/employees/e/assignments/a/scratch/input:ro", "/home/employee<-accounts/o/employees/e/assignments/a/scratch/home", "/cache<-accounts/o/employees/e/cache"]);
    assert.ok(!JSON.stringify(tool).includes("docker.sock"));
    assert.ok(tool.Env.includes("HTTPS_PROXY=http://run:tok_123456789@orbit-web:3128"));
    assert.ok(!JSON.stringify(tool).includes("sk-x"), "the tool plane holds no credential");
  });

  test("the model plane: only the connection's home and small tmpfs, its own limits, the runner's token, no managed settings", () => {
    const h = model.HostConfig;
    assert.deepEqual([h.Privileged, h.ReadonlyRootfs, h.CapDrop, model.User, h.NetworkMode], [false, true, ["ALL"], "10001:10001", "orbit-web-model"]);
    assert.deepEqual(h.Mounts.map((m) => [m.Source, m.Target, m.VolumeOptions.Subpath]), [["orbit-web_orbit-web-data", MODEL_PLANE.home, "connections/o/c"]]);
    assert.deepEqual(Object.keys(h.Tmpfs).sort(), ["/home/orbit", "/tmp", "/workdir"]);
    assert.ok(!JSON.stringify(model).includes("/etc/claude-code"));
    assert.ok(model.Env.includes(`ORBIT_WEB_RUNNER_TOKEN=${"r".repeat(64)}`));
    assert.ok(model.Env.includes("ORBIT_WEB_RUNNER_PASS_ENV=PATH,ANTHROPIC_API_KEY"));
    assert.deepEqual([h.NanoCpus, h.Memory, h.MemorySwap], [500e6, 1024 * MiB, 1024 * MiB]);
  });

  test("a chat's or research run's sandbox: the Orbit Web image's runner, hardened, only the mounts it was given, its own limits and network", () => {
    const body = sessionPlaneBody({ image: "orbit-web:1", network: "orbit-web-sn-1", dataVolume: "orbit-web_orbit-web-data", mounts: [{ subpath: "workspaces/chat-1", target: "/data/workspaces/chat-1", readOnly: false }, { subpath: "connections/a/c", target: "/data/connections/a/c", readOnly: false }], labels: { a: "b" }, cpuMillis: 1000, memoryMiB: 2048, pids: 1024, runnerToken: "r".repeat(64) });
    const h = body.HostConfig;
    assert.deepEqual([h.Privileged, h.ReadonlyRootfs, h.CapDrop, h.CapAdd, h.SecurityOpt, h.Init, body.User], [false, true, ["ALL"], [], ["no-new-privileges:true"], true, "10001:10001"]);
    assert.deepEqual([h.NanoCpus, h.Memory, h.MemorySwap, h.PidsLimit], [1000e6, 2048 * MiB, 2048 * MiB, 1024]);
    assert.deepEqual(h.Mounts.map((m) => [m.Source, m.Target, m.VolumeOptions.Subpath, m.ReadOnly]), [["orbit-web_orbit-web-data", "/data/workspaces/chat-1", "workspaces/chat-1", false], ["orbit-web_orbit-web-data", "/data/connections/a/c", "connections/a/c", false]]);
    assert.deepEqual(Object.keys(h.Tmpfs).sort(), ["/data/home", "/tmp"]);
    assert.deepEqual([h.NetworkMode, Object.keys(body.NetworkingConfig.EndpointsConfig)], ["orbit-web-sn-1", ["orbit-web-sn-1"]]);
    // The image's own entry point (tini, then the API) is not what runs: the runner, under Docker's init.
    assert.deepEqual([body.Entrypoint, body.Cmd], [[""], ["/usr/local/bin/node", "--disable-warning=ExperimentalWarning", "/opt/orbit-web/apps/api/dist/runner/main.js"]]);
    assert.ok(body.Env.includes(`ORBIT_WEB_RUNNER_TOKEN=${"r".repeat(64)}`));
    assert.ok(!JSON.stringify(body).includes("docker.sock"));
  });

  test("the attestation finds what is wrong: a privilege, an added capability, a second network, a stray mount, a socket", () => {
    const inspect = (over: Partial<ContainerInspect["HostConfig"]> = {}, mounts?: ContainerInspect["Mounts"], nets = ["orbit-web-sandbox"]): ContainerInspect =>
      ({
        Config: { User: "20001:20001" },
        HostConfig: { Privileged: false, CapDrop: ["ALL"], CapAdd: null, SecurityOpt: ["no-new-privileges:true"], ReadonlyRootfs: true, NetworkMode: "orbit-web-sandbox", PidMode: "", IpcMode: "private", UsernsMode: "", Binds: null, Devices: [], Dns: ["127.0.0.1"], PortBindings: {}, Tmpfs: { "/tmp": "x" }, ...over },
        NetworkSettings: { Networks: Object.fromEntries(nets.map((n) => [n, { IPAddress: "1.2.3.4", NetworkID: "n" }])) },
        Mounts: mounts ?? toolPlaneMounts("v", { scratch: "s", cache: null, team: null }).map((m) => ({ Type: "volume", Name: "v", Source: "/var/lib/docker/volumes/v/_data", Destination: m.target, RW: !m.readOnly })),
      }) as unknown as ContainerInspect;
    assert.deepEqual(hardeningProblems(inspect(), "20001:20001", "orbit-web-sandbox"), []);
    assert.match(hardeningProblems(inspect({ Privileged: true }), "20001:20001", "orbit-web-sandbox").join(), /privileged/);
    assert.match(hardeningProblems(inspect({ CapAdd: ["NET_ADMIN"] }), "20001:20001", "orbit-web-sandbox").join(), /NET_ADMIN/);
    assert.match(hardeningProblems(inspect({}, undefined, ["orbit-web-sandbox", "bridge"]), "20001:20001", "orbit-web-sandbox").join(), /not only/);
    assert.match(hardeningProblems(inspect({ Dns: [] }), "20001:20001", "orbit-web-sandbox").join(), /resolvers/);
    // A chat's run reaches the internet by design: its sandbox keeps the runtime's own resolver -- and only that.
    assert.deepEqual(hardeningProblems(inspect({ Dns: [] }), "20001:20001", "orbit-web-sandbox", []), []);
    assert.match(hardeningProblems(inspect({ Dns: ["8.8.8.8"] }), "20001:20001", "orbit-web-sandbox", []).join(), /resolvers \["8\.8\.8\.8"\]/);
    const expected = toolPlaneMounts("v", { scratch: "s", cache: null, team: null });
    const requested = expected.map((e) => ({ Target: e.target, Source: e.volume, VolumeOptions: { Subpath: e.subpath as string } }));
    assert.deepEqual(mountProblems(inspect(), expected, ["/tmp"], requested), []);
    const extra = [...inspect().Mounts, { Type: "bind", Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock", RW: true }];
    assert.match(mountProblems(inspect({}, extra), expected, ["/tmp"], requested).join(), /unexpected mount.*socket/s);
    const info = parseMountInfo(["1 0 0:1 / / ro - overlay overlay ro", ...expected.map((e, i) => `${i + 2} 1 0:44 /${e.subpath} ${e.target} ${e.readOnly ? "ro" : "rw"},relatime - btrfs /dev/loop0 rw`)].join("\n"));
    assert.deepEqual(mountRootProblems(info, expected), []);
    const wrong = info.map((l) => (l.mountPoint === "/work" ? { ...l, root: "/accounts/other/employees/x/desk/files" } : l));
    assert.match(mountRootProblems(wrong, expected).join(), /\/work holds \/accounts\/other/);
    assert.deepEqual(check("x", [], "held"), { name: "x", ok: true, detail: "held" });
  });
});

test("an over-quota write holds only when the kernel refused it, within the quota", () => {
  assert.equal(quotaHeld({ written: 16 * MiB, code: "EDQUOT" }, 16 * MiB), true);
  assert.equal(quotaHeld({ written: 15 * MiB, code: "ENOSPC" }, 16 * MiB), true);
  assert.equal(quotaHeld({ written: 48 * MiB, code: null }, 16 * MiB), false);
  assert.equal(quotaHeld({ written: 40 * MiB, code: "EDQUOT" }, 16 * MiB), false);
});

describe("the desk's copy (the same program a storage worker runs)", () => {
  let dir: string;
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, ["-e", nodeScript(syncScript), ...args], { encoding: "utf8" });
    return { code: r.status, out: JSON.parse(r.stdout || "{}") as Record<string, unknown>, err: r.stderr };
  };
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-sync-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("seed copies the desk into an empty work tree, links as links (never followed), and only once", () => {
    const desk = join(dir, "desk");
    const work = join(dir, "work");
    mkdirSync(join(desk, "toolbox/scripts"), { recursive: true });
    mkdirSync(work);
    writeFileSync(join(desk, "toolbox/scripts/run.py"), "print(1)\n", { mode: 0o755 });
    writeFileSync(join(dir, "secret"), "outside");
    symlinkSync(join(dir, "secret"), join(desk, "link"));
    assert.deepEqual(run("seed", desk, work).out, { seeded: true, entries: 4 });
    assert.equal(readFileSync(join(work, "toolbox/scripts/run.py"), "utf8"), "print(1)\n");
    assert.equal(lstatSync(join(work, "toolbox/scripts/run.py")).mode & 0o777, 0o755);
    assert.equal(readlinkSync(join(work, "link")), join(dir, "secret"));
    assert.deepEqual(run("seed", desk, work).out, { seeded: false, reason: "the work tree is not empty" });
  });

  test("publish mirrors the work tree onto the desk: added, changed and removed paths, `.orbit/` never carried", () => {
    const desk = join(dir, "desk");
    const work = join(dir, "work");
    writeFileSync(join(work, "new.md"), "# new\n");
    writeFileSync(join(work, "toolbox/scripts/run.py"), "print(2)\n");
    utimesSync(join(work, "toolbox/scripts/run.py"), new Date(0), new Date(0));
    rmSync(join(work, "link"));
    mkdirSync(join(work, ".orbit"));
    writeFileSync(join(work, ".orbit/handoff.json"), "{}");
    const r = run("publish", work, desk);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out, { published: true, changed: ["link", "new.md", "toolbox/scripts/run.py"], changedTotal: 3 });
    assert.equal(readFileSync(join(desk, "toolbox/scripts/run.py"), "utf8"), "print(2)\n");
    assert.deepEqual([existsSync(join(desk, "link")), existsSync(join(desk, ".orbit")), existsSync(join(desk, ".orbit-publish"))], [false, false, false]);
    assert.deepEqual(run("publish", work, desk).out, { published: true, changed: [], changedTotal: 0 });
  });

  test("a publish of more paths than an answer may name publishes them all, and names the first of them with how many there were", () => {
    const desk = join(dir, "desk3");
    const work = join(dir, "work3");
    mkdirSync(desk);
    mkdirSync(join(work, "many"), { recursive: true });
    for (let i = 0; i < 650; i += 1) writeFileSync(join(work, "many", `f${String(i).padStart(4, "0")}.txt`), String(i));
    const r = run("publish", work, desk, "500");
    assert.equal(r.code, 0, r.err);
    assert.deepEqual([(r.out.changed as string[]).length, r.out.changedTotal], [500, 651]);
    assert.deepEqual((r.out.changed as string[]).slice(0, 2), ["many", "many/f0000.txt"]);
    assert.equal(readdirSync(join(desk, "many")).length, 650, "everything is published; only the answer is bounded");
  });

  test("an isolation check's marker in the desk is neither seeded into work, published over, nor taken from a work tree", () => {
    const desk = join(dir, "desk2");
    const work = join(dir, "work2");
    mkdirSync(desk);
    mkdirSync(work);
    writeFileSync(join(desk, ".orbit-canary-0123456789abcdef"), "nonce");
    writeFileSync(join(desk, "kept.md"), "kept");
    assert.deepEqual(run("seed", desk, work).out, { seeded: true, entries: 1 });
    assert.equal(existsSync(join(work, ".orbit-canary-0123456789abcdef")), false);
    // A publish while the marker sits in the desk leaves it there; a marker-named file of the work tree never reaches it.
    writeFileSync(join(work, ".orbit-canary-fedcba9876543210"), "the employee's");
    assert.deepEqual(run("publish", work, desk).out, { published: true, changed: [], changedTotal: 0 });
    assert.equal(readFileSync(join(desk, ".orbit-canary-0123456789abcdef"), "utf8"), "nonce");
    assert.equal(existsSync(join(desk, ".orbit-canary-fedcba9876543210")), false);
  });
});

test("a record the storage helper read back cut short is refused, never taken as the whole record", async () => {
  const storage = Object.create(WorkforceStorage.prototype) as WorkforceStorage;
  storage.helper = async () => ({ code: 0, stdout: Buffer.from('{"version":1,"changed":["a'), stderr: Buffer.alloc(0), timedOut: false, truncated: true });
  await assert.rejects(storage.get("accounts/o/employees/e/desk/version"), /accounts\/o\/employees\/e\/desk\/version is larger than/);
});

describe("an employee's desk, looked into and cleaned up (the program a storage worker runs)", () => {
  let dir: string;
  let desk: string;
  let cache: string;
  const run = (args: string[], stdin?: unknown) => {
    const r = spawnSync(process.execPath, ["-e", nodeScript(deskScript), ...args], { encoding: "utf8", input: stdin === undefined ? "" : JSON.stringify(stdin) });
    return { code: r.status, out: JSON.parse(r.stdout || "{}") as Record<string, unknown>, err: r.stderr };
  };
  const list = (d: string, max = 100) => run(["list", desk, d, String(max)]);
  const names = (out: Record<string, unknown>): string[] => (out.entries as { name: string }[]).map((e) => e.name);
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-look-"));
    desk = join(dir, "desk");
    cache = join(dir, "cache");
    mkdirSync(join(desk, "toolbox/skills/report"), { recursive: true });
    mkdirSync(join(desk, "toolbox/scripts"), { recursive: true });
    mkdirSync(join(desk, "notes/old"), { recursive: true });
    mkdirSync(join(desk, ".orbit-publish"));
    mkdirSync(join(desk, "lost+found"));
    mkdirSync(join(cache, "npm"), { recursive: true });
    writeFileSync(join(desk, "toolbox/skills/report/SKILL.md"), "# report\n");
    writeFileSync(join(desk, "notes/plan.md"), "plan");
    writeFileSync(join(desk, "notes/old/big.log"), "x".repeat(5000));
    writeFileSync(join(desk, "notes/.orbit-canary-0123456789abcdef"), "deeper down, only a name");
    writeFileSync(join(desk, "report.html"), "<script>alert(1)</script>");
    writeFileSync(join(desk, "data.bin"), Buffer.from([0x50, 0x4b, 0x00, 0x01]));
    writeFileSync(join(desk, ".orbit-canary-0123456789abcdef"), "a marker");
    writeFileSync(join(desk, ".orbit-mine"), "the employee's own");
    writeFileSync(join(cache, "npm/pkg.tgz"), "cached");
    writeFileSync(join(dir, "secret"), "outside the desk");
    mkdirSync(join(dir, "elsewhere"));
    writeFileSync(join(dir, "elsewhere/x"), "outside");
    symlinkSync(join(dir, "secret"), join(desk, "to-secret"));
    symlinkSync(join(dir, "elsewhere"), join(desk, "to-elsewhere"));
  });
  after(() => {
    spawnSync("chmod", ["-R", "u+w", dir]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a folder's listing: the biggest first, each folder with what is under it, links never followed, Orbit Web's own names never shown", () => {
    const r = list("");
    assert.equal(r.code, 0, r.err);
    // notes 5028 bytes, report.html 25, .orbit-mine 18, toolbox 9, data.bin 4, then the links (nothing) by name.
    assert.deepEqual(names(r.out), ["notes", "report.html", ".orbit-mine", "toolbox", "data.bin", "to-elsewhere", "to-secret"]);
    const notes = (r.out.entries as { name: string; path: string; type: string; bytes: number; files: number }[]).find((e) => e.name === "notes");
    assert.deepEqual([notes?.path, notes?.type, notes?.bytes, notes?.files], ["notes", "dir", 4 + 5000 + "deeper down, only a name".length, 3]);
    const link = (r.out.entries as { name: string; type: string; bytes: number; target: string | null }[]).find((e) => e.name === "to-elsewhere");
    assert.deepEqual([link?.type, link?.bytes, link?.target], ["link", 0, join(dir, "elsewhere")]);
    assert.equal(r.out.truncated, false);
    assert.deepEqual([r.out.files, r.out.bytes], [7, 5028 + 25 + 18 + 9 + 4]);
    // Deeper down, a marker-shaped name is the employee's own.
    assert.deepEqual(new Set(names(list("notes").out)), new Set(["old", "plan.md", ".orbit-canary-0123456789abcdef"]));
    const cut = list("", 2);
    assert.deepEqual([names(cut.out).length, cut.out.truncated], [2, true]);
  });

  test("a folder is never listed through a link, nor one that is not there or not a folder", () => {
    assert.equal(list("to-elsewhere").code, 4);
    assert.equal(list("nowhere").code, 3);
    assert.equal(list("report.html").code, 6);
    assert.equal(list("../").code, 2);
    assert.equal(list(".orbit-publish").code, 2);
  });

  test("a file's bytes, at most what is asked; never through a link, never a folder", () => {
    const r = run(["read", desk, "report.html", "1000"]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual([Buffer.from(r.out.base64 as string, "base64").toString("utf8"), r.out.bytes, r.out.truncated], ["<script>alert(1)</script>", 25, false]);
    const cut = run(["read", desk, "notes/old/big.log", "10"]);
    assert.deepEqual([Buffer.from(cut.out.base64 as string, "base64").length, cut.out.bytes, cut.out.truncated], [10, 5000, true]);
    assert.equal(run(["read", desk, "to-secret", "1000"]).code, 4, "a link to a file is never opened");
    assert.equal(run(["read", desk, "to-elsewhere/x", "1000"]).code, 4, "nor a file through a linked folder");
    assert.equal(run(["read", desk, "notes", "1000"]).code, 6);
    assert.equal(run(["read", desk, "nowhere.md", "1000"]).code, 3);
    assert.equal(run(["read", desk, ".orbit-canary-0123456789abcdef", "1000"]).code, 2);
  });

  test("a clean that names a path through a link removes nothing", () => {
    const r = run(["clean", desk, cache], { remove: ["notes/plan.md", "to-elsewhere/x"], empty: false, cache: false });
    assert.equal(r.code, 4);
    assert.equal(existsSync(join(desk, "notes/plan.md")), true);
    assert.equal(existsSync(join(dir, "elsewhere/x")), true);
    assert.equal(run(["clean", desk, cache], { remove: ["../secret"], empty: false, cache: false }).code, 2);
  });

  test("a clean removes the named paths -- a read-only folder too, a link as a link -- and says what was not there", () => {
    spawnSync("chmod", ["0555", join(desk, "notes/old")]);
    const r = run(["clean", desk, cache], { remove: ["notes/old", "to-secret", "gone.txt"], empty: false, cache: false });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual([r.out.removed, r.out.paths, r.out.missing, r.out.cacheEmptied], [3, ["notes/old", "to-secret"], ["gone.txt"], false]);
    assert.deepEqual([existsSync(join(desk, "notes/old")), existsSync(join(desk, "to-secret")), existsSync(join(desk, "notes/plan.md"))], [false, false, true]);
    assert.equal(readFileSync(join(dir, "secret"), "utf8"), "outside the desk", "a link's target is never touched");
  });

  test("emptying the desk keeps the toolbox and Orbit Web's own names; emptying the cache empties it", () => {
    const r = run(["clean", desk, cache], { remove: [], empty: true, cache: true });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.cacheEmptied, true);
    assert.deepEqual(new Set(readdirSync(desk)), new Set(["toolbox", ".orbit-canary-0123456789abcdef", ".orbit-publish", "lost+found"]));
    assert.equal(readFileSync(join(desk, "toolbox/skills/report/SKILL.md"), "utf8"), "# report\n");
    assert.deepEqual(readdirSync(cache), []);
    assert.equal(existsSync(join(dir, "elsewhere/x")), true, "a link's target is never touched");
  });
});

describe("the allocator's HTTP door", () => {
  const secret = "z".repeat(48);
  let server: Server;
  let client: AllocatorClient;
  let origin: string;
  const calls: string[] = [];
  const fake = {
    findAttempt: async (k: string) => {
      calls.push(`find ${k}`);
      if (k === "missing:1") return null;
      throw new AllocatorError("conflict", "belongs to another run");
    },
    readFile: async () => Buffer.from([0, 1, 2, 255]),
    writeFile: async (_k: string, p: string, b: Buffer) => {
      calls.push(`write ${p} ${[...b].join(",")}`);
    },
    listDesk: async (_ids: unknown, dir: string, max: number) => ({ deskVersion: 3, entries: [{ name: "a.md", path: `${dir}/a.md`, type: "file", bytes: max, files: 1, modifiedAt: "2026-11-23T00:00:00.000Z", target: null }], truncated: false, bytes: max, files: 1 }),
    readDesk: async (_ids: unknown, path: string) => ({ deskVersion: 3, bytes: 4, data: Buffer.from([0, 1, 2, 255]), truncated: false, modifiedAt: `for ${path}` }),
    cleanDesk: async (_ids: unknown, req: { remove: string[] }, expected: number) => {
      if (expected !== 3) throw new AllocatorError("conflict", "the desk is at version 3");
      return { removed: req.remove.length, paths: req.remove, missing: [], cacheEmptied: false, deskVersion: 3 };
    },
  } as unknown as AllocatorApi;
  before(async () => {
    server = allocatorServer(fake, secret);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    client = new AllocatorClient(origin, secret);
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("a signed call reaches the operation; its answer and its error code come back as they were", async () => {
    assert.equal(await client.findAttempt("missing:1"), null);
    await assert.rejects(client.findAttempt("other:1"), (e: unknown) => e instanceof AllocatorError && e.code === "conflict" && /another run/.test(e.message));
    assert.deepEqual([...((await client.readFile("k:1", "/work/a", 10)) as Buffer)], [0, 1, 2, 255]);
    await client.writeFile("k:1", "/work/b", Buffer.from([255, 0]));
    assert.deepEqual(calls.slice(-1), ["write /work/b 255,0"]);
  });

  test("a look into a desk and its clean-up pass through as they were: a file's bytes as bytes, a refusal with its code", async () => {
    const ids = { orbitId: "o", employeeId: "e", sandboxId: "s" };
    assert.deepEqual((await client.listDesk(ids, "notes", 7)).entries.map((e) => [e.path, e.bytes]), [["notes/a.md", 7]]);
    const read = await client.readDesk(ids, "notes/a.md", 10);
    assert.deepEqual([[...read.data], read.bytes, read.modifiedAt], [[0, 1, 2, 255], 4, "for notes/a.md"]);
    assert.deepEqual((await client.cleanDesk(ids, { remove: ["notes"], empty: false, cache: false }, 3)).paths, ["notes"]);
    await assert.rejects(client.cleanDesk(ids, { remove: ["notes"], empty: false, cache: false }, 2), (e: unknown) => e instanceof AllocatorError && e.code === "conflict");
  });

  test("an unsigned, wrongly signed or replayed request is refused before it is read", async () => {
    const post = (headers: Record<string, string>, body = '{"dispatchKey":"missing:1"}') =>
      new Promise<number>((resolve, reject) => {
        const u = new URL(`${origin}/v1/findAttempt`);
        const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end(body);
      });
    const before = calls.length;
    assert.equal(await post({}), 401);
    const wrong = new AllocatorClient(origin, "y".repeat(48));
    await assert.rejects(wrong.findAttempt("missing:1"), (e: unknown) => e instanceof AllocatorError && e.code === "unauthorized");
    const { signedHeaders } = await import("../contexts/execution/infrastructure/sandbox/allocator-protocol.js");
    const body = '{"dispatchKey":"missing:1"}';
    const h = signedHeaders(secret, "POST", "/v1/findAttempt", Buffer.from(body));
    assert.equal(await post(h, body), 200);
    assert.equal(await post(h, body), 401, "the same request twice");
    assert.equal(calls.length, before + 1);
  });
});
