// THE WORKSPACE PANE's model (src/live/tui/workspace.mjs, 1.8.5): the checklist of the steps a task actually took --
// a workflow's plan with its engineering child under its step, or an engineering task's own steps in its journal's
// order, the baseline's runs under the baseline, the files under the change, what the change is held to under its
// verification -- the task worked on now, the status bar and the views, in seven status words that each need their
// evidence. Nothing is invented: no step nothing recorded, no total a runner did not say, and a runner that aborted
// before any case is BLOCKED, never a pass and never a failure of the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paneOf, VIEW_ROWS } from "../src/live/tui/pane.mjs";
import { derivedOf } from "../src/live/tui/derive.mjs";
import { contextOf } from "../src/live/tui/frame.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { checkStatus, checklistOf, currentRows, observedWords, paneTierOf, statusBarOf, viewsOf } from "../src/live/tui/workspace.mjs";
import { STATUS_WORDS } from "../src/live/words.mjs";
import { ENG, ago, engEvents, engView, fed, stateOf, workflow } from "./live-tui.fixture.mjs";

const text = (r) => [...r.left, ...r.right].map((s) => s.text).join("");
const ctxOf = (state) => contextOf(state, derivedOf(state));

const act = (id, type, state, over = {}) => ({ id, type, tool: over.tool ?? null, label: over.label ?? type, state, startedAt: ago(over.s ?? 100), endedAt: state === "running" ? null : ago((over.s ?? 100) - 5), receipts: [], evidence: "receipt", attempt: over.attempt ?? null, summary: over.summary ?? null });

const obs = (action, over = {}) => ({ version: 1, task: ENG, action, attempt: null, check: null, command: { id: over.tool ?? "rt-test", purpose: "test", component: "node:web", declaredAs: "test", program: "npm" }, why: "required: the change reaches node:web (modified: web/src/pricing.js)", adapter: { id: "tap", runner: "TAP", capabilities: { lifecycle: true, cases: "reported", total: "at-end", order: "reported" }, observes: ["passed", "failed"] }, state: "running", startedAt: ago(3), lastAt: ago(1), endedAt: null, counts: { passed: 24, failed: 2, skipped: 0, todo: 0, cancelled: 0 }, reported: 26, total: null, totals: null, summaries: 0, recent: [], failures: [], failuresMore: 0, output: { lines: 40, bytes: { out: 900, err: 0 }, lastAt: ago(1) }, outcome: null, aborted: null, seq: 30, complete: false, mismatch: false, gaps: [], ...over });

const viewWith = (actions, verification, over = {}) => engView({ actions, verification, stage: "TESTING", changes: { files: 2, added: 2, removed: 2, paths: [{ path: "web/src/pricing.js", change: "modified", added: 1, removed: 1 }, { path: "ledger/Ledger.cs", change: "modified", added: 1, removed: 1 }] }, receipts: [{ key: "impact:imp-4", domain: "impact", ref: "imp-4", outcome: "SCOPED", summary: "plan: 2 component(s) reached", at: ago(110) }], ...over });

const observed = (state, action, view) => reduce(state, { type: "frames", task: ENG, frames: [{ event: "activity-view", id: "t=99", data: { source: "activity", task: ENG, action, revision: view.seq, view } }] });

// An engineering task verifying its change: context, a plan, a baseline that failed (the bug it fixes), the change, its
// record, a build that passed and a test running now.
const ACTIONS = [
  act("act-1", "gather-context", "succeeded", { s: 200, summary: "6 section(s) of project context" }),
  act("act-2", "plan", "succeeded", { s: 190, summary: "2 path(s) in the plan's scope; 2 check(s) required, 1 not affected" }),
  act("act-3", "test", "failed", { s: 180, tool: "rt-test", label: "test · node:web · test", summary: "test · node:web · test · exit 1 · 8s" }),
  act("act-4", "implement", "succeeded", { s: 150, attempt: "att-1", summary: "the change was read back" }),
  act("act-5", "record-changes", "succeeded", { s: 140, attempt: "att-1", summary: "2 file(s) changed since the base revision" }),
  act("act-6", "build", "succeeded", { s: 30, tool: "rt-build", label: "build · node:web · build", attempt: "att-1" }),
  act("act-7", "test", "running", { s: 3, tool: "rt-test", label: "test · node:web · test", attempt: "att-1" }),
];
const HELD = [
  { subject: "rt-build", obligation: "node:web · build build passes", state: "satisfied", evidence: "check:chk-6" },
  { subject: "rt-test", obligation: "node:web · test test passes", state: "owed", evidence: null },
  { subject: "rt-api", obligation: "node:api · test test — not affected, not run", state: "not-applicable", evidence: null },
];

const verifying = () => observed(fed(stateOf({ columns: 64, rows: 40 }), ENG, viewWith(ACTIONS, HELD), engEvents()), "act-7", obs("act-7"));

