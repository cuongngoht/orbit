import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { validateAnalysis } from "../src/goal/analyze.mjs";
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

// What B21's review found (0.5.0), and closed: a host's `mandatory: false` on a criterion is never carried -- the
// analysis keeps only the fields its table declares -- so every criterion is held. A requirement is what its own source
// says, a host's reading is not that source, and nothing a host sends makes a criterion optional.
test("a host's word that a criterion is optional never makes it so: the stamp does not carry it, and the gate holds every criterion", () => {
  const digest = "c".repeat(64);
  const analysis = validateAnalysis({ objective: "Ship the refund rule", intent: { category: "change", workKinds: ["change"] }, requirements: [], acceptance: [{ statement: "refunds over thirty days need a manager", sourceRef: `spec@${digest}#L2`, mandatory: false }], unknowns: [], conflicts: [] }, digest);
  assert.equal("mandatory" in analysis.acceptance[0], false, "the stamp keeps only the fields its table declares");
  const records = [baseRecords[0], { kind: "analyzed", id: "gan-1", ...analysis }, baseRecords[2]];
  assert.deepEqual(completionGate(modelOf(records)), { outcome: "partial", because: "every mandatory acceptance criterion is verified on evidence", gate: "AC" }, "a criterion the host called optional is still held");
});
