// THE STOP HOLD (0.5.0, B22 M3, ADR 0050): the one place Orbit keeps the model going, held to every condition the
// design names -- at most twice a prompt, never a turn already held, never past a person's pause, cancel, approval or
// question, never without a workflow's own command in the turn, never with a halt cue, never when the trail cannot count
// or the setting is off -- and cheap: a turn that ran no workflow command never reaches the owners' records. First the
// table, over a world of ports; then the real hooks, in a real checkout and store, as Claude Code runs them.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AUTOMATION_SCHEMA } from "../src/automation/settings.mjs";
import { dispatch } from "../src/lifecycle/dispatch.mjs";
import { GUARDS, HOLD, HOLD_ROWS, MAX_HOLDS, NOT_RUNNING, PAIRED_MS, WORKFLOW_COMMANDS, hold, holdRowOf, needsOwners } from "../src/lifecycle/subscribers/hold.mjs";
import { NAMED, OWED, OWED_ROWS, QUIET, namedOf, needsOwners as owedNeedsOwners, owed, owedRowOf, uncheckedEdit } from "../src/lifecycle/subscribers/owed.mjs";
import { hostSession } from "../src/memory/session.mjs";
import { stateRooms, writeState } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { eventOf } from "../src/trace/events.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- the table, over a world of ports --------------------------------------------------------------------------------

const AT = "2026-11-05T10:00:00.000Z";
const NOW = Date.parse("2026-11-05T10:00:30.000Z");
const OWNER = { kind: "workflow", id: "tsk-0123456789ab", lifecycle: "EXECUTING", state: "running", ready: ["qa", "review"], open: [] };

let seq = 0;
const ev = (type, data = {}, at = AT) => eventOf(type, data, { id: `e-${String(seq++).padStart(4, "0")}`, at, session: "claude:s1" });

const STEP = () => ev("command.ran", { orbit: "cli/automation", sub: "step", ok: true });
const turnOf = (events, marks = []) => ({ prompt: ev("prompt.submitted", { routing: "on", ...(marks.length ? { marks } : {}) }), events });

// Every fact a row may ask for is a port, and each records that it was asked: a cheap row must decide before a dear one.
function worldOf(over = {}) {
  const asked = [];
  const wrote = [];
  const port = (name, value) => () => (asked.push(name), value);
  return { asked, wrote, host: over.host ?? { formatHold: (reason) => ({ decision: "block", reason }) }, input: {}, plugin: "orbit", engine: "/plug", nowMs: () => NOW, turn: port("turn", "turn" in over ? over.turn : turnOf([STEP()])), settings: port("settings", "settings" in over ? over.settings : { trigger: { holdOnStop: true } }), governed: port("governed", "owner" in over ? over.owner : OWNER), held: (d) => wrote.push(d) };
}

const STOP = { event: "turn-end" };
const rowOf = (w, event = STOP) => holdRowOf(event, w).row;

test("a turn its own workflow can go on from is held: the ready steps, the one command, or say why -- and one turn.held", () => {
  const w = worldOf();
  const answer = hold.run(STOP, w);
  assert.equal(answer.decision, "block");
  assert.match(answer.reason, /workflow tsk-0123456789ab \(EXECUTING\) is still running and steps qa, review are ready/);
  assert.match(answer.reason, /node \/plug\/cli\/automation\.mjs context tsk-0123456789ab says how/);
  assert.match(answer.reason, /or say in one sentence why you stop here/);
  assert.deepEqual(w.wrote, [{ kind: "workflow", task: "tsk-0123456789ab", steps: ["qa", "review"], count: 1 }], "what it writes is turn.held, and only that");
});

test("a goal is held through its own command, naming the units it may start next", () => {
  const w = worldOf({ owner: { kind: "goal", id: "goal-0123456789ab", lifecycle: "ready", state: "running", ready: ["gu-0a1b2c3d"], open: [] }, turn: turnOf([ev("command.ran", { orbit: "cli/orbit", sub: "goal", op: "step", ok: true })]) });
  assert.match(hold.run(STOP, w).reason, /goal goal-0123456789ab \(ready\) is still running and step gu-0a1b2c3d is ready.*node \/plug\/cli\/orbit\.mjs goal resume goal-0123456789ab/);
});

test("at most twice per prompt: the third Stop of one prompt is never held", () => {
  const once = ev("turn.held", { task: OWNER.id, steps: ["qa"], count: 1 });
  assert.equal(MAX_HOLDS, 2);
  const second = worldOf({ turn: turnOf([STEP(), once]) });
  assert.match(hold.run(STOP, second).reason, /\(2 of 2 for this prompt\)/);
  assert.equal(second.wrote[0].count, 2);
  const third = worldOf({ turn: turnOf([STEP(), once, ev("turn.held", { task: OWNER.id, steps: ["qa"], count: 2 })]) });
  assert.deepEqual([hold.run(STOP, third), rowOf(third), third.wrote], [null, "spent", []]);
});

test("a turn a Stop hook already kept going is never held again in a row, and nothing is read for it", () => {
  const w = worldOf();
  assert.deepEqual([hold.run({ event: "turn-end", held: true }, w), w.asked, w.wrote], [null, [], []]);
});

test("never past a person's pause or cancel, a wait for a person, a block, a workflow that must stop, or one that ended", () => {
  assert.deepEqual(NOT_RUNNING, ["paused", "cancelled", "waiting", "blocked", "stopping", "ended"]);
  for (const state of NOT_RUNNING) {
    const w = worldOf({ owner: { ...OWNER, state } });
    assert.deepEqual([hold.run(STOP, w), rowOf(w), w.wrote], [null, "not-running", []], state);
  }
  const nothing = worldOf({ owner: { ...OWNER, ready: [] } });
  assert.deepEqual([hold.run(STOP, nothing), rowOf(nothing)], [null, "nothing-ready"], "a running workflow with no step ready has nothing to name");
});

