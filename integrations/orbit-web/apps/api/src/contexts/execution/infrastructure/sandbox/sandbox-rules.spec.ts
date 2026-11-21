// THE SANDBOX'S RULES, without a container runtime: what the allocator names from ids (and refuses to name), how the
// storage mechanism and the admission rule decide, what a request may carry, how a request is signed, and what the
// host can give employees.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PRESETS } from "@orbit-web/contracts";
import { loadSandboxConfig } from "../../../../config/sandbox-config.js";
import type { HostCapabilities } from "../../application/sandbox.port.js";
import { checkAttemptSpec, checkExecRequest, NonceCache, readSecret, signedHeaders, toolPath, verifySigned } from "./allocator-protocol.js";
import { infrastructureCapacity } from "./capacity.js";
import { attemptLabels, checkDispatchKey, checkId, connectionSubpath, deskArea, isAreaPath, planeNames, runnerToken, scratchArea, teamArea } from "./ids.js";
import { chooseMechanism, hostProtectionOf, storageAdmits, tmpSizeMiB } from "./storage-policy.js";

const O = "0f1e2d3c-0000-4000-8000-000000000001";
const E = "0f1e2d3c-0000-4000-8000-000000000002";
const S = "0f1e2d3c-0000-4000-8000-000000000003";
const ids = { orbitId: O, employeeId: E, sandboxId: S };

const spec = (over: Record<string, unknown> = {}) => ({
  ...ids,
  runId: "run-1",
  dispatchKey: "run-1:1",
  fence: 1,
  assignmentId: "asg-1",
  resources: (DEFAULT_PRESETS[0] as { profile: unknown }).profile,
  modelPlane: { cpuMillis: 500, memoryMiB: 1024, connectionHome: `${O}/conn-1`, env: {} },
  egress: { proxyHost: "orbit-web", proxyPort: 3128, runToken: "tok_abcdefgh-123" },
  bridge: { url: "http://orbit-web:3000/api/runtime/tools", runToken: "tok_abcdefgh-123" },
  inputs: [],
  teamRoom: null,
  ...over,
});

test("ids: a plain identifier names a place; anything that could climb out of one is refused", () => {
  assert.equal(checkId(E, "employeeId"), E);
  for (const bad of ["..", "a/b", "", "a b", "a\0b", "-lead", "x".repeat(65), "../etc"]) assert.throws(() => checkId(bad, "id"), /identifier/);
  assert.throws(() => checkDispatchKey("has space"), /dispatchKey/);
  assert.equal(deskArea(ids), `accounts/${O}/employees/${E}/desk`);
  assert.equal(scratchArea(ids, "asg-1"), `accounts/${O}/employees/${E}/assignments/asg-1/scratch`);
  assert.equal(teamArea(O, "room-1"), `accounts/${O}/teams/room-1/room`);
  assert.throws(() => scratchArea(ids, "../../other"), /identifier/);
  for (const p of ["accounts/a/b", "probe/area"]) assert.equal(isAreaPath(p), true);
  for (const p of ["/abs", "a/../b", "a//b", "a/./b", "", "a/b c"]) assert.equal(isAreaPath(p), false);
});

test("ids: one dispatch key always names the same two containers, and one runner token; another key, others", () => {
  assert.deepEqual(planeNames("orbit-web", "run-1:1"), planeNames("orbit-web", "run-1:1"));
  assert.notEqual(planeNames("orbit-web", "run-1:1").tool, planeNames("orbit-web", "run-1:2").tool);
  assert.match(planeNames("orbit-web", "run-1:1").tool, /^orbit-web-tp-[0-9a-f]{24}$/);
  assert.equal(runnerToken("s".repeat(32), "run-1:1"), runnerToken("s".repeat(32), "run-1:1"));
  assert.notEqual(runnerToken("s".repeat(32), "run-1:1"), runnerToken("s".repeat(32), "run-1:2"));
  assert.notEqual(runnerToken("s".repeat(32), "run-1:1"), runnerToken("t".repeat(32), "run-1:1"));
  const labels = attemptLabels("orbit-web", { ...ids, dispatchKey: "run-1:1", runId: "run-1", assignmentId: "asg-1", fence: 3 }, "tool-plane");
  assert.equal(labels["orbit-web.account"], O);
  assert.equal(labels["orbit-web.fence"], "3");
});

test("ids: a connection's home is <account>/<connection> of the attempt's OWN account", () => {
  assert.equal(connectionSubpath(O, `${O}/conn-1`), `connections/${O}/conn-1`);
  assert.throws(() => connectionSubpath(O, `other-account/conn-1`), /another account/);
  for (const bad of [`${O}/../x`, `${O}`, `/data/connections/${O}/c`, `${O}/a/b`, 42]) assert.throws(() => connectionSubpath(O, bad));
});

