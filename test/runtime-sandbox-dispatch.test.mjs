// DISPATCHING a generated test to an isolated sandbox's worker (ADR 0036, 0038): refused or blocked by its gates in
// order before anything exists; the worker created from the trusted image, inspected and held to the profile BEFORE
// it starts; its request handed on stdin; stopped by its receipt when its deadline passes; and removed either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Blocked, Refused } from "../src/errors.mjs";
import { classOf } from "../src/runtime/governance.mjs";
import { COMMANDS } from "../src/runtime/index.mjs";
import { deps } from "../src/runtime/lifecycle/deps.mjs";
import { dispatchDirs, dispatched } from "../src/runtime/sandbox/dispatch.mjs";
import { signalled, supervisionRoom } from "../src/runtime/sandbox/supervise.mjs";
import { TASK } from "./sandbox.harness.mjs";
import { WORKER, readyWorld } from "./isolated.harness.mjs";

const RUN = "run-0001";

async function dispatchable(opts = {}) {
  const w = await readyWorld(opts);
  assert.equal(w.ready.state, "READY", w.ready.blocked?.because);
  const ctx = w.sandbox();
  ctx.io.ensureDir(dispatchDirs(ctx, RUN).in);
  return { ...w, ctx, d: deps(ctx) };
}

const docOf = (ctx) => ctx.sandboxes.read(ctx.envId);

const edited = (ctx, patch) => ctx.sandboxes.write({ ...docOf(ctx), ...patch(docOf(ctx)) });

