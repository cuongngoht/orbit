// Conditions of use (0.6.0, P1, P5): the facts about a session's work, derived from what its working set shows and
// nothing else -- never a prompt's words, never the text of an error. One check failing after the session's edits is
// `check.failed`; the same check failing REPEATS times in a row with nothing changed between is `check.repeats`, said
// first, because running it again is not progress.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fold } from "../src/engineering/working-set/fold.mjs";
import { FACTS, REPEATS, observedOf, withFacts } from "../src/routing/facts.mjs";
import { classify } from "../src/routing/classify.mjs";

const edit = { ev: "post-tool", tool: "edit", paths: ["src/x.mjs"], tokens: [] };
const fail = { ev: "post-tool-failure", tool: "command", paths: [], tokens: [], cmd: { class: "test", exe: "npm", ok: false } };
const pass = { ev: "post-tool", tool: "command", paths: [], tokens: [], cmd: { class: "test", exe: "npm", ok: true } };
const seen = (lines) => ({ checks: fold(lines).checks });

test("a check failing after the session's edits is check.failed, named by its class and executable", () => {
  assert.deepEqual(observedOf(seen([edit, fail])), [{ fact: "check.failed", subject: "test (npm)" }]);
  assert.deepEqual(observedOf(seen([fail])), [], "a check that failed before the session changed anything is the state it found, not one it caused");
  assert.deepEqual(observedOf(seen([edit, fail, pass])), [], "a check that passes again says nothing");
  assert.deepEqual(observedOf(seen([])), []);
  assert.deepEqual(observedOf(undefined), []);
});

test(`the same check failing ${REPEATS} times in a row with nothing changed between is check.repeats, said before check.failed`, () => {
  const run = Array(REPEATS).fill(fail);
  assert.deepEqual(observedOf(seen(run)), [{ fact: "check.repeats", subject: "test (npm)" }]);
  assert.deepEqual(observedOf(seen([edit, ...run])).map((o) => o.fact), ["check.repeats", "check.failed"]);
  assert.deepEqual(observedOf(seen([fail, fail, edit, fail])).map((o) => o.fact), ["check.failed"], "an edit between is progress of a kind: the count starts again");
  assert.equal(FACTS[0].fact, "check.repeats");
});

test("a fact's requirement joins what a prompt asked, saying which fact asked for it, and a requirement already asked is not asked twice", () => {
  const asked = withFacts(classify("hello"), [{ fact: "check.failed", subject: "test (npm)" }]);
  assert.deepEqual(asked.asked.at(-1), { requirement: "development.implementation", level: "conditional", because: "after check.failed" });
  assert.ok(asked.requirements.includes("development.implementation"));
  const change = withFacts(classify("fix the refund handler bug"), [{ fact: "check.failed", subject: "x" }, { fact: "check.repeats", subject: "x" }]);
  assert.equal(change.asked.filter((n) => n.requirement === "development.implementation").length, 1);
  assert.deepEqual(withFacts(classify("hello"), []).asked, classify("hello").asked);
});
