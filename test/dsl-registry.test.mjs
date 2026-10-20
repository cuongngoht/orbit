// The effective vocabulary: core, plus what a project registered, and the rules
// that stop the second from quietly rewriting the first.
//
// Everything here is asserted against the TABLES rather than against expected
// prose, for the same reason test/query-dsl.test.mjs is: a new core verb or
// field has to be covered by its row alone.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { caseSchema } from "../src/dsl/schema.mjs";
import { CORE, LAYERS, createDslRegistry } from "../src/dsl/registry.mjs";
import { CORE_VERBS } from "../src/dsl/core/verbs.mjs";
import { CORE_STEP_FIELDS } from "../src/dsl/core/fields.mjs";
import { interpolateStep } from "../src/dsl/interpolate.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { Refused } from "../src/errors.mjs";
import { UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));

// One field and one verb a PROJECT might add: a read-only probe of something the
// engine has never heard of, ruling on the data layer.
const FIELD = { type: "string", esc: "sql", doc: "probe: the read-only statement to send." };
const VERB = { name: "probe", kind: "verdict", verdict: "always", proves: "sql", doc: "ask the store underneath and rule on the answer", needs: ["statement", "expect"], fields: ["statement", "expect"] };

function extended(from = "acme-probe") {
  const dsl = createDslRegistry();
  dsl.registerField("statement", FIELD, from);
  dsl.registerVerb(VERB, from);
  return dsl;
}

const caseWith = (steps) => ({ id: "x", _file: "/x.json", name: "x", seen: "src", steps });

const refusal = (fn) => {
  try { fn(); } catch (e) { return e; }
  return null;
};

test("a fresh registry answers exactly core, and knows it did not invent anything", () => {
  const dsl = createDslRegistry();
  assert.deepEqual(dsl.verbNames(), CORE_VERBS.map((v) => v.name));
  assert.deepEqual(dsl.fieldNames(), Object.keys(CORE_STEP_FIELDS));
  assert.deepEqual(dsl.added(), [], "nothing was registered, so nothing is attributed to anyone");
  assert.equal(dsl.sourceOf("sql"), "core");
  assert.equal(dsl.sourceOf("nonesuch"), null);
});

test("a registered verb is known to the registry, the schema and the validator alike", () => {
  const dsl = extended();
  assert.ok(dsl.has("probe"));
  assert.equal(dsl.sourceOf("probe"), "acme-probe");
  const step = { do: "probe", statement: "SELECT 1", expect: "it.length === 1" };
  const findings = validate(caseWith([step, { do: "report", js: "1", expect: "true" }]), graph, dsl);
  assert.deepEqual(findings, [], "the effective vocabulary is what the case is judged against");
  const schema = caseSchema(dsl);
  assert.ok(schema.definitions.step.properties.do.enum.includes("probe"), "the schema offers it");
  assert.ok(schema.definitions.step.properties.statement, "and the field it needs");
});

test("the same case is REFUSED by the engine's own vocabulary — an extension is a project's, not everyone's", () => {
  const step = { do: "probe", statement: "SELECT 1", expect: "it.length === 1" };
  const findings = validate(caseWith([step, { do: "report", js: "1", expect: "true" }]), graph);
  assert.ok(findings.some((f) => /unknown verb/.test(f)), findings.join("; "));
});

test("two registries cannot see each other — one project's words never reach another's", () => {
  const a = extended("project-a");
  const b = createDslRegistry();
  assert.ok(a.has("probe"));
  assert.ok(!b.has("probe"), "project B never registered it");
  assert.ok(!CORE.has("probe"), "and the engine's own vocabulary is untouched");
  assert.deepEqual(CORE.verbNames(), CORE_VERBS.map((v) => v.name));
});

test("a duplicate name is REFUSED and says who already owns it — never last-one-wins", () => {
  const dsl = extended("first");
  const again = refusal(() => dsl.registerVerb(VERB, "second"));
  assert.ok(again instanceof Refused, String(again));
  assert.match(again.message, /already defined by first/);
  const field = refusal(() => dsl.registerField("statement", FIELD, "second"));
  assert.match(field.message, /already defined by first/);
});