test("an engineering task's checklist is the steps its journal recorded, in order, with what each ran or changed under it", () => {
  const rows = checklistOf(ctxOf(verifying()));
  const lines = rows.map((r) => `${"  ".repeat(r.depth)}${text(r).trim()}`);
  assert.deepEqual(rows.filter((r) => r.depth === 0).map((r) => [r.left.map((x) => x.text).join("").trim(), r.status]), [["✓ Project context", "PASSED"], ["✓ Plan", "PASSED"], ["✓ Baseline (before the change)", "PASSED"], ["✓ Implement", "PASSED"], ["✓ Changes recorded", "PASSED"], ["● Verify", "RUNNING"]]);
  assert.ok(lines.some((l) => /^ {2}✗ test · node:web · test\s*FAILED/.test(l)), "the baseline's run, as it came: failed before the change");
  assert.ok(lines.some((l) => /^ {2}M web\/src\/pricing\.js\s*\+1 −1/.test(l)), "the files under the change");
  assert.ok(lines.some((l) => /^ {2}✓ node:web · build build passes\s*PASSED/.test(l)));
  assert.ok(lines.some((l) => /^ {2}● node:web · test test passes\s*RUNNING\s+24 passed · 2 failed \(26 reported · total unknown\)/.test(l)), "what the runner reported so far, never a total it did not say");
  assert.ok(lines.some((l) => /^ {2}○ node:api · test test\s*NOT RUN\s+not affected/.test(l)));
  assert.equal(rows.find((r) => text(r).includes("Baseline")).status, "PASSED", "a baseline that recorded a failure is a baseline taken, not a step that failed");
});

test("the task worked on now: which, where it stands, what runs, why, with what, on what, how far, and what comes next", () => {
  const lines = currentRows(ctxOf(verifying())).map(text);
  assert.match(lines.find((l) => l.startsWith("task")), new RegExp(ENG));
  assert.match(lines.find((l) => l.startsWith("stage")), /EXECUTING · TESTING · attempt 2\/5/);
  assert.match(lines.find((l) => l.startsWith("action")), /act-7 · test · test · node:web · test/);
  assert.match(lines.find((l) => l.startsWith("goal")), /the change reaches node:web/);
  assert.match(lines.find((l) => l.startsWith("runs")), /npm · test/, "the program's own name and the declared check: the argument list is never written");
  assert.match(lines.find((l) => l.startsWith("component")), /node:web/);
  assert.match(lines.find((l) => l.startsWith("files")), /web\/src\/pricing\.js, ledger\/Ledger\.cs/);
  assert.match(lines.find((l) => l.startsWith("observed")), /24 passed · 2 failed/);
  assert.match(lines.find((l) => l.startsWith("status")), /● RUNNING/);
  const narrow = currentRows(ctxOf(verifying()), true).map((l) => text(l).split(/\s+/)[0]);
  assert.deepEqual(narrow, ["task", "action", "observed", "status"], "a narrow pane keeps what runs and how far");
});

test("a runner that aborted before any case is BLOCKED -- an environment's doing -- with the engine's own verdict beside it", () => {
  const actions = [...ACTIONS.slice(0, 6), act("act-7", "test", "failed", { s: 20, tool: "rt-test", label: "test · dotnet:ledger.tests · test", attempt: "att-1" })];
  const held = [HELD[0], { ...HELD[1], state: "violated", evidence: "check:chk-7" }, HELD[2]];
  const aborted = obs("act-7", { state: "failed", counts: { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 }, reported: 0, adapter: { id: "dotnet-test", runner: "VSTest", capabilities: { lifecycle: true, cases: "failures", total: "at-end", order: "reported" }, observes: ["failed", "skipped"] }, aborted: { why: "the test run aborted: System.Net.Sockets.SocketException (13): Permission denied", category: "environment" } });
  const state = observed(fed(stateOf({ columns: 64, rows: 40 }), ENG, viewWith(actions, held, { lifecycle: "FAILED", terminal: true, stopReason: "VERIFICATION_FAILED" }), engEvents()), "act-7", aborted);
  const row = checklistOf(ctxOf(state)).find((r) => text(r).includes("test test passes"));
  assert.equal(row.status, "BLOCKED");
  assert.match(text(row), /BLOCKED\s+held as REGRESSED · no case ran: the test run aborted: System\.Net\.Sockets\.SocketException \(13\): Permission denied \(environment\)/);
  assert.equal(checkStatus({ state: "failed" }, aborted), "BLOCKED");
  assert.equal(checkStatus({ state: "failed" }, { ...aborted, aborted: null }), "FAILED");
  assert.match(currentRows(ctxOf(state)).map(text).find((l) => l.startsWith("status")), /■ BLOCKED/);
  assert.match(currentRows(ctxOf(state)).map(text).find((l) => l.startsWith("blocker")), /1 regressed · stopped: VERIFICATION_FAILED/);
});