test("storage: the first mechanism the kernel enforced is chosen; with none, measurement (SOFT), never shown as isolation", () => {
  const tried = [
    { mechanism: "xfs-project" as const, outcome: "failed" as const, evidence: "ext4" },
    { mechanism: "xfs-loop-pool" as const, outcome: "failed" as const, evidence: "prjquota: invalid argument" },
    { mechanism: "btrfs-qgroup" as const, outcome: "hard" as const, evidence: "EDQUOT" },
  ];
  assert.equal(chooseMechanism(tried, true).mechanism, "btrfs-qgroup");
  assert.equal(chooseMechanism(tried, true).perArea, "HARD_ENFORCED");
  assert.deepEqual([chooseMechanism(tried.slice(0, 2), true).mechanism, chooseMechanism(tried.slice(0, 2), true).perArea], ["measured", "SOFT_MONITORED"]);
  assert.equal(chooseMechanism([{ mechanism: "loop-per-volume", outcome: "not_implemented", evidence: "" }], true).mechanism, "measured");
  assert.equal(chooseMechanism([], false).perArea, "UNSUPPORTED");
  assert.equal(hostProtectionOf("btrfs-qgroup", { sizeMiB: 1024, preallocated: true }).level, "HARD_ENFORCED");
  assert.equal(hostProtectionOf("btrfs-qgroup", { sizeMiB: 1024, preallocated: false }).level, "SOFT_MONITORED");
  assert.equal(hostProtectionOf("measured", null).level, "UNSUPPORTED");
});

test("storage: a shell is admitted only with every writable area HARD -- or SOFT accepted by the operator under HARD host protection", () => {
  const hard = [{ area: "scratch" as const, level: "HARD_ENFORCED" as const }, { area: "tmp" as const, level: "HARD_ENFORCED" as const }];
  const soft = [{ area: "scratch" as const, level: "SOFT_MONITORED" as const }, { area: "tmp" as const, level: "HARD_ENFORCED" as const }];
  assert.equal(storageAdmits(hard, "UNSUPPORTED", false).ok, true);
  assert.match(storageAdmits(soft, "HARD_ENFORCED", false).detail, /^storage_not_enforceable.*not accepted/);
  assert.match(storageAdmits(soft, "SOFT_MONITORED", true).detail, /^storage_not_enforceable.*HARD host protection/);
  assert.equal(storageAdmits(soft, "HARD_ENFORCED", true).ok, true);
  assert.equal(storageAdmits([{ area: "cache", level: "UNSUPPORTED" }], "HARD_ENFORCED", true).ok, false);
  assert.deepEqual([tmpSizeMiB(1024), tmpSizeMiB(4096), tmpSizeMiB(32)], [256, 512, 16]);
});

test("protocol: the file operations reach /work, /output, /team and /toolbox, and nothing above them", () => {
  assert.equal(toolPath("src/a.ts"), "/work/src/a.ts");
  assert.equal(toolPath("/output/report.md"), "/output/report.md");
  assert.equal(toolPath("/toolbox/skills/x/SKILL.md"), "/work/toolbox/skills/x/SKILL.md");
  assert.equal(toolPath("/team/"), "/team");
  for (const bad of ["../etc/passwd", "/work/../etc/passwd", "/etc/passwd", "/connection/claude/.credentials.json", "/workers", "", "/work/a\0b", "/cache/x", "/input/x"]) assert.equal(toolPath(bad), null, bad);
});

test("protocol: a command is an argument list in /work; a request that would climb out, or carry NUL, is refused", () => {
  const ok = checkExecRequest({ argv: ["python3", "-c", "print(1); rm -rf /"], cwd: "src", timeoutMs: 1000, maxOutputBytes: 100 });
  assert.deepEqual([ok.argv.length, ok.cwd], [3, "/work/src"]);
  assert.throws(() => checkExecRequest({ argv: ["ls"], cwd: "../..", timeoutMs: 1000, maxOutputBytes: 100 }), /inside \/work/);
  assert.throws(() => checkExecRequest({ argv: ["ls"], cwd: "/etc", timeoutMs: 1000, maxOutputBytes: 100 }), /relative/);
  assert.throws(() => checkExecRequest({ argv: ["ls\0x"], timeoutMs: 1000, maxOutputBytes: 100 }), /NUL/);
  assert.throws(() => checkExecRequest({ argv: [], timeoutMs: 1000, maxOutputBytes: 100 }), /argv/);
  assert.throws(() => checkExecRequest({ argv: ["ls"], env: { "BAD NAME": "x" }, timeoutMs: 1000, maxOutputBytes: 100 }), /variable name/);
});

