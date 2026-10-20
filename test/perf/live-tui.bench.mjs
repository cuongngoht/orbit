// What the full-screen viewer COSTS, measured on this machine and said with its denominators. Skipped in the
// suite; run it on purpose and read the numbers:
//
//   ORBIT_BENCH=1 node --test --test-reporter=spec test/perf/live-tui.bench.mjs
//
// Shapes: a task with 100, 1,000 and 10,000 journal lines (the window keeps 3,000); a burst of 1,000 lines in one
// poll; lines of 4 KiB; a resize storm; an idle minute; fifty task switches through the real adapter. For each:
// the time to fold the batch and build a frame (P50/P95 over RUNS), the bytes one paint writes, and -- through
// the adapter -- the timers, leases and listeners left after leaving. The release plan reports them; a target is
// never a claim about another machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../../src/live/tui/reducer.mjs";
import { frameOf } from "../../src/live/tui/frame.mjs";
import { changedRows } from "../../src/live/tui/diff.mjs";
import { runTui } from "../../cli/live-tui.mjs";
import { createFollowers } from "../../src/live/followers.mjs";
import { fakeTimers, fakeTty } from "../fakes/tty.mjs";
import { ENG, HERE, NOW, PLACE, SETTINGS, ago, engView, stateOf } from "../live-tui.fixture.mjs";

const RUNS = 40;
const skip = !process.env.ORBIT_BENCH;
const KINDS = ["stage", "decision", "action-started", "action-completed", "file-changed", "receipt"];

const lines = (n, size = 40) => Array.from({ length: n }, (_, i) => ({ source: "task", n: i, at: ago(n - i), kind: KINDS[i % KINDS.length], stage: "TESTING", id: `act-${i}`, type: "test", outcome: i % 7 ? "succeeded" : "failed", summary: "x".repeat(size), observed: "o" }));
const framesOf = (events) => [...events.map((e) => ({ event: "task-event", id: `t=${e.n + 1}`, data: e })), { event: "task-view", id: "t=1", data: { view: engView() } }];

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const ms = (n) => `${n.toFixed(2)} ms`;

function timed(fn) {
  const at = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - at) / 1e6;
}

function measured(name, make) {
  const times = Array.from({ length: RUNS }, () => timed(make));
  console.log(`${name.padEnd(40)} p50 ${ms(pct(times, 50))}  p95 ${ms(pct(times, 95))}  max ${ms(Math.max(...times))}`);
  return pct(times, 95);
}

const opened = (state) => reduce(state, { type: "feed-opened", task: ENG, role: "root" });

for (const n of [100, 1000, 10000]) {
  test(`fold ${n} lines and draw the frame`, { skip }, () => {
    const batch = framesOf(lines(n));
    const p95 = measured(`fold+frame, ${n} lines`, () => frameOf(reduce(opened(stateOf()), { type: "frames", task: ENG, frames: batch })));
    assert.ok(p95 < 1000);
  });
}

test("a burst of 1,000 lines into a task already holding 3,000, then one paint", { skip }, () => {
  const full = reduce(opened(stateOf()), { type: "frames", task: ENG, frames: framesOf(lines(3000)) });
  const burst = framesOf(lines(1000));
  measured("burst 1,000 onto a full window", () => frameOf(reduce(full, { type: "frames", task: ENG, frames: burst })));
});

test("lines of 4 KiB are cut to the screen, never wrapped", { skip }, () => {
  const s = reduce(opened(stateOf()), { type: "frames", task: ENG, frames: framesOf(lines(500, 4096)) });
  measured("500 lines of 4 KiB, all lines shown", () => frameOf(reduce(s, { type: "all" })));
});

test("an idle task: what a second costs when nothing was written", { skip }, () => {
  const s = reduce(reduce(opened(stateOf()), { type: "frames", task: ENG, frames: framesOf(lines(1000)) }), { type: "painted" });
  const a = frameOf(s);
  const b = frameOf(reduce(s, { type: "tick", nowMs: NOW + 1000 }));
  const bytes = changedRows(a, b).reduce((n, r) => n + Buffer.byteLength(r.text), 0);
  console.log(`idle second: ${changedRows(a, b).length} of ${a.rows} rows rewritten, ${bytes} bytes (the clock, the ages, the pulse)`);
  measured("idle second, frame + diff", () => changedRows(a, frameOf(reduce(s, { type: "tick", nowMs: NOW + 1000 }))));
});

test("through the real adapter: a resize storm, fifty switches and an idle minute leave nothing behind", { skip }, async () => {
  const tty = fakeTty({ columns: 120, rows: 40 });
  const timers = fakeTimers();
  const followers = createFollowers({ pollMs: 60_000 });
  const feeds = [];
  const feed = (id) => ((f) => (feeds.push(f), f))({ closed: false, start: (sink) => framesOf(lines(500)).forEach((x) => sink.send(x)), tick: () => {}, close() { this.closed = true; } });
  const world = { nowMs: () => NOW, followers, settings: SETTINGS, projects: () => [], rows: () => [{ id: ENG, checkout: HERE, terminal: false, createdAt: ago(9), coordinates: false }, { id: "tsk-0123456789ab", checkout: HERE, terminal: false, createdAt: ago(8), coordinates: false }], associate: () => ({ how: "none", task: null, ids: [] }), locate: () => null, open: (place, id) => feed(id), show: () => null, console: async () => ({ message: "none" }) };
  const rss = process.memoryUsage().rss;
  const run = runTui(world, tty, { start: { place: PLACE, association: { how: "explicit", task: ENG, ids: [ENG] }, root: ENG }, timers });
  const storm = timed(() => Array.from({ length: 1000 }, (_, i) => tty.resize(80 + (i % 60), 24 + (i % 20))));
  const switches = timed(() => Array.from({ length: 50 }, (_, i) => ["t", i % 2 ? "k" : "j", "\r"].forEach((k) => tty.type(k))));
  const before = tty.all().length;
  const idle = timed(() => Array.from({ length: 600 }, () => timers.fire(100)));
  console.log(`resize storm: 1,000 resizes in ${ms(storm)} · 50 switches in ${ms(switches)} · 600 idle paints (one clock second) in ${ms(idle)}, ${tty.all().length - before} bytes`);
  tty.type("q");
  await run;
  console.log(`after leaving: ${timers.active()} timers, ${followers.size()} leases, ${tty.stdin.listenerCount("data")} key listeners, ${feeds.filter((f) => !f.closed).length} feeds open, rss +${((process.memoryUsage().rss - rss) / 1048576).toFixed(1)} MiB`);
  assert.deepEqual([timers.active(), followers.size(), feeds.filter((f) => !f.closed).length], [0, 0, 0]);
});