test("a baseline run is the base revision's: while it runs, the check the change is held to is still NOT RUN", () => {
  const actions = [ACTIONS[0], ACTIONS[1], act("act-3", "test", "running", { s: 4, tool: "rt-test", label: "test · node:web · test" })];
  const state = observed(fed(stateOf({ columns: 64, rows: 40 }), ENG, viewWith(actions, HELD), engEvents()), "act-3", obs("act-3", { why: "baseline: how it does on the base revision, before the code first changes" }));
  const rows = checklistOf(ctxOf(state));
  assert.equal(rows.find((r) => r.depth === 1 && text(r).startsWith("  ● test · node:web · test")).status, "RUNNING", "under the baseline: running");
  assert.equal(rows.find((r) => text(r).includes("node:web · test test passes")).status, "NOT_RUN", "under the verification the plan requires: not run yet");
});

test("a coordinated workflow's checklist is its PLAN's steps -- pending ones too -- with the engineering task expanded under its step", () => {
  const rows = checklistOf(ctxOf(workflow({ columns: 64, rows: 40 })));
  const top = rows.filter((r) => r.depth === 0).map((r) => [text(r).trim().replace(/\s+/g, " "), r.status]);
  assert.deepEqual(top.map(([, s]) => s), ["PASSED", "UNKNOWN", "RUNNING", "NOT_RUN"]);
  assert.match(top[0][0], /Requirements/);
  assert.match(top[1][0], /Project context.*reported, no receipt/, "a step only reported is UNKNOWN, never done");
  assert.match(top[2][0], /Engineering/);
  assert.match(top[3][0], /Final review/, "the plan named it, so it is shown, not yet run");
  assert.ok(rows.some((r) => r.depth >= 1), "the engineering task's own steps under its step");
});

test("nothing is invented: no step nothing recorded, no pending verification once the task ended, no total a runner did not say", () => {
  const empty = fed(stateOf({ columns: 64, rows: 40 }), ENG, engView({ actions: [], verification: [], receipts: [] }), engEvents());
  assert.deepEqual(checklistOf(ctxOf(empty)), []);
  const owedButEnded = fed(stateOf({ columns: 64, rows: 40 }), ENG, viewWith([ACTIONS[0], ACTIONS[1]], HELD, { terminal: true, lifecycle: "CANCELLED" }), engEvents());
  assert.ok(!checklistOf(ctxOf(owedButEnded)).some((r) => text(r).includes("required by the plan")));
  const live = fed(stateOf({ columns: 64, rows: 40 }), ENG, viewWith([ACTIONS[0], ACTIONS[1]], HELD), engEvents());
  assert.ok(checklistOf(ctxOf(live)).some((r) => /Verify.*required by the plan, not run yet/.test(text(r))), "what the plan holds the change to, before any check ran");
  assert.equal(observedWords(obs("a", { counts: { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 }, reported: 0, totals: { tests: 30, passed: 30, failed: 0 }, state: "completed" })), "the runner said 30 passed of 30");
  assert.equal(observedWords(obs("a", { counts: { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 }, reported: 0 })), "no case reported yet");
  assert.equal(observedWords(obs("a", { counts: { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 }, reported: 0, state: "completed", command: { purpose: "build" }, adapter: { id: "generic", capabilities: { cases: "none" } } })), null, "a build says nothing of cases");
  assert.deepEqual(Object.keys(STATUS_WORDS), ["PASSED", "FAILED", "BLOCKED", "NOT_RUN", "RUNNING", "UNKNOWN", "UNAVAILABLE"]);
});

test("a pane has tiers of its own; the status bar counts steps, checks and tests from the same records", () => {
  assert.deepEqual([[25, 30], [60, 7], [40, 30], [47, 30], [48, 30], [83, 30], [84, 30], [140, 50]].map(([c, r]) => paneTierOf(c, r)), ["tiny", "tiny", "narrow", "narrow", "medium", "medium", "wide", "wide"]);
  const bar = text(statusBarOf(ctxOf(verifying())));
  assert.match(bar, /STEPS 5\/6 {2}· {2}CHECKS 1\/2 {2}· {2}TESTS 24\/26\? {2}· {2}EXECUTING/);
});

test("paneOf answers the workspace bounded and plain: the tier, the titles, the rows, six views", () => {
  const p = paneOf(verifying());
  assert.equal(p.tier, "medium");
  assert.deepEqual(p.titles, { checklist: "TASK EXECUTION", current: "NOW" });
  assert.deepEqual(p.views.map((v) => v.id), ["events", "tests", "changes", "notices", "plan", "timeline"], "1.8.6 adds Plan and Timeline after the four a person learned the keys of");
  assert.ok(p.views.every((v) => v.rows.length <= VIEW_ROWS));
  const segs = [...p.checklist, ...p.current, p.statusBar, ...p.views.flatMap((v) => v.rows)].flatMap((r) => [...r.left, ...r.right]);
  assert.ok(segs.every((s) => typeof s.text === "string" && !s.text.includes("\u001b")), "plain text and a tone: a host's drawer adds no word and no escape");
  assert.deepEqual(viewsOf(ctxOf(verifying())).find((v) => v.id === "changes").rows.map(text), ["M web/src/pricing.js+1 −1", "M ledger/Ledger.cs+1 −1"]);
});
