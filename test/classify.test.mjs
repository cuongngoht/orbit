import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CLASSES, TYPES, classify } from "../src/query/classify.mjs";

// Classification decides who touches which artifact next, and one direction of
// error is far more expensive than the others: reading a failure as MAP_DRIFT
// sends somebody to edit a record that was right, and the defect it was hiding
// ships. So most of what is asserted here is what the table must NOT say.
//
// Facts in, one row out. No browser, no evidence directory, no error-message
// regex -- the point of the `phase` field is that these can be described.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const stop = (over = {}) => ({ kind: "error", phase: "act", message: "boom", step: 4, do: "click", on: "users/Save", selector: "getByRole('button',{name:'Save'})", ...over });

// A locator the engine resolved off an edge the map has: the two facts that
// have to hold before drift is even a candidate.
const drivable = { ruled: false, edgeKnown: true, selectorResolved: true, nonTwoXx: [] };

const type = (facts) => classify(facts).type;

test("the validator's own findings are a DSL problem, and only the dsl-doctor's", () => {
  const said = classify({ status: "REFUSED", invalid: ['case create-user step 4 (sql): "query" belongs on a sql step'] });
  assert.equal(said.type, "DSL_INVALID");
  assert.equal(said.confidence, "high");
  assert.equal(said.handoff, "orbit-dsl-doctor");
  assert.match(said.because, /belongs on a sql step/, "the finding itself is the reason, not a paraphrase");
});

// A finding outranks everything below it: a case that does not yet say what it
// means cannot be evidence about a product, a map or a clock.
test("a DSL finding outranks every other explanation", () => {
  const worst = { status: "FAIL", failure: stop(), ...drivable, driftedRecord: true, passedHereAtSameBuild: true };
  assert.equal(type(worst), "MAP_DRIFT", "without a finding this is the drift case");
  assert.equal(type({ ...worst, invalid: ["case x: unknown verb"] }), "DSL_INVALID");
});

test("a signed-out session or a wrong identity is AUTH, never a product bug", () => {
  assert.equal(type({ status: "REFUSED", signedOut: true }), "AUTH");
  const wrong = classify({ status: "REFUSED", identityProblem: ["missing role(s): App.Admin"] });
  assert.equal(wrong.type, "AUTH");
  assert.match(wrong.because, /missing role\(s\)/);
  assert.equal(wrong.handoff, null, "identity is a human's workflow, not a repair agent's");
});

test("BLOCKED is an environment or a data precondition, and never the product", () => {
  const db = classify({ status: "BLOCKED", failure: stop({ kind: "blocked", do: "sql", message: "the database could not be reached" }) });
  assert.equal(db.type, "ENVIRONMENT");
  assert.match(db.next, /never a defect/);

  const preStep = classify({ status: "BLOCKED", failure: null });
  assert.equal(preStep.type, "DATA");
  assert.equal(preStep.confidence, "low", "resolve-found-no-row and database-unreachable look the same from here");
  assert.match(preStep.next, /resolve rows/);

  for (const f of [db, preStep]) assert.notEqual(f.type, "PRODUCT_FAILURE");
});

test("an unfilled placeholder is a DATA problem, named as the value that was missing", () => {
  const said = classify({ status: "FAIL", failure: stop({ phase: "bind", message: "unresolved placeholder(s) ${ID} — not a param, and no resolve filled it" }) });
  assert.equal(said.type, "DATA");
  assert.equal(said.confidence, "high");
  assert.match(said.because, /\$\{ID\}/);
});

// The MAP_DRIFT pair, and the escalation between them. The engine never hands
// work to the healer off one run: `verify` is what raises it.
test("a resolved locator the browser could not act on is a drift CANDIDATE, not a verdict", () => {
  const low = classify({ status: "FAIL", failure: stop(), ...drivable });
  assert.equal(low.type, "MAP_DRIFT");
  assert.equal(low.confidence, "low");
  assert.equal(low.handoff, null, "a low confidence must never reach the healer");
  assert.match(low.next, /query\.mjs verify/, "it has to name what would settle it");

  const high = classify({ status: "FAIL", failure: stop(), ...drivable, driftedRecord: true });
  assert.equal(high.confidence, "high");
  assert.equal(high.handoff, "orbit-map-healer");
});

