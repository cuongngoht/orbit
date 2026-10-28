// A crash must never make an action run twice. The decision and the action are recorded BEFORE it
// runs; one whose step died is reported, refused as a reason to start anything else, and settled by
// reconcile -- read back where its owner can, closed as interrupted where it cannot -- and a task is
// taken up again from the store alone, by a process that remembers nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/task/ops.mjs";
import { contextOf, reconcile, resume, step } from "../src/orchestration/loop.mjs";
import { BUILD, TEST, decided, orchestrationWorld, passes, prepared, testing } from "./fakes/orchestration.mjs";

function crashing(o) {
  const answer = o.process.run;
  o.process.run = () => {
    throw new Error("the host was killed mid-run");
  };
  return () => { o.process.run = answer; };
}

test("a crash after action-started and before its result: the step dies, the action stays open and nothing else may start", async (t) => {
  const o = orchestrationWorld(t);
  const { id, go } = await testing(o);
  const restore = crashing(o);
  await assert.rejects(go({ kind: "check", command: TEST }), /killed mid-run/);
  restore();
  const c = contextOf(o.ports, id);
  assert.deepEqual(c.open.map((a) => [a.kind, a.settle.startsWith("reconcile")]), [["check", true]]);
  assert.equal(c.stop.id, "unsettled");
  assert.ok(o.roomOf(id).read("running"), "which process ran it is kept");
  await assert.rejects(go({ kind: "check", command: TEST }), /UNSETTLED: act-\d+ started and never settled/);
});

test("reconcile never touches an action its process is still running, and closes one whose process is gone -- the check is then run again as a NEW action", async (t) => {
  const o = orchestrationWorld(t, { liveness: () => true });
  const { id, go } = await testing(o);
  const restore = crashing(o);
  await assert.rejects(go({ kind: "check", command: TEST }));
  restore();
  await assert.rejects(reconcile(o.ports, id), /STILL_RUNNING/);
  o.ports.liveness = () => false;
  const out = await reconcile(o.ports, id);
  assert.deepEqual(out.settled.map((s) => [s.kind, s.outcome]), [["check", "error"]]);
  assert.match(out.settled[0].summary, /interrupted/);
  assert.equal(o.roomOf(id).read("running"), null);
  const before = o.process.calls.length;
  const again = await go({ kind: "check", command: TEST });
  assert.deepEqual([again.outcome, o.process.calls.length - before], ["succeeded", 1], "run once more, as a new action, and only because a step asked");
  assert.equal(o.w.view(id).actions.filter((a) => a.type === "test").length, 2);
});

test("an interrupted PROTECTED action is never re-sent: its outcome is unknown, and another needs another approval", async (t) => {
  const o = orchestrationWorld(t, { capabilities: { "orders.migrate": { mutates: true, effects: ["migrate"], environment: "production", connection: null } } });
  const { id, go } = await testing(o);
  const seed = { kind: "invoke", capability: "orders.migrate", input: { database: "orders", migration: "20261028_add_invoice_index" } };
  await go(seed);
  apply({ ...o.w.ctx, door: "control" }, id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision });
  o.ports.capabilities.invoke = async () => {
    throw new Error("connection reset after the write was sent");
  };
  await assert.rejects(go(seed, { approval: "apr-1" }), /connection reset/);
  const out = await reconcile(o.ports, id);
  assert.match(out.settled[0].summary, /outcome is unknown: it may have changed something, so it is never sent again/);
  await assert.rejects(go(seed, { approval: "apr-1" }), /NOT_GRANTED: apr-1 is consumed/);
  assert.equal((await go(seed)).approval, "apr-2", "asking again is a new request a person decides");
});

test("an interrupted runtime start is read back from runtime's own receipts, never started again", async (t) => {
  const o = orchestrationWorld(t);
  const id = (await prepared(o, { ref: "PBI-482" })).id;
  const sessions = [];
  o.ports.runtime.start = async () => {
    sessions.push({ id: "rs-0000000000bb", component: "node:.", state: "STARTING", requestedAt: new Date(o.w.clock.at).toISOString() });
    throw new Error("killed after runtime wrote its receipt");
  };
  o.ports.runtime.sessions = async () => sessions;
  apply(o.w.ctx, id, "stage", { stage: "ENVIRONMENT" });
  await assert.rejects(step(o.ports, id, decided(o.ports, id, { kind: "start-runtime" })));
  const out = await reconcile(o.ports, id);
  assert.deepEqual(out.settled.map((s) => s.outcome), ["succeeded"]);
  assert.deepEqual(o.w.view(id).receipts.filter((r) => r.domain === "runtime").map((r) => [r.ref, r.outcome]), [["rs-0000000000bb", "STARTING"]]);
});

