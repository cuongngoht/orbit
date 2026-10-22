// A generated test's verdict is a compiled predicate (ADR 0038): every EXPECT_OPS template has one
// row that judges it, a path reads only what the answer said, an absence or a deadline on an
// observation that did not stay complete is UNDECIDED and blocks, and nothing a predicate holds is
// ever run -- under a design, an inline expression is refused before it is evaluated, and a
// predicate the design did not pin is the test's error, never a pass.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Blocked, Refused, StepError } from "../src/errors.mjs";
import { EXPECT_OPS } from "../src/qa/vocab.mjs";
import { COMPILED_PREFIX, HOLDS, TEMPLATES, UNDECIDED, VIOLATED, predicateDigest, predicateFindings, renderOf, valuesAt } from "../src/run/evaluator.mjs";
import { verdict } from "../src/run/verdict.mjs";
import { TEMPLATE_SHAPES } from "../src/predicate.mjs";

const outcome = (tree, it) => {
  try {
    verdict({ i: 1, expect: renderOf(tree) }, it);
    return HOLDS;
  } catch (e) {
    if (e instanceof StepError) return VIOLATED;
    if (e instanceof Blocked) return UNDECIDED;
    throw e;
  }
};

test("every template an EXPECT_OPS row names has exactly one row here, and nothing else but all", () => {
  assert.deepEqual(Object.keys(TEMPLATES).filter((t) => t !== "all").sort(), [...new Set(EXPECT_OPS.map((o) => o.template))].sort());
  assert.deepEqual(Object.keys(TEMPLATES).sort(), Object.keys(TEMPLATE_SHAPES).sort(), "one judge per template the predicate format declares");
});

test("each template holds, is violated, and -- where the answer cannot say -- stays undecided", () => {
  const answer = { status: 404, body: { error: "not_found" }, schema: true, messages: [{ id: "m-1" }, { id: "m-2" }], completeness: "complete", text: "Acme Synthetic (120)", count: 1 };
  const rows = [
    [{ template: "value-eq", path: "status", value: 404 }, HOLDS],
    [{ template: "value-eq", path: "status", value: 200 }, VIOLATED],
    [{ template: "value-eq", path: "missing", value: 1 }, UNDECIDED],
    [{ template: "value-in", path: "body.error", values: ["not_found", "forbidden"] }, HOLDS],
    [{ template: "value-excludes", path: "body", value: "tenant-b" }, HOLDS],
    [{ template: "value-excludes", path: "messages", value: "m-2" }, VIOLATED],
    [{ template: "value-includes", path: "text", value: "Acme" }, HOLDS],
    [{ template: "value-includes", path: "text", value: "Zeta" }, VIOLATED],
    [{ template: "value-includes", path: "count", value: "1" }, VIOLATED],
    [{ template: "count-eq", path: "messages[]", value: 2 }, HOLDS],
    [{ template: "count-at-most", path: "messages[].id", value: 1 }, VIOLATED],
    [{ template: "schema-valid", path: "schema" }, HOLDS],
    [{ template: "order-eq", path: "messages[].id", values: ["m-1", "m-2"] }, HOLDS],
    [{ template: "order-eq", path: "messages[].id", values: ["m-2", "m-1"] }, VIOLATED],
    [{ template: "complete", path: "messages[].id", value: "m-2", completeness: "completeness" }, HOLDS],
    [{ template: "absent-within", path: "messages[].id", value: "m-9", completeness: "completeness" }, HOLDS],
    [{ template: "absent-within", path: "messages[].id", value: "m-1", completeness: "completeness" }, VIOLATED],
    [{ template: "all", of: [{ template: "value-eq", path: "status", value: 404 }, { template: "count-eq", path: "messages[]", value: 2 }] }, HOLDS],
    [{ template: "all", of: [{ template: "value-eq", path: "status", value: 404 }, { template: "value-eq", path: "nope", value: 1 }] }, UNDECIDED],
  ];
  for (const [tree, want] of rows) assert.equal(outcome(tree, answer), want, JSON.stringify(tree));
});

