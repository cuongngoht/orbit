import assert from "node:assert/strict";
import { test } from "node:test";
import { encode } from "../src/dsl/escape.mjs";
import { COMMON_FIELDS, LITERAL_FIELDS, STEP_FIELDS } from "../src/dsl/fields.mjs";
import { interpolate, interpolateStep, unresolved } from "../src/dsl/interpolate.mjs";
import { caseSchema } from "../src/dsl/schema.mjs";
import { LAYERS, VERBS, VERB_NAMES, isVerdict, noneProved, ownersOf, provedBy, verbsWhere } from "../src/dsl/verbs.mjs";
import { EXECUTORS } from "../src/run/verbs/index.mjs";

test("interpolate substitutes declared params and keeps unknown placeholders visible", () => {
  assert.equal(interpolate("WHERE Name = '${NAME}' AND x = ${GRANTS}", { NAME: "TC-1" }), "WHERE Name = 'TC-1' AND x = ${GRANTS}");
  assert.equal(interpolate(42, {}), 42);
});

test("interpolateStep touches every value field and never a name field", () => {
  const s = interpolateStep({ do: "sql", on: "${X}/via", screen: "${X}", identity: "${X}", query: "SELECT '${X}'", expect: "'${X}'", why: "${X}" }, { X: "v" });
  assert.equal(s.query, "SELECT 'v'");
  assert.equal(s.expect, "'v'");
  assert.equal(s.why, "v");
  assert.equal(s.on, "${X}/via");
  assert.equal(s.identity, "${X}");
});

test("unresolved lists the placeholders a step still carries", () => {
  assert.deepEqual(unresolved({ do: "sql", query: "x ${A} ${B} ${A}", on: "${C}/x" }), ["A", "B"]);
  assert.deepEqual(unresolved({ do: "click", selector: "ok" }), []);
});

test("the generated schema names exactly the verbs the registry implements", () => {
  const schema = caseSchema();
  assert.deepEqual(schema.definitions.step.properties.do.enum, VERB_NAMES);
  assert.deepEqual([...EXECUTORS.names()].sort(), [...VERB_NAMES].sort());
  assert.equal(schema.definitions.step.allOf.length, VERBS.length);
  assert.ok(schema.properties.identities, "identities is part of the root schema");
});

test("every field a verb owns is defined once in STEP_FIELDS", () => {
  for (const v of VERBS) for (const f of [...v.fields, ...v.needs.flat()]) assert.ok(STEP_FIELDS[f] || COMMON_FIELDS.includes(f), `${v.name}.${f}`);
  assert.deepEqual(ownersOf("query"), ["sql"]);
  assert.deepEqual(ownersOf("expect"), ["report", "sql", "call"]);
});

// The column exists so no file has to keep a list of which verbs mean "the
// screen", "the call" or "the data" -- the drift this table was created to end.
test("every verdict verb declares WHICH layer it proves, and nothing else does", () => {
  assert.deepEqual(LAYERS, ["ui", "api", "sql"]);
  // A verdict verb names its layer in its ROW, or says the STEP names it -- one
  // of the two, never neither and never both. `call` is the only provesStep verb
  // and the reason it exists: the same capability can be the call a screen made
  // or the data underneath it, and only the case knows which it is asking about.
  for (const v of VERBS.filter((x) => x.verdict)) assert.ok(LAYERS.includes(v.proves) !== Boolean(v.provesStep), `${v.name} must name its layer, or say the step does`);
  for (const v of VERBS.filter((x) => !x.verdict)) assert.equal(v.proves, undefined, `${v.name} proves nothing and must not claim a layer`);
  assert.deepEqual(VERBS.filter((v) => v.provesStep).map((v) => v.name), ["call"]);
  assert.deepEqual(STEP_FIELDS.proves.enum, LAYERS, "and the step can only ever name one of the three");
  assert.deepEqual(noneProved(), { ui: 0, api: 0, sql: 0 });
});

test("a step proves a layer only when it actually ruled", () => {
  assert.equal(provedBy({ do: "sql" }), "sql");
  assert.equal(provedBy({ do: "api" }), "api");
  assert.equal(provedBy({ do: "assert" }), "ui");
  assert.equal(provedBy({ do: "report" }), null, "a report without expect records a value and proves nothing");
  assert.equal(provedBy({ do: "report", expect: "it.ok" }), "ui");
  assert.equal(provedBy({ do: "click" }), null);
});

test("a verdict is assert/api/sql always, report only with expect", () => {
  assert.equal(isVerdict({ do: "assert" }), true);
  assert.equal(isVerdict({ do: "report" }), false);
  assert.equal(isVerdict({ do: "report", expect: "it" }), true);
  assert.equal(isVerdict({ do: "click" }), false);
});

