// A port a sandbox uses is LEASED -- recorded before anything listens, never one something answers on, never one
// another sandbox holds -- and a component is told it only by evidence a project or a person gave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ABANDONED_MS, MAX_CANDIDATES, STALE_LEASES, createLeases, staleOf } from "../src/runtime/sandbox/ports.mjs";
import { BINDING_SOURCES, PORT_MODE, bindingOf, portModeOf, probeOnLease, withBinding } from "../src/runtime/sandbox/binding.mjs";
import { portProblem } from "../src/runtime/sandbox/policy.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { fakeProbe } from "./fakes/probe.mjs";

const ROOM = join("/base", "control", "hosts", "laptop", "ports");
const A = { kind: "task", id: "tsk-aaaaaaaaaaaa" };
const B = { kind: "task", id: "tsk-bbbbbbbbbbbb" };
const NOW = () => "2026-10-07T10:00:00.000Z";

const want = (over = {}) => ({ owner: A, env: "env-aaaaaaaaaaaa", checkout: "c".repeat(64), project: "shop", component: "node:web", from: 42000, to: 42999, host: "laptop", ...over });

function leases(opts = {}) {
  const io = fakeIo();
  const probe = fakeProbe(opts.world);
  return { io, probe, held: createLeases(ROOM, io, { host: "laptop", now: NOW, judge: opts.judge }) };
}

test("the first port nobody leased and nothing answers on is the lease, recorded as a receipt of whose it is", async () => {
  const { held, probe } = leases();
  const got = await held.acquire(want(), { probe });
  assert.deepEqual([got.lease.port, got.lease.owner, got.lease.env, got.lease.component, got.lease.requestedAt], [42000, A, "env-aaaaaaaaaaaa", "node:web", NOW()]);
  assert.deepEqual(held.list().map((l) => l.port), [42000]);
});

test("a leased port and a port something answers on are both passed over -- the answering one is somebody's, and is never taken", async () => {
  const { held, probe } = leases({ world: { tcp: { 42001: true } } });
  const first = await held.acquire(want(), { probe });
  const second = await held.acquire(want({ owner: B, env: "env-bbbbbbbbbbbb" }), { probe });
  assert.deepEqual([first.lease.port, second.lease.port], [42000, 42002]);
});

test("looking is bounded: a range where everything answers is not walked, and the answer says so", async () => {
  const world = { tcp: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [42000 + i, true])) };
  const { held, probe } = leases({ world });
  const got = await held.acquire(want({ to: 42199 }), { probe });
  assert.equal(got.lease, null);
  assert.match(got.because, new RegExp(`looked at ${MAX_CANDIDATES}`));
  assert.equal(probe.calls.length, MAX_CANDIDATES);
  assert.deepEqual(held.list(), []);
});

test("releasing lets go of what an owner holds in one environment, and of nothing else", async () => {
  const { held, probe } = leases();
  await held.acquire(want(), { probe });
  await held.acquire(want({ component: "dotnet:api" }), { probe });
  await held.acquire(want({ owner: B, env: "env-bbbbbbbbbbbb" }), { probe });
  const gone = await held.release({ env: "env-aaaaaaaaaaaa", owner: A, component: "node:web" });
  assert.deepEqual(gone.map((l) => l.component), ["node:web"]);
  assert.deepEqual(held.list().map((l) => [l.owner.id, l.component]).sort(), [[A.id, "dotnet:api"], [B.id, "node:web"]]);
  await held.release({ env: "env-aaaaaaaaaaaa", owner: A });
  assert.deepEqual(held.list().map((l) => l.owner.id), [B.id], "the other task's lease is still its own");
});

test("a lease nobody can need any more is let go -- a released sandbox's at once, another checkout's only when it is a day old and nothing runs there", () => {
  const f = (over) => ({ age: 1000, running: false, ...over });
  assert.deepEqual([staleOf(f({ own: "RELEASED" })), staleOf(f({ own: null })), staleOf(f({ own: "READY" })), staleOf(f({ own: "PREPARING" }))], [true, true, false, false]);
  assert.deepEqual([staleOf(f({ own: undefined })), staleOf(f({ own: undefined, age: ABANDONED_MS + 1 })), staleOf(f({ own: undefined, age: ABANDONED_MS + 1, running: true }))], [false, true, false]);
  assert.ok(STALE_LEASES.every((r) => r.say) && STALE_LEASES.at(-1).when({}));
});

test("an acquisition drops a released sandbox's lease, so its port can be leased again", async () => {
  const { held, probe } = leases({ judge: (l) => ({ own: l.env === "env-aaaaaaaaaaaa" ? "RELEASED" : "READY", running: false }) });
  await held.acquire(want(), { probe });
  const again = await held.acquire(want({ owner: B, env: "env-bbbbbbbbbbbb" }), { probe });
  assert.equal(again.lease.port, 42000);
  assert.deepEqual(held.list().map((l) => l.env), ["env-bbbbbbbbbbbb"]);
});