test("never without one of the workflow's own commands in the turn: a turn that only answered a question is not held", () => {
  const reads = [ev("tool.used", { tool: "Read", kind: "read", ok: true }), ev("command.ran", { orbit: "cli/automation", sub: "context", ok: true }), ev("command.ran", { orbit: "cli/orbit", sub: "goal", op: "status", ok: true }), ev("command.ran", { orbit: "cli/orbit", sub: "goal", ok: true }), ev("command.ran", { class: "test", exe: "npm", ok: true })];
  const w = worldOf({ turn: turnOf(reads) });
  assert.deepEqual([hold.run(STOP, w), rowOf(w)], [null, "no-workflow-command"]);
  assert.deepEqual([...new Set(w.asked)], ["turn"], "the settings and the owners' records were never read");
  assert.deepEqual(WORKFLOW_COMMANDS.map((c) => c.orbit), ["cli/automation", "cli/orbit"]);
  for (const ran of [{ orbit: "cli/automation", sub: "start" }, { orbit: "cli/automation", sub: "settle" }, { orbit: "cli/orbit", sub: "goal", op: "start" }]) assert.equal(rowOf(worldOf({ turn: turnOf([ev("command.ran", { ...ran, ok: true })]) })), "hold", JSON.stringify(ran));
});

test("never when the prompt carried a halt cue", () => {
  const w = worldOf({ turn: turnOf([STEP()], ["halt"]) });
  assert.deepEqual([hold.run(STOP, w), rowOf(w), w.wrote], [null, "halted", []]);
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP()], ["continue"]) })), "hold", "a mark that is not a halt changes nothing");
});

test("never when the trail cannot count this prompt's holds: trace off, no prompt of this turn, or a Stop of it that was not held", () => {
  assert.deepEqual([hold.run(STOP, worldOf({ turn: null })), rowOf(worldOf({ turn: null }))], [null, "uncounted"], "trace off, or the trail unreadable");
  const ended = ev("turn.ended", {}, new Date(NOW - PAIRED_MS - 5000).toISOString());
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP(), ended]) })), "uncounted", "an earlier Stop of this prompt nobody held: this Stop belongs to a prompt the trail never heard of");
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP(), ev("session.ended", {})]) })), "uncounted");
  const heldEnd = ev("turn.ended", {}, new Date(NOW - 60_000).toISOString());
  const itsHold = ev("turn.held", { task: OWNER.id, steps: ["qa"], count: 1 }, new Date(NOW - 59_500).toISOString());
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP(), heldEnd, itsHold]) })), "hold", "a Stop that WAS held does not end the turn");
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP(), ev("turn.ended", {}, new Date(NOW - 500).toISOString())]) })), "hold", "this Stop's own end, written beside the hold, is not an earlier one");
});

test("never when a person switched the hold off, or the settings cannot be read", () => {
  for (const settings of [{ trigger: { holdOnStop: false } }, null, {}]) {
    const w = worldOf({ settings });
    assert.deepEqual([hold.run(STOP, w), rowOf(w), w.wrote], [null, "switched-off", []], JSON.stringify(settings));
  }
});

test("never for a session with no governed work of its own, and never on a host that cannot hold a turn", () => {
  assert.deepEqual([hold.run(STOP, worldOf({ owner: null })), rowOf(worldOf({ owner: null }))], [null, "no-governed-work"]);
  const codex = worldOf({ host: { formatPostTool: () => null } });
  assert.deepEqual([hold.run(STOP, codex), codex.asked], [null, []], "no formatHold: nothing is even read");
});

test("cheapest first: the owners' records and the settings are reached only by a turn that ran a workflow's command", () => {
  const deep = HOLD.filter((r) => r.deep).map((r) => r.row);
  assert.deepEqual(deep, ["switched-off", "no-governed-work"]);
  assert.ok(HOLD_ROWS.indexOf("no-workflow-command") < HOLD_ROWS.indexOf(deep[0]), "every trail row decides before a dear one is asked");
  assert.equal(HOLD.at(-1).holds, true);
  assert.equal(HOLD.at(-1).when({}), true, "the last row always answers");
  assert.equal(needsOwners(STOP, worldOf({ turn: turnOf([ev("tool.used", { tool: "Read", kind: "read", ok: true })]) })), false, "an ordinary turn never loads the owners");
  assert.equal(needsOwners({ event: "turn-end", held: true }, worldOf()), false);
  assert.equal(needsOwners(STOP, worldOf()), true, "a turn that ran a workflow's step does");
});

// ---- the owed hold (0.6.0, P3): a turn is not left unverified ---------------------------------------------------------

const EDIT = () => ev("tool.used", { tool: "Edit", kind: "edit", ok: true });
const CHECKED = (ok = true, klass = "test") => ev("command.ran", { class: klass, exe: "npm", ok });
const CHECK = { id: "rt-command-b464ab6e", purpose: "test", component: "node:api", declaredAs: "test", argv: ["npm", "run", "test"], cwd: "api" };
const OWED_FACT = { changed: ["api/src/refund.mjs"], paths: ["api/src/refund.mjs"], components: ["node:api"], check: CHECK };

// The owed hold's world: the same ports, plus the session's governed work (any kind) and what its edits owe.
function owedWorld(over = {}) {
  const w = worldOf({ turn: turnOf([EDIT()]), settings: { trigger: { holdOnStop: true, holdUnverified: true } }, owner: null, ...over });
  const port = (name, value) => () => (w.asked.push(name), value);
  return Object.assign(w, { work: port("work", "work" in over ? over.work : null), owed: port("owed", "owed" in over ? over.owed : OWED_FACT) });
}

const owedRow = (w, event = STOP) => owedRowOf(event, w).row;