// Part of the contract, because each of these is a real failure that used to
// get filed as drift.
test("things that are NOT map drift, however much they look like it", () => {
  const base = { status: "FAIL", failure: stop(), ...drivable };

  assert.equal(type({ ...base, edgeKnown: false }), "UNKNOWN", "an edge the map does not have is not a drifted one");
  assert.equal(type({ ...base, selectorResolved: false }), "UNKNOWN", "a selector never captured cannot have drifted");
  assert.equal(type({ ...base, ruled: true }), "PRODUCT_FAILURE", "a step that ruled on the product is about the product");
  assert.equal(type({ ...base, failure: stop({ phase: "wait" }) }), "UNKNOWN", "a spent wait says nothing about the locator");
  assert.equal(type({ ...base, failure: stop({ phase: null }) }), "UNKNOWN", "a log that never recorded the phase must not be guessed at");

  const served = classify({ ...base, nonTwoXx: ["5 POST https://app.test/api/things => [500]"] });
  assert.equal(served.type, "PRODUCT_FAILURE", "the server refused the action — the map is not what is wrong");
  assert.match(served.because, /\[500\]/);
});

test("a verdict that ran and got the wrong answer is a product failure, preserved", () => {
  const said = classify({ status: "FAIL", ruled: true, failure: stop({ do: "api", message: "POST api/things answered 500, not 201" }) });
  assert.equal(said.type, "PRODUCT_FAILURE");
  assert.equal(said.confidence, "high");
  assert.equal(said.handoff, null, "nothing repairs a product failure — that is the point");
  assert.match(said.next, /Never weaken the case/);
});

// The ledger's own signal: nothing changed, and it used to work here.
test("a wait that ran out where this build already passed is TIMING, and no budget may be raised", () => {
  const said = classify({ status: "FAIL", failure: stop({ phase: "wait" }), ...drivable, passedHereAtSameBuild: true });
  assert.equal(said.type, "TIMING");
  assert.equal(said.handoff, null);
  assert.match(said.next, /Raising the budget to make it green is refused/);
});

test("a whole case that ran and ruled on nothing is case logic, for a person", () => {
  const said = classify({ status: "INCONCLUSIVE", whole: true });
  assert.equal(said.type, "CASE_LOGIC");
  assert.equal(said.handoff, null, "a missing verdict is a decision, not a repair");
});

test("ambiguous evidence is UNKNOWN, with the candidates named and nothing handed on", () => {
  const said = classify({ status: "FAIL", failure: stop({ phase: "wait" }), ...drivable });
  assert.equal(said.type, "UNKNOWN");
  assert.equal(said.handoff, null);
  assert.match(said.because, /equally consistent/);
  assert.match(said.next, /before anything is edited/);
});

test("it always answers, for any facts at all", () => {
  for (const facts of [{}, undefined, { status: "PASS" }, { status: "SKIP" }, { failure: null }]) {
    const said = classify(facts);
    assert.ok(TYPES.includes(said.type), `${JSON.stringify(facts)} produced ${said.type}`);
    assert.ok(said.because && said.next, "every answer owes a reason and a next step");
  }
});

// Structural guarantees over the table itself, so a row added later cannot
// quietly break the two rules that keep this safe.
test("every type in the vocabulary has a row, and the last row catches everything", () => {
  assert.deepEqual([...new Set(CLASSES.map((c) => c.type))].sort(), [...TYPES].sort());
  assert.equal(CLASSES.at(-1).when({}), true, "the table must always answer");
  assert.equal(CLASSES.at(-1).type, "UNKNOWN");
});

test("no low-confidence row may carry a handoff, whatever it claims to own", () => {
  for (const row of CLASSES) {
    if (row.confidence === "low") assert.equal(classify(fabricate(row)).handoff, null, `${row.type} hands work on at low confidence`);
    assert.ok(["high", "low"].includes(row.confidence), `${row.type} uses a confidence outside the two-valued contract`);
  }
});

// A handoff names a real agent that ships, or the routing is a dead end.
test("every handoff names an agent that exists in this plugin", () => {
  for (const row of CLASSES) {
    if (row.handoff) assert.ok(existsSync(join(ROOT, "agents", `${row.handoff}.md`)), `${row.type} hands off to ${row.handoff}, which is not in agents/`);
  }
});

// Enough facts to reach one particular row, so its own confidence can be read
// back through classify() rather than trusted from the table.
function fabricate(row) {
  const reached = CLASSES.slice(0, CLASSES.indexOf(row));
  const facts = { status: "FAIL", failure: stop({ phase: "wait" }), ...drivable, passedHereAtSameBuild: true, whole: true };
  return reached.some((r) => r.when(facts)) ? { ...facts, ...only(row) } : facts;
}

const only = (row) => (row.type === "DATA" ? { status: "BLOCKED", failure: null } : { status: "FAIL", failure: stop(), ...drivable });
