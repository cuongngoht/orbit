// `live tui`'s TERMINAL ADAPTER (cli/live-tui.mjs) on a terminal a test holds: it enters and leaves the
// alternate screen in order, gives the keyboard back on every way out -- q, Ctrl+C, a signal, a write that
// failed, a start that failed -- exactly once; paints only the rows that changed; follows a feed through its end,
// its reset and its errors; reads a sandbox only through the console it was handed; and leaves no timer, lease
// or listener behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTui, tuiRefusal } from "../cli/live-tui.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { OWN_SEQUENCE, clearScreen, enterAlt, hideCursor, leaveAlt, showCursor, wrapOff, wrapOn } from "../src/live/render/ansi.mjs";
import { fakeTimers, fakeTty, screenOf } from "./fakes/tty.mjs";
import { ENG, HERE, NOW, PLACE, SETTINGS, WF, ago, engEvents, engView, wfView } from "./live-tui.fixture.mjs";

const framesOf = (view, events, end = null) => [...events.map((e) => ({ event: e.source === "task" ? "task-event" : "qa-event", id: `t=${e.n + 1}`, data: e })), { event: "task-view", id: "t=9", data: { source: "task", revision: view.revision, view } }, ...(end ? [{ event: "end", id: "t=9", data: { source: "task", reason: end } }] : [])];

// A feed that sends what a test gives it, then whatever the test pushes later.
function fakeFeed(log, id, frames) {
  const f = { id, sink: null, closed: false, ticks: 0 };
  log.push(f);
  return Object.assign(f, { start: (sink) => { f.sink = sink; frames.forEach((x) => sink.send(x)); }, tick: () => { f.ticks += 1; }, close: () => { f.closed = true; }, push: (x) => f.sink.send(x) });
}

function world(over = {}) {
  const feeds = [];
  const reads = [];
  const views = { [ENG]: framesOf(engView(), engEvents()), [WF]: framesOf(wfView(), []), ...(over.frames ?? {}) };
  const w = {
    feeds, reads, opens: [], nowMs: () => NOW, followers: createFollowers({ pollMs: 60_000 }), settings: SETTINGS,
    projects: () => [{ key: "refunds", name: "refunds", checkouts: [{ id: HERE, root: "/work/refunds", summary: null }] }],
    rows: () => [{ id: ENG, checkout: HERE, terminal: false, createdAt: ago(300), coordinates: false }],
    associate: () => ({ how: "checkout", task: ENG, ids: [ENG] }),
    locate: () => null,
    open: (place, id, cursor) => (w.opens.push([id, cursor]), over.open?.(id) ?? fakeFeed(feeds, id, views[id] ?? [])),
    show: () => null,
    console: over.console ?? (async () => ({ env: "env-0123456789ab", sessions: [{ session: "rs-0123456789ab", component: "app", state: "RUNNING" }], read: async (session, stream, from) => (reads.push([session, stream, from]), { from, next: from + 6, size: from + 6, lines: [`${stream} line at ${from}`], truncated: false, held: false }), refresh: async () => [] })),
    ...over.world,
  };
  return w;
}

const start = (over = {}) => ({ start: { place: PLACE, association: { how: "session", task: ENG, ids: [ENG] }, root: ENG, overlay: null, ...over }, timers: fakeTimers() });

function opened(over = {}) {
  const tty = fakeTty(over.tty);
  const w = world(over);
  const opts = start(over.start);
  const run = runTui(w, tty, { ...opts, timing: { paintMs: 100, tickMs: 15000, listMs: 5000, retryMs: [1, 2] } });
  return { tty, w, run, timers: opts.timers, screen: () => screenOf(tty.all(), tty.stdout.columns, tty.stdout.rows) };
}

const settle = () => new Promise((r) => setImmediate(r));

test("a pipe and TERM=dumb are refused before anything is written, and pointed at watch", () => {
  assert.match(tuiRefusal({ stdin: { isTTY: true }, stdout: { isTTY: false } }), /watch --plain.*--jsonl/);
  assert.match(tuiRefusal({ stdin: { isTTY: false }, stdout: { isTTY: true } }), /interactive terminal/);
  assert.match(tuiRefusal({ stdin: { isTTY: true }, stdout: { isTTY: true }, term: "dumb" }), /TERM=dumb/);
  assert.equal(tuiRefusal({ stdin: { isTTY: true }, stdout: { isTTY: true }, term: "xterm" }), null);
});