test("an edit no check passed after is held ONCE, naming the component's declared check and its command -- and one turn.held", () => {
  const w = owedWorld();
  const answer = owed.run(STOP, w);
  assert.equal(answer.decision, "block");
  assert.match(answer.reason, /^Orbit holds this turn \(1 of 2 for this prompt\): api\/src\/refund\.mjs changed in component node:api and no test or declared verifying check passed after the edit\./);
  assert.match(answer.reason, /Run its declared test check rt-command-b464ab6e \(npm run test, in api\) to verify it, or say in one sentence why you stop here\./);
  assert.deepEqual(w.wrote, [{ kind: "unverified", check: "rt-command-b464ab6e", count: 1 }], "what it writes is turn.held, and only that");
  const again = owedWorld({ turn: turnOf([EDIT(), ev("turn.held", { kind: "unverified", check: CHECK.id, count: 1 }), EDIT()]) });
  assert.deepEqual([owed.run(STOP, again), owedRow(again), again.wrote], [null, "said-already", []], "never twice for this reason in one prompt, even after another edit");
  const afterWorkflow = owedWorld({ turn: turnOf([EDIT(), ev("turn.held", { kind: "workflow", task: OWNER.id, steps: ["qa"], count: 1 })]) });
  assert.match(owed.run(STOP, afterWorkflow).reason, /\(2 of 2 for this prompt\)/, "a workflow's hold counts toward the same budget, and is not this reason");
});

test("the guards are hold's own rows, shared and not copied, and the owed rows run cheapest first", () => {
  assert.deepEqual(OWED.slice(0, GUARDS.length), GUARDS, "the same row objects");
  assert.deepEqual(GUARDS.map((r) => r.row), ["host-cannot-hold", "held-already", "uncounted", "spent", "halted"]);
  assert.deepEqual(HOLD.slice(0, GUARDS.length), GUARDS);
  assert.deepEqual(OWED_ROWS.slice(GUARDS.length), ["verified", "said-already", "workflow-holds", "switched-off", "work-quiet", "unrecorded", "declared-passed", "unnamed", "hold"]);
  assert.deepEqual(OWED.filter((r) => r.deep).map((r) => r.row), ["switched-off", "work-quiet", "unrecorded"]);
  assert.equal(OWED.at(-1).when({}), true, "the last row always answers");
});

test("each guard alone stops it: a host that cannot hold, a held turn, an uncounted turn, a spent budget, a halt cue", () => {
  const codex = owedWorld({ host: { formatPostTool: () => null } });
  assert.deepEqual([owed.run(STOP, codex), codex.asked], [null, []], "no formatHold: nothing is even read");
  const active = owedWorld();
  assert.deepEqual([owed.run({ event: "turn-end", held: true }, active), active.asked], [null, []]);
  assert.equal(owedRow(owedWorld({ turn: null })), "uncounted");
  assert.equal(owedRow(owedWorld({ turn: turnOf([EDIT(), ev("turn.held", { kind: "workflow", task: OWNER.id, steps: ["qa"], count: 1 }), ev("turn.held", { kind: "workflow", task: OWNER.id, steps: ["qa"], count: 2 })]) })), "spent");
  const halted = owedWorld({ turn: turnOf([EDIT()], ["halt"]) });
  assert.deepEqual([owed.run(STOP, halted), owedRow(halted), halted.wrote], [null, "halted", []], "the person said to stop");
});

test("the cheap row: an edit and no TEST that PASSED after it -- a passing test after the edit is not held; a lint or a build reads on", () => {
  assert.equal(uncheckedEdit([EDIT()]), true);
  assert.equal(uncheckedEdit([]), false, "nothing edited");
  assert.equal(uncheckedEdit([ev("tool.used", { tool: "Read", kind: "read", ok: true })]), false);
  assert.equal(uncheckedEdit([EDIT(), CHECKED()]), false, "a passing check after the edit");
  assert.equal(uncheckedEdit([CHECKED(), EDIT()]), true, "a check before the last edit verified the code as it was then");
  assert.equal(uncheckedEdit([EDIT(), CHECKED(false)]), true, "a failed check verifies nothing");
  assert.equal(uncheckedEdit([EDIT(), CHECKED(true, "other")]), true, "a command that is not a check");
  assert.equal(uncheckedEdit([EDIT(), ev("command.ran", { orbit: "cli/automation", sub: "step", ok: true })]), true, "an Orbit command is not a check");
  assert.equal(uncheckedEdit([EDIT(), CHECKED(true, "test")]), false, "a test passing shows the change works");
  for (const klass of ["lint", "build"]) assert.equal(uncheckedEdit([EDIT(), CHECKED(true, klass)]), true, `a ${klass} passing says it reads well or compiles, never that it works`);
  assert.equal(uncheckedEdit([ev("tool.used", { tool: "Edit", kind: "edit", ok: false })]), false, "an edit that failed changed nothing");
  const w = owedWorld({ turn: turnOf([EDIT(), CHECKED()]) });
  assert.deepEqual([owed.run(STOP, w), owedRow(w), w.wrote], [null, "verified", []]);
});

test("an ordinary turn loads no owner record: nothing past the trail is asked, and the root loads nothing deep", () => {
  for (const events of [[], [ev("tool.used", { tool: "Read", kind: "read", ok: true })], [EDIT(), CHECKED()], [CHECKED(true, "other")]]) {
    const w = owedWorld({ turn: turnOf(events) });
    assert.deepEqual([owed.run(STOP, w), [...new Set(w.asked)]], [null, ["turn"]], JSON.stringify(events.map((e) => e.data)));
    assert.equal(owedNeedsOwners(STOP, owedWorld({ turn: turnOf(events) })), false);
    assert.equal(needsOwners(STOP, owedWorld({ turn: turnOf(events) })), false, "nor the workflow hold");
  }
  assert.equal(owedNeedsOwners(STOP, owedWorld()), true, "an edit no check passed after does");
  assert.equal(owedNeedsOwners({ event: "turn-end", held: true }, owedWorld()), false);
});