const ENV = { kind: "env", name: "LISTEN_ON", format: "http://127.0.0.1:{port}" };
const ARGV = { kind: "argv", after: "--", flag: "--urls", format: "http://127.0.0.1:{port}" };

test("how a component is told its port is evidence in order -- a person's word, then the project's own files -- and with none the port is FIXED", () => {
  assert.deepEqual(BINDING_SOURCES.map((s) => s.name), ["PERSON", "COMMAND", "FIXED"]);
  assert.deepEqual(bindingOf({ settings: { port: { override: ENV } }, command: { portOverride: ARGV } }), { binding: ENV, source: "PERSON" });
  assert.deepEqual(bindingOf({ settings: {}, command: { portOverride: ARGV } }), { binding: ARGV, source: "COMMAND" });
  assert.deepEqual(bindingOf({ settings: {}, command: {} }), { binding: null, source: "FIXED" });
});

test("a port can move only for a component that can be told, runs on this machine, opens one port, and a person did not fix them", () => {
  const can = { execution: "native", policy: { ports: { mode: "lease" } }, binding: ENV, ports: 1 };
  assert.equal(portModeOf(can), "lease");
  assert.equal(portModeOf({ ...can, execution: "devcontainer" }), "fixed");
  assert.equal(portModeOf({ ...can, policy: { ports: { mode: "fixed" } } }), "fixed");
  assert.equal(portModeOf({ ...can, ports: 2 }), "fixed");
  assert.equal(portModeOf({ ...can, binding: null }), "fixed");
  assert.ok(PORT_MODE.every((r) => r.say) && PORT_MODE.at(-1).when({}));
});

test("a binding adds an environment name or an argument after the command's own -- and a component with none is launched as it is", () => {
  const command = { argv: ["dotnet", "run", "--launch-profile", "http"] };
  assert.deepEqual(withBinding(command, ENV, 42001), { argv: command.argv, env: { LISTEN_ON: "http://127.0.0.1:42001" }, names: ["LISTEN_ON"] });
  assert.deepEqual(withBinding(command, ARGV, 42001).argv, [...command.argv, "--", "--urls", "http://127.0.0.1:42001"]);
  assert.deepEqual(withBinding(command, null, 42001), { argv: command.argv, env: {}, names: [] });
});

test("a readiness probe a person wrote for their own port is asked on the one the sandbox was given -- and a discovered one already is", () => {
  assert.deepEqual(probeOnLease({ kind: "tcp", target: 5173, source: "human" }, [42007]), { kind: "tcp", target: 42007, source: "human" });
  assert.equal(probeOnLease({ kind: "http", target: "http://localhost:5173/health", source: "human" }, [42007]).target, "http://localhost:42007/health");
  assert.deepEqual(probeOnLease({ kind: "tcp", target: 5173, source: "discovered" }, [42007]), { kind: "tcp", target: 5173, source: "discovered" });
  assert.equal(probeOnLease(null, [1]), null);
  assert.deepEqual(probeOnLease({ kind: "tcp", target: 1, source: "human" }, []), { kind: "tcp", target: 1, source: "human" });
});

test("a port override is a person's word held to a shape: where it is a URL it is this machine's, it names no credential, and {port} appears once", () => {
  assert.equal(portProblem({ override: ENV }), null);
  assert.equal(portProblem({ override: ARGV }), null);
  assert.match(portProblem({ override: { ...ENV, format: "http://db.example:{port}" } }), /holds \{port\} once/);
  assert.match(portProblem({ override: { ...ENV, format: "{port}{port}" } }), /holds \{port\} once/);
  assert.match(portProblem({ override: { kind: "env", name: "1BAD", format: "{port}" } }), /names the variable/);
  assert.match(portProblem({ override: { kind: "argv", flag: "urls", format: "{port}" } }), /names the flag/);
  assert.match(portProblem({ override: { ...ENV, after: "--" } }), /only for an argv override/);
  assert.match(portProblem({ command: "x" }), /port is \{ override/);
});

test("a port is leased only when the machine said, in so many words, that nothing listens: a denied or silent probe is 'I could not tell', never 'nobody's'", async () => {
  const denied = { tcp: async (port) => ({ ok: false, error: `127.0.0.1:${port} refused the connection (EPERM)` }) };
  const { held } = leases();
  const none = await held.acquire(want({ to: 42010 }), { probe: denied });
  assert.equal(none.lease, null, "a host's sandbox that will not let a process connect leases nothing, rather than a port somebody may hold");
  const refused = { tcp: async (port) => (port === 42000 ? { ok: false, error: "x (ECONNREFUSED)" } : { ok: false, error: "timed out" }) };
  assert.equal((await held.acquire(want(), { probe: refused })).lease.port, 42000);
  const forwarder = { tcp: async (port) => ({ ok: false, error: `127.0.0.1:${port} accepted the connection and closed it before answering — a forwarded port with nothing listening behind it` }) };
  assert.equal((await leases().held.acquire(want({ to: 42005 }), { probe: forwarder })).lease, null, "a published port nothing listens behind is not free either");
});
