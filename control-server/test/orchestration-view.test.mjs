// An ORCHESTRATED task is a task: Mission Control reads it through the routes it already has --
// its stages, its attempts with their failure signatures, its checks evidenced by receipts, its
// verification -- and a person's Approve once, given there, is what the orchestrator then consumes
// exactly once. No route was added for any of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectStoreRoot } from "../../src/project/repository.mjs";
import { step } from "../../src/orchestration/loop.mjs";
import { BUILD, FAILING, TEST, changed, decided, orchestrationWorld, passes, testing } from "../../test/fakes/orchestration.mjs";
import { runtimeWorld, serve } from "./checkout.mjs";
import { bind, PAYMENTS } from "./machine.mjs";
import { fixture } from "./fixture.mjs";

const path = (tail = "") => `/api/v1/projects/${encodeURIComponent(PAYMENTS.key)}/checkouts/${PAYMENTS.checkout}/tasks${tail}`;

async function served(t, opts = {}) {
  const { root } = fixture(t);
  bind(root, PAYMENTS);
  const o = orchestrationWorld(t, { ...opts, at: { dir: projectStoreRoot(root.store, PAYMENTS.key), project: PAYMENTS.key, checkout: PAYMENTS.checkout } });
  return { o, api: await serve(t, root, runtimeWorld(root)) };
}

test("Mission Control shows an orchestrated task the way it shows any task: stages, attempts and signatures, checks with receipts, verification -- COMPLETED", async (t) => {
  const { o, api } = await served(t, { script: { test: [FAILING, passes()] } });
  const { id, go } = await testing(o);
  await go({ kind: "check", command: TEST });
  await go({ kind: "diagnose", then: "fix" });
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  await go({ kind: "check", command: TEST });
  await go({ kind: "review" });
  const got = await api.get(path(`/${id}`));
  assert.equal(got.status, 200);
  const view = got.json.task;
  assert.deepEqual([view.lifecycle, view.stage, view.attempt.count], ["COMPLETED", "REVIEWING", 2]);
  assert.deepEqual(view.attempts.map((a) => [a.cause, a.outcome, Boolean(a.failureSignature)]), [["fresh", "failed", true], ["fix", "succeeded", false]]);
  assert.ok(view.receipts.some((r) => r.domain === "check" && r.outcome === "failed") && view.receipts.some((r) => r.domain === "check" && r.outcome === "succeeded"));
  assert.ok(view.actions.filter((a) => ["build", "test"].includes(a.type)).every((a) => a.evidence === "receipt"));
  assert.ok(view.verification.length > 0 && view.verification.every((v) => v.state === "satisfied"));
  const events = await api.get(path(`/${id}/events`));
  assert.deepEqual(events.json.events.filter((e) => e.kind === "stage").map((e) => e.stage).slice(-6), ["DIAGNOSING", "FIXING", "BUILDING", "TESTING", "REGRESSION", "REVIEWING"]);
});

test("a gated action waits in Mission Control's queue; a person's Approve once there is consumed by exactly that action, once", async (t) => {
  const { o, api } = await served(t, { capabilities: { "dev.seedRefunds": { mutates: true, connection: null } } });
  const { id, go } = await testing(o);
  const seed = { kind: "invoke", capability: "dev.seedRefunds", input: { refunds: 3 } };
  await go(seed, { reason: "the integration test needs refund rows" });
  const queue = await api.get("/api/v1/mission-control/approvals");
  const asked = queue.json.approvals.find((a) => a.task === id);
  assert.deepEqual([asked.action, asked.id], ["capability.invoke", "apr-1"]);
  const approved = await api.post(path(`/${id}/approvals/apr-1/approve`), { human: true, expectedRevision: asked.revision });
  assert.equal(approved.status, 200);
  const ran = await step(o.ports, id, decided(o.ports, id, seed, { approval: "apr-1" }));
  assert.deepEqual([ran.outcome, o.calls.invoked.length], ["succeeded", 1]);
  await assert.rejects(step(o.ports, id, decided(o.ports, id, seed, { approval: "apr-1" })), /NOT_GRANTED/);
  const after = await api.get(path(`/${id}`));
  assert.deepEqual(after.json.task.approvals.map((a) => [a.id, a.state, Boolean(a.consumedBy)]), [["apr-1", "consumed", true]]);
});