test("a core name is protected — an extension cannot redefine what the engine means by sql", () => {
  const dsl = createDslRegistry();
  const verb = refusal(() => dsl.registerVerb({ ...VERB, name: "sql" }, "acme"));
  assert.match(verb.message, /already defined by core/);
  const field = refusal(() => dsl.registerField("query", FIELD, "acme"));
  assert.match(field.message, /already defined by core/);
});

// The layers are denominators: qa/coverage.mjs divides by them and every report
// prints a column per layer. A project that could invent a fourth would change
// what every ratio in every other project's report means.
test("a layer is not extensible — a verb may only rule on one the engine already has", () => {
  const dsl = createDslRegistry();
  dsl.registerField("statement", FIELD, "acme");
  const bad = refusal(() => dsl.registerVerb({ ...VERB, proves: "queue" }, "acme"));
  assert.ok(bad instanceof Refused, String(bad));
  assert.match(bad.message, /proves must be/);
  assert.deepEqual(dsl.layers(), LAYERS, "and the set did not move");
});

test("a verdict that rules on nothing is REFUSED, not quietly uncounted", () => {
  const dsl = createDslRegistry();
  dsl.registerField("statement", FIELD, "acme");
  const { proves, ...noLayer } = VERB;
  const bad = refusal(() => dsl.registerVerb(noLayer, "acme"));
  assert.match(bad.message, /declares a verdict but no proves/);
});

test("a verb may only name fields that exist — a row promising one the schema never mentions", () => {
  const dsl = createDslRegistry();
  const bad = refusal(() => dsl.registerVerb(VERB, "acme"));
  assert.match(bad.message, /names field "statement", which no table defines/);
});

test("a malformed row is a sentence, not a TypeError six frames into a run", () => {
  const dsl = createDslRegistry();
  assert.match(refusal(() => dsl.registerVerb({ name: "x" }, "acme")).message, /no kind/);
  assert.match(refusal(() => dsl.registerVerb({ ...VERB, name: "Probe", fields: [], needs: [] }, "acme")).message, /does not look like/);
  assert.match(refusal(() => dsl.registerVerb({ ...VERB, kind: "guess", fields: [], needs: [] }, "acme")).message, /kind must be/);
  assert.match(refusal(() => dsl.registerVerb("probe", "acme")).message, /a verb must be an object/);
});

// escape.mjs's whole argument: a value spliced into text something else
// INTERPRETS has to declare which language, or it goes in raw.
test("an interpolated string field must declare the language it is read as", () => {
  const dsl = createDslRegistry();
  const { esc, ...noEsc } = FIELD;
  assert.match(refusal(() => dsl.registerField("statement", noEsc, "acme")).message, /must declare esc/);
  dsl.registerField("tenantKey", { type: "string", literal: true, doc: "names a tenant." }, "acme");
  assert.ok(dsl.literalFields().has("tenantKey"), "a field that NAMES something says so instead");
});

test("a registered field is escaped by its own declared language, like every core one", () => {
  const dsl = extended();
  const step = interpolateStep({ do: "probe", statement: "WHERE n = '${N}'" }, { N: "O'Brien" }, dsl);
  assert.equal(step.statement, "WHERE n = 'O''Brien'", "sql escaping, off the row");
  // A registry that has never heard of the field falls back to `text`, which is
  // the raw splice escape.mjs exists to prevent. That is not a hole -- a case
  // using an unregistered field is REFUSED by the validator long before a step
  // runs -- but it is exactly why registering the field is what buys the
  // escaping, and why `esc` is required of every interpolated string row.
  const raw = interpolateStep({ do: "probe", statement: "WHERE n = '${N}'" }, { N: "O'Brien" });
  assert.equal(raw.statement, "WHERE n = 'O'Brien'", "unknown to this registry, so nothing escaped it");
});

test("registration is deterministic — the same extension twice over produces the same schema", () => {
  assert.equal(JSON.stringify(caseSchema(extended())), JSON.stringify(caseSchema(extended())));
  assert.notEqual(JSON.stringify(caseSchema(extended())), JSON.stringify(caseSchema()));
});

test("a field name a project chose is held to a shape, so it cannot collide with the engine's own syntax", () => {
  const dsl = createDslRegistry();
  assert.match(refusal(() => dsl.registerField("Statement", FIELD, "acme")).message, /lowerCamelCase/);
  assert.match(refusal(() => dsl.registerField("state-ment", FIELD, "acme")).message, /lowerCamelCase/);
});
