import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { planUnits, validateGraph } from "../src/goal/plan.mjs";
import { respond } from "../src/goal/replan.mjs";

const analysis = {
  objective: "Implement order management and tests",
  requirements: [{ id: "gr-11111111", kind: "explicit", statement: "rules", sourceRef: "spec@abcd#1" }],
  acceptance: [{ id: "ac-11111111", statement: "tests pass", sourceRef: "spec@abcd#2", requirementRef: "gr-11111111" }],
};

test("large PBI yields multiple work units", () => {
  const big = { ...analysis, requirements: Array.from({ length: 5 }, (_, i) => ({ id: `gr-${i}`, kind: "explicit", statement: `r${i}`, sourceRef: `spec@abcd#${i}` })), acceptance: Array.from({ length: 10 }, (_, i) => ({ id: `ac-${i}`, statement: `ac${i}`, sourceRef: `spec@abcd#${i}` })) };
  const units = planUnits(big, "a".repeat(64));
  assert.ok(units.length >= 2);
});

test("dependency cycle is refused", () => {
  assert.throws(() => validateGraph([{ id: "gu-a", dependsOn: ["gu-b"] }, { id: "gu-b", dependsOn: ["gu-a"] }]), Refused);
});

test("replan trigger can revise on failure", () => {
  const r = respond({ at: "failed", unit: { id: "gu-x", state: "failed" }, analysis, specDigest: "a".repeat(64), planN: 1, planId: "plan-1" });
  assert.equal(r.response, "retry-unit");
});
