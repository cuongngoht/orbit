import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { findCase } from "../src/dsl/load.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { classify } from "../src/query/classify.mjs";
import { UI_TESTS } from "./fakes/context.mjs";
import { sealed } from "./home.mjs";

// The dsl-doctor's whole trigger surface is the EXISTING validator. That is the
// architectural claim worth testing: not the rules -- test/validate.test.mjs
// already owns those, one assertion per rule -- but that each category the
// doctor is documented to repair is a finding the engine produces, and that a
// finding routes to the doctor and to nobody else.
//
// If these ever start passing while validate.test.mjs fails, the doctor has
// begun deciding for itself what is invalid, which is the drift this split
// exists to prevent.
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");
const graph = loadGraph(join(UI_TESTS, "graph"));

const good = () => findCase(join(UI_TESTS, "screens"), "create-thing");

// Every mutation is one line against a case the validator currently accepts,
// so a finding can only have come from the mutation.
const broken = (change) => { const c = structuredClone(good()); change(c); return c; };

const findings = (change) => validate(broken(change), graph);

// create-thing: 1 goto · 2 skip-if · 3 click home/Add · 4 fill · 5 click Save
//               6 api · 7 sql · 8 report+expect
//
// Third column: something the finding must NAME. Without it a mutation could
// pass this file on some unrelated finding that happened to fire, which would
// report the pipeline as working while the category went unreported.
const CATEGORIES = [
  ["unknown verb", (c) => { c.steps[2].do = "hover"; }, "step 3"],
  ["unknown field", (c) => { c.steps[2].bogus = 1; }, "step 3"],
  ["misplaced field", (c) => { c.steps[2].query = "SELECT 1"; }, "step 3"],
  ["missing required field", (c) => { delete c.steps[3].value; }, "step 4"],
  ["invalid field constraint", (c) => { c.steps[5].status = 9; }, "step 6"],
  ["unknown control reference", (c) => { c.steps[2].on = "home/Nope"; }, "home/Nope"],
  ["no usable selector", (c) => { c.steps[2].on = "home/Delete"; }, "no usable selector"],
  ["unknown screen", (c) => { c.start = "nowhere"; }, "nowhere"],
  ["unbound placeholder", (c) => { c.steps[3].value = "${NOPE}"; }, "${NOPE}"],
  ["forward binding", (c) => { c.steps[3].value = "${LATER}"; c.steps[6].into = "LATER"; }, "a LATER step binds"],
  ["duplicate into", (c) => { c.steps[6].into = "DUP"; c.steps[7].into = "DUP"; }, "bound once"],
  ["unused binding", (c) => { c.steps[6].into = "NOBODY_READS_THIS"; }, "no later step uses it"],
  ["click without wait", (c) => { delete c.steps[2].wait; }, "no wait after it"],
  ["non-read-only SQL", (c) => { c.steps[6].query = "DELETE FROM Things"; }, "read-only SELECT"],
  ["unquoted SQL placeholder", (c) => { c.steps[6].query = "SELECT Id FROM Things WHERE Name=${NAME}"; }, "not inside a quoted value"],
  ["missing verdict", (c) => { c.steps = c.steps.slice(0, 5); }, "no assert and no expect"],
  ["creates without witnesses", (c) => { c.steps = [...c.steps.slice(0, 5), c.steps[7]]; }, "rules on api and sql nowhere"],
  ["creates without an early skip-if", (c) => { c.steps = [c.steps[0], ...c.steps.slice(2), c.steps[1]]; }, "no skip-if guard before"],
  ["effect mismatch with the map", (c) => { c.steps[5].method = "PUT"; }, "the map says"],
  ["identity states nothing verifiable", (c) => { c.identity = { as: "admin" }; }, "states nothing verifiable"],
];

test("the case the mutations start from is accepted, or nothing below means anything", () => {
  assert.deepEqual(validate(good(), graph), []);
});

test("every category the doctor may repair is a finding the VALIDATOR produces", () => {
  for (const [category, change, names] of CATEGORIES) {
    const said = findings(change);
    assert.ok(said.length > 0, `the validator reports nothing for: ${category}`);
    assert.ok(said.some((f) => f.includes(names)), `${category}: nothing named "${names}"\n  ${said.join("\n  ")}`);
  }
});

// The routing, which is the doctor's actual contract with the analyst.
test("a validator finding classifies as DSL_INVALID and routes to the doctor", () => {
  for (const [category, change] of CATEGORIES) {
    const said = classify({ status: "REFUSED", invalid: findings(change).map((f) => `case create-thing ${f}`) });
    assert.equal(said.type, "DSL_INVALID", category);
    assert.equal(said.handoff, "orbit-dsl-doctor", category);
    assert.equal(said.confidence, "high", `${category}: a finding is demonstrable, never a guess`);
  }
});

// The other half of the contract: the doctor must not be handed a failure that
// its repairs cannot address, because the only way it could "fix" one is by
// weakening the case.
test("a case the validator accepts never routes to the doctor, however it failed", () => {
  assert.deepEqual(validate(good(), graph), []);
  const stop = { kind: "error", phase: "act", message: "boom", step: 3, do: "click", on: "home/Add", selector: "x" };
  for (const facts of [
    { status: "FAIL", invalid: [], ruled: true, failure: stop },
    { status: "FAIL", invalid: [], ruled: false, failure: stop, edgeKnown: true, selectorResolved: true },
    { status: "BLOCKED", invalid: [], failure: null },
    { status: "REFUSED", invalid: [], signedOut: true },
  ]) {
    assert.notEqual(classify(facts).handoff, "orbit-dsl-doctor", JSON.stringify(facts));
  }
});

// "Caught before the browser" is the property that makes a --dry repair loop
// safe at all, and it is a property of run-case, not of the agent.
test("an invalid case is refused before any browser is touched, --dry included", () => {
  const r = spawnSync(process.execPath, [join(CLI, "run-case.mjs"), join(UI_TESTS, "..", "case.bad.json"), "--dry"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: UI_TESTS }) });
  assert.equal(r.status, 2, `expected REFUSED, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /case is invalid/);
  assert.doesNotMatch(r.stdout, /session:/, "it must not have reached the session gate");
});
