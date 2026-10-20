// Running is not ready, ready is not correct, and "nobody can tell" is a valid
// answer: the three states, where a probe came from, and the port a second project
// finds taken.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conflicts, ownerLookup, runningEverywhere } from "../src/runtime/ports.mjs";
import { hinted, portsOpenedBy, probeFor, readiness, startedWith, waitReady } from "../src/runtime/readiness.mjs";
import { liveRoom } from "../src/runtime/rooms.mjs";
import { PROBE_NAMES } from "../src/runtime/vocab.mjs";
import { createSessions } from "../src/runtime/sessions.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { fakeProbe } from "./fakes/probe.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const component = (ports = []) => ({ key: "node:web", ports });
const deps = (over = {}) => ({ probe: fakeProbe(), process: fakeProcess(), root: "/work/shop", env: {}, ...over });

test("a probe is the person's, else a declared port, else none -- and its source is said", () => {
  const human = { kind: "http", target: "http://localhost:8080/health", expect: 200 };
  assert.deepEqual(probeFor(component([{ port: 5000, confidence: "possible" }]), human), { kind: "http", target: human.target, expect: 200, source: "human" });
  assert.deepEqual(probeFor(component([{ port: 9000, confidence: "possible" }, { port: 5000, confidence: "certain" }]), null), { kind: "tcp", target: 5000, source: "discovered" });
  assert.deepEqual(probeFor(component([{ port: 9000, confidence: "possible" }]), null), { kind: "tcp", target: 9000, source: "discovered" });
  assert.equal(probeFor(component(), null), null);
});

test("a process that is not running has no readiness; one that is, with nothing to ask, is RUNNING and READINESS_UNKNOWN -- a valid state", async () => {
  assert.equal((await readiness(false, { kind: "tcp", target: 1 }, deps())).state, "NOT_RUNNING");
  const unknown = await readiness(true, null, deps());
  assert.equal(unknown.state, "READINESS_UNKNOWN");
  assert.match(unknown.because, /no file or setting says how to tell it is ready/);
});

test("alive is not ready: a running process whose port is closed is NOT_READY, and open is READY", async () => {
  const probe = fakeProbe();
  const tcp = { kind: "tcp", target: 5000, source: "discovered" };
  const closed = await readiness(true, tcp, deps({ probe }));
  assert.deepEqual([closed.state, closed.probe.source], ["NOT_READY", "discovered"]);
  probe.listen(5000);
  assert.deepEqual([(await readiness(true, tcp, deps({ probe }))).state, probe.calls.length], ["READY", 2]);
});

test("an http probe: a 2xx by default, an exact status when the person named one, and any other answer is not ready", async () => {
  const url = "http://localhost:8080/health";
  const ask = (status, expect) => readiness(true, { kind: "http", target: url, expect, source: "human" }, deps({ probe: fakeProbe({ http: { [url]: status } }) }));
  assert.equal((await ask(204)).state, "READY");
  assert.equal((await ask(503)).state, "NOT_READY");
  assert.match((await ask(503)).because, /answered 503, which is not a 2xx/);
  assert.equal((await ask(302, 302)).state, "READY");
  assert.match((await ask(200, 204)).because, /answered 200, not 204/);
  assert.equal((await ask(undefined)).state, "NOT_READY");
});

test("a command is not a way to ask: no probe runs a program, whatever a setting or a record says", async () => {
  const process = fakeProcess({ "pg_isready": { ok: true, out: "", status: 0 } });
  const asked = await readiness(true, { kind: "command", target: "pg_isready -p 5432", source: "human" }, deps({ process }));
  assert.equal(asked.state, "READINESS_UNKNOWN", "a probe of a kind nothing asks is not a crash and not a pass");
  assert.match(asked.because, /kind "command" is not one this knows how to ask/);
  assert.equal(process.calls.length, 0, "nothing was run for it");
  assert.deepEqual(PROBE_NAMES, ["process", "tcp", "http"]);
});

test("waiting looks again until ready or the time is spent -- and a test never really waits", async () => {
  const probe = fakeProbe();
  let now = 0;
  const clock = { now: () => now, sleep: async (ms) => { now += ms; if (now >= 1500) probe.listen(5000); } };
  const tcp = { kind: "tcp", target: 5000, source: "discovered" };
  const got = await waitReady(true, tcp, deps({ probe, ...clock }), 10000);
  assert.deepEqual([got.state, now], ["READY", 1500]);
  const never = await waitReady(true, { kind: "tcp", target: 6000, source: "discovered" }, deps({ probe: fakeProbe(), now: () => now, sleep: async (ms) => { now += ms; } }), 2000);
  assert.equal(never.state, "NOT_READY");
  const early = await waitReady(true, null, deps({ ...clock }), 10000);
  assert.equal(early.state, "READINESS_UNKNOWN", "nothing to ask means nothing to wait for");
});

