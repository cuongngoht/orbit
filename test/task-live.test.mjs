// A task as a live page reads it: the same fold and view as every reader, and a fingerprint that moves only on
// what a person watching cares about.
import { test } from "node:test";
import assert from "node:assert/strict";
import { realIo } from "../src/store/io.mjs";
import { createFollower } from "../src/store/follow.mjs";
import { COMMANDS } from "../src/task/index.mjs";
import { createTaskLive, fingerprintOf, FINGERPRINT } from "../src/task/live.mjs";
import { journalLine } from "../src/task/store.mjs";
import { ASK, pbi482, taskWorld } from "./task.harness.mjs";

function live(w, id) {
  const follower = createFollower(realIo(), w.tasks.journalFile(id), { parse: journalLine, keep: true });
  return createTaskLive(follower);
}

test("a live view is exactly the view `show` answers, after every kind of line", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  const l = live(w, id);
  assert.ok(l.pull().events.length > 20);
  assert.deepEqual(l.viewOf(w.now()), COMMANDS.show.run(w.ctx, [id]));
  w.op(id, "decide", { observed: "the regression is slow", hypothesis: "a fixture warms up", nextAction: "wait" });
  l.pull();
  assert.deepEqual(l.viewOf(w.now()), COMMANDS.show.run(w.ctx, [id]));
  assert.equal(l.viewOf(w.now()).revision, l.count);
});

test("a live event is the line as the journal kept it, with its source and its index", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  const l = live(w, id);
  w.op(id, "stage", { stage: "CONTEXT" });
  const events = l.pull().events;
  assert.deepEqual(events.map((e) => [e.source, e.n, e.kind]), [["task", 0, "created"], ["task", 1, "stage"]]);
  assert.deepEqual(events[1], { source: "task", n: 1, ...w.tasks.read(id)[1] });
});

// The revision is in the print on purpose: a person's decision names the revision it read, so a page must hold the
// latest one, and every line moves it.
test("the fingerprint moves on a stage, an attempt, an approval, a pause -- and on every line, through the revision", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  const l = live(w, id);
  const print = () => (l.pull(), fingerprintOf(l.viewOf(w.now())));
  const moved = (name, given) => ((before) => (w.op(id, name, given), before !== print()))(print());
  assert.equal(moved("stage", { stage: "IMPLEMENTING" }), true, "a stage");
  assert.equal(moved("attempt-start", {}), true, "an attempt");
  assert.equal(moved("decide", { observed: "it builds", hypothesis: "nothing to fix", nextAction: "test" }), true, "a decision is a line, and the revision is part of the print");
  assert.equal(moved("request-approval", ASK), true, "an approval asked");
  assert.equal(moved("pause", { human: true, expected: l.count }), true, "a pause");
});

test("the fingerprint changes when an approval EXPIRES, with no new line written", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  w.op(id, "request-approval", { ...ASK, expires: "2026-10-06T21:10:00.000Z" });
  const l = live(w, id);
  l.pull();
  const before = fingerprintOf(l.viewOf(w.now()));
  const count = l.count;
  w.tick(30);
  assert.equal(l.pull().events.length, 0);
  assert.equal(l.count, count, "no line was written");
  assert.notEqual(fingerprintOf(l.viewOf(w.now())), before, "the expiry is noticed");
});

test("FINGERPRINT names only what a view has, and time alone moves nothing but an expiry", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  const view = w.view(id);
  for (const [key, of] of FINGERPRINT) assert.doesNotThrow(() => of(view), key);
  w.tick(90);
  assert.equal(fingerprintOf(w.view(id)), fingerprintOf(view), "a minute passing (the budget's spent minutes) is not news");
});
