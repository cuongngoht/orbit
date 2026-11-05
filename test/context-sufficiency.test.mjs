// WHETHER THE CONTEXT IS ENOUGH TO CHOOSE SCOPE ON (0.5.0, B21): ENOUGH · DISCOVER · ASK, by an ordered table whose last
// row always holds (src/context/sufficiency.mjs). ASK is reached only for a blocking unknown no source can settle --
// a question already open about the task's own work, carried as it was found, never one made up here -- and DISCOVER
// always names the targeted reads that would fill the gap, never a full scan. The composition over a real checkout,
// with a goal's missing prerequisite and a requirement's blocking question, is test/context-grounding.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SUFFICIENCY, SUFFICIENCY_WORDS, TARGET_LIMIT, ownWork, sufficiencyLines, sufficiencyOf } from "../src/context/sufficiency.mjs";

const classes = (over = {}) => ({ direct: 3, dependency: 2, downstream: 1, verification: 1, unknown: 0, ...over });
const grounded = (over = {}) => ({ tree: true, classes: classes(), stale: [], paths: 2, graph: true, unanswered: [], refused: 0, blocking: [], ...over });
const QUESTION = { flow: "requirements", root: "req-0123456789ab", id: "rq-0123456789ab", asks: "What happens when the order is empty?" };

