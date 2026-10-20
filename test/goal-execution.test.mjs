import assert from "node:assert/strict";
import { test } from "node:test";
import { bindAutomationStart, readyUnit, viewOf } from "../src/goal/execute.mjs";

test("bindAutomationStart clips objective for automation task", () => {
  const model = viewOf([
    { kind: "created", id: "goal-cccccccccccc", title: "t", project: "p", checkout: "c", schema: 1 },
    { kind: "analyzed", id: "gan-1", objective: "short", requirements: [], acceptance: [] },
    { kind: "planned", id: "gpl-1", plan: "plan-1", units: [{ id: "gu-1", title: "Do work", state: "ready", dependsOn: [], workflow: "engineering" }] },
  ]);
  const unit = readyUnit(model);
  const spec = bindAutomationStart(unit, model.analyzed);
  assert.ok(spec.objective.length <= 240);
  assert.equal(spec.unit, "gu-1");
});
