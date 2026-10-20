// The ENGINEER COCKPIT of 1.8.5 in the full-screen viewer, pure: what the task does NOW is the second thing on the
// screen (ACTIVITY, after the stage, and the last section a short terminal lets go of), a check shows what its runner
// REPORTED -- never a total nobody said, never a case "running" -- `i` lists every action with its why, its evidence
// and, for a check, its cases and failures; an observation is replaced, never merged, so a late or repeated frame
// moves nothing; a task a launcher asks the viewer to show is followed, or only offered when a person picked one;
// and the status line, `watch --plain` and `--jsonl` read the same projection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activitiesOf, focusOf, progressWords } from "../src/live/activity.mjs";
import { OWN_SEQUENCE } from "../src/live/render/ansi.mjs";
import { compactLines } from "../src/live/render/compact.mjs";
import { jsonlLine } from "../src/live/render/jsonl.mjs";
import { activityPlainLines } from "../src/live/render/plain.mjs";
import { snapshotOf } from "../src/live/snapshot.mjs";
import { frameOf } from "../src/live/tui/frame.mjs";
import { HELP, KEYMAP, actionOfKey } from "../src/live/tui/keys.mjs";
import { budgetOf } from "../src/live/tui/layout.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { ENG, NOW, ago, engEvents, engView, fed, stateOf } from "./live-tui.fixture.mjs";

