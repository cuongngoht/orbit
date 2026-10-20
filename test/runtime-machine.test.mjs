// What a machine can do, asked through the real tool detection: three answers
// kept apart, only what a checkout needs probed, and a daemon that is down never
// confused with a command that is missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dockerDaemon } from "../src/runtime/machine.mjs";
import { finding } from "../src/tools/detect.mjs";
import { fakeDetection, fakeMachine, TOOL_ROWS } from "./fakes/machine.mjs";

const row = (id) => TOOL_ROWS.find((r) => r.id === id);

test("nothing is known until somebody asks, and reading what is known probes nothing", () => {
  const { machine, ran } = fakeMachine({ node: "22.1.0" });
  assert.deepEqual(machine.cached(["node"]).node, { state: "UNKNOWN", version: null, reason: null, checkedAt: null });
  assert.deepEqual(ran, []);
});

test("a probe asks ONLY the tools named, and what it finds is remembered with its version", () => {
  const { machine, ran } = fakeMachine({ node: "22.1.0", dotnet: "8.0.100", python3: "3.13.1" });
  const got = machine.probe(["node", "dotnet"]);
  assert.deepEqual([got.node.state, got.node.version, got.dotnet.version], ["AVAILABLE", "22.1.0", "8.0.100"]);
  assert.deepEqual(ran.map((c) => c[0]), ["/usr/bin/node", "/usr/bin/dotnet"], "python was never asked about");
  assert.equal(machine.cached(["python3"]).python3.state, "UNKNOWN");
  assert.equal(machine.cached(["node"]).node.version, "22.1.0", "what was found is kept");
});

test("absent is UNAVAILABLE, and a tool that was found and did not answer is UNKNOWN -- never one for the other", () => {
  const slow = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" });
  const { machine } = fakeMachine({ node: false, dotnet: slow, npm: "10.8.1" });
  const got = machine.probe(["node", "dotnet", "npm", "yarn"]);
  assert.deepEqual([got.node.state, got.dotnet.state, got.npm.state, got.yarn.state], ["UNAVAILABLE", "UNKNOWN", "AVAILABLE", "UNAVAILABLE"]);
  assert.match(got.dotnet.reason, /did not answer in time/);
});

test("an observation older than its time to live is UNKNOWN again, so a stale 'yes' is not trusted", () => {
  const { machine, state } = fakeMachine({ node: "22.1.0" });
  machine.probe(["node"]);
  const observed = state.read("observed");
  observed.tools.node.checkedAt = "2026-09-01T00:00:00.000Z";
  state.change("observed", () => observed);
  assert.equal(machine.cached(["node"]).node.state, "UNKNOWN");
});

test("the Docker daemon is its own question: three answers, three sentences", () => {
  const ask = (daemon, docker = "27.3.1") => {
    const { detection } = fakeDetection({ docker, "docker-daemon": daemon });
    return finding(row("docker-daemon"), dockerDaemon(row("docker-daemon"), { ...detection, now: () => "t" }), { now: () => "t" });
  };
  const up = ask("27.3.1");
  assert.deepEqual([up.status, up.version], ["ready", "27.3.1"]);
  const noCli = ask("27.3.1", false);
  assert.deepEqual([noCli.status, noCli.reason], ["missing", "the docker command is not installed, so there is no daemon to ask"]);
  const down = ask(false);
  assert.deepEqual([down.status, /daemon is not reachable/.test(down.reason)], ["missing", true]);
  const slow = ask("timeout");
  assert.deepEqual([slow.status, slow.reason], ["unknown", "the docker daemon did not answer in time"]);
});

test("the machine reads the daemon through the same tool state, so doctor and the resolver cannot disagree", () => {
  const { machine } = fakeMachine({ docker: "27.3.1", "docker-daemon": "timeout", devcontainer: "0.71.0" });
  const got = machine.probe(["docker", "docker-daemon", "devcontainer"]);
  assert.deepEqual([got.docker.state, got["docker-daemon"].state, got.devcontainer.state], ["AVAILABLE", "UNKNOWN", "AVAILABLE"]);
});

test("a tool that is not in the catalog is UNKNOWN with a sentence, not a crash", () => {
  const { machine } = fakeMachine({});
  assert.equal(machine.cached(["nonesuch"]).nonesuch.state, "UNKNOWN");
  assert.match(machine.cached(["nonesuch"]).nonesuch.reason, /no tool of that name/);
});
