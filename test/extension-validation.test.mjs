// A project's own validation rules, composed onto the end of the engine's.
//
// The alternative this replaces: an extension's needs being met by editing
// src/dsl/rules/semantic.mjs inside the installed plugin — which the next
// upgrade overwrites, and which would put one project's product knowledge into
// an engine that must not hold any.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { NO_VALIDATORS, createValidatorRegistry } from "../src/dsl/validators.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { Refused } from "../src/errors.mjs";
import { UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));

const CASE = { id: "x", _file: "/x.json", name: "x", seen: "src", steps: [{ do: "report", js: "1", expect: "true" }] };

const refusal = (fn) => {
  try { fn(); } catch (e) { return e; }
  return null;
};

function withRules(...rules) {
  const registry = createValidatorRegistry();
  registry.register(rules, "acme-probe");
  return registry;
}

test("an engine-only validation is unchanged when a project has registered nothing", () => {
  assert.deepEqual(validate(CASE, graph), []);
  assert.deepEqual(validate(CASE, graph, CORE, NO_VALIDATORS), []);
  assert.deepEqual(NO_VALIDATORS.ids(), []);
});

test("a case rule sees the whole case, and its finding is tagged with the rule that made it", () => {
  const seen = [];
  const rules = withRules({
    id: "needs-a-note",
    phase: "case",
    validate: ({ case: c, graph: g, dsl }) => { seen.push({ id: c.id, screens: g.screens.size, verbs: dsl.verbNames().length }); return c.note ? [] : [`${c.id}: this project requires a note on every case`]; },
  });
  const found = validate(CASE, graph, CORE, rules);
  assert.deepEqual(found, ["x: this project requires a note on every case (needs-a-note)"]);
  assert.equal(seen[0].id, "x");
  assert.ok(seen[0].screens > 0 && seen[0].verbs > 0, "it is handed the graph and the effective vocabulary");
  assert.deepEqual(validate({ ...CASE, note: "checked" }, graph, CORE, rules), []);
});

test("a step rule is asked once per step and told which one it is looking at", () => {
  const at = [];
  const rules = withRules({
    id: "no-bare-selectors",
    phase: "step",
    validate: ({ step, at: i }) => { at.push(i); return step.selector ? [`step ${i + 1}: this project maps every control first`] : []; },
  });
  const twoSteps = { ...CASE, steps: [{ do: "click", selector: "#go" }, { do: "report", js: "1", expect: "true" }] };
  const found = validate(twoSteps, graph, CORE, rules);
  assert.deepEqual(at, [0, 1]);
  // A core rule fires on the same step ("click with no wait after it"), which is
  // the ordering this test wants anyway: core's findings first, the project's last.
  assert.equal(found.at(-1), "step 1: this project maps every control first (no-bare-selectors)");
  assert.ok(found.some((f) => /click with no wait after it/.test(f)), "and the engine's own rule still ran");
});

// Core first, always. A rule that ran ahead of the shape check would be a rule
// walking a container that might turn out to be a string.
test("the engine's own findings come first, and a broken shape stops before any extension rule", () => {
  const ran = [];
  const rules = withRules({ id: "never-reached", phase: "case", validate: () => { ran.push(1); return ["extension says so"]; } });
  const found = validate({ ...CASE, steps: { not: "an array" } }, graph, CORE, rules);
  assert.deepEqual(ran, [], "the shape guard is a hard stop");
  assert.ok(found.every((f) => !/extension says so/.test(f)));

  const both = validate({ ...CASE, id: "WRONG" }, graph, CORE, rules);
  assert.ok(/id does not look like/.test(both[0]), `core first, got: ${both[0]}`);
  assert.equal(both.at(-1), "extension says so (never-reached)", "and the extension's last");
});

// A generated rule with a bug in it condemns nobody's test.
test("a rule that throws reports ITSELF, and the case is not blamed for it", () => {
  const rules = withRules({ id: "buggy", phase: "case", validate: () => { throw new TypeError("cannot read x of undefined"); } });
  const found = validate(CASE, graph, CORE, rules);
  assert.equal(found.length, 1);
  assert.match(found[0], /acme-probe: validator buggy threw — cannot read x of undefined/);
  assert.match(found[0], /That is the extension's defect, not the case's/);
});

test("a rule that answers with nonsense is ignored rather than trusted", () => {
  const rules = withRules({ id: "confused", phase: "case", validate: () => ({ not: "an array" }) });
  assert.deepEqual(validate(CASE, graph, CORE, rules), []);
  const mixed = withRules({ id: "mixed", phase: "case", validate: () => ["real", 42, null] });
  assert.deepEqual(validate(CASE, graph, CORE, mixed), ["real (mixed)"]);
});

test("a malformed or duplicate rule is REFUSED at registration, not at validation time", () => {
  const registry = createValidatorRegistry();
  assert.match(refusal(() => registry.register({ id: "x" }, "acme")).message, /has no validate\(subject\)/);
  assert.match(refusal(() => registry.register({ id: "x", phase: "whenever", validate: () => [] }, "acme")).message, /phase must be case or step/);
  assert.match(refusal(() => registry.register("x", "acme")).message, /a validator is an object with an id/);
  registry.register({ id: "once", phase: "case", validate: () => [] }, "acme");
  const again = refusal(() => registry.register({ id: "once", phase: "case", validate: () => [] }, "someone-else"));
  assert.ok(again instanceof Refused, String(again));
  assert.match(again.message, /already registered by acme/);
});

test("the default registry cannot be registered into — a caller meaning core gets core", () => {
  assert.equal(NO_VALIDATORS.register({ id: "x", phase: "case", validate: () => [] }, "acme"), 0);
  assert.deepEqual(NO_VALIDATORS.where("case"), []);
});
