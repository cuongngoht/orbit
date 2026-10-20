// A person's runtime and a task's sandbox keep their sessions in ONE live room, because port
// ownership is read from it host-wide -- and that makes "whose is it" the one question every
// lookup has to ask. These tests hold the answer: a session belongs to its owner and to its
// environment, a receipt written before owners existed is a person's, and nothing a task does
// to its own sessions reaches a developer's or another task's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "../src/errors.mjs";
import { start, sessionsNow } from "../src/runtime/lifecycle/start.mjs";
import { stop } from "../src/runtime/lifecycle/stop.mjs";
import { planned } from "../src/runtime/lifecycle/world.mjs";
import { ensure, look } from "../src/runtime/understanding.mjs";
import { ENV_SCOPE, HUMAN, createSessions, inScope, ownerOf } from "../src/runtime/sessions.mjs";
import { runningEverywhere, ownerLookup } from "../src/runtime/ports.mjs";
import { liveRoom } from "../src/runtime/rooms.mjs";
import { created } from "../src/runtime/instances.mjs";
import { NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { CHECKOUT, HOST, NOW, STORE_ROOT, fakeRuntime } from "./fakes/runtime-ctx.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const TOOLS = { node: "22.1.0", npm: "10.8.1", dotnet: "8.0.100" };
const A = { kind: "task", id: "tsk-aaaaaaaaaaaa" };
const B = { kind: "task", id: "tsk-bbbbbbbbbbbb" };

// The same machine, store and live room, seen as a task's sandbox: its own environment and owner.
const asTask = (ctx, owner, env) => ({ ...ctx, owner, envId: env, envs: { native: env, devcontainer: env, sandbox: env } });

function ready(opts = {}) {
  const rt = fakeRuntime(NODE_AND_DOTNET, { tools: TOOLS, ...opts });
  ensure(rt.ctx);
  const world = (ctx = rt.ctx) => planned(ctx, look(ctx), ctx.readSettings().settings, { probe: true });
  return { ...rt, world };
}

const doc = (over) => ({ id: "rs-000000000001", env: "env-x", component: "node:web", provider: "native", state: "RUNNING", pid: 1, requestedAt: NOW, ...over });

test("a receipt written before owners existed is a person's, and a task's context never sees it", () => {
  const io = rt().io;
  const sessions = createSessions(liveRoom(STORE_ROOT, HOST, CHECKOUT), io);
  sessions.write(doc({ id: "rs-aaaaaaaaaaaa" }));
  assert.deepEqual(ownerOf(sessions.read("rs-aaaaaaaaaaaa")), HUMAN);
  assert.equal(sessions.list({ env: "env-x", owner: HUMAN }).length, 1);
  assert.equal(sessions.list({ env: "env-x", owner: A }).length, 0, "an environment id match alone is not enough: the owner is");
  assert.equal(sessions.list().length, 1, "no scope is every session -- what host-wide port ownership asks");
});

function rt() {
  return fakeRuntime({}, {});
}

test("the person's rule is the COMPLEMENT of task-owned: a session stamped with any environment is still the person's", () => {
  const stamped = { owner: { kind: "human" }, env: "env-of-a-container-that-is-gone" };
  assert.equal(inScope({ env: "env-native", owner: HUMAN })(doc(stamped)), true);
  assert.equal(inScope({ env: "env-native", owner: HUMAN })(doc({ owner: A })), false);
  assert.equal(inScope({ env: "env-s", owner: A })(doc({ owner: A, env: "env-s" })), true);
  assert.equal(inScope({ env: "env-s", owner: A })(doc({ owner: A, env: "env-other" })), false, "a task sees its own environment only");
  assert.ok(ENV_SCOPE.every((r) => typeof r.say === "string") && ENV_SCOPE.at(-1).when({}), "a sentence per row, and the last always matches");
});

test("a person's running server does not make a task's start 'already running'", async () => {
  const { ctx, process, world } = ready();
  await start(ctx, world(), { component: "node:web" });
  const task = asTask(ctx, A, "env-sandboxaaaa1");
  const out = await start(task, world(task), { component: "node:web" });
  assert.equal(out.skipped.length, 0, "the developer's web is not the task's");
  assert.equal(out.started.length, 1);
  assert.equal(process.launches.length, 2, "both were launched");
  assert.deepEqual(ctx.sessions.all().map((s) => [ownerOf(s).kind, s.env === task.envId]).sort(), [["human", false], ["task", true]]);
});

test("task A and task B keep separate sessions of one component, and a person sees neither", async () => {
  const { ctx, world } = ready();
  const a = asTask(ctx, A, "env-sandboxaaaa1");
  const b = asTask(ctx, B, "env-sandboxbbbb2");
  await start(a, world(a), { component: "node:web" });
  await start(b, world(b), { component: "node:web" });
  assert.deepEqual([sessionsNow(a).length, sessionsNow(b).length, sessionsNow(ctx).length], [1, 1, 0]);
  const again = await start(a, world(a), { component: "node:web" });
  assert.equal(again.skipped.length, 1, "A finds its own session running, and only its own");
});

test("stopping A never signals B's or the developer's process", async () => {
  const { ctx, process, world } = ready();
  const a = asTask(ctx, A, "env-sandboxaaaa1");
  const b = asTask(ctx, B, "env-sandboxbbbb2");
  await start(ctx, world(), { component: "node:web" });
  await start(a, world(a), { component: "node:web" });
  await start(b, world(b), { component: "node:web" });
  const own = ctx.sessions.all().find((s) => ownerOf(s).id === A.id);
  const out = await stop(a, {});
  assert.deepEqual(out.stopped.map((s) => s.session), [own.id]);
  assert.deepEqual(process.signals.map((s) => s.pid), [own.pid], "one pid was signalled, and it was A's");
  assert.equal(sessionsNow(b)[0].judgement.state, "RUNNING");
  assert.equal(sessionsNow(ctx)[0].judgement.state, "RUNNING");
});

test("a session of another environment is named and refused, not stopped and not 'unknown'", async () => {
  const { ctx, world } = ready();
  const a = asTask(ctx, A, "env-sandboxaaaa1");
  await start(ctx, world(), { component: "node:web" });
  const [mine] = ctx.sessions.all();
  await assert.rejects(() => stop(a, { session: mine.id }), (e) => e instanceof Refused && /another environment/.test(e.message));
  await assert.rejects(() => stop(a, { session: "rs-ffffffffffff" }), /no session rs-ffffffffffff/);
});

test("a native component is stamped with the NATIVE environment even when a validated dev container exists", async () => {
  const rt2 = ready({ tools: { ...TOOLS, docker: "27.3.1", "docker-daemon": "27.3.1", devcontainer: "0.71.0" }, process: fakeProcess({ docker: { ok: true, out: "abc\n" } }) });
  const { ctx, world } = rt2;
  const container = created({ checkout: CHECKOUT, name: "devcontainer", provider: "devcontainer" }, NOW);
  ctx.instances.write({ ...container, state: "VALIDATED" });
  ctx.writeSettings({ next: { components: { "node:web": { provider: "devcontainer" }, "dotnet:api": { provider: "native" } } }, revision: null, by: "person" });
  await start(ctx, world(), {});
  const byComponent = Object.fromEntries(ctx.sessions.all().map((s) => [s.component, s.env]));
  assert.equal(byComponent["dotnet:api"], ctx.envId, "the native one runs in the native environment");
  assert.equal(byComponent["node:web"], container.id, "the container's runs in the container's");
});

test("port ownership stays host-wide, and a task's session is found in it with its owner", () => {
  const { ctx, io, process } = ready();
  const live = liveRoom(STORE_ROOT, HOST, CHECKOUT);
  const launched = process.launch("x", []);
  createSessions(live, io).write(doc({ id: "rs-aaaaaaaaaaaa", owner: A, env: "env-s", pid: launched.pid, pidStartedAt: launched.startedAt, ports: [4100] }));
  const registry = { list: () => [{ key: "repo-aaaa", name: "shop", checkouts: [{ id: CHECKOUT, root: "/work/shop" }] }] };
  const running = runningEverywhere({ registry, storeBase: "/store", host: HOST, io: ctx.raw, process });
  assert.deepEqual(ownerLookup(running)(4100), { project: "shop", checkout: "/work/shop", component: "node:web", owner: A });
});
