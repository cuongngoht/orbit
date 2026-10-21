import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { planUnits, validateGraph } from "../src/goal/plan.mjs";
import { respond } from "../src/goal/replan.mjs";

const analysis = {
  objective: "Implement order management and tests",
  intent: { category: "change", workKinds: ["change", "verify"], capabilities: [], verification: [], dependencies: [], missing: [] },
  requirements: [{ id: "gr-11111111", kind: "explicit", statement: "rules", sourceRef: "spec@abcd#1" }],
  acceptance: [{ id: "ac-11111111", statement: "tests pass", sourceRef: "spec@abcd#2", requirementRef: "gr-11111111" }],
};

test("a goal whose reading names analysis, a change and verification yields three chained work units", () => {
  const big = { ...analysis, intent: { ...analysis.intent, workKinds: ["verify", "analyze", "change"] }, requirements: Array.from({ length: 5 }, (_, i) => ({ id: `gr-${i}`, kind: "explicit", statement: `r${i}`, sourceRef: `spec@abcd#${i}` })), acceptance: Array.from({ length: 10 }, (_, i) => ({ id: `ac-${i}`, statement: `ac${i}`, sourceRef: `spec@abcd#${i}` })) };
  const units = planUnits(big, "a".repeat(64));
  assert.deepEqual(units.map((u) => u.kind), ["analyze", "change", "verify"], "the table's order, never the order the reading listed them in");
  assert.deepEqual(units.map((u) => u.dependsOn.length), [0, 1, 1]);
  assert.equal(units[0].acceptanceRefs.length, 0, "analysis answers for no acceptance criterion while a unit that does exists");
  assert.equal(units[1].requirementRefs.length, 5, "the change carries the requirements");
});

test("an analysis with no structured intent is never planned on a guess", () => {
  const { intent, ...bare } = analysis;
  assert.throws(() => planUnits(bare, "a".repeat(64)), (e) => e instanceof Refused && e.code === "GOAL_INTENT_MISSING");
});

test("dependency cycle is refused", () => {
  assert.throws(() => validateGraph([{ id: "gu-a", dependsOn: ["gu-b"] }, { id: "gu-b", dependsOn: ["gu-a"] }]), Refused);
});

test("replan trigger can revise on failure", () => {
  const r = respond({ at: "failed", unit: { id: "gu-x", state: "failed" }, analysis, specDigest: "a".repeat(64), planN: 1, planId: "plan-1" });
  assert.equal(r.response, "retry-unit");
});
