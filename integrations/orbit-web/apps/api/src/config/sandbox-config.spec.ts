// The sandbox's configuration: sizes and CPUs as an operator writes them, safe defaults, the stated starting values of
// the model plane, and a refusal -- naming the variable -- for anything else.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSandboxConfig, MODEL_PLANE_DEFAULTS, parseControlPlane, parseCpuMillis, parseMiB, SandboxConfigError } from "./sandbox-config.js";

test("sizes and CPUs as an operator writes them", () => {
  assert.deepEqual([parseMiB("512", "x"), parseMiB("512m", "x"), parseMiB("20g", "x"), parseMiB("1.5G", "x"), parseMiB("1t", "x"), parseMiB("2GiB", "x")], [512, 512, 20480, 1536, 1048576, 2048]);
  assert.deepEqual([parseCpuMillis("2", "x"), parseCpuMillis("1.5", "x"), parseCpuMillis("500m", "x")], [2000, 1500, 500]);
  for (const bad of ["", "abc", "-1", "0", "1x"]) assert.throws(() => parseMiB(bad, "SIZE"), SandboxConfigError);
  for (const bad of ["", "two", "0", "-1"]) assert.throws(() => parseCpuMillis(bad, "CPU"), SandboxConfigError);
  assert.deepEqual(parseControlPlane("orbit-web:1:2g, postgres:0.5:768m"), [
    { name: "orbit-web", cpuMillis: 1000, memoryMiB: 2048 },
    { name: "postgres", cpuMillis: 500, memoryMiB: 768 },
  ]);
  assert.throws(() => parseControlPlane("orbit-web:1"), /name:cpus:memory/);
});

test("defaults: the process provider without an allocator, the container provider with one -- never a silent mix", () => {
  const dev = loadSandboxConfig({});
  assert.equal(dev.provider, "process");
  assert.equal(dev.allocator, null);
  assert.deepEqual(dev.modelPlane, MODEL_PLANE_DEFAULTS);
  assert.deepEqual([dev.pool.sizeMiB, dev.pool.preallocate, dev.acceptSoftStorage], [20480, true, false]);
  assert.deepEqual(dev.headroom.reserve.cpu, { kind: "share", percent: 10 });
  const deployed = loadSandboxConfig({ ORBIT_WEB_ALLOCATOR_URL: "http://orbit-allocator:7171", ORBIT_WEB_ACCEPT_SOFT_STORAGE: "1", ORBIT_WEB_MODEL_PLANE_CLAUDE_MEMORY: "2g", ORBIT_WEB_WORKFORCE_POOL_SIZE: "64g", ORBIT_WEB_CAPACITY_RESERVE_MEMORY: "2g" });
  assert.equal(deployed.provider, "container");
  assert.deepEqual(deployed.allocator, { url: "http://orbit-allocator:7171", secretFile: "/run/secrets/orbit-allocator" });
  assert.equal(deployed.modelPlane.claude.memoryMiB, 2048);
  assert.equal(deployed.modelPlane.codex.memoryMiB, MODEL_PLANE_DEFAULTS.codex.memoryMiB);
  assert.deepEqual([deployed.pool.sizeMiB, deployed.acceptSoftStorage], [65536, true]);
  assert.deepEqual(deployed.headroom.reserve.memory, { kind: "amount", value: 2048 });
  assert.equal(deployed.names.workforceVolume, "orbit-web-workforce");
});

test("anything else is refused, naming the variable", () => {
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_SANDBOX: "container" }), /needs ORBIT_WEB_ALLOCATOR_URL/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_SANDBOX: "vm" }), /container or process/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_ALLOCATOR_URL: "https://allocator" }), /http:\/\//);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_ALLOCATOR_URL: "http://user:pw@allocator:7171" }), /http:\/\/ origin/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION: "bad image --privileged" }), /ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_SANDBOX_NETWORK: "../host" }), /ORBIT_WEB_SANDBOX_NETWORK/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_CAPACITY_RESERVE_CPU: "100%" }), /0% to 99%/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_ALLOCATOR_SECRET_FILE: "relative/path" }), /absolute/);
});
