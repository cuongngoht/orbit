// The compiler (ADR 0031, 0038; doc §14 #8): an accepted criterion's structured expectation
// becomes the predicate a generated test is judged by -- the template its op compiles to, the
// path the step's declared outputs put its meaning at, the value as its owner wrote it. What the
// host proposes is only which slot a step rules on; an assertion edited to `true`, or weakened,
// after the design pinned it is the test's error and never a pass.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused, StepError } from "../src/errors.mjs";
import { predicateDigest, renderOf } from "../src/predicate.mjs";
import { compileDesign, compiledAssertion } from "../src/qa/generation/compile.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { verdict } from "../src/run/verdict.mjs";

const HTTP = { status: "response.status", headers: "response.headers", body: "response.body", schema: "schema.valid", elapsedMs: "elapsed.ms" };
const AWAIT = { messages: { each: { id: "message.id", key: "message.key", correlation: "message.correlation", payload: "message.payload" } }, through: "cursor.through", completeness: "observation.completeness", gaps: "observation.gaps" };
const ROWS = { "[]": "effect.value" };
const OUTPUTS = { 2: HTTP, 3: AWAIT, 4: ROWS, 5: { count: "effect.count", rows: "effect.value" } };

const expectations = new Map([
  ["API-AC-2/E1", { id: "E1", property: "response.status", op: "eq", value: 404 }],
  ["API-AC-2/E2", { id: "E2", property: "response.body.error", op: "eq", value: "not_found" }],
  ["API-AC-2/E3", { id: "E3", property: "response.body", op: "excludes", value: "inv-tenant-a" }],
  ["FIX-ASYNC-1/E1", { id: "E1", property: "message.id", op: "absent-within", value: "msg-foreign", within: 30 }],
  ["FIX-ASYNC-1/E2", { id: "E2", property: "effect.count", op: "count-eq", value: 1 }],
  ["API-AC-1/E1", { id: "E1", property: "response.body", op: "conforms", value: "invoice-list" }],
]);

const context = (over = {}) => ({ expectations, outputsOf: (step) => OUTPUTS[step], shape: null, ...over });
const one = (a, over) => compiledAssertion(a, context(over));

test("a status compiles to value-eq on the field the step declares for it, with the owner's value -- never the host's", () => {
  const out = one({ criterionRef: "API-AC-2/E1", template: "value-eq", step: 2, value: 200 });
  assert.deepEqual(out.tree, { template: "value-eq", path: "status", value: 404, means: "response.status" });
  assert.deepEqual(one({ criterionRef: "API-AC-2/E2", template: "value-eq", step: 2 }).tree.path, "body.error", "a meaning inside a declared one");
  assert.equal(one({ criterionRef: "API-AC-1/E1", template: "schema-valid", step: 2 }).tree.path, "schema", "a schema is judged by whether the answer conformed");
});

test("an absence is compiled on an observation that can say it saw everything, within the criterion's own window", () => {
  const out = one({ criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 3 });
  assert.deepEqual(out.tree, { template: "absent-within", path: "messages[].id", value: "msg-foreign", completeness: "completeness", means: "message.id" });
  assert.deepEqual(out.window, { waitMs: 30_000 });
  const blind = one({ criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 3 }, { outputsOf: () => ({ messages: { each: { id: "message.id" } } }) });
  assert.match(blind.refused, /cannot say whether it saw everything/);
});

test("a count of effects answered only as rows counts the rows; a count field is read as itself", () => {
  assert.equal(one({ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 4 }).tree.path, "[]");
  assert.equal(one({ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 5 }).tree.path, "count");
});

test("what does not map is refused with its reason, never guessed", () => {
  assert.match(one({ criterionRef: "DRAFT-9/E1", template: "value-eq", step: 2 }).refused, /not an expectation of an ACCEPTED criterion/);
  assert.match(one({ criterionRef: "API-AC-2/E1", template: "value-in", step: 2 }).refused, /compiles to value-eq — not to value-in/);
  assert.match(one({ criterionRef: "API-AC-2/E1", template: "value-eq", step: 2 }, { shape: shapeOf("idempotent-under-repeat") }).refused, /does not rule with value-eq/);
  assert.match(one({ criterionRef: "API-AC-2/E1", template: "value-eq", step: 3 }).refused, /carries nothing that means response.status/);
  assert.match(one({ criterionRef: "API-AC-2/E1", template: "value-eq", step: 2 }, { outputsOf: () => ({ a: "response.status", b: "response.status" }) }).refused, /2 fields that mean response.status/);
});

const design = { assertions: [{ criterionRef: "API-AC-2/E1", template: "value-eq", step: 2 }, { criterionRef: "API-AC-2/E3", template: "value-excludes", step: 2 }, { criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 3 }, { criterionRef: "DRAFT-9/E1", template: "count-eq", step: 4 }] };