test("it enters the alternate screen, draws the task, and q gives the terminal back in order, once", async () => {
  const o = opened();
  assert.ok(o.tty.all().startsWith(`${enterAlt()}${wrapOff()}${hideCursor()}`));
  assert.deepEqual(o.tty.stdin.raw, [true]);
  assert.match(o.screen().join("\n"), /STAGE +EXECUTING · TESTING/);
  o.tty.type("q");
  const got = await o.run;
  assert.deepEqual([got.why, got.task, got.lifecycle, got.stage], ["detached", ENG, "EXECUTING", "TESTING"]);
  assert.ok(o.tty.all().endsWith(`${wrapOn()}${showCursor()}${leaveAlt()}`));
  assert.deepEqual(o.tty.stdin.raw, [true, false]);
  assert.equal(o.tty.stdin.paused, true);
  const bytes = o.tty.all().length;
  o.tty.type("j");
  o.tty.signals.emit("SIGTERM");
  o.run.restore();
  assert.equal(o.tty.all().length, bytes, "nothing is written after the alternate screen was left");
  assert.deepEqual([o.timers.active(), o.w.followers.size(), o.tty.stdin.listenerCount("data"), o.tty.signals.listenerCount("SIGTERM"), o.tty.stdout.listenerCount("resize")], [0, 0, 0, 0, 0]);
  assert.ok(o.w.feeds.every((f) => f.closed), "every feed it opened is closed");
});

for (const [how, act] of [["Ctrl+C in raw mode", (o) => o.tty.type("\u0003")], ["SIGTERM", (o) => o.tty.signals.emit("SIGTERM")], ["SIGHUP", (o) => o.tty.signals.emit("SIGHUP")], ["SIGINT", (o) => o.tty.signals.emit("SIGINT")]]) {
  test(`${how} leaves the viewer the same way`, async () => {
    const o = opened();
    act(o);
    assert.equal((await o.run).why, "detached");
    assert.ok(o.tty.all().endsWith(leaveAlt()));
    assert.equal(o.timers.active(), 0);
  });
}

test("a terminal that can no longer be written to ends the viewer without throwing", async () => {
  const o = opened();
  o.tty.stdout.failing = true;
  o.tty.type("a");
  assert.equal((await o.run).why, "the terminal could not be written to");
  assert.deepEqual(o.tty.stdin.raw, [true, false]);
});

test("a start that fails gives the terminal back and says so", async () => {
  const tty = fakeTty();
  tty.stdin.setRawMode = () => { throw new Error("not a tty after all"); };
  const run = runTui(world(), tty, start());
  await assert.rejects(run, /could not start: not a tty after all/);
  assert.ok(tty.all().endsWith(leaveAlt()));
});

