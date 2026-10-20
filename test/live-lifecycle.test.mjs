// Orbit Live's lifecycle rows (1.8.9, src/live/tui/lifecycle-view.mjs): Context · Memory · Engineering · Learning, each
// read off a journal line -- the context command's own word, the task's lifecycle, the learning receipt a finished
// task links -- and saying so when nothing has spoken yet. Never a percentage, never a guess.
import test from "node:test";
import assert from "node:assert/strict";
import { lifecycleOf, lifecycleRows } from "../src/live/tui/lifecycle-view.mjs";
import { LIFECYCLE_GLYPHS } from "../src/live/words.mjs";
import { ASCII } from "../src/live/tui/glyphs.mjs";

const ctxOf = (engineering, root = null) => ({ d: { engineering: engineering ? { view: engineering } : null, root: root ? { view: root } : null } });
const eng = (over = {}) => ({ lifecycle: "EXECUTING", stage: "TESTING", attempt: { number: 2 }, actions: [{ type: "gather-context", state: "succeeded", summary: "PARTIAL: 3 of 6 known; unknown: knowledge, work, working-set" }], receipts: [], ...over });
const byLabel = (rows) => Object.fromEntries(rows.map((r) => [r.label, r]));

test("nothing shown, nothing drawn: no task means no lifecycle", () => {
  assert.deepEqual(lifecycleOf(ctxOf(null)), []);
});

test("a task under way: the context's own word, what memory answered, where engineering stands, and learning awaits evidence", () => {
  const rows = byLabel(lifecycleOf(ctxOf(eng())));
  assert.deepEqual(Object.keys(rows), ["Context", "Memory", "Engineering", "Learning"]);
  assert.deepEqual([rows.Context.mark, rows.Context.text], ["partial", "PARTIAL — 3 of 6 known; unknown: knowledge, work, working-set"]);
  assert.deepEqual([rows.Memory.mark, rows.Memory.text], ["partial", "3 of 6 parts answered; nothing yet for knowledge, work, working-set"]);
  assert.deepEqual([rows.Engineering.mark, rows.Engineering.text], ["running", "testing · attempt 2"]);
  assert.deepEqual([rows.Learning.mark, rows.Learning.text], ["waiting", "awaiting evidence — a task teaches at its finish"]);
});

test("READY is done only when the context said READY; a context that could not be gathered is failed", () => {
  const ready = byLabel(lifecycleOf(ctxOf(eng({ actions: [{ type: "gather-context", state: "succeeded", summary: "READY: 6 of 6 known, 12 architecture fact(s), none citing a scope that moved" }] }))));
  assert.equal(ready.Context.mark, "done");
  assert.equal(ready.Memory.mark, "done");
  const blocked = byLabel(lifecycleOf(ctxOf(eng({ actions: [{ type: "gather-context", state: "failed", summary: "BLOCKED: architecture could not answer here" }] }))));
  assert.equal(blocked.Context.mark, "failed");
  const old = byLabel(lifecycleOf(ctxOf(eng({ actions: [{ type: "gather-context", state: "succeeded", summary: "6 section(s) of project context, 6 known" }] }))));
  assert.equal(old.Context.mark, "partial", "a context with no word (an older engine) is never called done");
  assert.equal(old.Memory.mark, "waiting");
});

test("a coordinator's context step stands in until its engineering task gathers its own", () => {
  const root = { receipts: [{ domain: "step", ref: "context", outcome: "REPORTED", summary: "BOOTSTRAPPED: known to Orbit, and nothing learned yet (0 of 3 known; unknown: architecture, engineering, working-set)" }] };
  const rows = byLabel(lifecycleOf(ctxOf(null, root)));
  assert.equal(rows.Context.mark, "partial");
  assert.match(rows.Context.text, /^BOOTSTRAPPED — /);
  assert.equal(rows.Engineering.text, "no engineering task yet");
});

test("learning shows the finished task's own receipt: what it kept, or why it learned nothing", () => {
  const learned = byLabel(lifecycleOf(ctxOf(eng({ lifecycle: "COMPLETED", receipts: [{ domain: "learning", ref: "task:tsk-1", outcome: "OBSERVED", summary: "4 candidate(s), 4 kept (observed at most), 0 refused" }] }))));
  assert.deepEqual([learned.Engineering.mark, learned.Learning.mark, learned.Learning.text], ["done", "done", "4 candidate(s), 4 kept (observed at most), 0 refused"]);
  const nothing = byLabel(lifecycleOf(ctxOf(eng({ lifecycle: "FAILED", stopReason: "NO_PROGRESS", receipts: [{ domain: "learning", ref: "task:tsk-1", outcome: "NOTHING", summary: "the task failed: a change nobody verified teaches nothing" }] }))));
  assert.deepEqual([nothing.Engineering.mark, nothing.Engineering.text], ["failed", "failed · NO_PROGRESS"]);
  assert.match(nothing.Learning.text, /^nothing learned: /);
});

test("the rows draw a glyph every terminal can show, and give way in a narrow pane", () => {
  for (const { glyph } of Object.values(LIFECYCLE_GLYPHS)) assert.ok(ASCII[glyph], `${glyph} has an ASCII spelling`);
  assert.equal(lifecycleRows(ctxOf(eng())).length, 4);
  assert.deepEqual(lifecycleRows(ctxOf(eng()), true), []);
  assert.ok(lifecycleRows(ctxOf(eng())).every((r) => r.left.every((s) => !/\d+%/.test(s.text))), "no percentage, anywhere");
});
