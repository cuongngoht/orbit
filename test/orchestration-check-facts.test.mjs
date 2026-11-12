// What stopped a check, through the whole step (0.6.0, P4): the Process port's code for a child that never started,
// and the facts the composition root hands in about a check that failed -- the workspace's dependency restore receipt
// and a fresh reach answer for what its component requires -- reach the failure's class, the check's record and the
// context a host reads. Asked only of a failure, and a failure to ask is no fact: the check's answer is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contextOf } from "../src/orchestration/loop.mjs";
import { BUILD, FAILING, PLAN, TEST, changed, fails, orchestrationWorld, prepared, unstarted } from "./fakes/orchestration.mjs";

async function failingCheck(t, script, facts) {
  const o = orchestrationWorld(t, { script, facts });
  const { id, go } = await prepared(o);
  await go(PLAN);
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  return { o, id, ran: await go({ kind: "check", command: TEST }) };
}

test("a check that never started carries the OS's code into its record, and a failed restore makes it DEPENDENCY", async (t) => {
  const asked = [];
  const { o, id, ran } = await failingCheck(t, { test: [unstarted("ENOENT")] }, async (command, at, answer) => (asked.push([command.id, at.task, answer.spawnCode]), { restore: { ok: false, status: 1 }, unreachable: [] }));
  assert.deepEqual([ran.failure.class, ran.failure.confidence], ["DEPENDENCY", "high"]);
  assert.match(ran.failure.because, /restoring its dependencies in this workspace failed \(exit 1\).*ENOENT/);
  assert.deepEqual(asked, [[TEST, id, "ENOENT"]], "asked once, of the failure, with the check and its task");
  assert.equal(o.roomOf(id).read(`checks/${ran.data.check}`).spawnCode, "ENOENT");
  assert.equal(contextOf(o.ports, id).latestFailure.class, "DEPENDENCY");
});

test("a check that ran and failed while a target its component requires is unreachable is ACCESS", async (t) => {
  const { ran } = await failingCheck(t, { test: [FAILING] }, async () => ({ restore: null, unreachable: [{ target: "orders-db", label: "orders database" }] }));
  assert.deepEqual([ran.failure.class, ran.failure.confidence], ["ACCESS", "high"]);
});

test("with no facts, or facts that cannot be asked, a failure is classed as before -- and a passing check asks nothing", async (t) => {
  const none = await failingCheck(t, { test: [unstarted("EACCES")] });
  assert.deepEqual([none.ran.failure.class, none.ran.failure.confidence], ["ENVIRONMENT", "high"]);
  assert.match(none.ran.failure.because, /EACCES: it is here, but not executable/);
  const broken = await failingCheck(t, { test: [fails("sh: 1: jest: not found", 127)] }, async () => { throw new Error("the store could not be read"); });
  assert.deepEqual([broken.ran.failure.class, broken.ran.failure.confidence, broken.ran.outcome], ["ENVIRONMENT", "low", "failed"], "the shell's own 127, read as a status, never as its words");
  let asked = 0;
  const passing = await failingCheck(t, {}, async () => (asked++, null));
  assert.deepEqual([passing.ran.outcome, asked], ["succeeded", 0]);
});