test("never when a person switched it off, or the settings cannot be read -- and the workflow hold's switch is not this one", () => {
  for (const settings of [{ trigger: { holdUnverified: false } }, { trigger: { holdOnStop: true } }, null, {}]) {
    const w = owedWorld({ settings });
    assert.deepEqual([owed.run(STOP, w), owedRow(w), w.wrote], [null, "switched-off", []], JSON.stringify(settings));
    assert.equal(w.asked.includes("owed"), false, "what the edits owe is never read once it is off");
  }
  assert.equal(owedRow(owedWorld({ settings: { trigger: { holdOnStop: false, holdUnverified: true } } })), "hold");
});

test("never past a person's pause, cancel or question on the session's governed work -- a running or finished one, or none, does not stop it", () => {
  assert.deepEqual(QUIET, ["paused", "cancelled", "waiting"]);
  for (const state of QUIET) {
    const w = owedWorld({ work: { kind: "task", id: "tsk-0123456789ab", lifecycle: "PAUSED", state } });
    assert.deepEqual([owed.run(STOP, w), owedRow(w), w.wrote], [null, "work-quiet", []], state);
  }
  for (const work of [null, { kind: "task", id: "tsk-0123456789ab", state: "running" }, { kind: "task", id: "tsk-0123456789ab", state: "ended" }]) assert.equal(owedRow(owedWorld({ work })), "hold", JSON.stringify(work));
});

test("never for a path neither a component's check nor a linked test speaks for, or an edit the working set has not kept yet", () => {
  const unowned = owedWorld({ owed: { changed: ["scratch/notes.txt"], paths: [], components: [], check: null, tests: [] } });
  assert.deepEqual([owed.run(STOP, unowned), owedRow(unowned), unowned.wrote], [null, "unnamed", []]);
  const nothing = owedWorld({ owed: { ...OWED_FACT, check: null, tests: [] } });
  assert.deepEqual([owed.run(STOP, nothing), owedRow(nothing)], [null, "unnamed"], "a component with no declared safe verifying check and no linked test");
  assert.equal(owedRow(owedWorld({ owed: { ...OWED_FACT, check: null } })), "unnamed", "a fact with no tests field names none");
  // The trail saw the edit, but the async working-set write of the very last edit has not landed: nothing is guessed.
  for (const missed of [{ changed: [], paths: [], components: [], check: null }, null]) {
    const w = owedWorld({ owed: missed });
    assert.deepEqual([owed.run(STOP, w), owedRow(w), w.wrote], [null, "unrecorded", []], JSON.stringify(missed));
  }
});

// ---- (P3b) with no declared check, the tests the relation adapters link to the edited files ---------------------------

const LINKED = { changed: ["pylint/checkers/variables.py"], paths: [], components: [], check: null, tests: ["tests/checkers/test_variables.py"] };

test("NAMED is ordered by what the engine has: a declared check, else the linked tests -- the first that names something is said", () => {
  assert.deepEqual(NAMED.map((n) => n.by), ["check", "tests"]);
  assert.equal(namedOf(OWED_FACT).by, "check");
  assert.equal(namedOf({ ...OWED_FACT, tests: ["api/test/refund.test.mjs"] }).by, "check", "a declared check wins over a linked test");
  assert.equal(namedOf(LINKED).by, "tests");
  for (const o of [{ ...LINKED, tests: [] }, { ...LINKED, tests: undefined }]) assert.equal(namedOf(o), null, JSON.stringify(o));
});

test("an edit no component's check speaks for, with linked tests, is held ONCE naming the test files -- never a command -- and asking for a regression test", () => {
  const w = owedWorld({ owed: LINKED });
  const answer = owed.run(STOP, w);
  assert.equal(answer.decision, "block");
  assert.match(answer.reason, /^Orbit holds this turn \(1 of 2 for this prompt\): pylint\/checkers\/variables\.py changed and no test passed after the edit\. The tests that go with it here: tests\/checkers\/test_variables\.py\./);
  assert.match(answer.reason, /Run them as this project runs its tests to verify it -- and a behaviour change no existing test covers wants a regression test -- or say in one sentence why you stop here\./);
  assert.deepEqual(w.wrote, [{ kind: "unverified", tests: 1, count: 1 }], "how many test files it named -- never a path, never a check it does not have");
  const again = owedWorld({ owed: LINKED, turn: turnOf([EDIT(), ev("turn.held", { kind: "unverified", tests: 1, count: 1 }), EDIT()]) });
  assert.deepEqual([owed.run(STOP, again), owedRow(again)], [null, "said-already"], "once per prompt, whatever it named");
  for (const [over, row] of [[{ turn: turnOf([EDIT()], ["halt"]) }, "halted"], [{ settings: { trigger: { holdUnverified: false } } }, "switched-off"], [{ work: { kind: "task", id: "tsk-0123456789ab", state: "paused" } }, "work-quiet"], [{ turn: turnOf([EDIT(), CHECKED(true, "test")]) }, "verified"]]) {
    const quiet = owedWorld({ owed: LINKED, ...over });
    assert.deepEqual([owed.run(STOP, quiet), owedRow(quiet), quiet.wrote], [null, row, []], row);
  }
  const both = owedWorld({ owed: { ...OWED_FACT, tests: ["api/test/refund.test.mjs"] } });
  assert.deepEqual([owed.run(STOP, both).reason.includes("rt-command-b464ab6e"), both.wrote], [true, [{ kind: "unverified", check: CHECK.id, count: 1 }]], "a declared check still wins");
});

test("the linked tests' reason is printable and bounded too", () => {
  const w = owedWorld({ owed: { ...LINKED, tests: ["tests/test_\u001b[2Jx.py", ...Array.from({ length: 40 }, (_, i) => `tests/${"y".repeat(60)}${i}/test_variables.py`)] } });
  const reason = owed.run(STOP, w).reason;
  assert.equal(/\u001b/.test(reason), false);
  assert.ok(Buffer.byteLength(reason) <= 600, `${Buffer.byteLength(reason)} bytes`);
  assert.deepEqual(w.wrote, [{ kind: "unverified", tests: 41, count: 1 }]);
});

