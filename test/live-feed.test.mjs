// The live core's feed with no server around it: what a terminal and the status line read is the replay and
// the follow Orbit Control streams, over the same journals, through the sources their owners declare.
import { test } from "node:test";
import assert from "node:assert/strict";
import { realIo } from "../src/store/io.mjs";
import { collectFeed, openFeed } from "../src/live/feed.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { CURSOR, parseCursor, zeroCursor } from "../src/live/cursor.mjs";
import { claimedEnvironment, isRefusal, sessionRefusal, witnessedBy } from "../src/live/logs.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { QA_SOURCE } from "../src/investigation/live.mjs";
import { taskWorld } from "./task.harness.mjs";

function feedWorld(t) {
  const w = taskWorld(t);
  const io = realIo({ now: w.now });
  const followers = createFollowers({ pollMs: 60_000 });
  const deps = { io, followers, task: TASK_SOURCE, qa: QA_SOURCE };
  const qa = QA_SOURCE.open(w.dir, io);
  const opened = (id) => ({ taskCtx: { tasks: w.tasks, checkoutSummary: null, now: w.now }, task: id, createdAt: w.view(id).task.createdAt, qa });
  return { w, io, followers, deps, qa, opened };
}

// A poll NOW, the way the follower registry's timer would: the feed's own lease is the one that listens.
function polled(f, id) {
  const lease = f.followers.acquire(`task:${f.w.tasks.journalFile(id)}`, () => null);
  lease.refresh();
  lease.release();
}

const sinkOf = () => ({ frames: [], closed: false, send(f) { this.frames.push(f); return true; }, end() { this.closed = true; } });

test("a collected feed is the task's lines from zero, one view, and the cursor after the last line", (t) => {
  const f = feedWorld(t);
  const id = f.w.create();
  f.w.op(id, "stage", { stage: "CONTEXT" });
  const got = collectFeed(f.deps, f.opened(id), zeroCursor());
  assert.deepEqual(got.events.map((e) => [e.source, e.n, e.kind]), [["task", 0, "created"], ["task", 1, "stage"]]);
  assert.equal(got.cursor, "t=2");
  assert.match(got.cursor, CURSOR);
  assert.equal(got.view.stage, "CONTEXT");
  assert.equal(got.terminal, false);
  assert.equal(got.version, TASK_SOURCE.version);
  assert.equal(f.followers.size(), 0, "a collected read holds no follower");
});

test("from a cursor, only what is newer is replayed", (t) => {
  const f = feedWorld(t);
  const id = f.w.create();
  f.w.op(id, "stage", { stage: "CONTEXT" });
  f.w.op(id, "stage", { stage: "PLANNING" });
  const got = collectFeed(f.deps, f.opened(id), parseCursor("t=2"));
  assert.deepEqual(got.events.map((e) => e.n), [2]);
  assert.equal(got.cursor, "t=3");
});

test("an open feed sends what is appended after it started, a view when it moved, and ends when the task ends", (t) => {
  const f = feedWorld(t);
  const id = f.w.create();
  const feed = openFeed(f.deps, f.opened(id), zeroCursor());
  const sink = sinkOf();
  feed.start(sink);
  f.w.op(id, "stage", { stage: "CONTEXT" });
  polled(f, id);
  assert.deepEqual(sink.frames.filter((x) => x.event === "task-event").map((x) => x.data.kind), ["created", "stage"]);
  f.w.op(id, "complete", { summary: "done" });
  polled(f, id);
  assert.equal(sink.frames.at(-1).event, "end");
  assert.deepEqual(sink.frames.at(-1).data, { source: "task", reason: "terminal" });
  assert.equal(sink.closed, true);
  feed.close();
  assert.equal(f.followers.size(), 0, "the last viewer to leave stops the poll");
});

test("a feed writes nothing: the journal is byte-identical after a collect and a follow", (t) => {
  const f = feedWorld(t);
  const id = f.w.create();
  f.w.op(id, "stage", { stage: "CONTEXT" });
  const before = f.w.text(id);
  collectFeed(f.deps, f.opened(id), zeroCursor());
  const feed = openFeed(f.deps, f.opened(id), zeroCursor());
  feed.start(sinkOf());
  feed.tick();
  feed.close();
  assert.equal(f.w.text(id), before);
  assert.equal(f.followers.size(), 0);
});

test("an investigation begun against the task joins the feed as allow-listed QA activity", (t) => {
  const f = feedWorld(t);
  const id = f.w.create();
  const inv = "inv-20261006-210400-abcd";
  f.qa.create({ id: inv, objective: "verify the refund", mode: "observe", runtime: { environment: "env-0123456789ab", task: id, sourceTree: "a".repeat(40) } });
  f.qa.append(inv, "action", { id: "act-1", do: "click", on: "Confirm Refund", state: "done", ms: 120, url: { before: "/a", after: "/b" }, screenshot: "evidence/act-1.png", headers: { authorization: "Bearer abc" } });
  const got = collectFeed(f.deps, f.opened(id), zeroCursor());
  const qa = got.events.filter((e) => e.source === inv);
  assert.deepEqual(qa.map((e) => e.kind), ["qa.started", "qa.step"]);
  assert.equal(qa[1].url, "/b");
  assert.equal(qa[1].screenshot, true);
  assert.doesNotMatch(JSON.stringify(got), /Bearer/);
  assert.match(got.cursor, new RegExp(`;${inv}=2$`));
});

test("whose sandbox a viewer may read is the task's claim witnessed by the checkout, refused as data", () => {
  const view = (ref) => ({ receipts: ref ? [{ domain: "sandbox", ref, at: "2026-10-06T21:00:00.000Z" }] : [] });
  assert.equal(claimedEnvironment(view(null)), null);
  assert.equal(claimedEnvironment(view("env-0123456789ab")), "env-0123456789ab");
  assert.equal(claimedEnvironment(view("../etc")).code, "INVALID_ENVIRONMENT_ID");
  const rows = [{ id: "env-0123456789ab", owner: { kind: "task", id: "tsk-aaaaaaaaaaaa" } }];
  assert.equal(witnessedBy(rows, "env-0123456789ab", "tsk-aaaaaaaaaaaa"), rows[0]);
  assert.equal(witnessedBy(rows, "env-0123456789ab", "tsk-bbbbbbbbbbbb").code, "SANDBOX_OWNER_MISMATCH");
  assert.equal(witnessedBy(rows, "env-ffffffffffff", "tsk-aaaaaaaaaaaa").code, "SANDBOX_UNKNOWN");
  assert.equal(sessionRefusal("rs-0123456789ab", "out"), null);
  assert.equal(sessionRefusal("rs-0123456789ab", "env").code, "SANDBOX_QUERY_INVALID");
  assert.ok(isRefusal(sessionRefusal("../x", "out")));
});

// A status line learns which tasks ended from each journal's last bytes, by these kinds -- so they must be exactly
// the kinds whose line ends a task in the fold every other reader uses.
test("the kinds a viewer reads as an ending are exactly the ones that end a task in its fold", async () => {
  const { modelOf } = await import("../src/task/model.mjs");
  const { KIND_NAMES } = await import("../src/task/vocab.mjs");
  const ends = (kind) => Boolean(modelOf([{ kind: "created", id: "tsk-aaaaaaaaaaaa", checkout: "c", at: "1" }, { kind, at: "2", id: "x", stop: "NO_PROGRESS" }]).ended);
  assert.deepEqual(KIND_NAMES.filter((k) => k !== "created" && ends(k)).sort(), [...TASK_SOURCE.ends].sort());
});
