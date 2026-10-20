// The WORK block Orbit Live draws above a session's raw tool list: rows from the ONE view a tracked work has, handed to the live core as
// data. Pure, over a view built by the engine's own `workViewOf` from lines a test writes -- so it shows how the rows read, and is
// not evidence that any host's hook ran.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../src/live/tui/model.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { workNowRows } from "../src/live/tui/work-view.mjs";
import { handoff, link, report, state, track } from "../src/work/track/write.mjs";
import { TASK_A, trackWorld } from "./work-track.harness.mjs";

const textOf = (segs) => (segs ?? []).map((s) => s.text).join("");
const rowsOf = (view, narrow = false) => workNowRows({ state: { work: view } }, narrow).map((r) => `${textOf(r.left)}${textOf(r.right)}`);

function busy(t) {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit", ref: "PBI-482", route: "orbit-develop" }).work;
  w.tick();
  w.edit("sess-a", "src/a.cs");
  w.edit("sess-b", "src/a.cs");
  w.tick();
  w.run("sess-a", "test", "grep", true);
  w.tick();
  w.edit("sess-a", "src/b.cs");
  return { w, made };
}

test("no work bound draws nothing, and the existing session rows are untouched", () => {
  assert.deepEqual(workNowRows({ state: { work: null } }), []);
  assert.deepEqual(workNowRows({ state: {} }), []);
});

test("the block names the work, its item, mode, state and evidence, flags a shared file, and says a later edit superseded a check", (t) => {
  const { w, made } = busy(t);
  const rows = rowsOf(w.view(made));
  assert.match(rows[0], new RegExp(`^WORK\\s+${made} · Fix the refund limit`));
  assert.ok(rows.some((r) => /^ref\s+PBI-482/.test(r)));
  assert.ok(rows.some((r) => /^mode\s+developer · routed to orbit-develop/.test(r)));
  assert.ok(rows.some((r) => /^state\s+● IN PROGRESS · evidence observed · session active/.test(r)));
  assert.ok(rows.some((r) => /^files\s+2 observed · .*src\/a\.cs \(shared\)/.test(r)), "a path two sessions wrote is flagged");
  assert.ok(rows.some((r) => /^checks\s+grep \(named like a test\) · exit-ok · superseded by a later edit/.test(r)), "a grep is not shown as a test, and a later edit supersedes it");
  assert.ok(rows.every((r) => !/%|passed/i.test(r)), "no percentage and no pass");
});

test("a narrow column keeps the work, its state and its blocker -- and a blocked work says why", (t) => {
  const { w, made } = busy(t);
  state(w.ctx(), { work: made, state: "blocked", why: "the database is off the VPN" });
  const narrow = rowsOf(w.view(made), true);
  assert.deepEqual(narrow.map((r) => r.split(/\s+/)[0]), ["WORK", "state", "blocker"]);
  assert.match(narrow[2], /the database is off the VPN/);
  assert.match(narrow[1], /■ BLOCKED/);
});

test("a work reported done shows reported -- and evidence verified only when a completed linked task says so", (t) => {
  const { w, made } = busy(t);
  report(w.ctx(), { work: made, outcome: "done", summary: "fixed" });
  assert.match(rowsOf(w.view(made)).find((r) => r.startsWith("state")), /✓ REPORTED DONE · evidence reported/);
  w.tick();
  link(w.ctx(), { work: made, what: "task", target: TASK_A });
  handoff(w.ctx(), { work: made, to: "autonomous", task: TASK_A });
  w.task(TASK_A, { lifecycle: "COMPLETED", terminal: true, ended: { at: "2099-01-01T00:00:00.000Z" } });
  assert.match(rowsOf(w.view(made)).find((r) => r.startsWith("state")), /evidence verified/);
});

test("the viewer's state takes a work's view in, and a null lets it go", (t) => {
  const { w, made } = busy(t);
  const view = w.view(made);
  const s0 = initialState({ columns: 80, rows: 30 });
  assert.equal(s0.work, null);
  const s1 = reduce(s0, { type: "work", view });
  assert.equal(s1.work.work, made);
  assert.equal(reduce(s1, { type: "work", view: null }).work, null);
  assert.equal(initialState({ work: view }).work.work, made, "a pane built for a session starts with its work");
});

test("hostile text in a title or a reason reaches the rows as plain segments of text, never a styled string", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix \u001b[31mred\u001b[0m [x](http://evil) the thing" }).work;
  state(w.ctx(), { work: made, state: "blocked", why: "\u001b]0;owned\u0007 needs a person" });
  const rows = workNowRows({ state: { work: w.view(made) } });
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.ok([...r.left, ...r.right].every((s) => typeof s.text === "string"), "rows are segments of text, never a styled string");
});