test("a component's DECLARED verifying check that passed after the edit clears it, whatever class its command is; a lint or a build alone never does", () => {
  const lint = owedWorld({ turn: turnOf([EDIT(), CHECKED(true, "lint")]) });
  assert.match(owed.run(STOP, lint).reason, /rt-command-b464ab6e/, "a lint passing reads on, and the edit is still owed");
  const build = owedWorld({ turn: turnOf([EDIT(), CHECKED(true, "build")]), owed: LINKED });
  assert.match(owed.run(STOP, build).reason, /tests\/checkers\/test_variables\.py/, "a build passing too");
  const declared = owedWorld({ turn: turnOf([EDIT(), CHECKED(true, "lint")]), owed: { ...OWED_FACT, declaredPassed: true } });
  assert.deepEqual([owed.run(STOP, declared), owedRow(declared), declared.wrote], [null, "declared-passed", []]);
});

test("one hold at a time: a Stop the workflow hold speaks for is never held again for an edit, and the hold answers first", () => {
  const both = owedWorld({ turn: turnOf([STEP(), EDIT()]), owner: OWNER });
  assert.equal(holdRowOf(STOP, both).row, "hold");
  assert.equal(owedRow(both), "workflow-holds");
  const answer = dispatch(STOP, both, [hold, owed]);
  assert.match(answer.reason, /workflow tsk-0123456789ab \(EXECUTING\) is still running/);
  assert.deepEqual(both.wrote, [{ kind: "workflow", task: OWNER.id, steps: ["qa", "review"], count: 1 }], "one turn.held, the workflow's");
  const quiet = owedWorld({ turn: turnOf([STEP(), EDIT()]), owner: { ...OWNER, ready: [] } });
  assert.match(dispatch(STOP, quiet, [hold, owed]).reason, /rt-command-b464ab6e/, "a workflow with nothing ready leaves the edit's hold to answer");
  assert.deepEqual(quiet.wrote.map((d) => d.kind), ["unverified"]);
});

test("what the reason says is made printable and bounded: a checkout's declaration never reaches the host raw", () => {
  const w = owedWorld({ owed: { ...OWED_FACT, check: { ...CHECK, argv: ["npm", "run", "t\u001b[2Jest"], cwd: "." } } });
  const reason = owed.run(STOP, w).reason;
  assert.equal(/\u001b/.test(reason), false);
  assert.match(reason, /\(npm run t\[2Jest\)/, "a cwd of the checkout's root is not said");
  const many = owedWorld({ owed: { ...OWED_FACT, paths: Array.from({ length: 50 }, (_, i) => `api/src/${"x".repeat(40)}${i}.mjs`) } });
  const long = owed.run(STOP, many).reason;
  assert.ok(Buffer.byteLength(long) <= 600, `${Buffer.byteLength(long)} bytes`);
  assert.match(long, /\(\+46\)/, "a long list names four and counts the rest");
});

// ---- the real hooks, in a real checkout and store --------------------------------------------------------------------

const RAW = "session-raw-hold";

function checkout(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-hold-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  return { dir, repo, store: join(dir, "store") };
}

const run = (p, file, args, env = {}, input = undefined) => spawnSync(process.execPath, [join(ROOT, "cli", file), ...args], { cwd: p.repo, env: sealed({ ORBIT_STORE_DIR: p.store, ...env }), input, encoding: "utf8", timeout: 60000 });

const hook = (p, file, payload, env = {}) => run(p, file, [], env, JSON.stringify({ session_id: RAW, cwd: p.repo, ...payload }));

// A coordinated workflow this session started, as /orbit-help starts one: its task carries the session's mark.
function workflow(p) {
  const started = run(p, "automation.mjs", ["start", "--for=implement the refund approval rule and verify it", "--json"], { ORBIT_SESSION: hostSession("claude", RAW) });
  assert.equal(started.status, 0, started.stderr);
  return JSON.parse(started.stdout).task;
}

// One turn, through the hooks: the person's prompt, then one command of the workflow's loop.
function turn(p, prompt, command, env = {}) {
  assert.equal(hook(p, "router-hook.mjs", { hook_event_name: "UserPromptSubmit", prompt }, env).status, 0);
  if (command) assert.equal(hook(p, "learn-hook.mjs", { hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: `toolu_${seq++}`, tool_input: { command } }, env).status, 0);
}

const stop = (p, env = {}, active = false) => hook(p, "follow-hook.mjs", { hook_event_name: "Stop", stop_hook_active: active }, env);

const stepLine = (task) => `node ${join(ROOT, "cli", "automation.mjs")} step ${task} --json`;

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

const trail = (p) => walk(join(p.store, "control", "activity", "trace")).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(f, "utf8").trim().split("\n")).map((l) => JSON.parse(l));

test("through the real hooks: this session's running workflow is held once, a held turn never again, and the trail's turn.held is the one write", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  turn(p, "carry on with the refund work", stepLine(task));
  const before = walk(p.store).filter((f) => !f.includes(join("control", "activity", "trace")));
  const first = stop(p);
  assert.equal(first.status, 0, first.stderr);
  const answer = JSON.parse(first.stdout);
  assert.equal(answer.decision, "block");
  assert.match(answer.reason, new RegExp(`workflow ${task} \\(EXECUTING\\) is still running and step context is ready`));
  assert.match(answer.reason, new RegExp(`node ${join(ROOT, "cli", "automation.mjs").replace(/[\\/.]/g, "\\$&")} context ${task}`));
  assert.deepEqual(walk(p.store).filter((f) => !f.includes(join("control", "activity", "trace"))), before, "nothing but the trail was written");
  const held = trail(p).filter((e) => e.type === "turn.held");
  assert.deepEqual(held.map((e) => e.data), [{ kind: "workflow", task, steps: ["context"], count: 1 }]);
  assert.match(String(held[0].project), /^[0-9a-f]{12}$/, "named by the project's short hash, never a path");
  assert.deepEqual([stop(p, {}, true).stdout, trail(p).filter((e) => e.type === "turn.held").length], ["", 1], "stop_hook_active: the turn ends");
});

