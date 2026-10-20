// A mutation a person must allow: asked for, waited on, never granted by the agent that asked,
// granted once in Orbit Control's door, consumed once by exactly the action it names -- and a
// rejection is never turned into another try.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/task/ops.mjs";
import { contextOf } from "../src/orchestration/loop.mjs";
import { orchestrationWorld, testing } from "./fakes/orchestration.mjs";

const SEED = { kind: "invoke", capability: "dev.seedRefunds", input: { refunds: 3 } };

const world = (t) => orchestrationWorld(t, { capabilities: { "dev.seedRefunds": { mutates: true, connection: null }, "dev.readRefunds": { mutates: false, connection: null } } });

const control = (o) => ({ ...o.w.ctx, door: "control" });

test("a gated mutation: asked, WAITING_APPROVAL, never self-approved, approved once in Control, consumed once by the exact action, and a second use refused", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  const asked = await go(SEED, { reason: "integration verification needs refund rows in DEV" });
  assert.deepEqual([asked.state, asked.approval], ["waiting-approval", "apr-1"]);
  const view = o.w.view(id);
  assert.deepEqual([view.lifecycle, view.stopReason, view.approvals[0].action, view.approvals[0].environment], ["WAITING_APPROVAL", "HUMAN_APPROVAL_REQUIRED", "capability.invoke", "local"]);
  assert.equal(o.calls.invoked.length, 0, "nothing ran on the asking");
  assert.throws(() => apply(o.w.ctx, id, "approve", { approval: "apr-1", human: true, expected: view.revision }), /PERSON_UNPROVEN/, "the agent's own door cannot grant what it asked for");
  await assert.rejects(go(SEED, { approval: "apr-1" }), /WAITING/);
  apply(control(o), id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision });
  await assert.rejects(go({ ...SEED, input: { refunds: 300 } }, { approval: "apr-1" }), /OTHER_ACTION/, "a changed action cannot spend the approval");
  const ran = await go(SEED, { approval: "apr-1" });
  assert.deepEqual([ran.outcome, o.calls.invoked], ["succeeded", [{ id: "dev.seedRefunds", input: { refunds: 3 }, approved: true }]]);
  const kinds = o.w.kinds(id);
  assert.equal(kinds.lastIndexOf("approval-consumed") + 1, kinds.lastIndexOf("action-started"), "consumed BEFORE the action it allowed started");
  await assert.rejects(go(SEED, { approval: "apr-1" }), /NOT_GRANTED: apr-1 is consumed/);
  assert.equal(o.calls.invoked.length, 1);
});

test("a person's rejection is never asked again: the same action is refused, a different one may be asked", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  await go(SEED);
  apply(o.w.ctx, id, "reject", { approval: "apr-1", human: true, expected: o.w.view(id).revision, reason: "not on shared DEV" });
  await assert.rejects(go(SEED), /REJECTED/);
  await assert.rejects(go(SEED, { approval: "apr-1" }), /REJECTED/);
  const other = await go({ ...SEED, input: { refunds: 1 } });
  assert.deepEqual([other.state, other.approval], ["waiting-approval", "apr-2"]);
  assert.equal(o.calls.invoked.length, 0);
});

test("asking twice for one action is one request: the second step says which approval to wait for", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  await go(SEED);
  apply(control(o), id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision });
  await assert.rejects(go(SEED), /ASKED: apr-1 already asks for exactly this action \(granted\)/);
  assert.equal(contextOf(o.ports, id).approvals[0].state, "granted");
});

test("a capability that changes nothing needs no person -- and an approval sent with it is refused, not ignored", async (t) => {
  const o = world(t);
  const { go } = await testing(o);
  await assert.rejects(go({ kind: "invoke", capability: "dev.readRefunds" }, { approval: "apr-1" }), /UNNEEDED/);
  const read = await go({ kind: "invoke", capability: "dev.readRefunds" });
  assert.deepEqual([read.outcome, o.calls.invoked[0].approved], ["succeeded", false]);
  await assert.rejects(go({ kind: "invoke", capability: "dev.unknown" }), /ACTION_CHECK: dev.unknown is not a capability/);
});

test("an expired approval allows nothing", async (t) => {
  const o = world(t);
  const { id, go } = await testing(o);
  await go(SEED);
  apply(control(o), id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision });
  apply(o.w.ctx, id, "approval-expire", { approval: "apr-1" });
  await assert.rejects(go(SEED, { approval: "apr-1" }), /NOT_GRANTED: apr-1 is expired/);
  assert.equal(o.calls.invoked.length, 0);
});