test("a design compiles each step's predicate whole, renders and digests it, and keeps the mapping verdict of every assertion", () => {
  const out = compileDesign(design, context());
  const tree = { template: "all", of: [one(design.assertions[0]).tree, one(design.assertions[1]).tree] };
  assert.deepEqual(out.steps["2"], { expect: renderOf(tree), digest: predicateDigest(tree), proves: "api" });
  assert.equal(compileDesign({ assertions: [{ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 4 }] }, context()).steps["4"].proves, "sql", "a count of durable effects proves the data layer");
  assert.equal(out.digests["2"], predicateDigest(tree));
  assert.equal(out.steps["4"], undefined, "a step with a refused assertion is judged by nothing compiled -- never by part of what it was meant to rule on");
  assert.deepEqual(out.mapping.map((m) => m.verdict), ["mapped", "mapped", "mapped", "refused"]);
  assert.deepEqual(out.windows, [{ step: 3, waitMs: 30_000 }]);
});

test("an assertion edited to true, or weakened, after the design pinned it is the test's error; the compiled one is judged", () => {
  const out = compileDesign(design, context());
  const underDesign = { evaluation: { mode: "compiled", digests: out.digests } };
  assert.throws(() => verdict({ i: 2, expect: "true" }, { status: 200 }, underDesign), (e) => e instanceof Refused);
  const weaker = renderOf({ template: "value-in", path: "status", values: [200, 404], means: "response.status" });
  assert.throws(() => verdict({ i: 2, expect: weaker }, { status: 200 }, underDesign), (e) => e instanceof Refused && /not the one its design pinned/.test(e.message));
  assert.deepEqual(verdict({ i: 2, expect: out.steps["2"].expect }, { status: 404, body: { error: "not_found" } }, underDesign).status, 404);
  assert.throws(() => verdict({ i: 2, expect: out.steps["2"].expect }, { status: 404, body: { owner: "inv-tenant-a" } }, underDesign), StepError, "a leak is a contradiction");
});

// What multi-step designs taught (0.1.0): a shape's templates bind only its own slots; a step no criterion speaks about
// is ruled on by what its own operation's answer shows; a fault control's witness is compiled from the control.
const ATTEMPTS = { attempts: { each: { messageId: "message.id", outcome: "settlement.outcome", terminalReason: "terminal.reason" } }, through: "cursor.through", completeness: "observation.completeness" };

test("a shape's templates bind its OWN slots, and an auxiliary slot compiles by its own op", () => {
  const shape = shapeOf("effect-once-per-key");
  const window = new Map([...expectations, ["FIX-ASYNC-1/E3", { id: "E3", property: "message.id", op: "complete-within", value: "msg-1", within: 120 }]]);
  assert.match(compiledAssertion({ criterionRef: "FIX-ASYNC-1/E3", template: "complete", step: 3 }, { expectations: window, outputsOf: (s) => OUTPUTS[s], shape, expected: ["FIX-ASYNC-1/E3"] }).refused, /does not rule with complete/, "its own slot is held to its shape");
  const aux = compiledAssertion({ criterionRef: "FIX-ASYNC-1/E3", template: "complete", step: 3 }, { expectations: window, outputsOf: (s) => OUTPUTS[s], shape, expected: ["FIX-ASYNC-1/E2"] });
  assert.deepEqual([aux.tree?.template, aux.window?.waitMs], ["complete", 120_000], "an auxiliary barrier rules with what its own op compiles to, within its own window");
});

test("an armed observer is ruled on by its baseline, and a fault's witness by the terminal reason the control declared", () => {
  const steps = [{ do: "call", capability: "orbit.messaging.observe", input: { channelRef: "c", observerRef: "o" } }, { do: "call", capability: "orbit.workload.control", input: { workloadRef: "w", request: { action: "fault", point: "p1" } } }, { do: "call", capability: "orbit.worker.observe", input: { workloadRef: "w", request: { count: 1, waitMs: 30_000 } } }];
  const outputs = { 1: { baseline: "cursor.baseline", completeness: "observation.completeness" }, 2: { status: "execution.status" }, 3: ATTEMPTS };
  const design = { skeleton: { steps }, assertions: [], controls: [{ role: "fault", point: "p1", step: 3 }, { role: "state" }] };
  const out = compileDesign(design, { expectations, outputsOf: (s) => outputs[s], shape: null, expected: [] });
  assert.deepEqual(out.mapping.map((m) => [m.step, m.structural, m.verdict]), [[3, "fault-witnessed", "mapped"], [1, "step-accepted", "mapped"], [2, "step-accepted", "mapped"]]);
  assert.match(out.steps["3"].expect, /"template":"complete".*"value":"fault:p1"|"value":"fault:p1".*"template":"complete"/, "the witness holds when the declared fault is seen, within its observation");
  assert.match(out.steps["1"].expect, /cursor\.baseline/);
});