test("through the real hooks: another session's workflow, a turn with no workflow command, and a halt cue are never held", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  turn(p, "carry on with the refund work", stepLine(task));
  const other = run(p, "follow-hook.mjs", [], {}, JSON.stringify({ session_id: "another-session", cwd: p.repo, hook_event_name: "Stop", stop_hook_active: false }));
  assert.deepEqual([other.status, other.stdout], [0, ""], "another session's workflow is not this session's to hold");
  turn(p, "what does the refund rule say?", `node ${join(ROOT, "cli", "automation.mjs")} context ${task} --json`);
  assert.deepEqual([stop(p).stdout], [""], "a turn that only read where the workflow stands");
  turn(p, "stop here, I will look at it myself", stepLine(task));
  assert.deepEqual([stop(p).stdout], [""], "the person said to stop");
  assert.equal(trail(p).filter((e) => e.type === "turn.held").length, 0);
});

test("through the real hooks: the setting off, the trail off, a paused workflow -- nothing", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  writeState(realIo(), join(stateRooms(p.store).automation, "settings.json"), { trigger: { holdOnStop: false } }, AUTOMATION_SCHEMA);
  turn(p, "carry on with the refund work", stepLine(task));
  assert.equal(stop(p).stdout, "", "a person switched the hold off");
  writeState(realIo(), join(stateRooms(p.store).automation, "settings.json"), { trigger: { holdOnStop: true } }, AUTOMATION_SCHEMA);
  assert.equal(stop(p, { ORBIT_TRACE: "off" }).stdout, "", "the trail is off: nobody can count this prompt's holds");
  const revision = JSON.parse(run(p, "task.mjs", ["show", task, "--json"]).stdout).revision;
  const paused = run(p, "task.mjs", ["pause", task, "--human", `--expect=${revision}`, "--json"], { ORBIT_TRACE: "off" });
  assert.equal(paused.status, 0, paused.stderr);
  assert.equal(stop(p).stdout, "", "a person paused it");
  assert.equal(trail(p).filter((e) => e.type === "turn.held").length, 0);
});

// A checkout whose one component (api/) declares a safe test and build, understood by runtime -- and a file no
// component owns beside it.
const MANIFEST = { "package.json": { name: "refunds", version: "1.0.0", scripts: { test: "node --test", build: "node build.mjs" } }, "package-lock.json": { name: "refunds", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "refunds", version: "1.0.0" } } } };

