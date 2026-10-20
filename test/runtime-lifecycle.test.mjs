// The lifecycle, step by step and apart: doctor probes, start launches a declared
// command behind a receipt, status looks, stop ends only what Orbit can prove is its
// own. Scenarios A, J, K and L, and every way a pid can lie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { Blocked, Refused } from "../src/errors.mjs";
import { doctor, prepare } from "../src/runtime/lifecycle/prepare.mjs";
import { start } from "../src/runtime/lifecycle/start.mjs";
import { status } from "../src/runtime/lifecycle/status.mjs";
import { stop } from "../src/runtime/lifecycle/stop.mjs";
import { planned } from "../src/runtime/lifecycle/world.mjs";
import { ensure, look } from "../src/runtime/understanding.mjs";
import { createSessions } from "../src/runtime/sessions.mjs";
import { liveRoom } from "../src/runtime/rooms.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { created } from "../src/runtime/instances.mjs";
import { sayStart, sayStatus } from "../src/runtime/views.mjs";
import { checkTarget } from "../src/runtime/connectivity/check.mjs";
import { CONNECTIVITY_FRESH_MS } from "../src/runtime/connectivity/observations.mjs";
import { FULL_TOOLS, NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { CHECKOUT, NOW, fakeRuntime } from "./fakes/runtime-ctx.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const TOOLS = { node: "22.1.0", npm: "10.8.1", dotnet: "8.0.100" };

// Understand the checkout, then ask the machine -- the two steps a person takes first.
function ready(files = NODE_AND_DOTNET, opts = {}) {
  const rt = fakeRuntime(files, { tools: TOOLS, ...opts });
  ensure(rt.ctx);
  return { ...rt, planned: () => planned(rt.ctx, look(rt.ctx), rt.ctx.readSettings().settings, { probe: true }) };
}

test("doctor asks only the tools this checkout's requirements name -- and never the container host when native runs everything", () => {
  const { ctx, machine } = ready();
  const out = doctor(ctx);
  assert.deepEqual(machine.ran.map((c) => c[0].split("/").pop()).sort(), ["dotnet", "node", "npm"]);
  assert.equal(out.plan.overall, "READY");
  assert.deepEqual(out.machine.asked.sort(), ["dotnet", "node", "npm"]);
  assert.equal(out.providers.length, 2);
});

test("when something cannot run natively, the container host is asked too -- a container might be the way", () => {
  const { ctx, machine } = ready(NODE_AND_DOTNET, { tools: { npm: "10.8.1", dotnet: "8.0.100", node: false, docker: "27.3.1", "docker-daemon": "27.3.1", devcontainer: "0.71.0" } });
  const out = doctor(ctx);
  assert.ok(machine.ran.some((c) => c[0].endsWith("/docker")), "docker was asked");
  assert.equal(out.plan.components.find((c) => c.key === "node:web").state, "blocked");
});

test("status asks nothing of the machine: an unasked tool is UNKNOWN, and a doctor makes it known", async () => {
  const { ctx, machine, process } = ready();
  const before = await status(ctx);
  assert.deepEqual([before.plan.overall, machine.ran.length, process.calls.length], ["UNKNOWN", 0, 0]);
  doctor(ctx);
  assert.equal((await status(ctx)).plan.overall, "READY");
});

test("Scenario A: doctor, start native, running -- the declared command through the Process port, behind a receipt written FIRST", async () => {
  const { ctx, process, planned: world } = ready();
  const seen = [];
  const launch = process.launch;
  process.launch = (file, args, opts) => (seen.push({ receipts: ctx.sessions.list().map((s) => s.state), file, args, opts }), launch(file, args, opts));
  const out = await start(ctx, world(), {});
  assert.deepEqual(out.started.map((s) => s.component).sort(), ["dotnet:api", "node:web"]);
  assert.deepEqual(seen[0].receipts, ["STARTING"], "the receipt existed before the first launch, and said STARTING");
  assert.ok(seen.every((s) => s.receipts.includes("STARTING")), "and before every other launch too");
  assert.deepEqual(process.launches.map((l) => [l.file, l.args]).sort(), [["dotnet", ["run", "--launch-profile", "http"]], ["npm", ["run", "dev"]]]);
  const web = process.launches.find((l) => l.file === "npm");
  assert.equal(web.opts.cwd, resolve("/work/shop", "web"));
  assert.deepEqual(Object.keys(web.opts.env).sort(), ["PATH"], "a child gets the base environment and nothing else");
});

const CONTAINER_TOOLS = { ...TOOLS, docker: "27.3.1", "docker-daemon": "27.3.1", devcontainer: "0.71.0" };

// A hybrid machine: a VALIDATED dev container whose labelled container runs, and a host that has the runtimes too.
function hybrid(placement, opts = {}) {
  const rt = ready(NODE_AND_DOTNET, { tools: CONTAINER_TOOLS, process: fakeProcess({ docker: { ok: true, out: "abc123\n" } }), ...opts });
  rt.ctx.instances.write({ ...created({ checkout: CHECKOUT, name: "devcontainer", provider: "devcontainer" }, NOW), state: "VALIDATED" });
  rt.ctx.writeSettings({ next: { components: placement }, revision: null, by: "person" });
  return rt;
}

test("a HYBRID start: each component through the provider it was placed in -- the container's through `devcontainer exec`, the host's through its own launch, a receipt each", async () => {
  const { ctx, process, planned: world } = hybrid({ "node:web": { provider: "devcontainer" }, "dotnet:api": { provider: "native" } });
  const plan = world().plan;
  assert.deepEqual(plan.components.filter((c) => c.state === "ready").map((c) => [c.key, c.provider]).sort(), [["dotnet:api", "native"], ["node:web", "devcontainer"]]);
  assert.equal(plan.overall, "READY");
  const out = await start(ctx, world(), {});
  assert.deepEqual(out.started.map((s) => [s.component, s.provider]).sort(), [["dotnet:api", "native"], ["node:web", "devcontainer"]]);
  const byFile = Object.fromEntries(process.launches.map((l) => [l.file, l.args]));
  assert.deepEqual(Object.keys(byFile).sort(), ["devcontainer", "dotnet"]);
  assert.equal(byFile.devcontainer[0], "exec");
  assert.deepEqual(byFile.devcontainer.slice(-3), ["npm", "run", "dev"], "the container's component is its own declared command, inside");
  assert.deepEqual(byFile.dotnet, ["run", "--launch-profile", "http"]);
  assert.deepEqual(ctx.sessions.list().map((s) => [s.component, s.provider, s.state]).sort(), [["dotnet:api", "native", "RUNNING"], ["node:web", "devcontainer", "RUNNING"]]);
});

test("a receipt whose provider this engine does not have is refused, with a sentence -- it does not crash the stop of everything else", async () => {
  const { ctx, process, planned: world } = ready();
  await start(ctx, world(), { component: "node:web" });
  const [good] = ctx.sessions.list();
  const other = process.launch("zzz", []);
  ctx.sessions.write({ ...good, id: "rs-aaaaaaaaaaaa", component: "node:other", provider: "teleporter", pid: other.pid, pidStartedAt: other.startedAt, requestedAt: "2026-10-03T10:00:00.000Z" });
  const out = await stop(ctx, {});
  assert.deepEqual(out.stopped.map((s) => s.component), ["node:web"], "the one that is Orbit's was stopped all the same");
  assert.equal(out.refused[0].component, "node:other");
  assert.match(out.refused[0].why, /its provider \(teleporter\) is not one this engine has/);
  assert.equal(process.alive(other.pid), true, "and the process it named was left alone");
});

test("two starts at once launch each component ONCE: looking for what is running and launching are one step, taken in turn", async () => {
  const { ctx, process, planned: world } = ready();
  const [a, b] = await Promise.all([start(ctx, world(), {}), start(ctx, world(), {})]);
  assert.equal(process.launches.length, 2, "one launch per component, not two");
  assert.deepEqual([a.started.length + b.started.length, a.skipped.length + b.skipped.length], [2, 2], "the second start found them running");
  assert.equal(ctx.sessions.list().filter((s) => s.state === "RUNNING").length, 2);
});

test("the lock is held for the launch and not for the wait: a server that is slow to answer does not keep another start waiting", async () => {
  const { ctx, process, probe, clockState, planned: world } = ready();
  ctx.writeSettings({ next: { strategy: "auto", components: { "node:web": { readiness: { kind: "tcp", target: 5173 } } } }, revision: null, by: "person" });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  ctx.sleep = async (ms) => { clockState.ms += ms; await gate; };
  const first = start(ctx, world(), { component: "node:web", wait: 30 });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await start(ctx, world(), { component: "node:web" });
  assert.deepEqual([second.skipped.length, second.started.length], [1, 0], "the second start was not held up by the first one's wait, and found the component running");
  probe.listen(5173);
  release();
  const done = await first;
  assert.equal(done.started[0].readiness.state, "READY");
  assert.equal(process.launches.length, 1, "and nothing was launched twice");
});

// What a real application showed: it built, started, and died 16 s later on a missing credential --
// and the start waited out its whole budget, then said "started … NOT_READY" with a hint about
// loopback binding. A process that is gone ends the wait at once, and the start says it EXITED, how
// long it ran, and where what it printed is.
test("a process that exits while it is waited for ends the wait at once: EXITED, how long it ran, where its output is -- never a NOT_READY waited out", async () => {
  const { ctx, process, clockState, planned: world } = ready();
  ctx.writeSettings({ next: { strategy: "auto", components: { "node:web": { readiness: { kind: "tcp", target: 5173 } } } }, revision: null, by: "person" });
  const began = clockState.ms;
  ctx.sleep = async (ms) => { clockState.ms += ms; process.die(5000); };
  const done = await start(ctx, world(), { component: "node:web", wait: 600 });
  const [s] = done.started;
  assert.deepEqual([s.readiness.state, s.readiness.exited], ["NOT_RUNNING", true]);
  assert.match(s.readiness.because, /^it exited about \d+ s after it started, before it answered — what it printed is in \S+err\S* and \S+out\S*$/);
  assert.ok(clockState.ms - began < 60000, "the wait ended when the process did, not at 600 s");
  assert.match(sayStart(done), /^START 0 started · 1 exited/);
  assert.match(sayStart(done), /EXITED\s+node:web/);
  assert.doesNotMatch(sayStart(done), /loopback/);
  const said = sayStatus(await status(ctx));
  assert.match(said, /ended on their own[^\n]*:\n\s+rs-\S+\s+node:web\s+STOPPED\s+the process is no longer there/, "and status says it is gone, where before it said nothing");
  assert.match(said, /components:\n\s+component\s+kind\s+state\s+provider\s+how it starts, or why not/);
});

test("a start of ONE component speaks of that one: what else in the checkout is not ready is status's to tell", async () => {
  const { ctx, planned: world } = ready();
  const one = await start(ctx, world(), { component: "node:web" });
  assert.deepEqual(one.notReady.map((n) => n.component).filter((k) => k !== "node:web"), []);
});

test("a started session is a receipt with the pid AND the OS's start time -- ownership can be proven from it later", async () => {
  const { ctx, planned: world } = ready();
  await start(ctx, world(), { component: "node:web" });
  const [session] = ctx.sessions.list();
  assert.deepEqual([session.state, session.component, session.provider, session.pid, session.ports], ["RUNNING", "node:web", "native", 5000, []]);
  assert.equal(session.pidStartedAt, "2026-10-03T10:00:00.000Z");
  assert.equal(ctx.io.dirs.has(join("/store/repo-aaaa", "runtime", "laptop-a", "checkouts", "c".repeat(64), "logs")), true, "the log directory exists before a launch needs to open a file in it");
  assert.deepEqual(session.command, { declaredAs: "dev", argv: ["npm", "run", "dev"], cwd: "web" });
  assert.match(session.commandFingerprint, /^[a-f0-9]{16}$/);
});

test("starting twice starts once: what Orbit can prove it started is not started again", async () => {
  const { ctx, process, planned: world } = ready();
  await start(ctx, world(), { component: "node:web" });
  const again = await start(ctx, world(), { component: "node:web" });
  assert.deepEqual([again.started.length, again.skipped.map((s) => s.component), process.launches.length], [0, ["node:web"], 1]);
});

test("a start that never settled is named and refuses another start until a person releases it", async () => {
  const { ctx, planned: world } = ready();
  ctx.sessions.write({ id: "rs-aaaaaaaaaaaa", env: "e", component: "node:web", provider: "native", state: "STARTING", pid: null, requestedAt: "2026-10-03T09:00:00.000Z" });
  await assert.rejects(() => start(ctx, world(), { component: "node:web" }), (e) => e instanceof Refused && /never settled \(rs-aaaaaaaaaaaa\).*--release=rs-aaaaaaaaaaaa --human/.test(e.message));
});

test("a component the person named that is not ready is BLOCKED with what is in the way -- never skipped quietly", async () => {
  const { ctx, planned: world } = ready(NODE_AND_DOTNET, { tools: { ...TOOLS, node: false } });
  await assert.rejects(() => start(ctx, world(), { component: "node:web" }), (e) => e instanceof Blocked && /node:web cannot be started.*install Node\.js/.test(e.message));
  await assert.rejects(() => start(ctx, world(), { component: "nope:x" }), (e) => e instanceof Refused && /no component "nope:x" is known here/.test(e.message));
});

test("a partial runtime starts what it can and reports what it cannot -- and ALL blocked is a BLOCKED", async () => {
  const half = ready(NODE_AND_DOTNET, { tools: { ...TOOLS, node: false } });
  const out = await start(half.ctx, half.planned(), {});
  assert.deepEqual([out.started.map((s) => s.component), out.notReady.map((n) => n.component)], [["dotnet:api"], ["node:web"]]);
  const none = ready(NODE_AND_DOTNET, { tools: { ...TOOLS, node: false, dotnet: false } });
  await assert.rejects(() => start(none.ctx, none.planned(), {}), Blocked);
  assert.equal(none.process.launches.length, 0);
});

test("Scenario K: a port another project holds is BLOCKED, with whose it is -- and nothing is launched or killed", async () => {
  const { ctx, process, probe, io, planned: world } = ready();
  const other = process.launch("x", []);
  createSessions(liveRoom("/store/repo-bbbb", "laptop-a", "b".repeat(64)), io).write({ id: "rs-bbbbbbbbbbbb", env: "e", component: "node:api", provider: "native", state: "RUNNING", pid: other.pid, startedAt: other.startedAt, pidStartedAt: other.startedAt, requestedAt: other.startedAt, ports: [5000] });
  io.write(join(stateRooms("/store").checkouts, `${"b".repeat(64)}.json`), JSON.stringify({ key: "repo-bbbb", root: "/work/payments" }));
  probe.listen(5000);
  const launches = process.launches.length;
  const out = await start(ctx, world(), {});
  const api = out.blocked.find((b) => b.component === "dotnet:api");
  assert.match(api.blocking[0], /port 5000 is in use by node:api of payments — it is not stopped and not moved/);
  assert.deepEqual([out.started.map((s) => s.component), process.launches.length - launches, process.signals], [["node:web"], 1, []]);
});

test("Scenario L: an external service on a port is EXTERNAL -- observed, never owned, and never stopped", async () => {
  const { ctx, process, probe, planned: world } = ready();
  probe.listen(5000);
  const out = await start(ctx, world(), { component: "node:web" });
  assert.equal(out.started.length, 1, "the client has no port of its own");
  await assert.rejects(() => start(ctx, world(), { component: "dotnet:api" }), (e) => e instanceof Blocked && /by something that is not Orbit's \(external or unknown\)/.test(e.message));
  const stopped = await stop(ctx, { component: "dotnet:api" });
  assert.deepEqual([stopped.stopped, stopped.refused, process.signals.length], [[], [], 0], "there is no receipt, so there is nothing of Orbit's to stop");
});

// reuseExternal on, with -- or without -- what a person expects the component to answer when it is up.
const REUSE = (readiness) => ({ strategy: "auto", reuseExternal: true, components: readiness ? { "dotnet:api": { readiness } } : {} });
const HEALTH = { kind: "http", target: "http://localhost:5000/health", expect: 200 };

test("reuseExternal on, and the readiness a person expects answers: REUSED as EXTERNAL -- no launch, no receipt, and nothing for stop to stop", async () => {
  const { ctx, process, probe, planned: world } = ready();
  ctx.writeSettings({ next: REUSE(HEALTH), revision: null, by: "person" });
  probe.listen(5000);
  probe.answer(HEALTH.target, 200);
  const out = await start(ctx, world(), { component: "dotnet:api" });
  assert.deepEqual(out.reused.map((r) => [r.component, r.state, r.provider, r.ownership, r.session, r.pid, r.readiness.state, r.readiness.probe.source]), [["dotnet:api", "reused", "native", "EXTERNAL", null, null, "READY", "human"]]);
  assert.deepEqual([out.started, process.launches.length, ctx.sessions.list()], [[], 0, []], "nothing was launched, and no receipt pretends to own it");
  assert.match(sayStart(out), /START 0 started · 1 reused/);
  assert.match(sayStart(out), /reused\s+dotnet:api\s+EXTERNAL \(native, http http:\/\/localhost:5000\/health answers\)\s+not started by Orbit and never stopped by it/);
  const stopped = await stop(ctx, {});
  assert.deepEqual([stopped.stopped, stopped.refused, process.signals], [[], [], []], "stop has nothing of Orbit's to stop");
  assert.equal((await probe.tcp(5000)).ok, true, "and the external server is still there");
});

test("reuseExternal on, but nothing a person set says what the component answers: BLOCKED with how to set it -- a held port proves only that something listens", async () => {
  const { ctx, process, probe, planned: world } = ready();
  ctx.writeSettings({ next: REUSE(null), revision: null, by: "person" });
  probe.listen(5000);
  await assert.rejects(() => start(ctx, world(), { component: "dotnet:api" }), (e) => e instanceof Blocked && /reuseExternal is set, but nothing a person set says how to tell dotnet:api is ready there/.test(e.message) && /--probe=http\|tcp/.test(e.message));
  assert.equal(process.launches.length, 0);
});

test("reuseExternal on, and the expected readiness does not answer: BLOCKED, and the holder is left alone", async () => {
  const { ctx, process, probe, planned: world } = ready();
  ctx.writeSettings({ next: REUSE(HEALTH), revision: null, by: "person" });
  probe.listen(5000);
  await assert.rejects(() => start(ctx, world(), { component: "dotnet:api" }), (e) => e instanceof Blocked && /the readiness expected of it \(http http:\/\/localhost:5000\/health\) did not answer: .*could not be reached/.test(e.message));
  assert.deepEqual([process.launches.length, process.signals.length], [0, 0]);
});

test("status shows a server it would reuse as EXTERNAL -- only when reuse is allowed, never one of Orbit's own -- and the last reach answers as they were kept, asking the network nothing", async () => {
  const { ctx, probe, reach } = ready();
  ctx.writeSettings({ next: { ...REUSE(HEALTH), connectivity: { retry: { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }, targets: { "corporate-sql": GATE } } }, revision: null, by: "person" });
  probe.listen(5000);
  probe.answer(HEALTH.target, 200);
  doctor(ctx);
  const seen = await status(ctx);
  assert.deepEqual(seen.external.map((e) => [e.component, e.provider, e.ownership, e.readiness.state]), [["dotnet:api", "native", "EXTERNAL", "READY"]]);
  assert.deepEqual(Object.values(seen.connectivity.targets[0].observations).map((o) => [o.provider, o.state]), [["native", "NOT_CHECKED"], ["devcontainer", "NOT_CHECKED"]]);
  assert.equal(reach.calls.length, 0, "a status never asks the network");
  assert.match(sayStatus(seen), /answering, and not Orbit's \(reused, never stopped\):\n\s+dotnet:api\s+EXTERNAL\s+native\s+READY \(http http:\/\/localhost:5000\/health\)/);
  assert.match(sayStatus(seen), /reach targets, as last observed[\s\S]*corporate-sql\s+native\s+NOT_CHECKED\s+not checked yet/);
  ctx.writeSettings({ next: { ...ctx.readSettings().settings, reuseExternal: false }, revision: ctx.readSettings().revision, by: "person" });
  assert.deepEqual((await status(ctx)).external, [], "reuse not allowed: nothing is called reusable");
});

test("reuseExternal never reuses what Orbit owns: its own running session is still already-running, and another project's port is still BLOCKED by name", async () => {
  const own = ready();
  own.ctx.writeSettings({ next: REUSE(HEALTH), revision: null, by: "person" });
  await start(own.ctx, own.planned(), { component: "dotnet:api" });
  own.probe.listen(5000);
  own.probe.answer(HEALTH.target, 200);
  const again = await start(own.ctx, own.planned(), { component: "dotnet:api" });
  assert.deepEqual([again.skipped.map((s) => s.component), again.reused, own.process.launches.length], [["dotnet:api"], [], 1], "its own session, not an external one");
  const { ctx, process, probe, io, planned: world } = ready();
  ctx.writeSettings({ next: REUSE(HEALTH), revision: null, by: "person" });
  const other = process.launch("x", []);
  createSessions(liveRoom("/store/repo-bbbb", "laptop-a", "b".repeat(64)), io).write({ id: "rs-bbbbbbbbbbbb", env: "e", component: "node:api", provider: "native", state: "RUNNING", pid: other.pid, startedAt: other.startedAt, pidStartedAt: other.startedAt, requestedAt: other.startedAt, ports: [5000] });
  io.write(join(stateRooms("/store").checkouts, `${"b".repeat(64)}.json`), JSON.stringify({ key: "repo-bbbb", root: "/work/payments" }));
  probe.listen(5000);
  probe.answer(HEALTH.target, 200);
  await assert.rejects(() => start(ctx, world(), { component: "dotnet:api" }), (e) => e instanceof Blocked && /port 5000 is in use by node:api of payments — it is not stopped and not moved/.test(e.message));
});

// ---- the before-start gate: a server the component needs, asked from where it will run ---------

const GATE = { label: "Corporate SQL", host: "sql.internal.example", port: 1433, requiredBy: ["dotnet:api"], checkFrom: ["native", "devcontainer"], beforeStart: true };
const gated = (rt, target = GATE, retry = { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }) => rt.ctx.writeSettings({ next: { connectivity: { retry, targets: { "corporate-sql": target } } }, revision: null, by: "person" });

test("a before-start target that is not reachable BLOCKS the component, the target named: no receipt, no launch -- and what was observed is kept", async () => {
  const { ctx, process, reach, planned: world } = ready();
  gated({ ctx });
  reach.answer("sql.internal.example", 1433, "timeout");
  await assert.rejects(() => start(ctx, world(), { component: "dotnet:api" }), (e) => e instanceof Blocked && /Corporate SQL \(sql\.internal\.example:1433\) is not reachable from native: sql\.internal\.example resolves here, but nothing answered on sql\.internal\.example:1433 within 3s/.test(e.message));
  assert.deepEqual([process.launches.length, ctx.sessions.list()], [0, []], "not started is not a launch that failed: there is nothing to read back");
  assert.deepEqual(ctx.observations.list().map((o) => [o.target, o.provider, o.state, o.attemptsUsed, o.configuredAttempts]), [["corporate-sql", "native", "UNREACHABLE", 3, 3]]);
  assert.equal(reach.calls.filter((c) => c.kind === "tcp").length, 3, "the saved policy, and not one attempt more");
});

test("a before-start target that answers on a retry lets the start through: receipt, launch, readiness as always", async () => {
  const { ctx, process, reach, planned: world } = ready();
  gated({ ctx });
  reach.answer("sql.internal.example", 1433, ["timeout", true]);
  const out = await start(ctx, world(), { component: "dotnet:api" });
  assert.deepEqual([out.started.map((s) => s.component), process.launches.length, ctx.sessions.list().map((s) => s.state)], [["dotnet:api"], 1, ["RUNNING"]]);
  assert.deepEqual(ctx.observations.list().map((o) => [o.state, o.attemptsUsed]), [["REACHABLE", 2]]);
});

test("the gate asks only from where each component will run, once per target and location, and never for a component Orbit already runs", async () => {
  const { ctx, process, reach, planned: world } = ready();
  gated({ ctx }, { ...GATE, requiredBy: ["dotnet:api", "node:web"] });
  reach.answer("sql.internal.example", 1433, true);
  const out = await start(ctx, world(), {});
  assert.deepEqual(out.started.map((s) => s.component).sort(), ["dotnet:api", "node:web"]);
  assert.equal(reach.calls.filter((c) => c.kind === "tcp").length, 1, "two components need it, from one place: asked once");
  assert.equal(process.calls.some((c) => c.file === "devcontainer"), false, "they run natively, so the container is not asked");
  const again = await start(ctx, world(), {});
  assert.deepEqual([again.skipped.length, reach.calls.filter((c) => c.kind === "tcp").length], [2, 1], "already running: nothing asked, nothing started");
});

test("a whole start with one gated component blocks that one and starts the rest -- a partial runtime, said", async () => {
  const { ctx, process, reach, planned: world } = ready();
  gated({ ctx });
  reach.answer("sql.internal.example", 1433, false);
  const out = await start(ctx, world(), {});
  assert.deepEqual([out.started.map((s) => s.component), out.blocked.map((b) => b.component)], [["node:web"], ["dotnet:api"]]);
  assert.match(out.blocked[0].blocking[0], /is not reachable from native: sql\.internal\.example resolves here, but sql\.internal\.example:1433 could not be reached \(ECONNREFUSED\)/);
  assert.equal(process.launches.length, 1);
  assert.match(sayStart(out), /BLOCKED\s+dotnet:api\s+Corporate SQL \(sql\.internal\.example:1433\) is not reachable from native/);
});

test("a component placed in the dev container is gated from INSIDE it -- the host reaching the server does not count -- and a container that is not up could not be checked", async () => {
  const rt = hybrid({ "dotnet:api": { provider: "devcontainer" } });
  rt.ctx.writeSettings({ next: { ...rt.ctx.readSettings().settings, connectivity: { retry: { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }, targets: { "corporate-sql": GATE } } }, revision: rt.ctx.readSettings().revision, by: "person" });
  rt.reach.answer("sql.internal.example", 1433, true);
  rt.process.run = (file, args, opts) => (rt.process.calls.push({ file, args, opts }), file === "docker" ? { ok: true, out: "abc123\n" } : { ok: true, out: "FAILED NOT_ATTEMPTED\n" });
  await assert.rejects(() => start(rt.ctx, rt.planned(), { component: "dotnet:api" }), (e) => e instanceof Blocked && /Corporate SQL \(sql\.internal\.example:1433\) is not reachable from devcontainer: sql\.internal\.example does not resolve inside the container/.test(e.message));
  assert.deepEqual([rt.reach.calls.length, rt.process.launches.length], [0, 0], "the host was not asked on the container's behalf, and nothing was launched");
  rt.process.run = (file, args, opts) => (rt.process.calls.push({ file, args, opts }), { ok: true, out: "" });
  await assert.rejects(() => start(rt.ctx, rt.planned(), { component: "dotnet:api" }), /the environment is not up/);
});

test("a check that saw the host fail and the container answer moves an AUTO component into the container -- and once that answer is stale, it moves nothing", async () => {
  const rt = hybrid({}, { process: fakeProcess({ docker: { ok: true, out: "abc123\n" }, devcontainer: { ok: true, out: "RESOLVED REACHABLE\n" } }) });
  rt.ctx.writeSettings({ next: { ...rt.ctx.readSettings().settings, connectivity: { retry: { attempts: 1, intervalMs: 1000, timeoutMs: 3000 }, targets: { "corporate-sql": GATE } } }, revision: rt.ctx.readSettings().revision, by: "person" });
  rt.reach.answer("sql.internal.example", 1433, false);
  await checkTarget(rt.ctx, "corporate-sql", {});
  const after = (key) => rt.planned().plan.components.find((c) => c.key === key);
  assert.deepEqual([after("dotnet:api").provider, after("node:web").provider], ["devcontainer", "native"]);
  rt.clockState.ms += CONNECTIVITY_FRESH_MS + 1;
  assert.equal(after("dotnet:api").provider, "native", "a stale answer is not a reason to move anything");
});

test("stop ends the process GROUP of a session Orbit proved is its own: TERM, and KILL only when it will not go", async () => {
  const { ctx, process, planned: world } = ready();
  await start(ctx, world(), { component: "node:web" });
  const out = await stop(ctx, { component: "node:web" });
  assert.deepEqual([out.stopped.map((s) => [s.component, s.how]), process.signals], [[["node:web", "SIGTERM"]], [{ pid: 5000, sig: "SIGTERM", tree: true }]]);
  assert.equal(ctx.sessions.list()[0].state, "STOPPED");
  const stubborn = ready();
  await start(stubborn.ctx, stubborn.planned(), { component: "node:web" });
  stubborn.process.stubborn(5000);
  const hard = await stop(stubborn.ctx, { component: "node:web" });
  assert.deepEqual([hard.stopped[0].how, stubborn.process.signals.map((s) => s.sig)], ["SIGKILL", ["SIGTERM", "SIGKILL"]]);
});

test("a pid the OS reused is NEVER stopped: the receipt is closed as LOST and nothing is signalled", async () => {
  const { ctx, process, planned: world } = ready();
  await start(ctx, world(), { component: "node:web" });
  process.reuse(5000, "2020-01-01T00:00:00.000Z");
  const out = await stop(ctx, {});
  assert.deepEqual([out.stopped, out.gone.map((g) => g.outcome), process.signals], [[], ["lost"], []]);
  assert.equal(ctx.sessions.list()[0].state, "LOST");
});

test("a process that already exited is closed, not signalled; one the OS will not date is refused", async () => {
  const gone = ready();
  await start(gone.ctx, gone.planned(), { component: "node:web" });
  gone.process.die(5000);
  assert.deepEqual([(await stop(gone.ctx, {})).gone.map((g) => g.outcome), gone.process.signals], [["gone"], []]);
  const undated = ready();
  await start(undated.ctx, undated.planned(), { component: "node:web" });
  undated.ctx.sessions.write({ ...undated.ctx.sessions.list()[0], pidStartedAt: null });
  const refused = await stop(undated.ctx, {});
  assert.deepEqual([refused.refused.length, undated.process.signals], [1, []]);
  assert.match(refused.refused[0].why, /would not say when that process started/);
});

test("releasing a session is a person's, closes the receipt, and kills nothing -- and a running Orbit-owned one is stopped, not released", async () => {
  const { ctx, process, planned: world } = ready();
  ctx.sessions.write({ id: "rs-aaaaaaaaaaaa", env: "e", component: "node:old", provider: "native", state: "AMBIGUOUS", pid: null, requestedAt: "2026-10-03T09:00:00.000Z" });
  await assert.rejects(() => stop(ctx, { release: "rs-aaaaaaaaaaaa" }), /releasing a session is a person's — relay it with --human/);
  const refusedStop = await stop(ctx, {});
  assert.match(refusedStop.refused[0].why, /a person releases it with --release=rs-aaaaaaaaaaaa --human/);
  assert.equal((await stop(ctx, { release: "rs-aaaaaaaaaaaa", human: true })).released.length, 1);
  assert.equal(ctx.sessions.read("rs-aaaaaaaaaaaa").state, "LOST");
  await start(ctx, world(), { component: "node:web" });
  const live = ctx.sessions.list().find((s) => s.component === "node:web");
  assert.match((await stop(ctx, { release: live.id, human: true })).refused[0].why, /it is running and Orbit's own: stop it/);
  assert.deepEqual(process.signals, []);
});

test("Control restarting loses nothing: a fresh context over the same store sees the session and can stop it", async () => {
  const { ctx, process, planned: world } = ready();
  await start(ctx, world(), { component: "node:web" });
  const again = fakeRuntime(NODE_AND_DOTNET, { tools: TOOLS, process });
  again.ctx.io.files.clear();
  for (const [k, v] of ctx.io.files) again.ctx.io.files.set(k, v);
  assert.equal((await stop(again.ctx, {})).stopped.length, 1);
});

test("status shows what is running, whose it is, and whether it ANSWERS -- three different things", async () => {
  const { ctx, probe, process, planned: world } = ready();
  await start(ctx, world(), {});
  probe.listen(5000);
  const out = await status(ctx);
  const api = out.sessions.find((s) => s.component === "dotnet:api");
  assert.deepEqual([api.state, api.ownership, api.readiness.state, api.readiness.probe.source], ["RUNNING", "ORBIT_OWNED", "READY", "discovered"]);
  const web = out.sessions.find((s) => s.component === "node:web");
  assert.equal(web.readiness.state, "READINESS_UNKNOWN", "alive, and nothing says how to tell it is ready");
  probe.close(5000);
  assert.equal((await status(ctx)).sessions.find((s) => s.component === "dotnet:api").readiness.state, "NOT_READY");
  assert.equal(process.signals.length, 0, "looking never touches what is running");
});

test("a person's readiness setting makes the probe human -- and is what status reports", async () => {
  const { ctx, probe, planned: world } = ready();
  ctx.writeSettings({ next: { strategy: "auto", components: { "node:web": { readiness: { kind: "http", target: "http://localhost:5173/health", expect: 200 } } } }, revision: null, by: "person" });
  await start(ctx, world(), { component: "node:web" });
  probe.answer("http://localhost:5173/health", 200);
  const web = (await status(ctx)).sessions.find((s) => s.component === "node:web");
  assert.deepEqual([web.readiness.state, web.readiness.probe.source], ["READY", "human"]);
});

test("status writes nothing, runs nothing, and is the same twice", async () => {
  const { ctx, io, process } = ready();
  const files = new Map(io.files);
  const first = await status(ctx);
  assert.deepEqual([...io.files], [...files], "not a byte was written");
  assert.deepEqual(process.calls, []);
  assert.deepEqual(await status(ctx), first);
});

test("Scenario J: two checkouts of one repository keep their own sessions, and one's stop never touches the other's", async () => {
  const a = ready();
  await start(a.ctx, a.planned(), { component: "node:web" });
  const b = fakeRuntime(NODE_AND_DOTNET, { tools: TOOLS, process: a.process });
  Object.assign(b.ctx, { checkout: "d".repeat(64) });
  b.ctx.sessions = createSessions(liveRoom("/store/repo-aaaa", "laptop-a", "d".repeat(64)), a.io);
  assert.equal(b.ctx.sessions.list().length, 0);
  assert.equal((await stop(b.ctx, {})).stopped.length, 0);
  assert.equal(a.process.signals.length, 0);
  assert.equal(a.ctx.sessions.list().length, 1);
  assert.equal(liveRoom("/s", "h", CHECKOUT).endsWith(CHECKOUT), true);
});

test("prepare is a PLAN until it is told otherwise: what a host lacks, what would be built, and that the repository is untouched", () => {
  const { ctx, process } = ready(NODE_AND_DOTNET, { tools: { ...TOOLS, docker: false } });
  const plan = prepare(ctx, {});
  assert.equal(plan.apply, false);
  const container = plan.plans.find((p) => p.provider === "devcontainer");
  assert.deepEqual([container.repository, container.environment.map((e) => e.step)], ["no changes", ["build"]]);
  assert.deepEqual(process.calls, [], "nothing was run");
  const applied = prepare(ctx, { apply: true });
  assert.match(applied.applied[0].because, /no environment to prepare: design and adopt one first/);
});

test("a command that cannot be started is a session that says so -- LOST with a sentence, and nothing is called running", async () => {
  const { ctx, process, planned: world } = ready();
  process.launch = () => ({ pid: null, startedAt: "x" });
  const out = await start(ctx, world(), { component: "node:web" }).catch((e) => e);
  assert.ok(out instanceof Blocked);
  assert.match(out.message, /npm could not be started: it is not on PATH, or it is a Windows command shim whose script could not be found/);
  assert.deepEqual(ctx.sessions.list().map((s) => s.state), ["LOST"]);
});

test("a launch that throws is a start that did not happen, and the receipt says why", async () => {
  const { ctx, process, planned: world } = ready();
  process.launch = () => { throw new Error("EACCES: permission denied"); };
  const out = await start(ctx, world(), { component: "node:web" }).catch((e) => e);
  assert.match(out.message, /EACCES: permission denied/);
  assert.equal(ctx.sessions.list()[0].why, "EACCES: permission denied");
});