test("a new process continues the task from the store alone: the same context, and the next step goes on", async (t) => {
  const first = orchestrationWorld(t, { script: { test: [passes()] } });
  const { id, go } = await testing(first);
  const before = contextOf(first.ports, id);
  const second = orchestrationWorld(t, { again: first, script: { test: [passes()] } });
  const after = resume(second.ports, "PBI-482");
  assert.equal(after.task, id);
  for (const k of ["revision", "lifecycle", "stage", "attempt", "workspace", "changes", "checks", "allowed"]) assert.deepEqual(after.context[k], before[k], k);
  const ran = await step(second.ports, id, decided(second.ports, id, { kind: "check", command: TEST }));
  assert.equal(ran.stage, "REVIEWING");
  assert.equal(typeof go, "function");
});

test("record-changes after a crash halfway through linking never links a file twice", async (t) => {
  const o = orchestrationWorld(t);
  const { id, go } = await prepared(o);
  await go({ kind: "plan", intent: "two files", scope: ["src"] });
  await go({ kind: "implement" });
  o.ws.edit("src/a.cs");
  o.ws.edit("src/b.cs");
  const apply0 = o.ports.task.apply;
  let links = 0;
  o.ports.task.apply = (tid, op, g) => {
    if (op === "link-file" && ++links === 2) throw new Error("killed between two file rows");
    return apply0(tid, op, g);
  };
  await assert.rejects(go({ kind: "record-changes" }));
  o.ports.task.apply = apply0;
  await reconcile(o.ports, id);
  await go({ kind: "record-changes" });
  const files = o.w.tasks.read(id).filter((l) => l.kind === "file-changed").map((l) => l.path).sort();
  assert.deepEqual(files, ["src/a.cs", "src/b.cs"], "each file once");
  assert.equal(o.w.view(id).stage, "BUILDING");
  assert.ok([BUILD].length);
});

// ---- a sandbox: a start whose answer was lost is read back from runtime's books, never sent again -----

const WITH_APP = { sandbox: { startable: ["node:web"] } };

test("an interrupted start-sandbox is read back from runtime's own sessions: the sandbox and the application it holds are receipted, and nothing is started again", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await testing(o);
  const start = o.box.start;
  o.box.start = async (a) => {
    await start(a);
    throw new Error("killed after runtime wrote its receipt");
  };
  await assert.rejects(go({ kind: "start-sandbox" }), /killed after runtime wrote its receipt/);
  o.box.start = start;
  assert.equal(contextOf(o.ports, id).stop.id, "unsettled");
  const out = await reconcile(o.ports, id);
  assert.deepEqual(out.settled.map((s) => [s.kind, s.outcome]), [["start-sandbox", "succeeded"]]);
  const view = o.w.view(id);
  assert.deepEqual(view.receipts.filter((r) => r.domain === "sandbox").map((r) => [r.outcome, r.sourceTree]), [["READY", o.ws.treeOf()]]);
  assert.deepEqual(view.receipts.filter((r) => r.domain === "runtime").map((r) => [r.outcome, r.environment === view.receipts.find((x) => x.domain === "sandbox").ref]), [["RUNNING", true]]);
  assert.equal(o.box.calls.filter((c) => c.op === "start").length, 1, "never sent again by itself");
  assert.equal(o.roomOf(id).read("running"), null);
});

test("an interrupted prepare-sandbox that did prepare is read back as prepared; one that did nothing is closed as not done, and never repeated", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await testing(o);
  const prepare = o.box.prepare;
  o.box.prepare = async (a) => {
    await prepare(a);
    throw new Error("killed after the sandbox was prepared");
  };
  await assert.rejects(go({ kind: "prepare-sandbox" }), /killed after the sandbox was prepared/);
  const done = await reconcile(o.ports, id);
  assert.deepEqual(done.settled.map((s) => [s.kind, s.outcome]), [["prepare-sandbox", "succeeded"]]);
  assert.match(done.settled[0].summary, /read back as ready/);
  const empty = orchestrationWorld(t, WITH_APP);
  const at = await testing(empty);
  let asked = 0;
  empty.box.prepare = async () => {
    asked += 1;
    throw new Error("killed before runtime did anything");
  };
  await assert.rejects(at.go({ kind: "prepare-sandbox" }), /killed before/);
  const out = await reconcile(empty.ports, at.id);
  assert.deepEqual(out.settled.map((s) => s.outcome), ["error"]);
  assert.match(out.settled[0].summary, /nothing it may have started or prepared is on runtime's books/);
  assert.equal(asked, 1, "asked once, and never again by the read-back");
});
