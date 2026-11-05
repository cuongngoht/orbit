// WHETHER THE CONTEXT IS ENOUGH TO CHOOSE SCOPE ON (0.5.0, B21): ENOUGH · DISCOVER · ASK, by an ordered table whose last
// row always holds (src/context/sufficiency.mjs). ASK is reached only for a blocking unknown no source can settle --
// a question already open about the task's own work, carried as it was found, never one made up here -- and DISCOVER
// always names the targeted reads that would fill the gap, never a full scan. The composition over a real checkout,
// with a goal's missing prerequisite and a requirement's blocking question, is test/context-grounding.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SUFFICIENCY, SUFFICIENCY_WORDS, TARGET_LIMIT, sufficiencyLines, sufficiencyOf } from "../src/context/sufficiency.mjs";

const classes = (over = {}) => ({ direct: 3, dependency: 2, downstream: 1, verification: 1, unknown: 0, ...over });
const grounded = (over = {}) => ({ tree: true, classes: classes(), stale: [], paths: 2, graph: true, unanswered: [], refused: 0, blocking: [], ...over });
const QUESTION = { flow: "requirements", root: "req-0123456789ab", id: "rq-0123456789ab", asks: "What happens when the order is empty?" };

test("every row is reachable, in its order, and the last always answers", () => {
  const reached = [
    sufficiencyOf(grounded({ blocking: [QUESTION] })).row,
    sufficiencyOf(grounded({ tree: false })).row,
    sufficiencyOf(grounded({ classes: classes({ direct: 0 }) })).row,
    sufficiencyOf(grounded({ stale: [{ ref: "src/orders", owner: "architecture", id: "arch-module-1" }] })).row,
    sufficiencyOf(grounded({ graph: false, classes: classes({ verification: 0 }) })).row,
    sufficiencyOf(grounded()).row,
  ];
  assert.deepEqual(reached, SUFFICIENCY.map((r) => r.row));
  assert.deepEqual([...new Set(SUFFICIENCY.map((r) => r.word))].sort(), [...SUFFICIENCY_WORDS].sort());
  assert.equal(SUFFICIENCY.at(-1).when({}), true, "the last row is unconditional");
  assert.equal(sufficiencyOf({}).word, "DISCOVER", "nothing handed in is never ENOUGH");
  assert.equal(sufficiencyOf(undefined).row, "no-tree");
});

test("ENOUGH: what the task touches is named, nothing under it moved, something holds it, and nothing is asked", () => {
  const s = sufficiencyOf(grounded());
  assert.deepEqual([s.word, s.targets, s.question], ["ENOUGH", [], null]);
  assert.match(s.because, /3 direct · 3 related · 1 verification item\(s\)/);
  assert.equal(sufficiencyOf(grounded({ graph: false })).word, "ENOUGH", "a gate that holds it is verification enough without a runtime graph");
  assert.equal(sufficiencyOf(grounded({ paths: 0, graph: false, classes: classes({ verification: 0 }) })).word, "ENOUGH", "a named component with no path has nothing for a graph to reach");
});