test("a port that is taken is BLOCKED with whose it is when Orbit knows, and `external` when it does not", async () => {
  const probe = fakeProbe({ tcp: { 8080: true, 9090: true, 7000: false } });
  const owners = new Map([[8080, { project: "payments", checkout: "/work/payments", component: "node:api" }]]);
  const got = await conflicts([{ component: "node:web", port: 8080 }, { component: "node:web", port: 9090 }, { component: "node:web", port: 7000 }], { probe, ownerOf: (p) => owners.get(p) ?? null });
  assert.deepEqual(got.map((c) => [c.port, c.owner?.project ?? "external"]), [[8080, "payments"], [9090, "external"]]);
});

test("whose a port is comes from Orbit's own receipts across every project -- proven running, never guessed", () => {
  const io = fakeIo();
  const registry = { list: () => [{ key: "repo-a", name: "payments", checkouts: [{ id: "a".repeat(64), root: "/work/payments" }] }, { key: "repo-b", name: "shop", checkouts: [{ id: "b".repeat(64), root: "/work/shop" }] }] };
  const process = fakeProcess();
  const mine = process.launch("x", []);
  const stranger = process.launch("y", []);
  process.reuse(stranger.pid, "2020-01-01T00:00:00.000Z");
  const put = (key, checkout, doc) => createSessions(liveRoom(`/base/${key}`, "laptop", checkout), io).write({ env: "e", requestedAt: "2026-10-03T10:00:00.000Z", state: "RUNNING", ...doc });
  put("repo-a", "a".repeat(64), { id: "rs-aaaaaaaaaaaa", component: "node:api", pid: mine.pid, pidStartedAt: mine.startedAt, ports: [8080] });
  put("repo-b", "b".repeat(64), { id: "rs-bbbbbbbbbbbb", component: "node:web", pid: stranger.pid, pidStartedAt: stranger.startedAt, ports: [9090] });
  put("repo-b", "b".repeat(64), { id: "rs-cccccccccccc", component: "node:old", pid: 1, state: "STOPPED", ports: [7000] });
  const running = runningEverywhere({ registry, storeBase: "/base", host: "laptop", io, process });
  assert.deepEqual(running.map((r) => [r.project, r.component, r.ports]), [["payments", "node:api", [8080]]], "a reused pid and a stopped session are nobody's");
  assert.deepEqual(ownerLookup(running)(8080), { project: "payments", checkout: "/work/payments", component: "node:api", owner: { kind: "human" } }, "a receipt written before owners existed is a person's");
  assert.equal(ownerLookup(running)(9090), null);
});

test("a discovered probe waits on a port the command it was STARTED WITH opens -- never on one only another launch profile opens", () => {
  const component = { ports: [{ port: 7168, confidence: "certain" }, { port: 5067, confidence: "certain" }], commands: [{ declaredAs: "start:http", ports: [5067] }, { declaredAs: "start:https", ports: [5067, 7168] }, { declaredAs: "dev", ports: null }] };
  const session = (declaredAs) => ({ command: { declaredAs } });
  assert.deepEqual(probeFor(component, null, startedWith(component, session("start:http"))), { kind: "tcp", target: 5067, source: "discovered" });
  assert.equal(probeFor(component, null, startedWith(component, session("dev"))).target, 7168, "a command that names no ports of its own: a port the component declares");
  assert.equal(probeFor(component, { kind: "tcp", target: 9000 }, startedWith(component, session("start:http"))).target, 9000, "a person's probe still wins");
  assert.equal(startedWith(component, session("start:gone")), null, "a command the files no longer declare");
  assert.deepEqual([portsOpenedBy(component, component.commands[0]), portsOpenedBy(component, component.commands[2])], [[5067], [7168, 5067]], "a start checks only the ports it will open");
});

test("a provider's own knowledge of being out of reach is said BESIDE the probe's sentence, and only when it is not ready", () => {
  const provider = { unreached: "listen on all interfaces" };
  assert.deepEqual(hinted({ state: "NOT_READY", because: "nothing answered" }, provider), { state: "NOT_READY", because: "nothing answered — listen on all interfaces" });
  assert.deepEqual(hinted({ state: "READY", because: "port 5 accepts a connection" }, provider).because, "port 5 accepts a connection");
  assert.deepEqual(hinted({ state: "NOT_READY", because: "nothing answered" }, { id: "native" }).because, "nothing answered", "a provider with nothing to add adds nothing");
  assert.equal(hinted({ state: "NOT_READY", because: "x" }, null).because, "x");
});
