// Autonomous by default (0.2.0): a capability call runs on its own -- whatever it changes -- unless what it DECLARES it
// does crosses a protected boundary (src/protected/). Then it is asked for, waited on, never granted by the agent that
// asked, granted once in Orbit Control's door, consumed once by exactly the action it names -- and a rejection is never
// turned into another try.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/task/ops.mjs";
import { contextOf } from "../src/orchestration/loop.mjs";
import { orchestrationWorld, testing } from "./fakes/orchestration.mjs";

const DEPLOY = { kind: "invoke", capability: "orders.deploy", input: { service: "orders-api", artifact: "orders-api:1.8.2", revision: "abc123" } };
const TRUNCATE = { kind: "invoke", capability: "orders.truncate", input: { database: "orders", table: "invoices" } };
const SEED = { kind: "invoke", capability: "dev.seedRefunds", input: { refunds: 3 } };

const CAPS = {
  "orders.deploy": { mutates: true, effects: ["deploy"], environment: "production", connection: null },
  "orders.stagingDeploy": { mutates: true, effects: ["deploy"], environment: "staging", connection: null },
  "orders.truncate": { mutates: true, effects: ["truncate"], environment: "production", connection: null },
  "orders.localTruncate": { mutates: true, effects: ["truncate"], environment: "local", connection: null },
  "dev.seedRefunds": { mutates: true, effects: ["write"], connection: null },
  "dev.readRefunds": { mutates: false, effects: ["read"], connection: null },
};

const world = (t) => orchestrationWorld(t, { capabilities: CAPS });

const control = (o) => ({ ...o.w.ctx, door: "control" });

test("an ordinary capability that changes state outside the workspace is AUTONOMOUS: it runs at once, authorized by the orchestrator, and nobody is asked", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  const ran = await go(SEED, { reason: "integration verification needs refund rows in DEV" });
  assert.deepEqual([ran.outcome, o.calls.invoked], ["succeeded", [{ id: "dev.seedRefunds", input: { refunds: 3 }, approved: true }]]);
  assert.deepEqual(o.w.view(id).approvals, [], "no approval was ever asked for");
  const staging = await go({ kind: "invoke", capability: "orders.stagingDeploy", input: { artifact: "orders-api:1.8.2" } });
  assert.equal(staging.outcome, "succeeded", "a staging deploy is autonomous");
  const local = await go({ kind: "invoke", capability: "orders.localTruncate", input: { table: "invoices" } });
  assert.equal(local.outcome, "succeeded", "a destructive operation on a local database is autonomous");
});

test("a production deploy: asked, WAITING_APPROVAL, never self-approved, approved once in Control, consumed once by the exact action, and a second use refused", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  const asked = await go(DEPLOY, { reason: "the release this task verified goes to production" });
  assert.deepEqual([asked.state, asked.approval, asked.boundary], ["waiting-approval", "apr-1", "PRODUCTION_DEPLOY"]);
  const view = o.w.view(id);
  const apr = view.approvals[0];
  assert.deepEqual([view.lifecycle, view.stopReason, apr.action, apr.environment, apr.boundary, apr.title, apr.destructive], ["WAITING_APPROVAL", "HUMAN_APPROVAL_REQUIRED", "deployment.production", "production", "PRODUCTION_DEPLOY", "Production deployment", false]);
  assert.match(apr.risk, /deploys orders-api:1\.8\.2 at abc123 to production/, "Orbit Control's Risk row says what the person approves");
  assert.deepEqual(apr.shows, { service: "orders-api", environment: "production", artifact: "orders-api:1.8.2", revision: "abc123" });
  assert.equal(o.calls.invoked.length, 0, "nothing ran on the asking");
  assert.throws(() => apply(o.w.ctx, id, "approve", { approval: "apr-1", human: true, expected: view.revision }), /PERSON_UNPROVEN/, "the agent's own door cannot grant what it asked for");
  assert.throws(() => apply({ ...o.w.ctx, door: "coordinator" }, id, "approve", { approval: "apr-1", human: true, expected: view.revision }), /PERSON_UNPROVEN/, "nor can the coordinator's");
  await assert.rejects(go(DEPLOY, { approval: "apr-1" }), /WAITING/);
  apply(control(o), id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision });
  await assert.rejects(go({ ...DEPLOY, input: { ...DEPLOY.input, artifact: "orders-api:1.8.3" } }, { approval: "apr-1" }), /OTHER_ACTION/, "a changed artifact cannot spend the approval");
  await assert.rejects(go({ ...DEPLOY, input: { ...DEPLOY.input, revision: "def456" } }, { approval: "apr-1" }), /OTHER_ACTION/, "nor a changed revision");
  const ran = await go(DEPLOY, { approval: "apr-1" });
  assert.equal(ran.outcome, "succeeded");
  assert.equal(o.calls.invoked.length, 1);
  assert.match(o.calls.invoked[0].authorized.action, /^[0-9a-f]{16}$/, "the call carries the fingerprint of exactly the approved action");
  const kinds = o.w.kinds(id);
  assert.equal(kinds.lastIndexOf("approval-consumed") + 1, kinds.lastIndexOf("action-started"), "consumed BEFORE the action it allowed started");
  assert.equal(o.w.view(id).approvals[0].outcome, "succeeded", "a viewer reads what became of the protected action");
  await assert.rejects(go(DEPLOY, { approval: "apr-1" }), /NOT_GRANTED: apr-1 is consumed/);
  assert.equal(o.calls.invoked.length, 1);
});