test("protocol: an attempt names its own account's connection, URL-safe tokens and no variable the allocator sets", () => {
  assert.equal(checkAttemptSpec(spec()).dispatchKey, "run-1:1");
  assert.throws(() => checkAttemptSpec(spec({ modelPlane: { cpuMillis: 500, memoryMiB: 1024, connectionHome: "someone-else/conn", env: {} } })), /another account/);
  assert.throws(() => checkAttemptSpec(spec({ modelPlane: { cpuMillis: 500, memoryMiB: 1024, connectionHome: `${O}/conn-1`, env: { ORBIT_WEB_RUNNER_TOKEN: "x" } } })), /set by the allocator/);
  assert.throws(() => checkAttemptSpec(spec({ egress: { proxyHost: "orbit-web", proxyPort: 3128, runToken: "has@sign:and/slash" } })), /URL-safe/);
  assert.throws(() => checkAttemptSpec(spec({ egress: { proxyHost: "orbit-web", proxyPort: 0, runToken: "tok_abcdefgh-123" } })), /proxyPort/);
  assert.throws(() => checkAttemptSpec(spec({ bridge: { url: "http://user:pw@orbit-web/x", runToken: "tok_abcdefgh-123" } })), /without credentials/);
  assert.throws(() => checkAttemptSpec(spec({ resources: { cpuMillis: 1 } })), /resources/);
  assert.throws(() => checkAttemptSpec(spec({ inputs: [{ name: "../x", base64: "" }] })), /plain file name/);
});

test("signing: only the secret's holder, fresh, once -- a changed body, an old request, a replay or another secret is refused", () => {
  const secret = "s".repeat(40);
  const body = Buffer.from('{"dispatchKey":"run-1:1"}');
  const nonces = new NonceCache();
  const h = signedHeaders(secret, "POST", "/v1/findAttempt", body, 1_000_000);
  assert.equal(verifySigned(secret, "POST", "/v1/findAttempt", h, body, nonces, 1_000_500), null);
  assert.match(verifySigned(secret, "POST", "/v1/findAttempt", h, body, nonces, 1_000_500) ?? "", /already used/);
  const h2 = signedHeaders(secret, "POST", "/v1/findAttempt", body, 1_000_000);
  assert.match(verifySigned(secret, "POST", "/v1/findAttempt", h2, Buffer.from('{"dispatchKey":"run-9:9"}'), nonces, 1_000_500) ?? "", /signature/);
  assert.match(verifySigned(secret, "POST", "/v1/remove", h2, body, nonces, 1_000_500) ?? "", /signature/);
  assert.match(verifySigned("t".repeat(40), "POST", "/v1/findAttempt", h2, body, nonces, 1_000_500) ?? "", /signature/);
  assert.match(verifySigned(secret, "POST", "/v1/findAttempt", h2, body, nonces, 1_000_000 + 61_000) ?? "", /window/);
  assert.match(verifySigned(secret, "POST", "/v1/findAttempt", {}, body, nonces) ?? "", /not signed/);
});

test("the secret file: at least 32 characters, never writable by everybody", () => {
  const dir = mkdtempSync(join(tmpdir(), "alloc-secret-"));
  try {
    const f = join(dir, "secret");
    writeFileSync(f, "short\n", { mode: 0o600 });
    assert.throws(() => readSecret(f), /shorter than 32/);
    writeFileSync(f, `${"k".repeat(40)}\n`);
    assert.equal(readSecret(f), "k".repeat(40));
    chmodSync(f, 0o666);
    assert.throws(() => readSecret(f), /writable by everybody/);
    assert.throws(() => readSecret(join(dir, "missing")), /create it first/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("capacity: detected or configured, minus the control plane's limits and the OS reserve", () => {
  const caps = { host: { cpuMillis: 4000, memoryMiB: 16_000, storageMiB: 20_000 }, storage: { mechanism: "btrfs-qgroup", perArea: "HARD_ENFORCED", hostProtection: "HARD_ENFORCED", evidence: "", probedAt: null }, probedAt: "2026-11-21T00:00:00.000Z" } as unknown as HostCapabilities;
  const detected = infrastructureCapacity(caps, loadSandboxConfig({ ORBIT_WEB_CONTROL_PLANE_LIMITS: "orbit-web:1:2g,postgres:0.5:768m,allocator:0.25:256m" }));
  assert.equal(detected.source, "detected");
  assert.deepEqual(detected.headroom, { cpuMillis: 1750 + 400, memoryMiB: 3072 + 1600, storageMiB: 2000 });
  assert.deepEqual(detected.usable, { cpuMillis: 1850, memoryMiB: 11_328, storageMiB: 18_000 });
  const configured = infrastructureCapacity(caps, loadSandboxConfig({ ORBIT_WEB_CAPACITY_CPU: "2", ORBIT_WEB_CAPACITY_RESERVE_CPU: "0%", ORBIT_WEB_CAPACITY_RESERVE_MEMORY: "1g" }));
  assert.equal(configured.source, "configured");
  assert.deepEqual([configured.total.cpuMillis, configured.usable.cpuMillis, configured.headroom.memoryMiB], [2000, 2000, 1024]);
  const tiny = infrastructureCapacity(caps, loadSandboxConfig({ ORBIT_WEB_CONTROL_PLANE_LIMITS: "orbit-web:8:64g" }));
  assert.deepEqual([tiny.usable.cpuMillis, tiny.usable.memoryMiB], [0, 0]);
});