test("an absence, or a deadline, on an observation that did not stay complete is never decided", () => {
  const partial = { messages: [{ id: "m-1" }], completeness: "partial" };
  assert.equal(outcome({ template: "absent-within", path: "messages[].id", value: "m-9", completeness: "completeness" }, partial), UNDECIDED);
  assert.equal(outcome({ template: "complete", path: "messages[].id", value: "m-9", completeness: "completeness" }, partial), UNDECIDED, "not seen yet, and the window did not close complete: no contradiction");
  assert.equal(outcome({ template: "complete", path: "messages[].id", value: "m-9", completeness: "completeness" }, { ...partial, completeness: "complete" }), VIOLATED, "a window that closed complete without it is a contradiction");
  assert.throws(() => verdict({ i: 1, expect: renderOf({ template: "absent-within", path: "messages[].id", value: "m-9", completeness: "completeness" }) }, partial), (e) => e instanceof Blocked && e.helperClass === "incomplete");
});

test("a path reads only what the answer said: a list it does not have is unknown, never empty; a prototype is never read", () => {
  assert.deepEqual(valuesAt({ messages: [] }, "messages[]"), { known: true, list: true, values: [] });
  assert.equal(valuesAt({}, "messages[]").known, false);
  assert.deepEqual(valuesAt({ messages: [{ id: "a" }, {}] }, "messages[].id").values, ["a", null]);
  assert.equal(valuesAt({}, "constructor").known, false, "an own property only");
  assert.match(predicateFindings({ template: "value-eq", path: "constructor.constructor", value: 1 }).join(), /is not a dot path/);
  assert.match(predicateFindings({ template: "value-eq", path: "__proto__", value: 1 }).join(), /is not a dot path/);
});

test("what is not a predicate is said before anything is judged", () => {
  const says = (tree) => predicateFindings(tree).join(" | ");
  assert.match(says({ template: "eval", path: "x" }), /not a template this evaluator answers/);
  assert.match(says({ template: "value-eq", path: "x" }), /value-eq needs value/);
  assert.match(says({ template: "value-eq", path: "a[].b", value: 1 }), /rules on one value, and a\[\]\.b is a list/);
  assert.match(says({ template: "value-eq", path: "x", value: "${TOKEN}" }), /placeholder/);
  assert.match(says({ template: "value-eq", path: "x", value: 1, code: "process.exit()" }), /"code" is not a field a predicate has/);
  assert.match(says({ template: "count-eq", path: "x[]", value: -1 }), /whole number/);
  const deep = (n) => (n ? { template: "all", of: [deep(n - 1)] } : { template: "value-eq", path: "x", value: 1 });
  assert.match(says(deep(5)), /deep/);
  assert.match(says({ template: "value-eq", path: "x", value: "y".repeat(17_000) }), /more than/);
});

test("nothing a compiled predicate holds is run, and under a design an inline expression is refused before it is evaluated", () => {
  delete globalThis.__orbitPwned;
  const bait = { template: "value-eq", path: "status", value: "globalThis.__orbitPwned = true" };
  assert.equal(outcome(bait, { status: 200 }), VIOLATED, "the value is data, compared, never evaluated");
  const design = { evaluation: { mode: "compiled", digests: { 1: predicateDigest(bait) } } };
  assert.throws(() => verdict({ i: 1, expect: "(globalThis.__orbitPwned = true)" }, {}, design), (e) => e instanceof Refused && /not a compiled predicate/.test(e.message));
  assert.equal(globalThis.__orbitPwned, undefined, "the inline expression never ran");
});

test("under a design, only the predicate the design pinned for that step is judged -- an edited assertion is the test's error", () => {
  const tree = { template: "value-eq", path: "status", value: 404 };
  const design = { evaluation: { mode: "compiled", digests: { 3: predicateDigest(tree) } } };
  assert.equal(verdict({ i: 3, expect: renderOf(tree) }, { status: 404 }, design).status, 404);
  const weakened = { template: "value-in", path: "status", values: [200, 404] };
  assert.throws(() => verdict({ i: 3, expect: renderOf(weakened) }, { status: 200 }, design), (e) => e instanceof Refused && /not the one its design pinned/.test(e.message));
  assert.throws(() => verdict({ i: 4, expect: renderOf(tree) }, { status: 404 }, design), (e) => e instanceof Refused && /pinned none for this step/.test(e.message));
  assert.throws(() => verdict({ i: 3, expect: `${COMPILED_PREFIX}{not json` }, {}, design), (e) => e instanceof Refused);
});

test("a person's inline expect is judged as it always was", () => {
  assert.deepEqual(verdict({ expect: "it.n === 1" }, '{"n":1}'), { n: 1 });
  assert.throws(() => verdict({ expect: "it.n === 2" }, { n: 1 }), StepError);
});