test("a destructive production data change is marked DESTRUCTIVE where a person reads it", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  await go(TRUNCATE);
  const apr = o.w.view(id).approvals[0];
  assert.deepEqual([apr.action, apr.boundary, apr.destructive], ["database.production.truncate", "PRODUCTION_DESTRUCTIVE_DATA", true]);
  assert.match(apr.risk, /^DESTRUCTIVE — truncate on production data in orders\.invoices/);
});

test("a person's rejection is never asked again: the same action is refused, a different one may be asked", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  await go(DEPLOY);
  apply(o.w.ctx, id, "reject", { approval: "apr-1", human: true, expected: o.w.view(id).revision, reason: "not before the freeze ends" });
  await assert.rejects(go(DEPLOY), /REJECTED/);
  await assert.rejects(go(DEPLOY, { approval: "apr-1" }), /REJECTED/);
  const other = await go({ ...DEPLOY, input: { ...DEPLOY.input, artifact: "orders-api:1.8.4" } });
  assert.deepEqual([other.state, other.approval], ["waiting-approval", "apr-2"]);
  assert.equal(o.calls.invoked.length, 0);
});

test("asking twice for one action is one request: the second step says which approval to wait for", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  await go(DEPLOY);
  apply(control(o), id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision });
  await assert.rejects(go(DEPLOY), /ASKED: apr-1 already asks for exactly this action \(granted\)/);
  assert.equal(contextOf(o.ports, id).approvals.length, 1);
  assert.equal(contextOf(o.ports, id).approvals[0].state, "granted");
});

test("an action that needs no person -- reading, or an ordinary write -- refuses an approval sent with it, never ignores it", async (t) => {
  const o = world(t);
  const { go } = await testing(o);
  await assert.rejects(go({ kind: "invoke", capability: "dev.readRefunds" }, { approval: "apr-1" }), /UNNEEDED/);
  await assert.rejects(go(SEED, { approval: "apr-1" }), /UNNEEDED/);
  const read = await go({ kind: "invoke", capability: "dev.readRefunds" });
  assert.deepEqual([read.outcome, o.calls.invoked[0].approved], ["succeeded", true]);
  await assert.rejects(go({ kind: "invoke", capability: "dev.unknown" }), /ACTION_CHECK: dev.unknown is not a capability/);
});

test("an expired approval allows nothing", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  await go(DEPLOY);
  apply(control(o), id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision });
  apply(o.w.ctx, id, "approval-expire", { approval: "apr-1" });
  await assert.rejects(go(DEPLOY, { approval: "apr-1" }), /NOT_GRANTED: apr-1 is expired/);
  assert.equal(o.calls.invoked.length, 0);
});