function understood(t, scripts = {}) {
  const p = checkout(t);
  mkdirSync(join(p.repo, "api", "src"), { recursive: true });
  mkdirSync(join(p.repo, "notes"));
  const manifest = { ...MANIFEST, "package.json": { ...MANIFEST["package.json"], scripts: { ...MANIFEST["package.json"].scripts, ...scripts } } };
  for (const [file, doc] of Object.entries(manifest)) writeFileSync(join(p.repo, "api", file), `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(join(p.repo, "api", "src", "refund.mjs"), "export const refund = (a) => a;\n");
  writeFileSync(join(p.repo, "notes", "plan.txt"), "a plan\n");
  execFileSync("git", ["-C", p.repo, "add", "-A"], { env: sealed() });
  execFileSync("git", ["-C", p.repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "-m", "api"], { env: sealed() });
  const discovered = run(p, "runtime.mjs", ["discover", "--json"]);
  assert.equal(discovered.status, 0, discovered.stderr);
  return p;
}

const edit = (p, rel, env = {}) => assert.equal(hook(p, "learn-hook.mjs", { hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: `toolu_${seq++}`, tool_input: { file_path: join(p.repo, rel), old_string: "a", new_string: "b" }, tool_response: {} }, env).status, 0);

const bash = (p, command, ok = true) => assert.equal(hook(p, "learn-hook.mjs", { hook_event_name: ok ? "PostToolUse" : "PostToolUseFailure", tool_name: "Bash", tool_use_id: `toolu_${seq++}`, tool_input: { command } }).status, 0);

const unverifiedHolds = (p) => trail(p).filter((e) => e.type === "turn.held" && e.data.kind === "unverified");

test("through the real hooks: an edit under a component with no passing check after it is held once, naming the check -- and never twice", (t) => {
  const p = understood(t);
  turn(p, "make the refund rule reject amounts over what was paid");
  edit(p, "api/src/refund.mjs");
  const before = walk(p.store).filter((f) => !f.includes(join("control", "activity", "trace")));
  const first = stop(p);
  assert.equal(first.status, 0, first.stderr);
  const answer = JSON.parse(first.stdout);
  assert.equal(answer.decision, "block");
  assert.match(answer.reason, /api\/src\/refund\.mjs changed in component node:api and no test or declared verifying check passed after the edit\. Run its declared test check rt-command-[0-9a-f]+ \(npm run test, in api\)/);
  assert.deepEqual(walk(p.store).filter((f) => !f.includes(join("control", "activity", "trace"))), before, "nothing but the trail was written");
  const held = unverifiedHolds(p);
  assert.deepEqual(held.map((e) => Object.keys(e.data).sort()), [["check", "count", "kind"]]);
  assert.match(held[0].data.check, /^rt-command-[0-9a-f]+$/);
  assert.deepEqual([stop(p, {}, true).stdout, stop(p).stdout, unverifiedHolds(p).length], ["", "", 1], "stop_hook_active ends the turn; this prompt is never held again for it");
});

test("through the real hooks: a path no component owns, a passing check after the edit, a failed one", (t) => {
  const p = understood(t);
  turn(p, "write the plan down");
  edit(p, "notes/plan.txt");
  assert.equal(stop(p).stdout, "", "no component owns notes/plan.txt");
  turn(p, "make the refund rule reject amounts over what was paid");
  edit(p, "api/src/refund.mjs");
  bash(p, "cd api && npm run test");
  assert.equal(stop(p).stdout, "", "the check passed after the edit");
  turn(p, "and the other one");
  edit(p, "api/src/refund.mjs");
  bash(p, "cd api && npm run test", false);
  assert.match(stop(p).stdout, /"decision":"block"/, "a check that failed verifies nothing");
  assert.equal(unverifiedHolds(p).length, 1);
  turn(p, "write the plan again");
  edit(p, "notes/plan.txt");
  assert.match(stop(p).stdout, /api\/src\/refund\.mjs changed in component node:api/, "what the session still owes is the session's: an earlier edit no check has passed since");
});

// (P3b) A Python checkout runtime understanding declares no component or check for: what goes with an edited file is
// what the relation adapters link to it -- here `tests/checkers/test_variables.py` for `pkg/checkers/variables.py`.
const PYTHON = { "pkg/__init__.py": "", "pkg/checkers/__init__.py": "", "pkg/checkers/variables.py": "def unused(names):\n    return names\n", "pkg/other.py": "VALUE = 1\n", "tests/checkers/test_variables.py": "from pkg.checkers import variables\n\ndef test_unused():\n    assert variables.unused([]) == []\n" };

function python(t) {
  const p = checkout(t);
  for (const [file, text] of Object.entries(PYTHON)) {
    mkdirSync(dirname(join(p.repo, file)), { recursive: true });
    writeFileSync(join(p.repo, file), text);
  }
  execFileSync("git", ["-C", p.repo, "add", "-A"], { env: sealed() });
  execFileSync("git", ["-C", p.repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "-m", "pkg"], { env: sealed() });
  assert.equal(run(p, "runtime.mjs", ["discover", "--json"]).status, 0);
  return p;
}

test("through the real hooks (P3b): a Python edit no component declares a check for is held once, naming the test file the adapters link to it", (t) => {
  const p = python(t);
  turn(p, "fix the unused-import false positive");
  edit(p, "pkg/checkers/variables.py");
  const before = walk(p.store).filter((f) => !f.includes(join("control", "activity", "trace")));
  const first = stop(p);
  assert.equal(first.status, 0, first.stderr);
  const answer = JSON.parse(first.stdout);
  assert.equal(answer.decision, "block");
  assert.match(answer.reason, /pkg\/checkers\/variables\.py changed and no test passed after the edit\. The tests that go with it here: tests\/checkers\/test_variables\.py\. Run them as this project runs its tests/);
  assert.match(answer.reason, /a behaviour change no existing test covers wants a regression test/);
  assert.deepEqual(walk(p.store).filter((f) => !f.includes(join("control", "activity", "trace"))), before, "nothing but the trail was written");
  assert.deepEqual(unverifiedHolds(p).map((e) => e.data), [{ kind: "unverified", tests: 1, count: 1 }], "a count, never a path");
  assert.deepEqual([stop(p, {}, true).stdout, stop(p).stdout, unverifiedHolds(p).length], ["", "", 1], "never twice for this prompt");
});

test("through the real hooks (P3b): the checkout's own pytest patterns decide which tests go with a file -- setup.cfg's *test_*.py links unittest_variables.py", (t) => {
  const p = python(t);
  writeFileSync(join(p.repo, "setup.cfg"), "[metadata]\nname = pkg\n\n[tool:pytest]\ntestpaths = tests\npython_files = *test_*.py\n");
  execFileSync("git", ["-C", p.repo, "mv", "tests/checkers/test_variables.py", "tests/checkers/unittest_variables.py"], { env: sealed() });
  execFileSync("git", ["-C", p.repo, "add", "-A"], { env: sealed() });
  execFileSync("git", ["-C", p.repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "-m", "pytest config"], { env: sealed() });
  turn(p, "fix the unused-import false positive");
  edit(p, "pkg/checkers/variables.py");
  assert.match(stop(p).stdout, /The tests that go with it here: tests\/checkers\/unittest_variables\.py\./);
  assert.deepEqual(unverifiedHolds(p).map((e) => e.data), [{ kind: "unverified", tests: 1, count: 1 }]);
});

test("through the real hooks (P3b): a passing test run after the edit clears it, whatever runner; a file nothing links a test to is silent", (t) => {
  const p = python(t);
  for (const command of ["pytest tests/checkers/test_variables.py", "python -m pytest -q", "python3 -m unittest discover", ".venv/bin/pytest -x"]) {
    turn(p, `fix the false positive, then ${command}`);
    edit(p, "pkg/checkers/variables.py");
    bash(p, command);
    assert.equal(stop(p).stdout, "", `${command} passed after the edit`);
  }
  turn(p, "and once more");
  edit(p, "pkg/checkers/variables.py");
  bash(p, "python -m pytest -q", false);
  assert.match(stop(p).stdout, /tests\/checkers\/test_variables\.py/, "a failed test run verifies nothing");
  turn(p, "now the constant");
  edit(p, "pkg/checkers/variables.py");
  bash(p, "pytest");
  edit(p, "pkg/other.py");
  assert.equal(stop(p).stdout, "", "no adapter links a test to pkg/other.py and no component owns it: silent, never a guess");
  assert.equal(unverifiedHolds(p).length, 1);
});

test("through the real hooks (P3b): a component's declared check still wins over a test the adapters link", (t) => {
  const p = understood(t);
  writeFileSync(join(p.repo, "api", "src", "refund.test.mjs"), "import { refund } from './refund.mjs';\n");
  execFileSync("git", ["-C", p.repo, "add", "-A"], { env: sealed() });
  execFileSync("git", ["-C", p.repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "-m", "test"], { env: sealed() });
  turn(p, "make the refund rule reject amounts over what was paid");
  edit(p, "api/src/refund.mjs");
  assert.match(stop(p).stdout, /Run its declared test check rt-command-[0-9a-f]+ \(npm run test, in api\)/);
  assert.deepEqual(unverifiedHolds(p).map((e) => Object.keys(e.data).sort()), [["check", "count", "kind"]]);
});

// What a turn owes is evidence the change WORKS: a lint or a build passing shows it reads well or compiles, never that.
const DEV2 = "/opt/miniconda3/envs/testbed/bin/python -m pylint /tmp/a.py --disable=all --enable=unused-import";

test("through the real hooks: a lint, a build or a manual repro passing after the edit is still held; a test or the component's declared verifying check clears it", (t) => {
  const p = understood(t, { lint: "node lint.mjs" });
  for (const command of ["npm run build", "make lint", DEV2]) {
    turn(p, `change the refund rule, then ${command}`);
    edit(p, "api/src/refund.mjs");
    bash(p, command);
    assert.match(stop(p).stdout, /"decision":"block"/, `${command} passing shows nothing works`);
  }
  turn(p, "change it again and run its declared lint");
  edit(p, "api/src/refund.mjs");
  bash(p, "npm run lint");
  assert.equal(stop(p).stdout, "", "the component's own declared verifying check (purpose verify) passed after the edit");
  turn(p, "and once more, with its test");
  edit(p, "api/src/refund.mjs");
  bash(p, "npm run build");
  bash(p, "npm test");
  assert.equal(stop(p).stdout, "", "a test passed after the edit");
  assert.equal(unverifiedHolds(p).length, 3);
});

test("through the real hooks (P3b): the dev2 repro after a Python edit is still held, naming the linked test", (t) => {
  const p = python(t);
  turn(p, "fix the unused-import false positive");
  edit(p, "pkg/checkers/variables.py");
  bash(p, DEV2);
  assert.match(stop(p).stdout, /The tests that go with it here: tests\/checkers\/test_variables\.py/);
});

test("through the real hooks: the setting off, a halt cue, the working set off -- nothing", (t) => {
  const p = understood(t);
  writeState(realIo(), join(stateRooms(p.store).automation, "settings.json"), { trigger: { holdUnverified: false } }, AUTOMATION_SCHEMA);
  turn(p, "make the refund rule reject amounts over what was paid");
  edit(p, "api/src/refund.mjs");
  assert.equal(stop(p).stdout, "", "a person switched it off");
  writeState(realIo(), join(stateRooms(p.store).automation, "settings.json"), { trigger: { holdUnverified: true } }, AUTOMATION_SCHEMA);
  turn(p, "stop here, I will look at it myself");
  edit(p, "api/src/refund.mjs");
  assert.equal(stop(p).stdout, "", "the person said to stop");
  turn(p, "now the other rule");
  edit(p, "api/src/refund.mjs");
  assert.equal(stop(p, { ORBIT_WORKING_SET: "off" }).stdout, "", "nothing keeps what was edited: never a guess");
  assert.equal(unverifiedHolds(p).length, 0);
});

test("fast and silent with no governed work: an ordinary Stop answers nothing and reads no owner", (t) => {
  const p = checkout(t);
  turn(p, "rename qty to quantity in orders.mjs", "git status");
  const started = process.hrtime.bigint();
  const r = stop(p);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
  assert.ok(ms < 5000, `an ordinary Stop took ${ms} ms`);
  const bare = spawnSync(process.execPath, [join(ROOT, "cli", "follow-hook.mjs")], { cwd: p.dir, env: sealed({ ORBIT_STORE_DIR: join(p.dir, "elsewhere") }), input: JSON.stringify({ session_id: "s", cwd: p.dir, hook_event_name: "Stop", stop_hook_active: false }), encoding: "utf8" });
  assert.deepEqual([bare.status, bare.stdout, bare.stderr], [0, "", ""], "no store, no trail, no checkout: nothing");
});

test("FAIL OPEN: garbage, no payload and an unknown host all exit 0 with nothing said", (t) => {
  const p = checkout(t);
  for (const input of ["", "not json", "{}", JSON.stringify({ hook_event_name: "Unheard" }), JSON.stringify({ hook_event_name: "Stop" })]) {
    const r = run(p, "follow-hook.mjs", [], {}, input);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], input);
  }
  const codex = run(p, "follow-hook.mjs", ["--host=codex", "--protocol=2"], {}, JSON.stringify({ hook_event_name: "Stop", session_id: "s", cwd: p.repo, turn_id: "t1" }));
  assert.deepEqual([codex.status, codex.stdout], [0, ""], "a host whose Stop blocking is unverified is never held");
});

// ---- the sweep: every captured Claude payload through the new entries ------------------------------------------------

test("every captured Claude payload, through the new synchronous entries, says nothing where no governed work exists", (t) => {
  const p = checkout(t);
  const dir = join(ROOT, "test", "fixtures", "hooks", "claude");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 30, `${files.length} fixtures`);
  for (const file of files) {
    const { input } = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const cwd of [input.cwd, p.repo]) {
      const r = spawnSync(process.execPath, [join(ROOT, "cli", "follow-hook.mjs")], { cwd: p.repo, env: sealed({ ORBIT_STORE_DIR: p.store }), input: JSON.stringify({ ...input, cwd }), encoding: "utf8", timeout: 30000 });
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], `${file} in ${cwd}`);
    }
  }
});

test("hooks.json wires the hold and the agent-return line SYNCHRONOUSLY, beside the async Stop entry it leaves as it was; the other hosts' files carry no hold", () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;
  const follow = (entries) => entries.flatMap((e) => e.hooks.map((h) => ({ ...h, matcher: e.matcher }))).filter((h) => /cli\/follow-hook\.mjs"$/.test(h.command));
  assert.deepEqual(follow(hooks.Stop).map((h) => [h.async, h.timeout <= 10]), [[undefined, true]], "a hold arrives only from a synchronous Stop hook");
  assert.deepEqual(follow(hooks.PostToolUse).map((h) => [h.matcher, h.async]), [["Agent", undefined]], "additionalContext reaches the model beside the result only from a synchronous hook");
  assert.deepEqual(hooks.Stop.flatMap((e) => e.hooks).filter((h) => /learn-hook/.test(h.command)).map((h) => h.async), [true], "the trail's turn boundary is still the async entry");
  for (const file of ["codex.json", "grok.json"]) assert.equal(readFileSync(join(ROOT, "hooks", file), "utf8").includes("follow-hook"), false, file);
});