test("every row is reachable, in its order, and the last always answers", () => {
  const reached = [
    sufficiencyOf(grounded({ blocking: [QUESTION] })).row,
    sufficiencyOf(grounded({ tree: false })).row,
    sufficiencyOf(grounded({ classes: classes({ direct: 0 }) })).row,
    sufficiencyOf(grounded({ stale: [{ ref: "src/orders", owner: "architecture", id: "arch-module-1" }] })).row,
    sufficiencyOf(grounded({ graph: false, classes: classes({ verification: 0 }), understood: "NOT_DISCOVERED" })).row,
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
  assert.equal(goal.question.answer, "a person answers it; then the goal is analyzed and planned again: orbit goal analyze goal-0123456789ab --stdin, then orbit goal plan goal-0123456789ab", "each command named by the CLI that runs it (cli/orbit.mjs), as every target's is");
  assert.deepEqual(goal.question.blocks, ["verify"]);
  for (const gap of [{ classes: classes({ direct: 0 }) }, { tree: false }, { stale: [{ ref: "x", owner: "architecture", id: "a" }] }, { graph: false, classes: classes({ verification: 0 }), understood: "NOT_DISCOVERED" }, { refused: 5 }]) {
    assert.notEqual(sufficiencyOf(grounded(gap)).word, "ASK", `a gap a read can fill is never a question: ${JSON.stringify(gap)}`);
  }
  assert.equal(sufficiencyOf(grounded({ blocking: [QUESTION], classes: classes({ direct: 0 }) })).word, "ASK", "a question only a person can answer outranks reading more");
  assert.equal(sufficiencyOf(grounded({ blocking: [{ ...QUESTION, asks: "x".repeat(900) }] })).question.asks.length, 200, "what is quoted is bounded");
});

// ASK waits on a person, so the question must be about the task's OWN work: a work or a goal the task names by id, or
// whose objective shares more than half the words of the shorter of the two. Two words in common -- "make", "order" --
// is a task NEAR another work, which the WORK section may show, never one whose open question it must wait on.
test("a work or a goal is the task's own -- so its open question can be the task's ASK -- only when most of its words are the task's", () => {
  const work = "Make createOrder refuse an empty order";
  assert.equal(ownWork(work, "make createOrder refuse an empty order"), true, "the task restates it");
  assert.equal(ownWork(work, "createOrder must refuse empty orders, with a clear error"), true, "the task says most of it, in its own words");
  assert.equal(ownWork("Refuse empty orders at checkout and show the customer a clear error", "refuse empty orders"), true, "a short task that is the heart of a long objective");
  assert.equal(ownWork(work, "make the order list paginate in pages of twenty"), false, "two words in common is near, never the same work");
  assert.equal(ownWork(work, "make the order list paginate"), false, "even when the task is short");
  assert.equal(ownWork(work, "rename the empty state message in the order view"), false);
  assert.equal(ownWork(work, "order"), false, "one word is never enough");
  assert.equal(ownWork("", "make createOrder refuse an empty order"), false, "an objective with no words is nobody's");
});

test("DISCOVER names the targeted reads that would fill the gap -- never a full scan", () => {
  const nothing = sufficiencyOf(grounded({ classes: classes({ direct: 0 }), unanswered: ["acme", "vault"], refused: 2 }));
  assert.equal(nothing.word, "DISCOVER");
  assert.match(nothing.because, /nothing the task names is held by the tracked tree or by an owner \(2 proposed reference\(s\) refused\)/);
  assert.deepEqual(nothing.targets, [{ source: "host", target: "references", run: "context --with-refs" }, { source: "architecture", target: "acme", run: "architecture ensure --capability=acme" }, { source: "architecture", target: "vault", run: "architecture ensure --capability=vault" }]);
  const stale = sufficiencyOf(grounded({ stale: [{ ref: "src/orders", owner: "architecture", id: "a1" }, { ref: "src/orders", owner: "architecture", id: "a2" }, { ref: "src/db/pool.mjs", owner: "engineering", id: "e1" }, { ref: "src/x", owner: "knowledge", id: "k-0123" }, { ref: "web", owner: "plan", id: "runtime" }, { ref: "api", owner: "plan", id: "runtime" }] }));
  assert.deepEqual(stale.targets, [{ source: "architecture", target: "src/orders", run: "architecture ensure" }, { source: "engineering", target: "src/db/pool.mjs", run: "engineering why e1" }, { source: "knowledge", target: "src/x", run: "knowledge why k-0123" }, { source: "runtime", target: "component graph", run: "runtime discover" }], "each record that moved, by the owner that re-reads it -- an observation by its own evidence -- once");
  const unreached = sufficiencyOf(grounded({ graph: false, classes: classes({ verification: 0 }), understood: "NOT_DISCOVERED" }));
  assert.deepEqual(unreached.targets, [{ source: "runtime", target: "component graph", run: "runtime discover" }]);
  assert.deepEqual(sufficiencyOf(grounded({ tree: false })).targets, [{ source: "checkout", target: "tracked tree", run: null }]);
  const many = sufficiencyOf(grounded({ classes: classes({ direct: 0 }), unanswered: Array.from({ length: 20 }, (_, i) => `t${i}xx`) }));
  assert.equal(many.targets.length, TARGET_LIMIT, "bounded");
});

// A DISCOVER names a read that can fill the gap -- and `runtime discover` fills a missing component graph only when
// runtime understanding has not read this checkout yet, or what it read moved. Once it has read it and found no
// component the direct paths lie in, asking it again finds the same nothing: that is no gap a read can fill, and a host
// sent back to it would loop.
test("the component graph is DISCOVERed only while runtime understanding can still read one -- never again once it read this checkout and found none", () => {
  const unreached = (understood) => sufficiencyOf(grounded({ graph: false, classes: classes({ verification: 0 }), understood })).row;
  assert.equal(unreached("NOT_DISCOVERED"), "unreached", "nothing has read what this checkout declares: `runtime discover` does");
  assert.equal(unreached("STALE"), "unreached", "what it read moved: reading it again may find a graph");
  for (const read of ["CURRENT", "PARTIAL", "UNKNOWN", null, undefined]) assert.equal(unreached(read), "grounded", `${read}: a read already made, or one that cannot be made here, finds no graph by being made again`);
  assert.match(sufficiencyOf(grounded({ graph: false, classes: classes({ verification: 0 }), understood: "NOT_DISCOVERED" })).because, /runtime understanding has not read this checkout/);
});

test("an edit the index cannot see is not a move: only a stale record sends anything to be read again", () => {
  assert.equal(sufficiencyOf(grounded({ stale: [] })).word, "ENOUGH", "freshness unknown (uncommitted edits) is not stale");
});

test("the word and its targets, as the lines the context package prints", () => {
  assert.deepEqual(sufficiencyLines(sufficiencyOf(grounded({ classes: classes({ direct: 0 }) }))), ["SUFFICIENCY  DISCOVER -- nothing the task names is held by the tracked tree or by an owner — read the code for it, and propose what you find to be verified", "  target  host · references -- context --with-refs"]);
  assert.deepEqual(sufficiencyLines(sufficiencyOf(grounded({ blocking: [QUESTION] }))).slice(1), [`  question  ${QUESTION.asks} -- a person answers it: requirements answer req-0123456789ab --question=rq-0123456789ab --says="…" --human`]);
  assert.match(sufficiencyLines(sufficiencyOf(grounded()))[0], /^SUFFICIENCY {2}ENOUGH -- /);
});
