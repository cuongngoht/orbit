import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeGoal, planGoal, startGoal } from "../src/goal/commands.mjs";
import { GOAL_SOURCE } from "../src/goal/source.mjs";
import { createGoals } from "../src/goal/store.mjs";
import { verifyGoal } from "../src/goal/commands.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ctx = { project: "acme-web", checkout: "co-111111111111", session: "s-1", host: "test" };

function ports(store) {
  const io = fakeIo();
  const goals = createGoals(store, io);
  return {
    ctx,
    io,
    goals,
    tasks: { list: () => [] },
    automation: { start: () => ({ id: "tsk-aaaaaaaaaaaa", objective: "stub" }) },
    taskSummaries: () => new Map(),
  };
}

test("fixture path: intake → analyze → plan → source projection", () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-e2e-"));
  const p = ports(store);
  const started = startGoal(p, "Ship Orbit RC\nAC1: goals persist\nAC2: verify gates\n");
  const digest = started.specDigest;
  const ref = `spec@${digest}`;
  analyzeGoal(p, started.id, {
    objective: "Deliver Orbit 1.9.0 RC",
    intent: { category: "change", workKinds: ["change", "verify"] },
    requirements: [],
    acceptance: [
      { id: "ac-11111111", statement: "goals persist", sourceRef: `${ref}#L1` },
      { id: "ac-22222222", statement: "verify gates", sourceRef: `${ref}#L2` },
    ],
    unknowns: [],
    conflicts: [],
  });
  const planned = planGoal(p, started.id);
  assert.ok(planned.units >= 1);
  const view = GOAL_SOURCE.open(store, p.io).read(started.id);
  assert.equal(view.id, started.id);
  assert.ok(view.acceptance.total >= 2);
  const gate = verifyGoal(p, started.id);
  assert.equal(gate.outcome, "partial");
});
