// WHETHER THE CONTEXT IS ENOUGH TO CHOOSE SCOPE ON (0.5.0, B21): ENOUGH · DISCOVER · ASK, by an ordered table whose last
// row always holds (src/context/sufficiency.mjs). ASK is reached only for a blocking unknown no source can settle --
// a question already open about the task's own work, carried as it was found, never one made up here -- and DISCOVER
// always names the targeted reads that would fill the gap, never a full scan. The composition over a real checkout,
// with a goal's missing prerequisite and a requirement's blocking question, is test/context-grounding.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LEVELS, LEVEL_NAMES, SUFFICIENCY, SUFFICIENCY_WORDS, TARGET_LIMIT, directFacts, levelLines, ownWork, sufficiencyLines, sufficiencyOf } from "../src/context/sufficiency.mjs";

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

// What B21's review found (0.5.0): "rename the order service and keep its public API" is ENOUGH on this repository from
// one-word names its words matched -- `public`, `api`. A word-level reading cannot tell a meant match from an incidental
// one, and a rule that demoted one-word matches would send every short, specific task to DISCOVER. So the word stays,
// and says what it is: a place to start, each item confirmed in the code -- the caveat every playbook that reads it
// already gives, in the reason any reader of the word reads.
test("ENOUGH is a place to start, never proof: its own reason says to confirm each item in the code", () => {
  assert.match(sufficiencyOf(grounded()).because, /— start from them, and confirm each in the code before it goes in: a name one of the task's words matched is not proof the change needs it$/);
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

// The three playbooks that read SUFFICIENCY act on it: every read a DISCOVER can name is a command each may run without
// a prompt, and each says how a target's `run` becomes that command. A target a playbook cannot run is a host that
// guesses, or waits on a permission nobody is there to give (0.5.0 review).
const PLAYBOOKS = ["orbit-develop", "orbit-engineer", "orbit-help"];

const everyRun = () => {
  const stale = ["architecture", "intelligence", "engineering", "knowledge", "plan"].map((owner) => ({ ref: `src/${owner}`, owner, id: `${owner}-1` }));
  const said = [grounded({ classes: classes({ direct: 0 }), unanswered: ["vault"] }), grounded({ stale }), grounded({ graph: false, classes: classes({ verification: 0 }), understood: "NOT_DISCOVERED" })];
  return [...new Set(said.flatMap((f) => sufficiencyOf(f).targets.map((t) => t.run)).filter(Boolean))];
};

const grantsOf = (skill) => [...readFileSync(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), "utf8").matchAll(/^\s+- Bash\((.+)\*\)$/gm)].map((m) => m[1]);

const commandOf = (run) => ((words) => `node \${CLAUDE_PLUGIN_ROOT}/cli/${words[0]}.mjs ${words.slice(1).join(" ")}`)(run.split(" "));

test("every read a DISCOVER can name is one each playbook that reads SUFFICIENCY may run, and each says how a target becomes that command", () => {
  const runs = everyRun();
  assert.deepEqual(runs.map((r) => r.split(" ").slice(0, 2).join(" ")).sort(), ["architecture ensure", "architecture ensure", "context --with-refs", "engineering why", "intelligence ensure", "knowledge why", "runtime discover"], "the targets this test holds the playbooks to");
  for (const skill of PLAYBOOKS) {
    const grants = grantsOf(skill);
    for (const run of runs) assert.ok(grants.some((g) => commandOf(run).startsWith(g)), `${skill} may not run \`${commandOf(run)}\` that a DISCOVER can name`);
    assert.match(readFileSync(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), "utf8"), /`node \$\{CLAUDE_PLUGIN_ROOT\}\/cli\/<first word>\.mjs <the rest>`/, `${skill} says how a target's run becomes a command`);
  }
});

test("an edit the index cannot see is not a move: only a stale record sends anything to be read again", () => {
  assert.equal(sufficiencyOf(grounded({ stale: [] })).word, "ENOUGH", "freshness unknown (uncommitted edits) is not stale");
});

test("the word and its targets, as the lines the context package prints", () => {
  assert.deepEqual(sufficiencyLines(sufficiencyOf(grounded({ classes: classes({ direct: 0 }) }))), ["SUFFICIENCY  DISCOVER -- nothing the task names is held by the tracked tree or by an owner — read the code for it, and propose what you find to be verified", "  target  host · references -- context --with-refs"]);
  assert.deepEqual(sufficiencyLines(sufficiencyOf(grounded({ blocking: [QUESTION] }))).slice(1), [`  question  ${QUESTION.asks} -- a person answers it: requirements answer req-0123456789ab --question=rq-0123456789ab --says="…" --human`]);
  assert.match(sufficiencyLines(sufficiencyOf(grounded()))[0], /^SUFFICIENCY {2}ENOUGH -- /);
});

// ---- THREE LEVELS (0.6.0, U1): enough to investigate, to change, to conclude -------------------------------------------

const WORK = { id: "w-0123456789ab", proofs: 2, unproved: 0, moved: 0, evidence: "verified" };
const ready = (over = {}) => grounded({ grounded: 2, confirmed: 1, followed: 1, work: WORK, ...over });
const levels = (facts) => sufficiencyOf(facts).levels;
const rowsOf = (facts) => Object.fromEntries(LEVEL_NAMES.map((n) => [n, levels(facts)[n].row]));

test("every level's rows are reachable, each ALONE, in order -- and with every fact in place each level holds", () => {
  assert.deepEqual(LEVEL_NAMES, ["investigate", "change", "conclude"]);
  assert.deepEqual(rowsOf(ready()), { investigate: "grounded", change: "ready", conclude: "concluded" });
  assert.equal(Object.values(levels(ready())).every((l) => l.holds && l.missing.length === 0), true);
  const alone = {
    investigate: [["no-tree", { tree: false }], ["nothing-grounded", { grounded: 0 }]],
    change: [["unconfirmed", { confirmed: 0 }], ["dependents-unknown", { followed: 0, classes: classes({ dependency: 0, downstream: 0 }) }], ["no-done-criterion", { work: { ...WORK, proofs: 0 } }], ["no-check", { classes: classes({ verification: 0 }) }]],
    conclude: [["no-work", { work: null }], ["no-proof", { work: { ...WORK, proofs: 0 } }], ["unproved", { work: { ...WORK, unproved: 1 } }], ["moved", { work: { ...WORK, moved: 1 } }], ["unverified", { work: { ...WORK, evidence: "reported" } }]],
  };
  for (const name of LEVEL_NAMES) {
    assert.deepEqual(alone[name].map(([row]) => row), LEVELS[name].map((r) => r.row), `${name}: every row is exercised`);
    for (const [row, over] of alone[name]) {
      const l = levels(ready(over))[name];
      assert.deepEqual([l.holds, l.row, l.missing.length], [false, row, 1], `${name}/${row} alone`);
      assert.equal(l.because, l.missing[0]);
    }
  }
});

test("a level lists everything it misses, its first row first, and says how each is filled", () => {
  const nothing = levels({ tree: true });
  assert.deepEqual([nothing.investigate.row, nothing.change.row, nothing.conclude.row], ["nothing-grounded", "unconfirmed", "no-work"]);
  assert.equal(nothing.change.missing.length, 4, "unconfirmed, dependents, a done criterion and a check");
  assert.match(nothing.change.missing[2], /work start, then work need --type=proof/);
  assert.match(levels(ready({ work: { ...WORK, proofs: 0 } })).change.because, /work need w-0123456789ab --type=proof/, "the task's own work, by id");
  assert.match(levels(ready({ work: { ...WORK, unproved: 2 } })).conclude.because, /2 proof need\(s\) not satisfied .* work settle w-0123456789ab/);
});

// What a word-level match is worth: a place to start. However many names the task's words hit, nothing has been read,
// so a change has nothing confirmed to rest on.
test("many name hits and no read stays at investigate", () => {
  const named = Array.from({ length: 12 }, (_, i) => ({ kind: "file", ref: `src/login${i}.mjs`, class: "direct", evidence: [{ source: "name", id: "login" }, { source: "tree", id: "tracked" }], freshness: "current", by: "engine" }));
  const facts = directFacts(named);
  assert.deepEqual(facts, { grounded: 12, confirmed: 0 });
  const l = levels(ready(facts));
  assert.deepEqual([l.investigate.holds, l.change.holds, l.change.row], [true, false, "unconfirmed"]);
  assert.match(l.change.because, /12 named, none read/);
});

test("confirmed is a read: the host's verified proposal, or an owner's record that is fresh -- never a stale one, a request's words or a name", () => {
  const item = (by, source, freshness = "current", kind = "file", cls = "direct") => ({ kind, ref: "x", class: cls, evidence: [{ source, id: "1" }], freshness, by });
  assert.deepEqual(directFacts([item("host-verified", "tree")]), { grounded: 1, confirmed: 1 });
  assert.deepEqual(directFacts([item("host-verified", "tree", "unknown", "symbol")]), { grounded: 1, confirmed: 1 });
  for (const source of ["architecture", "graph", "intelligence", "engineering", "knowledge"]) assert.equal(directFacts([item("engine", source)]).confirmed, 1, source);
  assert.equal(directFacts([item("engine", "architecture", "stale")]).confirmed, 0, "a record whose basis moved");
  assert.equal(directFacts([item("engine", "request")]).confirmed, 0, "a path the request writes out is named, not read");
  assert.equal(directFacts([item("engine", "working-set")]).confirmed, 0);
  assert.deepEqual(directFacts([item("engine", "architecture", "current", "component")]), { grounded: 0, confirmed: 0 }, "a component is not a file or a symbol the tree holds");
  assert.equal(directFacts([item("engine", "name")], [{ kind: "file", ref: "x" }]).confirmed, 1, "proposed by the host and held, though the engine found it too by its name");
  assert.equal(directFacts([item("engine", "name")], [{ kind: "symbol", ref: "x" }]).confirmed, 0, "a symbol of that name is another item");
  assert.deepEqual(directFacts([item("host-verified", "tree", "current", "file", "dependency")]), { grounded: 0, confirmed: 0 }, "only direct items");
});

// A developer's own session is observed or reported, never verified (src/work/track/view.mjs): conclude waits for an
// owner's record -- a completed task with no edit after it.
test("conclude needs every proof satisfied and unmoved on VERIFIED evidence -- a developer's observed or reported session never concludes", () => {
  for (const evidence of ["none", "observed", "reported"]) assert.deepEqual([levels(ready({ work: { ...WORK, evidence } })).conclude.holds, levels(ready({ work: { ...WORK, evidence } })).conclude.row], [false, "unverified"], evidence);
  assert.equal(levels(ready()).conclude.holds, true);
});

test("the levels are additive: the word, its row and its targets are what they were", () => {
  for (const facts of [grounded(), grounded({ classes: classes({ direct: 0 }) }), grounded({ blocking: [QUESTION] })]) {
    const s = sufficiencyOf(facts);
    const t = sufficiencyOf({ ...facts, grounded: 3, confirmed: 3, followed: 2, work: WORK });
    assert.deepEqual([t.word, t.row, t.targets, t.question], [s.word, s.row, s.targets, s.question]);
  }
});

test("one line per level, after the word's", () => {
  const lines = levelLines(sufficiencyOf(ready({ confirmed: 0 })));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^ {2}investigate holds -- 2 direct item\(s\) the tracked tree holds$/);
  assert.match(lines[1], /^ {2}change {6}not yet -- a direct item confirmed by a read/);
  assert.match(lines[2], /^ {2}conclude {4}holds -- /);
});