// A value is spliced into text something else INTERPRETS. Blind substitution is
// the bug: a thing called O'Brien turned includes('${NAME}') into a syntax error,
// and WHERE Name='${NAME}' into a different question that still returns rows.
test("a value is encoded for the language of the field it lands in", () => {
  assert.equal(encode("O'Brien", "js"), "O\\'Brien");
  assert.equal(encode("O'Brien", "sql"), "O''Brien");
  assert.equal(encode("O'Brien", "text"), "O'Brien");
  assert.equal(encode('say "hi"', "js"), 'say \\"hi\\"');
  assert.equal(encode("a" + String.fromCharCode(92) + "b", "js"), "a" + String.fromCharCode(92).repeat(2) + "b");
  assert.equal(encode("two\nlines", "js"), "two\\nlines");
  assert.equal(encode("a.b*c(d)", "regex"), "a\\.b\\*c\\(d\\)");
  assert.equal(encode("ok 👍 Ünïcødé", "js"), "ok 👍 Ünïcødé", "nothing is mangled that did not need escaping");
});

// String.replace with a STRING replacement treats $& and $1 as back-references,
// and would re-scan a replacement containing ${OTHER}. The replacement is a
// function precisely so a captured value is inserted literally.
test("a bound value is never re-scanned as a placeholder or a back-reference", () => {
  assert.equal(interpolate("x=${A}", { A: "${B}" }), "x=${B}", "no second pass");
  assert.equal(interpolate("x=${A}", { A: "$&" }), "x=$&");
  assert.equal(interpolate("x=${A}", { A: "$1" }), "x=$1");
});

// If a field that reaches an interpreter forgets to declare its language, values
// go into it raw -- so the declaration is checked, not trusted.
test("every interpolated string field declares the language it is read as", () => {
  const interpreted = ["js", "expect", "wait", "selector", "query", "match"];
  for (const k of interpreted) assert.ok(STEP_FIELDS[k].esc, k + " must declare esc");
  for (const k of interpreted) assert.ok(!LITERAL_FIELDS.has(k), k + " is interpolated, so it must not be literal");
  assert.ok(!JSON.stringify(caseSchema()).includes('"esc"'), "esc is the engine's own key and must not reach the published schema");
  assert.ok(!JSON.stringify(caseSchema()).includes('"says"'), "nor must says");
});

// The runner once had one ACT table plus five other verb lists, and adding a
// verb meant finding all six. Anything that needs to know "which verbs do X"
// asks the table, so these columns are the only place such a set exists.
test("what a verb does to the run around it is declared in the table, not enumerated elsewhere", () => {
  assert.deepEqual([...verbsWhere("changes")], ["click", "fill", "press"]);
  assert.deepEqual([...verbsWhere("navigates")], ["goto"]);
  assert.deepEqual([...verbsWhere("switchesIdentity")], ["as"]);
  assert.deepEqual([...verbsWhere("requests", "mark")], ["goto", "click", "fill", "press", "as"]);
  assert.deepEqual([...verbsWhere("requests", "since")], ["api"]);

  // A verb that changes something, or navigates, has to be an act.
  for (const v of VERBS.filter((x) => x.changes || x.navigates)) assert.equal(v.kind, "act", v.name);
  // And every value of requests is one the two readers understand.
  for (const v of VERBS.filter((x) => x.requests)) assert.ok(["mark", "since"].includes(v.requests), v.name);
  // goto navigates and changes nothing; the creates-guard rule leans on exactly that.
  assert.ok(!verbsWhere("changes").has("goto"));
});

// The registry refuses to load when the vocabulary and the behaviours disagree.
// A row offering into promises the runner can turn that step's result into one
// value, and only the verb knows how -- so only the verb may answer.
test("a verb that offers into carries its own capture, and nothing else decides", () => {
  const owed = VERBS.filter((v) => v.fields.includes("into"));
  assert.deepEqual(owed.map((v) => v.name), ["report", "sql", "call"]);
  for (const v of owed) assert.equal(typeof EXECUTORS.resolve(v.name).capture, "function", v.name);
  for (const v of VERBS.filter((x) => !x.fields.includes("into"))) assert.equal(EXECUTORS.resolve(v.name).capture, undefined, v.name);

  // The other three Strategy members the run asks for, each on one verb only.
  assert.deepEqual(VERB_NAMES.filter((n) => EXECUTORS.resolve(n).stops), ["skip-if"], "only skip-if owns the SKIP sentinel");
  assert.deepEqual(VERB_NAMES.filter((n) => EXECUTORS.resolve(n).after), ["report"], "only report decides what the run reports");
  assert.deepEqual(VERB_NAMES.filter((n) => EXECUTORS.resolve(n).plan), ["goto"], "only goto resolves a url from the map");
});
