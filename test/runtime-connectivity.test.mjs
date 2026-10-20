// Connectivity, per location: a server a checkout needs and does not run, asked about from where a
// component runs -- this machine and the dev container, each on its own -- with a bounded retry, kept
// as the last observation and never presented as current once it is old.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Refused } from "../src/errors.mjs";
import { COMMANDS } from "../src/runtime/index.mjs";
import { TARGET_UNKNOWN } from "../src/runtime/connectivity/check.mjs";
import { CONNECTIVITY_FRESH_MS, aged, createObservations, current, observationOf, reachOf } from "../src/runtime/connectivity/observations.mjs";
import { retried } from "../src/runtime/connectivity/retry.mjs";
import { stateOf } from "../src/runtime/connectivity/states.mjs";
import { targetPrint, targetsOf } from "../src/runtime/connectivity/targets.mjs";
import { created } from "../src/runtime/instances.mjs";
import { connectivityRoom, liveRoom } from "../src/runtime/rooms.mjs";
import { NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { CHECKOUT, NOW, fakeRuntime } from "./fakes/runtime-ctx.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeReach } from "./fakes/reach.mjs";
import { native } from "../src/runtime/providers/native.mjs";

const SQL = { label: "Corporate SQL", host: "sql.internal.example", port: 1433, requiredBy: ["dotnet:api"], checkFrom: ["native", "devcontainer"], beforeStart: true };
const SETTINGS = (targets, retry) => ({ connectivity: { retry: { attempts: 3, intervalMs: 1000, timeoutMs: 3000, ...retry }, targets } });
const run = async (rt, name, ...args) => COMMANDS[name].run(rt.ctx, args);

// A checkout with a VALIDATED dev container whose labelled container answers `docker ps`, and the
// target `corporate-sql` configured by a person.
function configured(targets = { "corporate-sql": SQL }, opts = {}) {
  const rt = fakeRuntime(NODE_AND_DOTNET, { process: fakeProcess({ docker: opts.docker ?? { ok: true, out: "abc123\n" }, devcontainer: opts.devcontainer }), ...opts });
  rt.ctx.instances.write({ ...created({ checkout: CHECKOUT, name: "devcontainer", provider: "devcontainer" }, NOW), state: "VALIDATED" });
  rt.ctx.writeSettings({ next: SETTINGS(targets, opts.retry), revision: null, by: "person" });
  return rt;
}

// ---- the words, and what a target is -----------------------------------------------------------

test("the state is folded from two facts, never a boolean: blocked, accepted, refused or unresolved, and everything else unknown", () => {
  assert.deepEqual([
    stateOf({ resolution: "UNKNOWN", transport: "NOT_ATTEMPTED", blocked: true }),
    stateOf({ resolution: "RESOLVED", transport: "REACHABLE" }),
    stateOf({ resolution: "RESOLVED", transport: "UNREACHABLE" }),
    stateOf({ resolution: "FAILED", transport: "NOT_ATTEMPTED" }),
    stateOf({ resolution: "UNKNOWN", transport: "NOT_ATTEMPTED" }),
  ], ["BLOCKED", "REACHABLE", "UNREACHABLE", "UNREACHABLE", "UNKNOWN"]);
});

test("a target's print is where it points: a new label or note keeps it, a moved host, port or protocol does not", () => {
  const was = targetPrint({ host: "sql.internal.example", port: 1433, protocol: "tcp" });
  assert.equal(targetPrint({ label: "Renamed", note: "x", host: "sql.internal.example", port: 1433, protocol: "tcp" }), was);
  assert.notEqual(targetPrint({ host: "sql.internal.example", port: 1434, protocol: "tcp" }), was);
  assert.notEqual(targetPrint({ host: "sql2.internal.example", port: 1433, protocol: "tcp" }), was);
  const [t] = targetsOf({ connectivity: { retry: { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }, targets: { db: { ...SQL, retry: { attempts: 5 } } } } });
  assert.deepEqual(t.retry, { attempts: 5, intervalMs: 1000, timeoutMs: 3000 }, "a target's own policy is laid over the block's");
});

// ---- the bounded retry -------------------------------------------------------------------------

function scripted(states) {
  const asked = [];
  const sleeps = [];
  const once = async (n) => (asked.push(n), { state: states[Math.min(n, states.length) - 1], resolution: "RESOLVED", transport: states[Math.min(n, states.length) - 1] === "REACHABLE" ? "REACHABLE" : "UNREACHABLE", because: `attempt ${n}` });
  return { once, asked, sleeps, deps: { sleep: async (ms) => void sleeps.push(ms), now: () => Date.parse(NOW) } };
}

test("timeout, timeout, reachable: REACHABLE on the third of three, after exactly two waits of the interval -- and nothing actually waited", async () => {
  const s = scripted(["UNREACHABLE", "UNREACHABLE", "REACHABLE"]);
  const done = await retried(s.once, { attempts: 3, intervalMs: 1000 }, s.deps);
  assert.deepEqual([done.state, done.attemptsUsed, done.configuredAttempts, s.sleeps, done.attempts.map((a) => [a.number, a.state])], ["REACHABLE", 3, 3, [1000, 1000], [[1, "UNREACHABLE"], [2, "UNREACHABLE"], [3, "REACHABLE"]]]);
  assert.equal(done.checkedAt, NOW);
});

test("every attempt fails: UNREACHABLE after three of three, and there is no fourth", async () => {
  const s = scripted(["UNREACHABLE"]);
  const done = await retried(s.once, { attempts: 3, intervalMs: 250 }, s.deps);
  assert.deepEqual([done.state, done.attemptsUsed, s.asked, s.sleeps], ["UNREACHABLE", 3, [1, 2, 3], [250, 250]]);
});

test("BLOCKED settles it at once: ten attempts allowed, one made, no wait -- a container that is not up is not asked ten times", async () => {
  const s = scripted(["BLOCKED"]);
  const done = await retried(s.once, { attempts: 10, intervalMs: 30000 }, s.deps);
  assert.deepEqual([done.state, done.attemptsUsed, done.configuredAttempts, s.sleeps], ["BLOCKED", 1, 10, []]);
});

test("REACHABLE the first time stops at once: one attempt, no wait", async () => {
  const s = scripted(["REACHABLE"]);
  assert.deepEqual([(await retried(s.once, { attempts: 5, intervalMs: 1000 }, s.deps)).attemptsUsed, s.sleeps], [1, []]);
});

// ---- what is kept, and how old it is ------------------------------------------------------------

test("an observation is kept under the connectivity room's own lock -- never the start's -- scrubbed and clipped, one per target and location", () => {
  const io = fakeIo();
  const live = liveRoom("/store/repo-aaaa", "laptop-a", CHECKOUT);
  const locks = [];
  const mkdir = io.mkdir;
  io.mkdir = (p, ...rest) => (locks.push(p), mkdir(p, ...rest));
  const kept = createObservations(live, io);
  const [t] = targetsOf(SETTINGS({ db: SQL }));
  const because = `password=hunter2 ${"x".repeat(400)}`;
  const observed = observationOf(t, "native", { state: "UNREACHABLE", resolution: "RESOLVED", transport: "UNREACHABLE", because, checkedAt: NOW, attemptsUsed: 1, configuredAttempts: 1, attempts: [{ number: 1, state: "UNREACHABLE", because }] });
  assert.deepEqual([observed.because.length <= 300, observed.because.includes("hunter2"), observed.attempts[0].because.includes("hunter2")], [true, false, false], "scrubbed and clipped before it is kept");
  kept.note(observed);
  kept.note({ ...observed, provider: "devcontainer", state: "BLOCKED", because: "not up" });
  assert.deepEqual(kept.list().map((o) => [o.target, o.provider, o.state]), [["db", "native", "UNREACHABLE"], ["db", "devcontainer", "BLOCKED"]]);
  assert.ok(locks.some((p) => p === join(connectivityRoom(live), ".lock")), "its own room's lock");
  assert.equal(locks.some((p) => p === join(live, ".lock")), false, "never the live room's, which a start holds");
  assert.equal(io.read(join(connectivityRoom(live), "probes.json")).includes("hunter2"), false);
});

test("what is read back is still ABOUT the target: a moved host or port is NOT_CHECKED with why, and a location no longer asked is not shown", () => {
  const [t] = targetsOf(SETTINGS({ db: { ...SQL, checkFrom: ["native"] } }));
  const seen = [{ target: "db", provider: "native", targetPrint: "an-older-print", state: "REACHABLE", checkedAt: NOW }, { target: "db", provider: "devcontainer", targetPrint: t.print, state: "REACHABLE", checkedAt: NOW }];
  const [row] = current(seen, [t], Date.parse(NOW));
  assert.deepEqual(row.locations.map((o) => [o.provider, o.state, o.because]), [["native", "NOT_CHECKED", "the target points somewhere else since it was last checked"]]);
});

test("an answer ages: current within the window, STALE after it, and one with no time is stale", () => {
  const at = Date.parse(NOW);
  assert.deepEqual(aged({ checkedAt: NOW }, at + 1000), { age: 1000, stale: false });
  assert.deepEqual(aged({ checkedAt: NOW }, at + CONNECTIVITY_FRESH_MS + 1), { age: CONNECTIVITY_FRESH_MS + 1, stale: true });
  assert.deepEqual(aged({ checkedAt: null }, at), { age: null, stale: true });
});

test("what the resolver is handed is only FRESH answers of before-start targets -- UNREACHABLE wins, and stale, unknown and unchecked are nothing", () => {
  const settings = SETTINGS({ db: SQL, cache: { ...SQL, label: "Cache", host: "cache.internal.example", port: 6379 }, docs: { ...SQL, label: "Docs", host: "docs.internal.example", port: 443, beforeStart: false } });
  const targets = targetsOf(settings);
  const print = (id) => targets.find((t) => t.id === id).print;
  const at = Date.parse(NOW);
  const seen = [
    { target: "db", provider: "native", targetPrint: print("db"), state: "REACHABLE", checkedAt: NOW },
    { target: "cache", provider: "native", targetPrint: print("cache"), state: "UNREACHABLE", checkedAt: NOW },
    { target: "db", provider: "devcontainer", targetPrint: print("db"), state: "UNKNOWN", checkedAt: NOW },
    { target: "cache", provider: "devcontainer", targetPrint: print("cache"), state: "UNREACHABLE", checkedAt: new Date(at - CONNECTIVITY_FRESH_MS - 1).toISOString() },
    { target: "docs", provider: "native", targetPrint: print("docs"), state: "UNREACHABLE", checkedAt: NOW },
  ];
  const reach = reachOf(seen, targets, at);
  assert.deepEqual(Object.keys(reach), ["dotnet:api"]);
  assert.deepEqual([reach["dotnet:api"].native.state, reach["dotnet:api"].native.target], ["UNREACHABLE", "cache"], "one unreachable gate is enough, whatever order they come in");
  assert.equal(reach["dotnet:api"].devcontainer, undefined, "unknown and stale say nothing");
});

// ---- the commands: connectivity reads, check and retry ask ---------------------------------------

test("connectivity reads what is kept and asks the network nothing: every location of every target, NOT_CHECKED until asked", async () => {
  const rt = configured();
  const read = await run(rt, "connectivity");
  assert.deepEqual(read.targets.map((t) => [t.id, t.host, t.port, Object.values(t.observations).map((o) => [o.provider, o.state])]), [["corporate-sql", "sql.internal.example", 1433, [["native", "NOT_CHECKED"], ["devcontainer", "NOT_CHECKED"]]]]);
  assert.deepEqual([rt.reach.calls.length, rt.process.calls.length], [0, 0], "reading opens no connection and runs nothing");
  assert.match(COMMANDS.connectivity.say(read), /corporate-sql\s+Corporate SQL \(sql\.internal\.example:1433\)\s+tcp\s+required by dotnet:api\s+· checked before start/);
  assert.match(COMMANDS.connectivity.say(read), /native\s+NOT_CHECKED\s+not checked yet/);
  assert.doesNotMatch(COMMANDS.connectivity.say(read), /not a login/, "the reminder stands beside a REACHABLE answer, and nothing here was reached");
  assert.match(COMMANDS.connectivity.say(await run(fakeRuntime({}), "connectivity")), /no connectivity target is set for this machine: runtime configure --reach=<id>/);
});

test("the VPN case: the host resolves and reaches the database while the container cannot even resolve its name -- two answers, kept apart, never copied across", async () => {
  const rt = configured(undefined, { devcontainer: { ok: true, out: "FAILED NOT_ATTEMPTED\n" } });
  rt.reach.answer("sql.internal.example", 1433, true);
  const done = await run(rt, "check", "corporate-sql");
  assert.deepEqual([done.mode, Object.keys(done.results)], ["check", ["native", "devcontainer"]]);
  assert.deepEqual([done.results.native.state, done.results.native.resolution, done.results.native.transport, done.results.native.attemptsUsed, done.results.native.configuredAttempts], ["REACHABLE", "RESOLVED", "REACHABLE", 1, 1]);
  assert.deepEqual([done.results.devcontainer.state, done.results.devcontainer.resolution, done.results.devcontainer.transport], ["UNREACHABLE", "FAILED", "NOT_ATTEMPTED"]);
  assert.match(done.results.devcontainer.because, /sql\.internal\.example does not resolve inside the container/);
  assert.deepEqual(rt.reach.calls.map((c) => [c.kind, c.host]), [["resolve", "sql.internal.example"], ["tcp", "sql.internal.example"]], "the host's answer came from the host's own network");
  const exec = rt.process.calls.find((c) => c.file === "devcontainer");
  assert.equal(exec.args[0], "exec", "the container's answer came from inside the container");
  const read = await run(rt, "connectivity");
  assert.deepEqual(Object.values(read.targets[0].observations).map((o) => [o.provider, o.state, o.freshness.stale]), [["native", "REACHABLE", false], ["devcontainer", "UNREACHABLE", false]]);
});

test("an ADDRESS needs no lookup: its DNS fact is NOT_ATTEMPTED from every place, while a name's lookup is kept -- the state is the connection's", async () => {
  const rt = configured({ "by-address": { ...SQL, host: "10.20.30.40" }, "by-name": SQL }, { devcontainer: { ok: true, out: "RESOLVED UNREACHABLE\n" } });
  rt.reach.answer("10.20.30.40", 1433, true);
  rt.reach.answer("sql.internal.example", 1433, true);
  const address = await run(rt, "check", "by-address");
  assert.deepEqual(["native", "devcontainer"].map((p) => [address.results[p].resolution, address.results[p].state]), [["NOT_ATTEMPTED", "REACHABLE"], ["NOT_ATTEMPTED", "UNREACHABLE"]]);
  const name = await run(rt, "check", "by-name", "--from=native");
  assert.equal(name.results.native.resolution, "RESOLVED");
});

test("the other way round, and both: a container that reaches what the host cannot is said so, and when both reach it neither needs anything", async () => {
  const both = configured(undefined, { devcontainer: { ok: true, out: "RESOLVED REACHABLE\n" } });
  both.reach.answer("sql.internal.example", 1433, true);
  assert.deepEqual(Object.values((await run(both, "check", "corporate-sql")).results).map((o) => o.state), ["REACHABLE", "REACHABLE"]);
  const inverse = configured(undefined, { devcontainer: { ok: true, out: "RESOLVED REACHABLE\n" } });
  inverse.reach.named("sql.internal.example", false);
  const done = await run(inverse, "check", "corporate-sql");
  assert.deepEqual([done.results.native.state, done.results.native.resolution, done.results.devcontainer.state], ["UNREACHABLE", "FAILED", "REACHABLE"]);
});

test("retry is the saved policy and stops at the first REACHABLE -- a check never retries", async () => {
  const rt = configured({ "corporate-sql": { ...SQL, checkFrom: ["native"] } }, { retry: { attempts: 3, intervalMs: 1000 } });
  rt.reach.answer("sql.internal.example", 1433, ["timeout", "timeout", true]);
  const once = await run(rt, "check", "corporate-sql");
  assert.deepEqual([once.results.native.state, once.results.native.attemptsUsed, once.results.native.configuredAttempts], ["UNREACHABLE", 1, 1]);
  const before = rt.clockState.ms;
  const again = await run(rt, "retry", "corporate-sql");
  assert.deepEqual([again.mode, again.results.native.state, again.results.native.attemptsUsed, again.results.native.configuredAttempts], ["retry", "REACHABLE", 2, 3], "the second answer of the retry was the third of the server's script");
  assert.equal(rt.clockState.ms - before, 1000, "one wait between two attempts, on the fake clock");
  assert.match(COMMANDS.retry.say(again), /RETRY corporate-sql · Corporate SQL \(sql\.internal\.example:1433\) · up to 3 attempt\(s\), 1000 ms apart[\s\S]*native\s+REACHABLE\s+attempt 2 of 3[\s\S]*1\s+UNREACHABLE\s+sql\.internal\.example resolves here, but nothing answered/);
});

test("a container that is not up is BLOCKED once, with how to bring it up -- no retry against nothing, and nothing exec'd", async () => {
  const rt = configured({ "corporate-sql": { ...SQL, checkFrom: ["devcontainer"] } }, { docker: { ok: true, out: "" }, retry: { attempts: 10, intervalMs: 30000 } });
  const done = await run(rt, "retry", "corporate-sql");
  assert.deepEqual([done.results.devcontainer.state, done.results.devcontainer.attemptsUsed, done.results.devcontainer.configuredAttempts], ["BLOCKED", 1, 10]);
  assert.match(done.results.devcontainer.because, /the environment is not up/);
  assert.equal(rt.process.calls.some((c) => c.file === "devcontainer"), false);
});

test("a check names a target by its id and nothing else: an unknown one is refused with its own code, a location it is not checked from is refused, and no name is a usage line", async () => {
  const rt = configured({ "corporate-sql": { ...SQL, checkFrom: ["native"] } });
  await assert.rejects(() => run(rt, "check", "ghost"), (e) => e instanceof Refused && e.code === TARGET_UNKNOWN && /no connectivity target "ghost" is set for this machine/.test(e.message));
  await assert.rejects(() => run(rt, "check", "corporate-sql", "--from=devcontainer"), /corporate-sql is checked from native — not from devcontainer/);
  await assert.rejects(() => run(rt, "check"), /name a target/);
  await assert.rejects(() => run(rt, "check", "10.0.0.1"), (e) => e.code === TARGET_UNKNOWN, "a host is not a target: it is looked up as an id and is not one");
  assert.equal(rt.reach.calls.length, 0);
});

test("nothing a check keeps or returns carries a value from this machine's environment", async () => {
  const rt = configured(undefined, { env: { PATH: "/usr/bin", DB_PASSWORD: "canary-7c1e0d2f", API_TOKEN: "canary-7c1e0d2f" }, devcontainer: { ok: true, out: "RESOLVED UNREACHABLE\n" } });
  rt.reach.answer("sql.internal.example", 1433, false);
  const done = await run(rt, "retry", "corporate-sql");
  const read = await run(rt, "connectivity");
  for (const text of [JSON.stringify(done), JSON.stringify(read), COMMANDS.retry.say(done), COMMANDS.connectivity.say(read), ...[...rt.io.files.values()]]) assert.equal(text.includes("canary-7c1e0d2f"), false);
  assert.equal(rt.process.calls.some((c) => JSON.stringify(c).includes("canary-7c1e0d2f")), false, "and nothing exec'd in the container is handed one");
});

test("from the host: a name that does not resolve is FAILED and no connection is tried, a resolver that never answers is UNKNOWN, a refusal is UNREACHABLE, an accept is REACHABLE", async () => {
  const reach = fakeReach({ dns: { "gone.example": false, "slow.example": "timeout" }, tcp: { "db.example:5432": true, "closed.example:5432": false } });
  const ask = (host) => native.reach({ host, port: 5432 }, {}, { reach, timeoutMs: 3000 });
  const out = Object.fromEntries(await Promise.all(["gone.example", "slow.example", "closed.example", "db.example"].map(async (h) => [h, await ask(h)])));
  assert.deepEqual(Object.values(out).map((o) => [o.resolution, o.transport, stateOf(o)]), [["FAILED", "NOT_ATTEMPTED", "UNREACHABLE"], ["UNKNOWN", "NOT_ATTEMPTED", "UNKNOWN"], ["RESOLVED", "UNREACHABLE", "UNREACHABLE"], ["RESOLVED", "REACHABLE", "REACHABLE"]]);
  assert.deepEqual(reach.calls.filter((c) => c.kind === "tcp").map((c) => c.host).sort(), ["closed.example", "db.example"], "a name that did not resolve was not connected to");
  assert.ok(reach.calls.every((c) => c.opts.timeoutMs === 3000), "every ask carries the attempt's deadline");
  assert.match((await native.reach({ host: "x", port: 1 }, {}, { timeoutMs: 3000 })).because, /nothing on this machine was bound to ask the network/);
});
