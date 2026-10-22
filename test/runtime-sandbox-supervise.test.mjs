// SUPERVISING an isolated sandbox (ADR 0036): signals and heartbeats are allow-listed lines whose state is FOLDED,
// one tick is an ordered table over the facts of the moment, and the supervisor launches nothing -- it beats, stops a
// worker past its deadline by its receipt, and on a cancel or a spent lifetime tears the sandbox down in order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Refused } from "../src/errors.mjs";
import { deps } from "../src/runtime/lifecycle/deps.mjs";
import { specOf, startedNode } from "../src/runtime/sandbox/network.mjs";
import { HEARTBEAT_FIELDS, SIGNAL_FIELDS, SUPERVISE, decided, heartbeatLine, heartbeats, signalled, supervisionNow, supervisionRoom } from "../src/runtime/sandbox/supervise.mjs";
import { HARD_LIFETIME_MS, tick } from "../cli/sandbox-supervisor.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { WORKER, readyWorld } from "./isolated.harness.mjs";

const ROOM = "/store/runtime/laptop-a/x/sandboxes/sbx/supervision";
const AT = "2026-10-21T10:00:00.000Z";

const linesIn = (io, file) => String(io.read(file) ?? "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("a signal is one of three words, allow-listed, scrubbed and numbered -- and what they say is folded from the lines, never kept", () => {
  const io = fakeIo();
  signalled(io, ROOM, { signal: "pause", by: "control", why: "password=hunter2hunter2 while a person looks", extra: "dropped" }, AT);
  assert.throws(() => signalled(io, ROOM, { signal: "kill", by: "x" }, AT), (e) => e instanceof Refused && /a signal is pause, resume, cancel/.test(e.message));
  assert.deepEqual(supervisionNow(io, ROOM), { paused: true, cancelled: false, seq: 1, last: linesIn(io, join(ROOM, "signals.jsonl"))[0] });
  signalled(io, ROOM, { signal: "resume", by: "control" }, AT);
  assert.equal(supervisionNow(io, ROOM).paused, false);
  signalled(io, ROOM, { signal: "cancel", by: "orchestrator", why: "the task ended" }, AT);
  const now = supervisionNow(io, ROOM);
  assert.deepEqual([now.paused, now.cancelled, now.seq], [false, true, 3]);
  const lines = linesIn(io, join(ROOM, "signals.jsonl"));
  assert.ok(lines.every((l) => Object.keys(l).every((k) => SIGNAL_FIELDS.includes(k))));
  assert.ok(!lines[0].why.includes("hunter2"), "a why is scrubbed before it is kept");
});

test("a heartbeat keeps only its declared fields", () => {
  const line = JSON.parse(heartbeatLine({ seq: 1, gen: "g1", at: AT, state: "running", running: 2, workers: 0, argv: ["secret"], env: { A: "1" } }));
  assert.deepEqual(Object.keys(line), ["seq", "gen", "at", "state", "running", "workers"]);
  assert.ok(Object.keys(line).every((k) => HEARTBEAT_FIELDS.includes(k)));
});

const facts = (over = {}) => ({ doc: { state: "READY", createdAt: AT }, signals: { paused: false, cancelled: false }, nowMs: Date.parse(AT) + 1000, lifetimeEndsMs: Date.parse(AT) + 3600000, workers: [], ...over });

