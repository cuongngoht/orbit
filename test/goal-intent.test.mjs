// AC-01 (0.0.4): a goal is planned from the host model's STRUCTURED reading of it, validated, and never from the words
// of its objective -- so the same goal written in Vietnamese and in English plans the same units, starts the same
// workflows and asks for the same capabilities. And a reading that is short of something leaves the unit it stops
// UNRESOLVED instead of starting it on a guess.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAnalysis } from "../src/goal/analyze.mjs";
import { bindAutomationStart } from "../src/goal/execute.mjs";
import { lifecycleOf } from "../src/goal/lifecycle.mjs";
import { frontierOf, modelOf } from "../src/goal/model.mjs";
import { planUnits } from "../src/goal/plan.mjs";
import { analyzeGoal, planGoal, startGoal } from "../src/goal/commands.mjs";
import { createGoals } from "../src/goal/store.mjs";
import { WORK_KINDS } from "../src/goal/vocab.mjs";
import { planFor, start } from "../src/automation/loop.mjs";
import { INTENTS } from "../src/routing/intents.mjs";
import { Refused } from "../src/errors.mjs";
import { automationWorld } from "./fakes/automation.mjs";
import { fakeIo } from "./fakes/io.mjs";

const VI = "a".repeat(64);
const EN = "b".repeat(64);

const reading = { category: "procedure", workKinds: ["procedure", "verify"], capabilities: ["release.quality.verification"], verification: ["every declared quality check ran and each one is reported"], dependencies: [], missing: [] };

const vietnamese = { objective: "Tạo quy trình kiểm tra chất lượng trước khi phát hành.", intent: reading, requirements: [{ statement: "Quy trình chạy mọi kiểm tra chất lượng đã khai báo", sourceRef: `spec@${VI}#L1` }], acceptance: [{ statement: "Mỗi kiểm tra có kết quả được ghi lại", sourceRef: `spec@${VI}#L2` }], unknowns: [], conflicts: [] };

const english = { objective: "Create a pre-release quality verification workflow.", intent: reading, requirements: [{ statement: "The workflow runs every declared quality check", sourceRef: `spec@${EN}#L1` }], acceptance: [{ statement: "Every check has a recorded result", sourceRef: `spec@${EN}#L2` }], unknowns: [], conflicts: [] };

// What a unit MEANS, with its ids and its language left out: the kind, the routing intent, the capabilities, whether it
// settles the work item, where it waits, how many criteria it answers for, and the state it starts in.
const meaning = (units) => units.map((u, i) => ({ kind: u.kind, intent: u.intent, capabilities: u.capabilities, takesRef: u.takesRef, waitsFor: u.dependsOn.map((d) => units.findIndex((x) => x.id === d)), accepts: u.acceptanceRefs.length, requirements: u.requirementRefs.length, state: u.state, at: i }));

const started = (unit, analysis) => (({ objective, ...rest }) => rest)(bindAutomationStart(unit, analysis, { ref: "PBI-1", goal: "goal-0123456789ab" }));

test("AC-01: the Vietnamese and the English goal read the same way plan the same units", () => {
  const vi = validateAnalysis(vietnamese, VI);
  const en = validateAnalysis(english, EN);
  assert.deepEqual(vi.intent, en.intent, "one reading, two languages");
  const viUnits = planUnits(vi, VI);
  const enUnits = planUnits(en, EN);
  assert.deepEqual(meaning(viUnits), meaning(enUnits));
  assert.deepEqual(viUnits.map((u) => u.kind), ["procedure", "verify"]);
  assert.deepEqual(viUnits[0].capabilities, ["release.quality.verification"], "the procedure carries the capability it provides");
});

test("AC-01: their units start the same coordinated workflows, with nothing classified from their words", () => {
  const [vi, en] = [validateAnalysis(vietnamese, VI), validateAnalysis(english, EN)];
  const [viUnits, enUnits] = [planUnits(vi, VI), planUnits(en, EN)];
  const viStarts = viUnits.map((u) => started(u, vi));
  const enStarts = enUnits.map((u) => started(u, en));
  assert.deepEqual(viStarts.map(({ goal, unit, ...s }) => s), enStarts.map(({ goal, unit, ...s }) => s));
  assert.deepEqual(viStarts[0], { ref: null, intent: "engineering", capabilities: ["release.quality.verification"], goal: `goal-0123456789ab:${viUnits[0].id}`, unit: viUnits[0].id }, "a procedure settles no work item, and declares its routing intent");
});

test("AC-01: the automation plan of each unit is the same plan, and the classifier is never asked", (t) => {
  const plans = [vietnamese, english].map((a, i) => {
    const o = automationWorld(t, { resolved: { "release.quality.verification": { capability: "release.quality.verification", outcome: "gap", remedy: "prepare", status: "unprovided", provider: null, why: "nothing provides it" } }, gap: { kind: "workflow", word: "VERIFICATION_GAP", generates: true, shape: "verification", because: "nothing here provides it" } });
    o.ports.classify = () => assert.fail("a declared intent is never classified from the objective's words");
    const analysis = validateAnalysis(a, i ? EN : VI);
    const unit = planUnits(analysis, i ? EN : VI)[0];
    return planFor(o.ports, { ...bindAutomationStart(unit, analysis, {}), capabilities: unit.capabilities }).plan;
  });
  const shape = (p) => ({ workflow: p.workflow, intent: p.intent, steps: p.steps.map((s) => ({ id: s.id, kind: s.kind, after: s.after, for: s.for ?? null })) });
  assert.deepEqual(shape(plans[0]), shape(plans[1]));
  assert.equal(plans[0].workflow, "playbook");
  assert.deepEqual(plans[0].steps.map((s) => s.kind), ["context", "propose-skill", "register-skill", "playbook"], "the gap is a workflow gap the factory may close, planned whole");
});