test("ASK only for a blocking unknown no source can settle -- a question already open, carried as found, with how a person answers it", () => {
  const s = sufficiencyOf(grounded({ blocking: [QUESTION, { ...QUESTION, id: "rq-111111111111" }] }));
  assert.equal(s.word, "ASK");
  assert.match(s.because, /^2 question\(s\) about this task's own work are open, and only a person answers them: What happens/);
  assert.deepEqual(s.question, { ...QUESTION, answer: 'a person answers it: requirements answer req-0123456789ab --question=rq-0123456789ab --says="…" --human' });
  const goal = sufficiencyOf(grounded({ blocking: [{ flow: "goal", goal: "goal-0123456789ab", asks: "which environment the release is checked in", blocks: ["verify"] }] }));
  assert.match(goal.question.answer, /goal analyze goal-0123456789ab --stdin, goal plan goal-0123456789ab/);
  assert.deepEqual(goal.question.blocks, ["verify"]);
  for (const gap of [{ classes: classes({ direct: 0 }) }, { tree: false }, { stale: [{ ref: "x", owner: "architecture", id: "a" }] }, { graph: false, classes: classes({ verification: 0 }) }, { refused: 5 }]) {
    assert.notEqual(sufficiencyOf(grounded(gap)).word, "ASK", `a gap a read can fill is never a question: ${JSON.stringify(gap)}`);
  }
  assert.equal(sufficiencyOf(grounded({ blocking: [QUESTION], classes: classes({ direct: 0 }) })).word, "ASK", "a question only a person can answer outranks reading more");
  assert.equal(sufficiencyOf(grounded({ blocking: [{ ...QUESTION, asks: "x".repeat(900) }] })).question.asks.length, 200, "what is quoted is bounded");
});

test("DISCOVER names the targeted reads that would fill the gap -- never a full scan", () => {
  const nothing = sufficiencyOf(grounded({ classes: classes({ direct: 0 }), unanswered: ["acme", "vault"], refused: 2 }));
  assert.equal(nothing.word, "DISCOVER");
  assert.match(nothing.because, /nothing the task names is held by the tracked tree or by an owner \(2 proposed reference\(s\) refused\)/);
  assert.deepEqual(nothing.targets, [{ source: "host", target: "references", run: "context --with-refs" }, { source: "architecture", target: "acme", run: "architecture ensure --capability=acme" }, { source: "architecture", target: "vault", run: "architecture ensure --capability=vault" }]);
  const stale = sufficiencyOf(grounded({ stale: [{ ref: "src/orders", owner: "architecture", id: "a1" }, { ref: "src/orders", owner: "architecture", id: "a2" }, { ref: "src/db/pool.mjs", owner: "engineering", id: "e1" }, { ref: "src/x", owner: "knowledge", id: "k-0123" }, { ref: "web", owner: "plan", id: "runtime" }, { ref: "api", owner: "plan", id: "runtime" }] }));
  assert.deepEqual(stale.targets, [{ source: "architecture", target: "src/orders", run: "architecture ensure" }, { source: "engineering", target: "src/db/pool.mjs", run: "engineering ensure" }, { source: "knowledge", target: "k-0123", run: "knowledge why k-0123" }, { source: "runtime", target: "component graph", run: "runtime discover" }], "each record that moved, by the owner that re-reads it, once");
  const unreached = sufficiencyOf(grounded({ graph: false, classes: classes({ verification: 0 }) }));
  assert.deepEqual(unreached.targets, [{ source: "runtime", target: "component graph", run: "runtime discover" }]);
  assert.deepEqual(sufficiencyOf(grounded({ tree: false })).targets, [{ source: "checkout", target: "tracked tree", run: null }]);
  const many = sufficiencyOf(grounded({ classes: classes({ direct: 0 }), unanswered: Array.from({ length: 20 }, (_, i) => `t${i}xx`) }));
  assert.equal(many.targets.length, TARGET_LIMIT, "bounded");
});

test("an edit the index cannot see is not a move: only a stale record sends anything to be read again", () => {
  assert.equal(sufficiencyOf(grounded({ stale: [] })).word, "ENOUGH", "freshness unknown (uncommitted edits) is not stale");
});

test("the word and its targets, as the lines the context package prints", () => {
  assert.deepEqual(sufficiencyLines(sufficiencyOf(grounded({ classes: classes({ direct: 0 }) }))), ["SUFFICIENCY  DISCOVER -- nothing the task names is held by the tracked tree or by an owner — read the code for it, and propose what you find to be verified", "  target  host · references -- context --with-refs"]);
  assert.deepEqual(sufficiencyLines(sufficiencyOf(grounded({ blocking: [QUESTION] }))).slice(1), [`  question  ${QUESTION.asks} -- a person answers it: requirements answer req-0123456789ab --question=rq-0123456789ab --says="…" --human`]);
  assert.match(sufficiencyLines(sufficiencyOf(grounded()))[0], /^SUFFICIENCY {2}ENOUGH -- /);
});