test("SUPERVISE: gone ends, a cancel or a spent lifetime tears down then ends, a pause beats as paused -- and a worker past its deadline is stopped either way", () => {
  assert.deepEqual(SUPERVISE.map((r) => r.name), ["GONE", "CANCELLED", "LIFETIME", "PAUSED", "RUNNING"]);
  const kinds = (f) => decided(f).map((a) => a.kind);
  assert.deepEqual(kinds(facts({ doc: null })), ["end"]);
  assert.deepEqual(kinds(facts({ doc: { state: "QUARANTINED" } })), ["end"]);
  assert.deepEqual(kinds(facts({ signals: { paused: true, cancelled: true } })), ["teardown", "end"]);
  assert.deepEqual(kinds(facts({ nowMs: Date.parse(AT) + 3600001 })), ["teardown", "end"]);
  const overdue = [{ id: "s-late", deadlineAt: AT }, { id: "s-fine", deadlineAt: "2027-01-01T00:00:00Z" }];
  assert.deepEqual(decided(facts({ signals: { paused: true, cancelled: false }, workers: overdue })), [{ kind: "stop-worker", session: "s-late" }, { kind: "beat", state: "paused" }], "pausing interrupts nothing: it holds what is new, and a deadline is still a deadline");
  assert.deepEqual(decided(facts({ workers: overdue })), [{ kind: "stop-worker", session: "s-late" }, { kind: "beat", state: "running" }]);
  assert.equal(HARD_LIFETIME_MS, 26 * 3600 * 1000);
});

test("a tick over a running sandbox beats and launches nothing; a cancel tears it down in order and ends the supervisor", async () => {
  const w = await readyWorld();
  await w.run("sandbox-start");
  const ctx = w.sandbox();
  const d = deps(ctx);
  const made = () => w.iso.state.calls.filter((c) => ["create", "start", "build", "network.create", "startAttached"].includes(c.kind)).length;
  const before = made();
  const state = { seq: 0, gen: "g1", since: Date.now(), once: true };
  assert.equal(await tick(ctx, d, state), false);
  const [beat] = heartbeats(ctx.io, supervisionRoom(ctx.rooms.liveSandbox));
  assert.deepEqual([beat.seq, beat.state, beat.running, beat.workers], [1, "running", 2, 0]);
  assert.equal(made(), before, "a supervisor never launches, starts or builds anything");
  signalled(ctx.io, supervisionRoom(ctx.rooms.liveSandbox), { signal: "cancel", by: "orchestrator", why: "the task ended" }, ctx.now());
  assert.equal(await tick(ctx, d, state), true);
  assert.equal(ctx.sandboxes.read(ctx.envId).state, "RELEASED");
  assert.equal(made(), before);
  assert.equal([...w.iso.state.containers.values()].some((c) => c.running), false);
});

test("a spent lifetime is a teardown too, at the next tick", async () => {
  const w = await readyWorld();
  const ctx = w.sandbox();
  w.clockState.ms += 121 * 60000;
  assert.equal(await tick(ctx, deps(ctx), { seq: 0, gen: "g", since: Date.now(), once: true }), true);
  assert.equal(ctx.sandboxes.read(ctx.envId).state, "RELEASED");
});

test("a worker past its deadline is stopped by its receipt at the next tick, and nothing else is", async () => {
  const w = await readyWorld();
  const ctx = w.sandbox();
  const d = deps(ctx);
  const now = { topology: { mode: "aliases", network: ctx.sandboxes.read(ctx.envId).isolation.network }, place: { names: { envId: ctx.envId }, policy: { isolation: { limits: { cpus: 1, memoryMb: 256, pids: 64 } } }, catalog: ctx.catalog, paths: { workspace: ctx.root } } };
  const node = { key: "worker:run-0009", role: "worker", alias: "worker-x", image: { pinned: WORKER }, argv: [], env: { names: [], values: {} }, ports: [] };
  const up = startedNode(ctx, w.iso, node, specOf(node, now.topology, now.place), { kind: "worker" }, d);
  ctx.sessions.write({ ...up.session, deadlineAt: new Date(ctx.clock() - 1000).toISOString() });
  const stoppedBefore = w.iso.state.stopped.length;
  assert.equal(await tick(ctx, d, { seq: 0, gen: "g", since: Date.now(), once: true }), false);
  assert.deepEqual(w.iso.state.stopped.slice(stoppedBefore), [up.session.container.id]);
  assert.equal(ctx.sessions.read(up.session.id).state, "STOPPED");
});
