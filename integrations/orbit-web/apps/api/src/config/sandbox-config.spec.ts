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
  assert.deepEqual([deployed.control, deployed.attemptSubnets], [{ container: "orbit-web", alias: "orbit-web" }, []]);
  const lab = loadSandboxConfig({ ORBIT_WEB_CONTROL_CONTAINER: "none", ORBIT_WEB_SANDBOX_HOST: "egress", ORBIT_WEB_ATTEMPT_SUBNETS: "10.231.0.0/16, 172.16.0.0/20" });
  assert.deepEqual([lab.control, lab.attemptSubnets], [{ container: null, alias: "egress" }, ["10.231.0.0/16", "172.16.0.0/20"]]);
});

test("anything else is refused, naming the variable", () => {
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_SANDBOX: "container" }), /needs ORBIT_WEB_ALLOCATOR_URL/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_SANDBOX: "vm" }), /container or process/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_ALLOCATOR_URL: "https://allocator" }), /http:\/\//);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_ALLOCATOR_URL: "http://user:pw@allocator:7171" }), /http:\/\/ origin/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION: "bad image --privileged" }), /ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_CONTROL_CONTAINER: "../host" }), /ORBIT_WEB_CONTROL_CONTAINER/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_SANDBOX_HOST: "-bad-" }), /ORBIT_WEB_SANDBOX_HOST/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_ATTEMPT_SUBNETS: "10.0.0.0/30" }), /\/8 to \/28/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_ATTEMPT_SUBNETS: "10.0.0.300/16" }), /\/8 to \/28/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_CAPACITY_RESERVE_CPU: "100%" }), /0% to 99%/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_ALLOCATOR_SECRET_FILE: "relative/path" }), /absolute/);
});

test("runtime security is OFF unless the operator names a backend, with no floor; both sides read the same settings", () => {
  const dev = loadSandboxConfig({});
  assert.deepEqual(dev.runtimeSecurity, {
    backend: "off",
    floor: "disabled",
    sensor: "orbit-tetragon",
    eventsDir: "/run/orbit-runtime-security/events",
    containAfterMs: 15_000,
    freshMs: 60_000,
    retentionDays: 14,
    maxEventsPerRun: 20_000,
    reserve: { cpuMillis: 1000, memoryMiB: 1024 },
  });
  const on = loadSandboxConfig({ ORBIT_WEB_RUNTIME_SECURITY: "tetragon", ORBIT_WEB_RUNTIME_SECURITY_FLOOR: "enforce", ORBIT_WEB_RUNTIME_SECURITY_SENSOR: "lab-tetragon", ORBIT_WEB_RUNTIME_SECURITY_EVENTS_DIR: "/srv/events", ORBIT_WEB_RUNTIME_SECURITY_CONTAIN_AFTER_MS: "5000", ORBIT_WEB_RUNTIME_SECURITY_RETENTION_DAYS: "3", ORBIT_WEB_RUNTIME_SECURITY_RESERVE_CPU: "500m", ORBIT_WEB_RUNTIME_SECURITY_RESERVE_MEMORY: "512m" });
  assert.equal(on.runtimeSecurity.backend, "tetragon");
  assert.equal(on.runtimeSecurity.floor, "enforce");
  assert.equal(on.runtimeSecurity.sensor, "lab-tetragon");
  assert.equal(on.runtimeSecurity.eventsDir, "/srv/events");
  assert.equal(on.runtimeSecurity.containAfterMs, 5000);
  assert.equal(on.runtimeSecurity.retentionDays, 3);
  assert.deepEqual(on.runtimeSecurity.reserve, { cpuMillis: 500, memoryMiB: 512 });
  // A floor with no backend is kept as said: every attempt it covers is then refused, never run unprotected.
  assert.equal(loadSandboxConfig({ ORBIT_WEB_RUNTIME_SECURITY_FLOOR: "observe" }).runtimeSecurity.floor, "observe");
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_RUNTIME_SECURITY: "falco" }), /ORBIT_WEB_RUNTIME_SECURITY must be off or tetragon/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_RUNTIME_SECURITY_FLOOR: "strict" }), /ORBIT_WEB_RUNTIME_SECURITY_FLOOR must be disabled, observe or enforce/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_RUNTIME_SECURITY_CONTAIN_AFTER_MS: "10" }), /ORBIT_WEB_RUNTIME_SECURITY_CONTAIN_AFTER_MS/);
  assert.throws(() => loadSandboxConfig({ ORBIT_WEB_RUNTIME_SECURITY_EVENTS_DIR: "relative/dir" }), /ORBIT_WEB_RUNTIME_SECURITY_EVENTS_DIR/);
});
