// A check's OBSERVATION through the live core's feed (1.8.5, ADR 0020), with no server around it: the projection is
// sent when a viewer attaches and again when what it says moved -- never twice the same -- a viewer that comes back
// with a cursor gets the task's lines it missed and the projection again, whole, so nothing is duplicated; a line of
// another schema or kind is never folded; a task from before 1.8.5 (no observation) sends none and fails nothing; a
// task that ends sends its checks' final projections BEFORE its end; and two viewers share one follower per file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { realIo } from "../src/store/io.mjs";
import { collectFeed, openFeed } from "../src/live/feed.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { parseCursor, zeroCursor } from "../src/live/cursor.mjs";
import { ACTIVITY_SOURCE, activityFile } from "../src/orchestration/activity/source.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { QA_SOURCE } from "../src/investigation/live.mjs";
import { taskWorld } from "./task.harness.mjs";

function feedWorld(t) {
  const w = taskWorld(t);
  const io = realIo({ now: w.now });
  const followers = createFollowers({ pollMs: 60_000 });
  const deps = { io, followers, task: TASK_SOURCE, qa: QA_SOURCE, activity: ACTIVITY_SOURCE };
  const opened = (id) => ({ taskCtx: { tasks: w.tasks, checkoutSummary: null, now: w.now }, task: id, createdAt: w.view(id).task.createdAt, qa: QA_SOURCE.open(w.dir, io), activity: ACTIVITY_SOURCE.open(w.dir) });
  return { w, io, followers, deps, opened };
}

const sinkOf = () => ({ frames: [], closed: false, send(f) { this.frames.push(f); return true; }, end() { this.closed = true; } });

const line = (seq, kind, extra = {}) => `${JSON.stringify({ v: 1, seq, gen: 1, at: `2026-10-15T09:00:${String(seq).padStart(2, "0")}.000Z`, kind, ...extra })}\n`;

function written(f, id, action, text) {
  const file = activityFile(f.w.dir, id, action);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, text);
}

// A task running one test check: act-1, with the start of its observation written.
function running(f) {
  const id = f.w.create();
  f.w.op(id, "stage", { stage: "TESTING" });
  f.w.op(id, "act-start", { type: "test", label: "test · node:api · test" });
  written(f, id, "act-1", line(0, "activity.started", { task: id, action: "act-1", check: "chk-1", adapter: { id: "tap", capabilities: { cases: "reported" }, observes: ["passed", "failed"] } }) + line(1, "case.reported", { key: "1", name: "first", state: "passed" }));
  return id;
}

const views = (sink) => sink.frames.filter((fr) => fr.event === "activity-view");

// A poll now, the way the follower registry's timer would: the feed's own lease listens.
function polled(f, id, action) {
  const lease = f.followers.acquire(`act:${activityFile(f.w.dir, id, action)}`, () => null);
  lease.refresh();
  lease.release();
}

test("a viewer that attaches is sent the projection as it stands, then only when it moved -- never twice the same", (t) => {
  const f = feedWorld(t);
  const id = running(f);
  const feed = openFeed(f.deps, f.opened(id), zeroCursor());
  const sink = sinkOf();
  feed.start(sink);
  t.after(() => feed.close());
  assert.equal(views(sink).length, 1);
  assert.deepEqual([views(sink)[0].data.action, views(sink)[0].data.view.counts.passed, views(sink)[0].data.view.state], ["act-1", 1, "running"]);
  polled(f, id, "act-1");
  assert.equal(views(sink).length, 1, "nothing new in the file: nothing sent");
  written(f, id, "act-1", line(2, "case.reported", { key: "2", name: "second", state: "failed" }));
  polled(f, id, "act-1");
  assert.equal(views(sink).length, 2);
  assert.deepEqual(views(sink)[1].data.view.counts, { passed: 1, failed: 1, skipped: 0, todo: 0, cancelled: 0 });
  assert.equal(views(sink)[1].data.revision, 2);
});

test("a viewer coming back with a cursor gets the task lines it missed, and the projection whole again: no line twice", (t) => {
  const f = feedWorld(t);
  const id = running(f);
  const first = collectFeed(f.deps, f.opened(id), zeroCursor());
  f.w.op(id, "stage", { stage: "REGRESSION" });
  written(f, id, "act-1", line(2, "case.reported", { key: "2", name: "second", state: "passed" }));
  const again = collectFeed(f.deps, f.opened(id), parseCursor(first.cursor));
  assert.deepEqual(again.events.map((e) => e.kind), ["stage"], "only the line after the cursor");
  assert.equal(again.activity["act-1"].counts.passed, 2, "the projection is replaced, never added to what the viewer held");
  assert.equal(first.activity["act-1"].counts.passed, 1);
});

test("a line of another schema, of an unknown kind, out of sequence or torn is never folded", (t) => {
  const f = feedWorld(t);
  const id = running(f);
  written(f, id, "act-1", `${JSON.stringify({ v: 2, seq: 2, gen: 1, kind: "case.reported", key: "x", state: "failed" })}\n{"v":1,"seq":3,"gen":1,"kind":"rm -rf"}\nnot json\n${line(1, "case.reported", { key: "dup", state: "failed" })}{"v":1,"seq":9`);
  const view = collectFeed(f.deps, f.opened(id), zeroCursor()).activity["act-1"];
  assert.deepEqual(view.counts, { passed: 1, failed: 0, skipped: 0, todo: 0, cancelled: 0 });
  assert.match(view.gaps.join(), /out of order or of another run, ignored/);
});

test("a task from before 1.8.5 has no observation: no activity frame, nothing refused, everything else as it was", (t) => {
  const f = feedWorld(t);
  const id = f.w.create();
  f.w.op(id, "stage", { stage: "TESTING" });
  f.w.op(id, "act-start", { type: "test", label: "test" });
  const got = collectFeed(f.deps, f.opened(id), zeroCursor());
  assert.deepEqual(got.activity, {});
  assert.equal(got.view.stage, "TESTING");
  const legacy = collectFeed({ ...f.deps, activity: undefined }, { ...f.opened(id), activity: undefined }, zeroCursor());
  assert.deepEqual(legacy.activity, {}, "a caller that binds no activity source still reads the task");
});

test("a task that ends sends each check's last projection BEFORE its end", (t) => {
  const f = feedWorld(t);
  const id = running(f);
  const feed = openFeed(f.deps, f.opened(id), zeroCursor());
  const sink = sinkOf();
  feed.start(sink);
  t.after(() => feed.close());
  written(f, id, "act-1", line(2, "activity.completed", { outcome: { status: 0 } }));
  f.w.op(id, "act-complete", { action: "act-1", outcome: "succeeded" });
  f.w.op(id, "complete", { summary: "done" });
  const lease = f.followers.acquire(`task:${f.w.tasks.journalFile(id)}`, () => null);
  lease.refresh();
  lease.release();
  const names = sink.frames.map((fr) => (fr.event === "activity-view" ? `view:${fr.data.view.state}` : fr.event));
  assert.ok(names.indexOf("view:completed") >= 0 && names.indexOf("view:completed") < names.indexOf("end"), names.join(" "));
});

test("two viewers of one task share one follower per observation file, and leaving releases it", (t) => {
  const f = feedWorld(t);
  const id = running(f);
  const a = openFeed(f.deps, f.opened(id), zeroCursor());
  const b = openFeed(f.deps, f.opened(id), zeroCursor());
  a.start(sinkOf());
  b.start(sinkOf());
  assert.equal(f.followers.size(), 2, "one for the journal, one for the observation");
  a.close();
  b.close();
  assert.equal(f.followers.size(), 0);
});
