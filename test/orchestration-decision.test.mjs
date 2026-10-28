// Every rule a decision is judged by, each on its own -- and a refused decision writes NOTHING: the
// journal is byte for byte what it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/task/ops.mjs";
import { step } from "../src/orchestration/loop.mjs";
import { protocolOf } from "../src/orchestration/loop.mjs";
import { PLAN, decided, orchestrationWorld, prepared, testing } from "./fakes/orchestration.mjs";

async function refused(o, id, decision, rule) {
  const before = o.w.text(id);
  await assert.rejects(step(o.ports, id, decision), new RegExp(`^Refused: ${rule}:|${rule}:`));
  assert.equal(o.w.text(id), before, `${rule} wrote nothing`);
}

test("FORM: not a decision, a forbidden field, an unknown field, an unknown action -- each refused by name", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await prepared(o);
  const ok = decided(o.ports, id, PLAN);
  await refused(o, id, { ...ok, schemaVersion: 2 }, "SHAPE");
  await refused(o, id, "plan", "SHAPE");
  for (const word of ["outcome", "verdict", "stage", "signature", "confidence", "approved", "human"]) await refused(o, id, { ...ok, [word]: "x" }, "FORBIDDEN");
  await refused(o, id, { ...ok, chainOfThought: "…" }, "FIELDS");
  await refused(o, id, { ...ok, action: { kind: "shell", command: "rm -rf /" } }, "ACTION");
  await refused(o, id, { ...ok, action: "plan" }, "ACTION");
});

test("FRESH: text, evidence, a stale revision, a stage that does not allow it, an action's fields and its own check", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await prepared(o);
  const ok = decided(o.ports, id, PLAN);
  await refused(o, id, { ...ok, observed: "x".repeat(241) }, "TEXT");
  await refused(o, id, { ...ok, hypothesis: " " }, "TEXT");
  await refused(o, id, { ...ok, evidence: Array.from({ length: 17 }, (_, i) => `act-${i}`) }, "EVIDENCE");
  await refused(o, id, { ...ok, expectedRevision: ok.expectedRevision - 1 }, "STALE");
  await refused(o, id, { ...ok, action: { kind: "check", command: "rt-command-ffffffff" } }, "ACTION_CHECK");
  await refused(o, id, { ...ok, action: { kind: "review" } }, "STAGE");
  await refused(o, id, { ...ok, action: { ...PLAN, cmd: "x" } }, "FIELDS_OF_ACTION");
  await refused(o, id, { ...ok, action: { kind: "plan", intent: "x" } }, "FIELDS_OF_ACTION");
  await refused(o, id, { ...ok, action: { ...PLAN, scope: ["../outside"] } }, "ACTION_CHECK");
  await refused(o, id, { ...ok, action: { ...PLAN, scope: ["/etc/passwd"] } }, "ACTION_CHECK");
});

test("evidence must name what this task recorded: the task's own door refuses it, and nothing is written", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await prepared(o);
  await refused(o, id, decided(o.ports, id, PLAN, { evidence: ["check:chk-999"] }), "REFS");
});

test("ENDED, PAUSED and an action that never settled stop every decision", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await prepared(o);
  apply(o.w.ctx, id, "pause", { human: true, expected: o.w.view(id).revision });
  await refused(o, id, decided(o.ports, id, PLAN), "PAUSED");
  apply({ ...o.w.ctx, door: "control" }, id, "resume", { human: true, expected: o.w.view(id).revision });
  apply(o.w.ctx, id, "act-start", { type: "gather-context" });
  await refused(o, id, decided(o.ports, id, PLAN), "UNSETTLED");
  apply(o.w.ctx, id, "fail", { stop: "EXECUTION_FAILED", because: "a person gave up" });
  await refused(o, id, decided(o.ports, id, PLAN), "ENDED");
});

test("an approval that names nothing of this task, or one never granted, allows nothing", async (t) => {
  const o = orchestrationWorld(t, { capabilities: { "dev.seed": { mutates: true, effects: ["delete"], environment: "production", connection: null } } });
  const { id, go } = await testing(o);
  const seed = { kind: "invoke", capability: "dev.seed", input: {} };
  await refused(o, id, decided(o.ports, id, seed, { approval: "apr-9" }), "APPROVAL_UNKNOWN");
  await go(seed);
  apply(o.w.ctx, id, "reject", { approval: "apr-1", human: true, expected: o.w.view(id).revision });
  await refused(o, id, decided(o.ports, id, { ...seed, input: { other: true } }, { approval: "apr-1" }), "NOT_GRANTED");
});

test("the protocol is printed from the tables, so no playbook keeps a copy", () => {
  const p = protocolOf();
  assert.equal(p.schemaVersion, 1);
  assert.ok(p.rules.fresh.includes("STALE") && p.rules.form.includes("FORBIDDEN"));
  assert.ok(p.actions.some((a) => a.kind === "check" && a.required.includes("command")));
  assert.ok(p.stops.includes("NO_PROGRESS"));
});