test("the gates refuse or block a dispatch in their order, before anything is created", async () => {
  const w = await dispatchable();
  const { ctx, d } = w;
  const calls = () => w.iso.state.calls.filter((c) => ["create", "startAttached"].includes(c.kind)).length;
  const before = calls();
  await assert.rejects(() => dispatched(ctx, { run: "Run 1" }, d), (e) => e instanceof Refused && /name the run with --run/.test(e.message));
  await assert.rejects(() => dispatched(ctx, { run: "run-0002" }, d), (e) => e instanceof Refused && /inputs are not prepared/.test(e.message));
  await assert.rejects(() => dispatched({ ...ctx, pluginRoot: null }, { run: RUN }, d), (e) => e instanceof Blocked && /without the plugin's own directory/.test(e.message));
  const kept = docOf(ctx);
  edited(ctx, (doc) => ({ isolation: { ...doc.isolation, egress: { ...doc.isolation.egress, held: false } } }));
  await assert.rejects(() => dispatched(ctx, { run: RUN }, d), (e) => e instanceof Blocked && /keeps no egress evidence that held/.test(e.message));
  edited(ctx, (doc) => ({ isolation: { ...doc.isolation, attested: false, because: "service:db: not LIMITED" } }));
  await assert.rejects(() => dispatched(ctx, { run: RUN }, d), (e) => e instanceof Blocked && /was not attested: service:db: not LIMITED/.test(e.message));
  edited(ctx, () => ({ state: "STALE" }));
  await assert.rejects(() => dispatched(ctx, { run: RUN }, d), (e) => e instanceof Blocked && /the sandbox is STALE/.test(e.message));
  edited(ctx, () => ({ isolation: null }));
  await assert.rejects(() => dispatched(ctx, { run: RUN }, d), (e) => e instanceof Refused && /this sandbox is not isolated/.test(e.message));
  ctx.sandboxes.write(kept);
  signalled(ctx.io, supervisionRoom(ctx.rooms.liveSandbox), { signal: "pause", by: "control", why: "a person looks" }, ctx.now());
  await assert.rejects(() => dispatched(ctx, { run: RUN }, d), (e) => e instanceof Blocked && /is paused \(control\)/.test(e.message));
  signalled(ctx.io, supervisionRoom(ctx.rooms.liveSandbox), { signal: "cancel", by: "orchestrator", why: "the task ended" }, ctx.now());
  await assert.rejects(() => dispatched(ctx, { run: RUN }, d), (e) => e instanceof Refused && /was cancelled/.test(e.message));
  assert.equal(calls(), before, "no gate let anything be created");
});

test("the worker is created from the trusted image with only its rooms mounted, attested, and only then started -- its request on stdin", async () => {
  const w = await dispatchable({ iso: { attached: (c, opts) => (w.io.write(join(dispatchDirs(w.ctx, RUN).out, "envelope.json"), "{}"), { ok: true, status: 0, out: `ran: ${opts.input}\n` }) } });
  const r = await dispatched(w.ctx, { run: RUN, deadlineMs: 60000, input: '{"v":"orbit.worker/v1"}' }, w.d);
  assert.deepEqual([r.ok, r.status, r.timedOut, r.stopped, r.envelope], [true, 0, false, false, true]);
  const create = w.iso.state.calls.find((c) => c.kind === "create" && c.spec.labels["orbit.role"] === "worker");
  const dirs = dispatchDirs(w.ctx, RUN);
  assert.deepEqual([create.spec.image, create.spec.labels["orbit.run"], create.spec.readOnly, create.spec.capDrop], [WORKER, RUN, true, ["ALL"]]);
  assert.deepEqual(create.spec.mounts, [{ source: "/plugins/orbit", target: "/orbit", readOnly: true }, { source: dirs.in, target: "/work/in", readOnly: true }, { source: dirs.out, target: "/work/out", readOnly: false }]);
  assert.deepEqual(create.spec.env.values, { ORBIT_STORE_DIR: "/work/out/store", HOME: "/tmp", ORBIT_WORKER_DEADLINE_MS: "60000", ORBIT_UI_TESTS: "/work/in/ui-tests" }, "a scratch store, a home, a deadline, and the project the caller laid in its inputs -- nothing of this machine's");
  const order = w.iso.state.calls.filter((c) => c.id === create.id || (c.kind === "inspect" && c.id === create.id)).map((c) => c.kind);
  assert.deepEqual(order.filter((k, i) => order.indexOf(k) === i), ["create", "inspect", "startAttached", "remove"], "inspected and attested between being created and being started");
  assert.equal(w.iso.state.calls.find((c) => c.kind === "startAttached").input, '{"v":"orbit.worker/v1"}');
  const session = w.ctx.sessions.read(r.session);
  assert.deepEqual([session.kind, session.state, session.stoppedHow, typeof session.deadlineAt], ["worker", "STOPPED", "it ended", "string"]);
  assert.match(w.io.read(dirs.activity), /"stream":"out","text":"ran: \{\\"v\\":\\"orbit.worker\/v1\\"\}\\n"/);
});

test("a worker that does not hold to the profile is removed before it runs", async () => {
  const w = await dispatchable({ iso: { honour: (spec, facts) => (spec.labels["orbit.role"] === "worker" ? { ...facts, readOnly: false } : facts) } });
  await assert.rejects(() => dispatched(w.ctx, { run: RUN }, w.d), (e) => e instanceof Blocked && /removed before it ran: worker:run-0001: not ROOT_READ_ONLY/.test(e.message));
  assert.equal(w.iso.state.calls.some((c) => c.kind === "startAttached"), false);
  const worker = w.ctx.sessions.list({ env: w.ctx.envId, owner: w.ctx.owner }).find((s) => s.kind === "worker");
  assert.deepEqual([worker.state, worker.stoppedHow, w.iso.state.removed.includes(worker.container.id)], ["STOPPED", "removed before it ran", true]);
});

test("a worker past its deadline is stopped by its receipt, then removed -- what ends the docker client does not end a container", async () => {
  const w = await dispatchable({ iso: { attached: () => ({ ok: false, timedOut: true, out: "", error: "docker was killed after 75s" }) } });
  const r = await dispatched(w.ctx, { run: RUN, deadlineMs: 60000 }, w.d);
  assert.deepEqual([r.timedOut, r.stopped, r.envelope], [true, true, false]);
  const session = w.ctx.sessions.read(r.session);
  assert.deepEqual([session.state, session.stoppedHow], ["STOPPED", "its deadline passed"]);
  assert.ok(w.iso.state.stopped.includes(session.container.id) && w.iso.state.removed.includes(session.container.id));
});

test("what the worker prints is observed as scrubbed, bounded lines a viewer reads -- never a decision", async () => {
  const secret = "hunter2hunter2";
  const w = await dispatchable({ iso: { attached: () => ({ ok: true, status: 1, chunks: [["out", `password=${secret}\n`], ["err", "x".repeat(2000)]] }) } });
  const r = await dispatched(w.ctx, { run: RUN }, w.d);
  assert.deepEqual([r.ok, r.status, r.envelope], [true, 1, false], "how it ended is said; what it means is the host's to judge from the envelope");
  const lines = w.io.read(dispatchDirs(w.ctx, RUN).activity).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.seq, l.stream]), [[1, "out"], [2, "err"]]);
  assert.ok(!lines[0].text.includes(secret) && lines[1].text.length <= 400);
});

test("the dispatch command is the runtime's, writes the machine, and is the TEST_WORKER_DISPATCH class -- a signal writes only the store", async () => {
  assert.deepEqual([COMMANDS["sandbox-dispatch"].writes, COMMANDS["sandbox-signal"].writes], ["machine", "store"]);
  assert.deepEqual([classOf("sandbox-dispatch").class, classOf("sandbox-signal").class], ["TEST_WORKER_DISPATCH", "SIGNAL_SANDBOX"]);
  const w = await dispatchable();
  const answer = await w.run("sandbox-dispatch", TASK, [`--run=${RUN}`]);
  assert.equal(answer.run, RUN);
});