test("only the rows that changed are written; a resize redraws the whole screen at its new size", () => {
  const o = opened();
  const before = o.tty.stdout.writes.length;
  o.timers.fire(100);
  assert.equal(o.tty.stdout.writes.length, before, "a quiet second within the same second writes nothing");
  o.w.feeds[0].push({ event: "task-event", id: "t=10", data: { source: "task", n: 9, at: ago(0), kind: "blocked", stop: "ENVIRONMENT_BLOCKED", needs: "environment" } });
  o.timers.fire(100);
  const last = o.tty.stdout.writes.at(-1);
  const rows = (last.match(/\u001b\[\d+;1H/g) ?? []).length;
  assert.ok(rows > 0 && rows < 34, `${rows} rows rewritten`);
  o.tty.resize(90, 24);
  assert.ok(o.tty.stdout.writes.at(-1).startsWith(clearScreen()));
  assert.equal(o.screen().length, 24);
  assert.match(o.screen().join("\n"), /blocked: ENVIRONMENT_BLOCKED/);
  o.tty.type("q");
});

test("every byte it writes is one of ansi.mjs's own sequences or text: a journal's ESC never reaches the terminal", () => {
  const hostile = [{ source: "task", n: 0, at: ago(4), kind: "completed", summary: "\u001b[2J\u001b]0;pwned\u0007evil‮txt\nsecond" }];
  const o = opened({ frames: { [ENG]: framesOf(engView({ lifecycle: "COMPLETED", terminal: true, ended: { kind: "completed", summary: hostile[0].summary } }), hostile, "terminal") } });
  o.tty.type("a");
  o.tty.type("q");
  const all = o.tty.all();
  const seqs = all.match(/\u001b\[[0-9;?]*[A-Za-z]/g) ?? [];
  assert.ok(seqs.every((s) => OWN_SEQUENCE.test(s)), seqs.filter((s) => !OWN_SEQUENCE.test(s)).join(" "));
  assert.equal(all.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").includes("\u001b"), false);
  assert.equal(all.includes("\u0007"), false);
  assert.equal(all.includes("‮"), false);
  assert.match(all, /evil.*txt ⏎ second/);
});

test("a finished task stays on screen after its feed ended, and its leases are released", () => {
  const o = opened({ frames: { [ENG]: framesOf(engView({ lifecycle: "COMPLETED", terminal: true, ended: { kind: "completed" } }), engEvents(), "terminal") } });
  o.timers.fire(100);
  assert.equal(o.w.feeds[0].closed, true);
  assert.match(o.screen().join("\n"), /COMPLETED/);
  o.tty.type("q");
});

test("a journal begun again is read from its first line; one that cannot be followed is retried, then UNAVAILABLE", async () => {
  const once = { n: 0 };
  const o = opened({ open: (id) => (once.n++ ? null : fakeFeed([], id, framesOf(engView(), engEvents(), "reset"))) });
  o.timers.fire(100);
  assert.deepEqual(o.w.opens.map((x) => x[1]), ["t=0", "t=0"]);
  assert.match(o.screen().join("\n"), /journal was begun again/);
  o.tty.type("q");
  const e = opened({ frames: { [ENG]: [{ event: "end", id: "t=0", data: { reason: "error" } }] } });
  for (let i = 0; i < 4; i += 1) e.timers.fire();
  assert.equal(e.w.opens.length, 3, "the first open and two retries");
  e.tty.type("d");
  assert.match(e.screen().join("\n"), /the viewer stopped asking/);
  e.tty.type("q");
  assert.equal(e.timers.active() > 0, true, "q closes an overlay; it does not leave");
  e.tty.type("\u0003");
  await e.run;
});

test("a workflow opens its engineering task's feed as soon as its view names it", () => {
  const o = opened({ start: { root: WF, association: { how: "coordinator", task: WF, ids: [WF] } } });
  o.timers.fire(100);
  assert.deepEqual(o.w.opens.map((x) => x[0]), [WF, ENG]);
  assert.match(o.screen().join("\n"), /WORKFLOW/);
  assert.match(o.screen().join("\n"), /ENGINEER/);
  o.tty.type("c");
  assert.match(o.screen().join("\n"), /engineering task/);
  o.tty.type("q");
});

test("l opens the console through the world's sandbox door, reads stdout and stderr at their own offsets, s switches", async () => {
  const sandboxed = engView({ receipts: [{ domain: "sandbox", ref: "env-0123456789ab", outcome: "READY", at: ago(9) }] });
  const o = opened({ frames: { [ENG]: framesOf(sandboxed, engEvents()) } });
  o.tty.type("l");
  await settle();
  await settle();
  await settle();
  o.timers.fire(100);
  assert.match(o.screen().join("\n"), /SANDBOX +rs-0123456789ab · app · RUNNING · stdout/);
  assert.match(o.screen().join("\n"), /out line at 0/);
  assert.deepEqual(o.w.reads.map((r) => r[1]).sort(), ["err", "out"]);
  o.tty.type("s");
  assert.match(o.screen().join("\n"), /stderr/);
  assert.match(o.screen().join("\n"), /err line at 0/);
  o.tty.type("q");
  await o.run;
  assert.equal(o.w.followers.size(), 0, "the log clocks are released");
});

test("a console that refuses (another task's sandbox) is said in the console, and no log is read", async () => {
  const sandboxed = engView({ receipts: [{ domain: "sandbox", ref: "env-0123456789ab", outcome: "READY", at: ago(9) }] });
  const o = opened({ frames: { [ENG]: framesOf(sandboxed, engEvents()) }, console: async () => { throw new Error("env-0123456789ab is not tsk-375de395af89's sandbox: it belongs to another task"); } });
  o.tty.type("l");
  await settle();
  await settle();
  o.timers.fire(100);
  assert.match(o.screen().join("\n"), /belongs to another task/);
  assert.deepEqual(o.w.reads, []);
  o.tty.type("q");
});

test("a console answer that arrives after the viewer moved to another task is dropped", async () => {
  const sandboxed = engView({ receipts: [{ domain: "sandbox", ref: "env-0123456789ab", outcome: "READY", at: ago(9) }] });
  const answers = [];
  const o = opened({ frames: { [ENG]: framesOf(sandboxed, engEvents()) }, console: () => new Promise((resolve) => answers.push(resolve)) });
  o.tty.type("l");
  await settle();
  o.tty.type("l");
  answers[0]({ env: "env-0123456789ab", sessions: [{ session: "rs-0123456789ab", state: "RUNNING" }], read: async () => ({ lines: ["late"], next: 4 }) });
  await settle();
  await settle();
  assert.deepEqual(o.w.reads, []);
  assert.equal(o.w.followers.size(), 0);
  o.tty.type("q");
});

test("a viewer opened where no task was bound yet finds the checkout, then the task the association names", () => {
  const found = { place: null, association: { how: "none", task: null, ids: [] } };
  const o = opened({ start: { place: null, root: null, overlay: "picker", association: found.association }, world: { relocate: () => found.place, associate: () => found.association } });
  assert.match(o.screen().join("\n"), /not a Orbit checkout yet/);
  Object.assign(found, { place: PLACE, association: { how: "checkout", task: ENG, ids: [ENG] } });
  o.timers.fire(5000);
  o.timers.fire(100);
  assert.deepEqual(o.w.opens.map((x) => x[0]), [ENG]);
  assert.match(o.screen().join("\n"), /STAGE +EXECUTING · TESTING/);
  o.tty.type("q");
});

// --until-done: a clock the test moves, a task that ends.
function untilDone(over = {}) {
  const clock = { now: NOW };
  const tty = fakeTty();
  const timers = fakeTimers();
  const w = world({ ...over, world: { nowMs: () => clock.now, ...(over.world ?? {}) } });
  const run = runTui(w, tty, { ...start(), timers, untilDone: { lingerMs: 10_000 }, timing: { paintMs: 100, tickMs: 15000, listMs: 5000, retryMs: [1] } });
  const tick = (ms) => { clock.now += ms; timers.fire(100); };
  return { tty, timers, w, run, tick, screen: () => screenOf(tty.all(), tty.stdout.columns, tty.stdout.rows).join("\n") };
}

const finishedFrames = () => framesOf(engView({ lifecycle: "COMPLETED", terminal: true, ended: { kind: "completed" } }), engEvents(), "terminal");

test("--until-done counts down once the task shown has ended, says so, then gives the terminal back by itself", async () => {
  const o = untilDone({ frames: { [ENG]: finishedFrames() } });
  o.tick(1000);
  assert.match(o.screen(), /the task ended · this viewer closes in 9s · any key keeps it open/, "counted from the first frame that saw it ended");
  o.tick(4000);
  assert.match(o.screen(), /closes in 5s/);
  o.tick(6000);
  const got = await o.run;
  assert.equal(got.why, "the task ended");
  assert.ok(o.tty.all().endsWith(leaveAlt()));
  assert.deepEqual([o.timers.active(), o.w.followers.size()], [0, 0]);
});

test("--until-done never leaves while the task runs, and any key keeps an ended task open", async () => {
  const running = untilDone();
  running.tick(60_000);
  assert.ok(!/closes in/.test(running.screen()), "a running task is never counted down");
  running.tty.type("q");
  await running.run;
  const o = untilDone({ frames: { [ENG]: finishedFrames() } });
  o.tick(1000);
  o.tty.type("j");
  o.tick(60_000);
  assert.match(o.screen(), /kept open: q leaves/);
  assert.equal(o.timers.active() > 0, true, "still open a minute later");
  o.tty.type("q");
  assert.equal((await o.run).why, "detached");
});
