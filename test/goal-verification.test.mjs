import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { modelOf } from "../src/goal/model.mjs";
import { completionGate, recordAcVerification } from "../src/goal/verification.mjs";

const baseRecords = [
  { kind: "created", id: "goal-aaaaaaaaaaaa", title: "t", project: "p", checkout: "c", schema: 1 },
  { kind: "analyzed", id: "gan-1", objective: "o", requirements: [], acceptance: [{ id: "ac-1", statement: "must pass" }] },
  { kind: "planned", id: "gpl-1", plan: "plan-1", units: [{ id: "gu-1", state: "completed", dependsOn: [] }] },
];

test("completion refused without verified acceptance", () => {
  const model = modelOf(baseRecords);
  const gate = completionGate(model);
  assert.equal(gate.outcome, "partial");
});

test("verified AC requires evidence", () => {
  const model = modelOf(baseRecords);
  assert.throws(() => recordAcVerification(model, "ac-1", "verified", null), Refused);
});

test("all units and AC verified completes gate", () => {
  const records = [...baseRecords, { kind: "ac", id: "gac-1", ac: "ac-1", state: "verified", evidence: "tsk-1:verification" }];
  const gate = completionGate(modelOf(records));
  assert.equal(gate.outcome, "completed");
});
