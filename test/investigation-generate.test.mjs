// The GENERATE action (PBI 11): a design proposal for an obligation the journal holds becomes a
// draft, a frozen version and its validation -- or a `designed` record that failed with its word
// and stage. Every record is written once, so the same proposal twice is one design; and nothing
// runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { inputFindings } from "../src/capability/invoke.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { Refused } from "../src/errors.mjs";
import { ACTIONS } from "../src/investigation/dispatch.mjs";
import { generated } from "../src/investigation/generate.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ID = "inv-20261022-090000-abcd";
const caps = new Map(familyCapabilities().map((c) => [c.id, { ...c, from: "pack:orbit-backend-test" }]));
const call = (capability, input) => ({ do: "call", capability, input });
const STEPS = [
  call("orbit.scheduler.trigger", { scheduleRef: "billing-daily", fixtureRef: "fx", request: { occurrenceId: "billing-daily:2026-10-22T09:00:00+07:00" } }),
  call("orbit.state.read", { stateRef: "reminders", fixtureRef: "fx", request: { businessKey: "inv-a-1" } }),
];
const design = (over = {}) => ({ obligation: "tob-abc123", skeleton: { steps: STEPS }, assertions: [{ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 2 }], controls: [{ role: "positive" }], fixtureRefs: ["fx"], trigger: { kind: "schedule", ref: "billing-daily", step: 1 }, effectScope: "fixture", ...over });

function world() {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "one reminder per due occurrence" });
  store.appendOnce(ID, "obligation", { id: "obr-1", eventId: eventIdOf("obligation", "tob-abc123", 0, "r1"), obligation: "tob-abc123", revision: "r1", shape: "occurrence-one-execution" });
  const drafts = [];
  const graph = fakeContext().graph;
  const generation = {
    contextFor: () => ({ expectations: new Map([["FIX-ASYNC-1/E2", { id: "E2", property: "effect.count", op: "count-eq", value: 1 }]]), outputsOf: (step) => ({ 1: { executionRef: "execution.ref" }, 2: { count: "effect.count" } })[step], shape: { ...shapeOf("occurrence-one-execution"), controls: ["positive"] }, caseId: "gen-billing-once", title: "one reminder", validate: (c) => validate(c, graph, CORE, undefined, (id) => caps.get(id) ?? null), inputFindings: (s) => inputFindings(caps.get(s.capability), s.input), dsl: CORE, pageOf: (id) => caps.get(id)?.page }),
    saveDraft: (c) => drafts.push(c),
    versions: { engineVersion: "0.1.0", validatorVersion: "core", dslDigest: "d".repeat(64), extensionsDigest: "e".repeat(64) },
  };
  return { w: { id: ID, store, io, generation }, drafts, model: () => modelOf(store.read(ID)) };
}

test("a design that holds becomes a draft, a frozen version and its validation -- and runs nothing", () => {
  const t = world();
  const out = generated(t.w, { obligation: "tob-abc123", design: design() });
  assert.equal(out.outcome, "DRAFT_CREATED");
  assert.deepEqual(t.drafts.map((c) => c.id), ["gen-billing-once"]);
  const m = t.model();
  assert.deepEqual([m.designs.length, m.designs[0].state, m.versions.length, m.validations[0].state], [1, "designed", 1, "valid"]);
  assert.equal(m.versions[0].version, out.version);
  assert.match(out.version, /^gen-billing-once@[0-9a-f]{16}$/);
  const frozen = t.w.store.readVersion(ID, `versions/${out.version.split("@")[1]}/gen-billing-once.json`);
  assert.match(frozen.case.steps[1].expect, /^compiled:/);
});

test("the same proposal sent twice is the same design: nothing is written again", () => {
  const t = world();
  generated(t.w, { obligation: "tob-abc123", design: design() });
  generated(t.w, { obligation: "tob-abc123", design: design() });
  const m = t.model();
  assert.deepEqual([m.designs.length, m.versions.length, m.validations.length], [1, 1, 1]);
});

test("a design that does not hold is kept as designed-failed, with its word and its stage, and no draft", () => {
  const t = world();
  const out = generated(t.w, { obligation: "tob-abc123", design: design({ assertions: [{ criterionRef: "DRAFT-1/E1", template: "count-eq", step: 2 }] }) });
  assert.deepEqual([out.outcome, out.stage], ["REQUIRES_REQUIREMENT", "mapping"]);
  assert.equal(t.drafts.length, 0);
  const m = t.model();
  assert.equal(m.designs[0].state, "failed");
  assert.match(m.designs[0].why, /^REQUIRES_REQUIREMENT at mapping/);
});

test("an obligation the journal does not hold is refused, and generate is an action that mutates nothing", () => {
  const t = world();
  assert.throws(() => generated(t.w, { obligation: "tob-nope", design: design() }), (e) => e instanceof Refused && /not an obligation of/.test(e.message));
  assert.equal(ACTIONS.generate.mutates(), false);
  assert.match(ACTIONS.generate.check({ design: [] }), /one design proposal/);
  assert.throws(() => generated({ ...t.w, generation: undefined }, { obligation: "tob-abc123", design: design() }), (e) => e instanceof Refused && /cli\/autonomous-qa.mjs binds one/.test(e.message));
});