const plain = (frame) => frame.lines.map((l) => l.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");

// The running test of the fixture (act-6), as its observation reports it.
const observation = (over = {}) => ({ version: 1, task: ENG, action: "act-6", attempt: "att-2", check: "chk-6", command: { id: "rt-command-0000a7e5", purpose: "test", component: "node:api", declaredAs: "test" }, why: "required: the change reaches node:api (modified: api/routing.js)", adapter: { id: "tap", framework: "a TAP stream", runner: "TAP", capabilities: { lifecycle: true, cases: "reported", total: "at-end", order: "reported" }, observes: ["passed", "failed"] }, state: "running", startedAt: ago(3), lastAt: ago(1), endedAt: null, counts: { passed: 33, failed: 1, skipped: 0, todo: 0, cancelled: 0 }, reported: 34, total: null, totals: null, summaries: 0, recent: [{ key: "1.33", name: "TrainingDataContractTests.ValidPayload", state: "passed" }, { key: "1.34", name: "ToolRoutingTests.MissingTool", state: "failed" }], failures: [{ key: "1.34", name: "ToolRoutingTests.MissingTool", category: "assertion", message: "expected 'tool-a' · actual 'tool-b'", location: "test/routing.test.js:41:5", stack: ["TestContext (test/routing.test.js:41:5)"] }], failuresMore: 0, output: { lines: 412, bytes: { out: 18000, err: 0 }, lastAt: ago(1) }, outcome: null, seq: 40, complete: false, mismatch: false, gaps: [], resets: 0, ...over });

const viewFrame = (view, action = "act-6", revision = view.seq) => ({ event: "activity-view", id: "t=9", data: { source: "activity", task: ENG, action, revision, view } });

const observed = (over = {}, size = {}) => reduce(fed(stateOf(size), ENG, engView(), engEvents()), { type: "frames", task: ENG, frames: [viewFrame(observation(over))] });

test("ACTIVITY comes right after the stage: what runs, why, what its runner reported, the latest failure, when it last printed", () => {
  const text = plain(frameOf(observed({}, { columns: 130, rows: 44 })));
  assert.match(text, /ACTIVITY  [◐◓◑◒] RUNNING · TEST/);
  assert.match(text, /why +required: the change reaches node:api \(modified: api\/routing\.js\)/);
  assert.match(text, /cases +33 passed · 1 failed +34 reported · total unknown · TAP · in reported order/);
  assert.match(text, /failed +✗ ToolRoutingTests\.MissingTool — assertion: expected 'tool-a' · actual 'tool-b'/);
  assert.match(text, /output +412 line\(s\) · last printed 1s ago/);
  assert.ok(text.indexOf("ACTIVITY") < text.indexOf("ENGINEER") && text.indexOf("STAGE") < text.indexOf("ACTIVITY"));
});

test("no total is ever invented, a command nothing reads says so, and an action that reports nothing shows its time alone", () => {
  assert.doesNotMatch(plain(frameOf(observed())), /33 of \d+/, "the runner said no total: none is drawn");
  assert.match(plain(frameOf(observed({ total: 40, totals: { tests: 40 } }))), /34 of 40 reported/);
  const generic = plain(frameOf(observed({ adapter: { id: "generic", capabilities: { cases: "none", total: "none", order: "reported" }, observes: [] }, counts: { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 }, reported: 0, recent: [], failures: [] })));
  assert.match(generic, /case progress unavailable: the command prints nothing Orbit reads as case results/);
  const noCheck = fed(stateOf(), ENG, engView({ actions: [{ id: "act-9", type: "implement", tool: null, label: "the change, in the workspace", state: "running", startedAt: ago(30), endedAt: null, receipts: [], evidence: "reported", attempt: "att-2" }] }), engEvents());
  assert.match(plain(frameOf(noCheck)), /progress +this action reports no progress: only how long it has run/);
});

test("an observation is REPLACED by a newer one only: a late or repeated frame, or a line of another action, moves nothing", () => {
  const s = observed();
  const older = reduce(s, { type: "frames", task: ENG, frames: [viewFrame(observation({ seq: 12, counts: { passed: 2, failed: 0, skipped: 0, todo: 0, cancelled: 0 } }), "act-6", 12)] });
  assert.equal(older.tasks[ENG].activity["act-6"].counts.passed, 33, "a stale projection is ignored");
  const begunAgain = reduce(s, { type: "frames", task: ENG, frames: [viewFrame(observation({ seq: 3, resets: 1, counts: { passed: 1, failed: 0, skipped: 0, todo: 0, cancelled: 0 } }), "act-6", 3)] });
  assert.equal(begunAgain.tasks[ENG].activity["act-6"].counts.passed, 1, "a file begun again replaces it, however low its revision");
  const otherAction = reduce(s, { type: "frames", task: ENG, frames: [viewFrame(observation({ action: "act-5", seq: 99, counts: { passed: 0, failed: 3, skipped: 0, todo: 0, cancelled: 0 } }), "act-5", 99)] });
  assert.equal(otherAction.tasks[ENG].activity["act-6"].counts.passed, 33, "a late line of an old attempt's check updates that check only");
  assert.equal(otherAction.tasks[ENG].activity["act-5"].counts.failed, 3);
});

test("`i` lists every action, newest first, with its state; f keeps the ones worth finding; enter opens one with its evidence and its cases", () => {
  let s = reduce(observed({}, { columns: 130, rows: 50 }), { type: "overlay", name: "activity" });
  const list = plain(frameOf(s));
  assert.match(list, /ACTIVITY[\s\S]*▶ RUNNING +act-6 +TEST[\s\S]*✗ FAILED +act-5[\s\S]*✓ ENDED +act-4 +BUILD/);
  assert.match(list, /an observation is never the verdict/);
  s = reduce(s, { type: "pick" });
  const open = plain(frameOf(s));
  assert.match(open, /why +required: the change reaches node:api/);
  assert.match(open, /result +still running: its receipt is written when it ends/);
  assert.match(open, /OBSERVED +what the runner printed while it ran -- the receipt above is the check's word/);
  assert.match(open, /total +not said by the runner/);
  assert.match(open, /✗ ToolRoutingTests\.MissingTool +assertion · test\/routing\.test\.js:41:5/);
  const failedOnly = reduce(reduce(s, { type: "inspect-filter" }), { type: "inspect-filter" });
  assert.equal(failedOnly.viewer.inspect.filter, "failed");
  assert.match(plain(frameOf(failedOnly)), /1 shown · failed or could not run[\s\S]*act-5/);
  assert.doesNotMatch(plain(frameOf(failedOnly)), /act-6 +TEST/);
});

test("`i` is a key of the dashboard and of every overlay, said in the help, and only ever opens a view", () => {
  assert.deepEqual(KEYMAP.normal.i, { type: "overlay", name: "activity" });
  assert.deepEqual(actionOfKey({ mode: "normal", overlay: "evidence" }, "f"), { type: "inspect-filter" });
  assert.ok(HELP.some(([key]) => key === "i"));
  assert.ok(Object.values(KEYMAP).every((layer) => Object.values(layer).every((a) => typeof a === "function" || !["approve", "resume", "cancel", "pause", "run", "stop", "start"].includes(a.type))), "no key is a decision about the task");
});

test("a short terminal keeps the stage and what runs now before anything else", () => {
  const sections = ["stage", "activity", "workflow", "engineer", "verify", "qa", "sandbox", "recent", "notices"].map((name) => ({ name, rows: Array.from({ length: 6 }, () => ({})) }));
  assert.deepEqual(budgetOf(sections, 3).sections.map((s) => s.name), ["stage", "activity"]);
  assert.deepEqual(budgetOf(sections, 6).sections.map((s) => s.name), ["stage", "activity", "recent"]);
  assert.match(plain(frameOf(observed({}, { columns: 70, rows: 16 }))), /NOW +[◐◓◑◒] RUNNING/, "narrow: the short label, still shown");
});

test("what a runner printed cannot drive the terminal: a case name full of escape sequences is drawn as text", () => {
  const evil = observation({ recent: [{ key: "x", name: "pwned\u001b]0;title\u0007\u001b[2J\u001b[31mred", state: "failed" }], failures: [{ key: "x", name: "\u001b]52;c;Y2xpcA==\u0007clip", category: "unknown", message: "\u001b[1Aup", location: null, stack: [] }] });
  const frame = frameOf(reduce(fed(stateOf({ columns: 130, rows: 44 }), ENG, engView(), engEvents()), { type: "frames", task: ENG, frames: [viewFrame(evil)] }));
  const sequences = frame.lines.join("").match(/\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g) ?? [];
  assert.ok(sequences.every((seq) => OWN_SEQUENCE.test(seq)), sequences.filter((seq) => !OWN_SEQUENCE.test(seq)).join(" "));
});

test("a task a launcher asks the viewer to show is followed -- or, when a person picked one here, only offered", () => {
  const auto = reduce(stateOf({ start: { auto: true } }), { type: "selection", task: "tsk-aaaaaaaaaaaa" });
  assert.equal(auto.root, "tsk-aaaaaaaaaaaa");
  const picked = reduce(reduce(stateOf(), { type: "overlay", name: "picker" }), { type: "selection", task: "tsk-bbbbbbbbbbbb" });
  const person = { ...picked, picker: { ...picked.picker, auto: false } };
  const held = reduce(person, { type: "selection", task: "tsk-cccccccccccc" });
  assert.equal(held.root, person.root, "a person's choice is never moved under them");
  assert.match(held.viewer.message, /a new task to show: tsk-cccccccccccc — t picks it/);
});

test("the derived activity: why from the engine's own words, next from a decision AFTER the action, never a guess", () => {
  const events = [...engEvents(), { source: "task", n: 20, at: ago(1), kind: "decision", nextAction: "diagnose", hypothesis: "the routing test fails on the missing tool" }];
  const done = engView({ actions: engView().actions.map((a) => (a.id === "act-6" ? { ...a, state: "failed", endedAt: ago(2) } : a)) });
  const ended = [...events.slice(0, -1), { source: "task", n: 19, at: ago(2), kind: "action-completed", id: "act-6", outcome: "failed" }, events.at(-1)];
  const acts = activitiesOf({ view: done, events: ended, observations: { "act-6": observation({ state: "completed" }) } });
  assert.equal(focusOf(acts).id, "act-6");
  assert.deepEqual(focusOf(acts).next, { decided: "diagnose", at: ago(1) });
  assert.equal(focusOf(acts).why, "required: the change reaches node:api (modified: api/routing.js)");
  const waiting = activitiesOf({ view: done, events: ended.slice(0, -1), observations: {} });
  assert.deepEqual(focusOf(waiting).next, { decided: null, waiting: "the orchestrator's next decision" });
  assert.equal(progressWords(null), null);
});

test("the status line, `watch --plain` and `--jsonl` read the same projection", () => {
  const snap = snapshotOf({ association: { how: "session", task: ENG, ids: [ENG] }, collected: { view: engView(), cursor: "t=9" }, events: engEvents().filter((e) => e.source === "task"), nowMs: NOW, idleAfterMs: 120000, activity: { "act-6": observation() } });
  assert.match(compactLines(snap, { lines: 2, columns: 160 }).join("\n"), /▶ test 3s · 33 passed · 1 failed/);
  const first = activityPlainLines(null, observation());
  assert.match(first.join("\n"), /observed: test on node:api, read with tap · required: the change reaches node:api/);
  assert.match(first.join("\n"), /✗ ToolRoutingTests\.MissingTool — assertion: expected 'tool-a'/);
  assert.deepEqual(activityPlainLines(observation(), observation({ counts: { passed: 34, failed: 1, skipped: 0, todo: 0, cancelled: 0 } })), [], "a case that passed prints nothing in a log");
  assert.match(activityPlainLines(observation(), observation({ state: "completed", total: 35 })).join(), /completed: 33 passed · 1 failed · 0 skipped · total 35 \(the runner's\)/);
  assert.equal(JSON.parse(jsonlLine(viewFrame(observation()))).event, "activity-view");
});
