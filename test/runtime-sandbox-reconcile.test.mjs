// A preparation that died in the middle is recognised by what it wrote BEFORE it acted, judged by age, and never
// run again by itself when it may have half-run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECONCILE, STILL_RUNNING_MS, reconciled } from "../src/runtime/sandbox/reconcile.mjs";
import { createOperations } from "../src/runtime/sandbox/operations.mjs";
import { operationsRoom, sandboxLiveRoom } from "../src/runtime/rooms.mjs";
import { sandboxWorld } from "./sandbox.harness.mjs";

const opsOf = (ctx) => createOperations(operationsRoom(sandboxLiveRoom(ctx.rooms.live, ctx.envId)), ctx.io, ctx.now);

const withDoc = (w, over = {}) => (w.sandbox().sandboxes.write({ ...w.sandbox().sandboxDoc(), ...over }), w.sandbox());

test("an operation is on record BEFORE it acts, settled after, and keeps no output, argument or path", () => {
  const w = sandboxWorld();
  const ops = opsOf(w.sandbox());
  const op = ops.begin("restore", { fingerprint: "a".repeat(64) });
  assert.deepEqual(ops.open().map((o) => [o.kind, o.state]), [["restore", "STARTED"]]);
  ops.settle(op, "FAILED", "exit 1");
  assert.deepEqual(ops.open(), []);
  assert.deepEqual(Object.keys(ops.list()[0]).sort(), ["at", "because", "fingerprint", "id", "kind", "schema", "settledAt", "state"]);
});

test("an operation younger than the longest thing a preparation does is left alone -- it may still be running", () => {
  const w = sandboxWorld();
  const ctx = withDoc(w, { state: "PREPARING" });
  opsOf(ctx).begin("prepare");
  const out = reconciled(ctx, { apply: true });
  assert.deepEqual([out.outcome, out.rule], ["RUNNING", "STILL_RUNNING"]);
  assert.equal(opsOf(ctx).open().length, 1, "nothing was settled under a live process");
});

test("a restore that died is AMBIGUOUS and is never run again by itself; a preparation that died is safe to try again", () => {
  const w = sandboxWorld();
  const ctx = withDoc(w, { state: "PREPARING" });
  opsOf(ctx).begin("restore", { fingerprint: "a".repeat(64) });
  w.clockState.ms += STILL_RUNNING_MS + 1000;
  const dead = reconciled(ctx, { apply: true });
  assert.deepEqual([dead.outcome, dead.state], ["AMBIGUOUS", "AMBIGUOUS"]);
  assert.equal(ctx.sandboxes.read(ctx.envId).state, "AMBIGUOUS");
  assert.deepEqual(opsOf(ctx).open(), [], "what died is settled, so it is never read as running");
  const other = sandboxWorld();
  const ctx2 = withDoc(other, { state: "PREPARING" });
  opsOf(ctx2).begin("prepare");
  other.clockState.ms += STILL_RUNNING_MS + 1000;
  assert.deepEqual([reconciled(ctx2, { apply: true }).outcome, ctx2.sandboxes.read(ctx2.envId).state], ["RETRYABLE", "PREPARING"]);
});

test("reading says what applying would do and changes nothing; a sandbox waiting on a person is waiting, not crashed", () => {
  const w = sandboxWorld();
  const ctx = withDoc(w, { state: "PREPARING", blocked: { needs: "person", because: "trust it", at: "t" } });
  assert.deepEqual([reconciled(ctx).outcome, reconciled(ctx).rule], ["BLOCKED", "WAITING"]);
  const quiet = withDoc(sandboxWorld(), { state: "READY" });
  assert.equal(reconciled(quiet).rule, "SETTLED");
});

test("every row is reachable in order and the last always matches", () => {
  assert.deepEqual(RECONCILE.map((r) => r.name), ["SETTLED", "STILL_RUNNING", "RESTORE_DIED", "DISPATCH_DIED", "OPERATION_DIED", "WAITING", "NOTHING_OPEN"]);
  assert.ok(RECONCILE.every((r) => typeof r.say({ doc: { blocked: { needs: "x", because: "y" } } }) === "string") && RECONCILE.at(-1).when({}));
});

test("preparing again after a crash does the reconciling first: a half-run restore is AMBIGUOUS, waits on a person, and is not restored twice", async () => {
  const w = sandboxWorld();
  const ctx = withDoc(w, { state: "PREPARING" });
  opsOf(ctx).begin("restore", { fingerprint: "a".repeat(64) });
  w.clockState.ms += STILL_RUNNING_MS + 1000;
  const out = await w.run("sandbox-prepare");
  assert.deepEqual([out.state, out.blocked.needs], ["BLOCKED", "person"]);
  assert.match(out.blocked.because, /half-run/);
  assert.equal(ctx.sandboxes.read(ctx.envId).state, "AMBIGUOUS");
  assert.deepEqual(w.process.calls.filter((c) => ["npm", "dotnet"].includes(c.file)), [], "nothing was restored on top of it");
  assert.equal((await w.run("sandbox-release")).released, true, "a person's release is the way out");
  assert.equal((await w.run("sandbox-prepare")).blocked?.needs, "person", "and the next sandbox starts afresh -- here it waits only for the trust it needs");
});