test("every work kind declares a routing intent the routing table has", () => {
  const ids = new Set(INTENTS.map((r) => r.id));
  for (const k of WORK_KINDS) assert.ok(ids.has(k.intent), `${k.id} declares ${k.intent}`);
});

test("a reading is judged as it was SENT: unknown and engine-owned fields are refused, never dropped", () => {
  const bad = [
    [{ ...english, intent: undefined }, /intent is required/],
    [{ ...english, confidence: "high" }, /unknown field "confidence"/],
    [{ ...english, digest: "x" }, /digest is the engine's to say/],
    [{ ...english, intent: { ...reading, workKinds: [] } }, /workKinds is 1 to/],
    [{ ...english, intent: { ...reading, workKinds: ["verify", "verify"] } }, /different kinds of work/],
    [{ ...english, intent: { ...reading, workKinds: ["deploy"] } }, /each one of/],
    [{ ...english, intent: { ...reading, category: "anything" } }, /category is one of/],
    [{ ...english, intent: { ...reading, capabilities: ["Release Checks"] } }, /capability word/],
    [{ ...english, intent: { ...reading, verdict: "pass" } }, /unknown field "verdict"/],
    [{ ...english, intent: { ...reading, missing: [{ statement: "x", blocks: ["nothing"] }] } }, /prerequisite/],
    [{ ...english, intent: { ...reading, dependencies: ["password=hunter2hunter2"] } }, /secret/],
  ];
  for (const [raw, says] of bad) assert.throws(() => validateAnalysis(raw, EN), (e) => e instanceof Refused && says.test(e.message), String(says));
});

test("a missing prerequisite leaves the unit it blocks UNRESOLVED, never started, and the goal waits for a person", () => {
  const analysis = validateAnalysis({ ...english, intent: { ...reading, missing: [{ statement: "which environment the release is checked in", blocks: ["verify"] }] } }, EN);
  const units = planUnits(analysis, EN);
  assert.deepEqual(units.map((u) => u.state), ["ready", "unresolved"]);
  assert.match(units[1].because, /which environment/);
  const model = modelOf([{ kind: "created", id: "goal-0123456789ab", schema: 1 }, { kind: "analyzed", ...analysis }, { kind: "planned", id: "gpl-1", plan: "plan-1", units }, { kind: "unit", unit: units[0].id, state: "completed" }]);
  assert.deepEqual(frontierOf(model), [], "an unresolved unit is never ready");
  assert.equal(lifecycleOf(model), "waiting-input");
});

test("a procedure whose reading names no capability is unresolved: nothing would say what it provides", () => {
  const analysis = validateAnalysis({ ...english, intent: { ...reading, capabilities: [] } }, EN);
  const [procedure] = planUnits(analysis, EN);
  assert.equal(procedure.state, "unresolved");
  assert.match(procedure.because, /names none/);
});

test("planning again after a new analysis is plan-2: plan-1 is never written over", () => {
  const io = fakeIo();
  const goals = createGoals("/store/acme", io);
  const p = { ctx: { project: "acme", checkout: "co-111111111111", session: "s", host: "test" }, io, goals };
  const g = startGoal(p, "Create a pre-release quality verification workflow.\nAC1: every check is recorded\n");
  analyzeGoal(p, g.id, { ...english, requirements: [], acceptance: [{ statement: "every check is recorded", sourceRef: `spec@${g.specDigest}#L2` }] });
  assert.equal(planGoal(p, g.id).plan, "plan-1");
  analyzeGoal(p, g.id, { ...english, intent: { ...reading, workKinds: ["procedure"] }, requirements: [], acceptance: [{ statement: "every check is recorded", sourceRef: `spec@${g.specDigest}#L2` }] });
  assert.equal(planGoal(p, g.id).plan, "plan-2");
  assert.ok(io.read(`${goals.dirOf(g.id)}/plan-1.json`), "the first plan's artifact is still there");
});

test("a goal unit's workflow links the goal back, and only that unit's workflow is picked up again", (t) => {
  const o = automationWorld(t, { intent: "qa", requirements: ["qa.execution"] });
  const spec = { objective: "Verify acceptance criteria and regression", intent: "qa", capabilities: [], goal: "goal-0123456789ab:gu-11111111" };
  const first = start(o.ports, spec);
  assert.equal(first.created, true);
  assert.ok(o.w.view(first.task).receipts.some((r) => r.domain === "goal" && r.ref === spec.goal && r.outcome === "LINKED"));
  assert.equal(start(o.ports, spec).task, first.task, "the same unit picks up its own workflow");
  o.w.tick(1);
  const other = start(o.ports, { ...spec, goal: "goal-ba9876543210:gu-22222222" });
  assert.notEqual(other.task, first.task, "another goal's unit with the same title is never handed this one");
});
