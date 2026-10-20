import assert from "node:assert/strict";
import { test } from "node:test";
import { modelOf } from "../src/goal/model.mjs";
import { goalProjection } from "../src/goal/live.mjs";

test("goal projection reports coverage without fabricating active run", () => {
  const model = modelOf([
    { kind: "created", id: "goal-bbbbbbbbbbbb", title: "Orders", project: "p", checkout: "c", schema: 1 },
    { kind: "analyzed", id: "gan-1", objective: "o", requirements: [], acceptance: [{ id: "ac-1" }, { id: "ac-2" }] },
    { kind: "planned", id: "gpl-1", plan: "plan-1", units: [{ id: "gu-1", state: "ready", dependsOn: [] }] },
  ]);
  const p = goalProjection(model);
  assert.equal(p.lifecycle, "ready");
  assert.equal(p.active, false);
  assert.equal(p.acceptance.total, 2);
});
