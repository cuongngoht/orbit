// Cancellation, through the RUNTIME subject's real start and stop: a task owns a session it asked
// runtime to start; a person cancels; the task starts nothing else; the orchestrator asks runtime to
// stop exactly the sessions this task linked -- and runtime's own ownership rules decide. A session a
// developer started and a process Orbit never started are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS as RUNTIME } from "../src/runtime/index.mjs";
import { ensure } from "../src/runtime/understanding.mjs";
import { apply } from "../src/task/ops.mjs";
import { cleanup, step } from "../src/orchestration/loop.mjs";
import { decided, orchestrationWorld } from "./fakes/orchestration.mjs";
import { NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { fakeRuntime } from "./fakes/runtime-ctx.mjs";

const TOOLS = { node: "22.1.0", npm: "10.8.1", dotnet: "8.0.100" };

function withRuntime(t) {
  const rt = fakeRuntime(NODE_AND_DOTNET, { tools: TOOLS });
  ensure(rt.ctx);
  const runtime = { readiness: async () => ({ understanding: "CURRENT", components: [], checks: [], unsafeTests: false }), start: (a) => RUNTIME.start.run(rt.ctx, a.component ? [`--component=${a.component}`] : []), stop: (a) => RUNTIME.stop.run(rt.ctx, [`--session=${a.session}`]), sessions: async () => rt.ctx.sessions.list() };
  return { rt, o: orchestrationWorld(t, { runtime }) };
}

async function inEnvironment(o) {
  const id = (await o.ports.task.create({ objective: "PBI-482 with a dev server" })).task;
  apply(o.w.ctx, id, "stage", { stage: "ENVIRONMENT" });
  return id;
}

test("cancel: the task's own session stops, a developer's session and a stranger's process are untouched, and nothing else starts", async (t) => {
  const { rt, o } = withRuntime(t);
  const developer = await RUNTIME.start.run(rt.ctx, ["--component=dotnet:api"]);
  rt.process.adopt(7777, "2026-10-03T09:00:00.000Z");
  const id = await inEnvironment(o);
  const started = await step(o.ports, id, decided(o.ports, id, { kind: "start-runtime", component: "node:web" }));
  assert.equal(started.outcome, "succeeded");
  const mine = o.w.view(id).receipts.find((r) => r.domain === "runtime");
  assert.equal(mine.outcome, "RUNNING");
  apply(o.w.ctx, id, "cancel", { human: true, expected: o.w.view(id).revision, because: "the requirement changed" });
  const out = await step(o.ports, id, decided(o.ports, id, { kind: "gather-context" }));
  assert.deepEqual([out.state, out.cleanup.sessions.map((s) => [s.ref, s.outcome])], ["cancelled", [[mine.ref, "STOPPED"]]]);
  const minePid = rt.ctx.sessions.read(mine.ref).pid;
  assert.deepEqual([...new Set(rt.process.signals.map((s) => s.pid))], [minePid], "only the task's own process was signalled");
  assert.ok(rt.process.alive(developer.started[0].pid), "the developer's session runs on");
  assert.ok(rt.process.alive(7777), "a process Orbit never started runs on");
  assert.equal(o.calls.context, 0, "a cancelled task starts nothing");
  assert.deepEqual(o.w.view(id).receipts.filter((r) => r.domain === "runtime").map((r) => r.outcome), ["STOPPED"]);
});

test("cleanup asks again for nothing it already saw end, and a session runtime cannot prove is the task's own is refused, never killed", async (t) => {
  const { rt, o } = withRuntime(t);
  const id = await inEnvironment(o);
  await step(o.ports, id, decided(o.ports, id, { kind: "start-runtime", component: "node:web" }));
  const mine = o.w.view(id).receipts.find((r) => r.domain === "runtime");
  rt.process.reuse(rt.ctx.sessions.read(mine.ref).pid, "2030-01-01T00:00:00.000Z");
  apply(o.w.ctx, id, "cancel", { human: true, expected: o.w.view(id).revision });
  const first = await cleanup(o.ports, id);
  assert.deepEqual(first.sessions.map((s) => s.outcome), ["GONE"], "the pid is another program's now: the receipt is closed and nothing is killed");
  assert.equal(rt.process.signals.length, 0);
  const second = await cleanup(o.ports, id);
  assert.deepEqual(second.sessions, [], "nothing owed twice");
});

test("cleanup is for an ended task: a running one keeps what it started", async (t) => {
  const { o } = withRuntime(t);
  const id = await inEnvironment(o);
  await assert.rejects(cleanup(o.ports, id), /RUNNING: cleanup is for a task that ended/);
});
