// A generated test, from a design proposal to the case that runs (doc §4.1 steps 3-4; PBI 11): the
// proposal is held whole -- its contract, the controls its shape needs, the asynchronous rules,
// the mapping of every assertion to an ACCEPTED criterion -- and the case the engine assembles is
// validated with the real grammar and every call's input against its capability. A repair may
// change how a test is written, never what it rules on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { inputFindings } from "../src/capability/invoke.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { compileDesign } from "../src/qa/generation/compile.mjs";
import { generatedCase } from "../src/qa/generation/design.mjs";
import { repairFindings } from "../src/qa/generation/repair.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { VERIFICATION_OUTCOME_IDS } from "../src/investigation/verification.mjs";
import { fakeContext } from "./fakes/context.mjs";

const caps = new Map(familyCapabilities().map((c) => [c.id, { ...c, from: "pack:orbit-backend-test" }]));
const AWAIT = { messages: { each: { id: "message.id", correlation: "message.correlation" } }, through: "cursor.through", completeness: "observation.completeness", gaps: "observation.gaps" };
const STATE = { count: "effect.count" };

const expectations = new Map([
  ["FIX-ASYNC-1/E1", { id: "E1", property: "message.id", op: "absent-within", value: "rem-tenant-b", within: 20 }],
  ["FIX-ASYNC-1/E2", { id: "E2", property: "effect.count", op: "count-eq", value: 1 }],
]);

const call = (capability, input) => ({ do: "call", capability, input });
const skeleton = (steps) => ({ steps });
const STEPS = [
  call("orbit.scheduler.trigger", { scheduleRef: "billing-daily", fixtureRef: "fx", request: { occurrenceId: "billing-daily:2026-10-22T09:00:00+07:00" } }),
  call("orbit.observe.await", { observerRef: "obs-1", request: { match: { correlationId: "inv-a-1" } } }),
  call("orbit.state.read", { stateRef: "reminders", fixtureRef: "fx", request: { businessKey: "inv-a-1" } }),
];
const TRIGGER = { executionRef: "execution.ref", occurrenceId: "occurrence.id", scheduledFor: "occurrence.scheduledFor", decision: "occurrence.decision" };

const proposal = (over = {}) => ({
  obligation: "tob-abc123",
  skeleton: skeleton(STEPS),
  assertions: [{ criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 2 }, { criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 3 }],
  controls: [{ role: "positive", why: "the due occurrence runs once" }, { role: "state", why: "one reminder, nothing else" }],
  fixtureRefs: ["fx"],
  trigger: { kind: "schedule", ref: "billing-daily", step: 1 },
  observationPlan: [{ observerRef: "obs-1", channelRef: "reminders", boundary: "publication", correlation: "the business key as correlation id" }],
  effectScope: "fixture",
  ...over,
});

const graph = fakeContext().graph;
const context = (over = {}) => ({
  expectations,
  outputsOf: (step) => ({ 1: TRIGGER, 2: AWAIT, 3: STATE })[step],
  semanticsOf: () => ({ observation: ["shadow-subscription"] }),
  observerSemantics: () => ({ observation: ["shadow-subscription"] }),
  shape: { ...shapeOf("occurrence-one-execution"), controls: ["positive", "state"], templates: ["count-eq", "absent-within"] },
  caseId: "gen-billing-once",
  title: "a due occurrence produces one reminder, and none for another tenant",
  validate: (c) => validate(c, graph, CORE, undefined, (id) => caps.get(id) ?? null),
  inputFindings: (s) => inputFindings(caps.get(s.capability), s.input),
  dsl: CORE,
  pageOf: (id) => caps.get(id)?.page,
  ...over,
});

test("a design that holds becomes a pageless case: every verdict compiled from an accepted criterion, each window from its own within", () => {
  const out = generatedCase(proposal(), context());
  assert.equal(out.ok, true, JSON.stringify(out.findings));
  assert.equal(out.channel, "pageless");
  assert.deepEqual(out.case.steps.map((s) => s.proves), ["api", "api", "sql"], "each verdict proves the layer of what it reads");
  assert.match(out.case.steps[1].expect, /^compiled:/);
  assert.equal(out.case.steps[1].input.request.waitMs, 20_000);
  assert.match(out.case.steps[0].expect, /"template":"value-present"/, "the trigger is ruled on by what its own answer shows when it was taken");
  assert.equal(out.case.seen, "src", "a generated case was written from source and has never run");
  assert.match(out.design.id, /^tds-[0-9a-f]{16}$/);
  assert.deepEqual(out.design.mapping.assertions.map((m) => [m.verdict, m.structural ?? m.criterionRef]), [["mapped", "FIX-ASYNC-1/E1"], ["mapped", "FIX-ASYNC-1/E2"], ["mapped", "trigger-accepted"]]);
  assert.deepEqual(out.design.temporalContract, { windows: [{ step: 2, waitMs: 20_000 }] });
  assert.deepEqual(out.digests, compileDesign(proposal(), context()).digests);
});

test("each stage stops a design with its own word, before the next is asked", () => {
  const stop = (p, cx) => ((r) => [r.stage, r.outcome])(generatedCase(p, cx ?? context()));
  assert.deepEqual(stop(proposal({ mapping: { assertions: [] } })), ["contract", "GENERATION_FAILED"], "a stamped field is refused by name");
  assert.deepEqual(stop(proposal({ controls: [{ role: "positive" }] })), ["controls", "GENERATION_FAILED"]);
  assert.deepEqual(stop(proposal({ observationPlan: [] })), ["rules", "GENERATION_FAILED"], "an await of an observer nothing armed");
  assert.deepEqual(stop(proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 2 }, { criterionRef: "DRAFT-1/E1", template: "count-eq", step: 3 }] })), ["mapping", "REQUIRES_REQUIREMENT"]);
  assert.deepEqual(stop(proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 2 }] })), ["verdicts", "GENERATION_FAILED"], "a read-back nothing accepted rules on");
  assert.deepEqual(stop(proposal({ skeleton: skeleton([...STEPS.slice(0, 2), call("orbit.state.read", { stateRef: "reminders", url: "http://x" })]) })), ["validate", "INVALID_TEST"], "an input the capability does not accept");
  assert.deepEqual(stop(proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 3 }] }), context({ expected: ["FIX-ASYNC-1/E1", "FIX-ASYNC-1/E2"] })), ["coverage", "GENERATION_FAILED"], "a design that leaves a slot of its own criterion unruled tests something else");
  for (const word of ["GENERATION_FAILED", "REQUIRES_REQUIREMENT", "INVALID_TEST"]) assert.ok(VERIFICATION_OUTCOME_IDS.includes(word), word);
});

test("a repair may change how a step is written, never what the test rules on", () => {
  const before = proposal();
  const relocated = proposal({ skeleton: skeleton(STEPS.map((s, i) => (i === 1 ? call("orbit.observe.await", { observerRef: "obs-1", request: { match: { messageId: "rem-1" } } }) : s))) });
  const digests = (p) => compileDesign(p, context()).digests;
  assert.deepEqual(repairFindings(before, relocated, { before: digests(before), after: digests(relocated) }), []);
  const weakened = proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 3 }] });
  assert.deepEqual(repairFindings(before, weakened, { before: digests(before), after: digests(weakened) }).map((f) => f.rule), ["ASSERTIONS", "PREDICATES"]);
  assert.deepEqual(repairFindings(before, proposal({ controls: [{ role: "positive" }] })).map((f) => f.rule), ["CONTROLS"]);
});
