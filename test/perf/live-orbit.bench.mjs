// What the ORBIT costs (0.0.3, ADR 0029), measured on this machine, never assumed. Skipped in the suite; run it on
// purpose and read the numbers:
//
//   ORBIT_BENCH=1 node --test --test-reporter=spec test/perf/live-orbit.bench.mjs
//
// The orbit turns the whole time a viewer is open, ten paints a second, so what one of those paints costs is what it
// costs. For each shape -- a task ORBITING, IDLE, BLOCKED, one holding 1,000 journal lines, a 44-column pane, the
// animation off -- it prints what a whole frame costs (what 0.0.2 drew on every paint while the orbit turned) beside
// what an orbit tick costs (the rows that hold the orbit, drawn again over the last frame), the rows and bytes a tick
// writes, and the share of one core ten ticks a second take. Then, through the real adapter on a terminal a test holds,
// ten seconds of ticks and a resize storm in the middle of them; and last, `live tui` itself in a real pseudo-terminal,
// six seconds with the animation on and six with it off: the CPU the process spent, as the operating system counted it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTui } from "../../cli/live-tui.mjs";
import { createFollowers } from "../../src/live/followers.mjs";
import { derivedOf } from "../../src/live/tui/derive.mjs";
import { changedRows } from "../../src/live/tui/diff.mjs";
import { frameOf, orbitFrameOf } from "../../src/live/tui/frame.mjs";
import { reduce } from "../../src/live/tui/reducer.mjs";
import { indicatorFor } from "../../src/live/tui/workspace.mjs";
import { contextOf } from "../../src/live/tui/frame.mjs";
import { fakeTimers, fakeTty } from "../fakes/tty.mjs";
import { sealed } from "../home.mjs";
import { ENG, HERE, NOW, PLACE, SETTINGS, ago, engEvents, engView, engineering, fed, stateOf, workflow } from "../live-tui.fixture.mjs";

const skip = !process.env.ORBIT_BENCH;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNS = 200;
const TICK_MS = 100;

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const ms = (n) => `${n.toFixed(3)} ms`;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function timed(fn) {
  const at = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - at) / 1e6;
}

const runs = (fn) => Array.from({ length: RUNS }, (_, i) => timed(() => fn(i)));

// What a tick writes to the terminal for one row: a position, a clear, the row.
const bytesOf = (ops) => ops.reduce((n, op) => n + Buffer.byteLength(`\u001b[${op.row + 1};1H\u001b[2K${op.text}`), 0);

const coloured = (s) => ({ ...s, viewer: { ...s.viewer, colour: true, depth: "truecolor", bands: true, redraw: false } });

const KINDS = ["stage", "decision", "action-started", "action-completed", "file-changed", "receipt"];
const lines = (n) => Array.from({ length: n }, (_, i) => ({ source: "task", n: i, at: ago(n - i), kind: KINDS[i % KINDS.length], stage: "TESTING", id: `act-${i}`, type: "test", outcome: i % 7 ? "succeeded" : "failed", summary: "x".repeat(40) }));
const quietly = () => engEvents().map((e) => ({ ...e, at: ago(600) }));
const ended = engView({ actions: engView().actions.map((a) => ({ ...a, state: a.state === "running" ? "succeeded" : a.state, endedAt: ago(590) })) });

const SHAPES = [
  { name: "ORBITING (workflow, pane 88)", state: () => coloured(workflow({ columns: 88, rows: 40, start: { layout: "pane" } })) },
  { name: "IDLE (nothing written lately)", state: () => coloured(fed(stateOf({ columns: 88, rows: 40, start: { layout: "pane" } }), ENG, ended, quietly())) },
  { name: "BLOCKED", state: () => coloured(engineering({ columns: 88, rows: 40, start: { layout: "pane" }, view: { lifecycle: "BLOCKED", blocked: { stop: "ENVIRONMENT_BLOCKED" } } })) },
  { name: "1,000 journal lines", state: () => coloured(fed(stateOf({ columns: 88, rows: 40, start: { layout: "pane" } }), ENG, engView(), lines(1000))) },
  { name: "dashboard 120x40", state: () => coloured(workflow({ columns: 120, rows: 40 })) },
  { name: "narrow pane 44", state: () => coloured(workflow({ columns: 44, rows: 30, start: { layout: "pane" } })) },
  { name: "animation off", state: () => coloured(workflow({ columns: 88, rows: 40, start: { layout: "pane", settings: { ...SETTINGS, pane: { animation: "off" } } } })) },
];

const ROW = (cells) => cells.map((c, i) => String(c).padEnd([30, 10, 22, 22, 10, 10, 12][i] ?? 10)).join("");

test("a whole frame against an orbit tick, in every shape: the time, the rows and bytes a tick writes, the share of a core", { skip }, () => {
  console.log(ROW(["shape", "state", "whole frame p50/p95", "orbit tick p50/p95", "rows/tick", "bytes/tick", "core @10 fps"]));
  for (const shape of SHAPES) {
    const s = shape.state();
    const d = derivedOf(s);
    const word = indicatorFor(contextOf(s, d)).state;
    const whole = runs((i) => frameOf(s, undefined, { orbitMs: i * TICK_MS }));
    const base = frameOf(s, d, { orbitMs: 0 });
    const frames = Array.from({ length: RUNS + 1 }, (_, i) => ({ at: i * TICK_MS }));
    const ticks = runs((i) => changedRows(base, orbitFrameOf(s, d, base, { orbitMs: frames[i + 1].at })));
    const series = frames.map((f) => orbitFrameOf(s, d, base, { orbitMs: f.at }));
    const ops = series.slice(1).map((f, i) => changedRows(series[i], f));
    const rows = mean(ops.map((o) => o.length));
    console.log(ROW([shape.name, word, `${ms(pct(whole, 50))}/${ms(pct(whole, 95))}`, `${ms(pct(ticks, 50))}/${ms(pct(ticks, 95))}`, rows.toFixed(2), mean(ops.map(bytesOf)).toFixed(0), `${(pct(ticks, 50) * (1000 / TICK_MS) / 10).toFixed(2)} %`]));
    assert.ok(ops.every((o) => o.every((op) => base.orbitRows.some((r) => r.row === op.row))), `${shape.name}: a tick writes only the orbit's rows`);
    assert.ok(pct(ticks, 95) < 25, `${shape.name}: a tick under 25 ms`);
    if (!base.orbiting) assert.equal(rows, 0, "the animation off: a tick writes nothing");
  }
});

test("through the real adapter: ten seconds of ticks, and a resize storm in the middle of them, leave nothing behind", { skip }, async () => {
  const tty = fakeTty({ columns: 88, rows: 40 });
  const timers = fakeTimers();
  const followers = createFollowers({ pollMs: 60_000 });
  const frames = [...lines(200).map((e) => ({ event: "task-event", id: `t=${e.n + 1}`, data: e })), { event: "task-view", id: "t=1", data: { view: engView() } }];
  const world = { nowMs: () => NOW, followers, settings: SETTINGS, projects: () => [], rows: () => [{ id: ENG, checkout: HERE, terminal: false, createdAt: ago(9), coordinates: false }], associate: () => ({ how: "none", task: null, ids: [] }), locate: () => null, open: () => ({ start: (sink) => frames.forEach((x) => sink.send(x)), tick: () => {}, close: () => {} }), show: () => null, console: async () => ({ message: "none" }) };
  const run = runTui(world, tty, { start: { place: PLACE, association: { how: "explicit", task: ENG, ids: [ENG] }, root: ENG, layout: "pane" }, timers });
  const before = { writes: tty.stdout.writes.length, bytes: tty.all().length, cpu: process.cpuUsage() };
  const ten = timed(() => Array.from({ length: 100 }, () => timers.fire(TICK_MS)));
  const cpu = process.cpuUsage(before.cpu);
  const writes = tty.stdout.writes.slice(before.writes);
  const rows = writes.map((w) => (w.match(/\u001b\[\d+;1H/g) ?? []).length);
  console.log(`10 s of ticks: ${writes.length} writes, ${mean(rows).toFixed(2)} rows a write, ${tty.all().length - before.bytes} bytes, ${ms(ten)} wall, ${((cpu.user + cpu.system) / 1000).toFixed(1)} ms CPU -- ${(((cpu.user + cpu.system) / 1000 / 10_000) * 100).toFixed(2)} % of a core at ten paints a second`);
  const storm = timed(() => Array.from({ length: 200 }, (_, i) => (tty.resize(40 + (i % 60), 20 + (i % 20)), timers.fire(TICK_MS))));
  console.log(`resize storm: 200 resizes, each followed by an orbit tick, in ${ms(storm)}`);
  tty.type("q");
  await run;
  console.log(`after leaving: ${timers.active()} timers, ${followers.size()} leases, ${tty.stdin.listenerCount("data")} key listeners`);
  assert.deepEqual([timers.active(), followers.size()], [0, 0]);
  assert.ok(mean(rows) <= 2, "a tick is the orbit's row, not the screen");
});

// ---- the real process -----------------------------------------------------------------------------------------------

const python = process.platform === "win32" ? null : ["python3"].find((p) => spawnSync(p, ["-c", "import pty"], { encoding: "utf8" }).status === 0) ?? null;

// `live tui` in a pty of 88x40 for so many seconds, then q; what the operating system says the child spent (os.wait4).
const DRIVER = `
import os, pty, sys, time, select, struct, fcntl, termios, json
argv, cwd, seconds = json.loads(sys.argv[1]), sys.argv[2], float(sys.argv[3])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd); os.execv(argv[0], argv)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 88, 0, 0))
out = bytearray()
def pump(t):
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.02)
        if r:
            try: out.extend(os.read(fd, 65536))
            except OSError: return
deadline = time.time() + 15
while b"ORBIT LIVE" not in out and time.time() < deadline: pump(0.1)
started = len(out)
pump(seconds)
steady = len(out) - started
os.write(fd, b"q"); pump(0.5)
_, status, usage = os.wait4(pid, 0)
sys.stdout.write(json.dumps({ "cpu": usage.ru_utime + usage.ru_stime, "bytes": steady, "heads": out[started:].count(b"\\x1b[1;1H"), "exit": os.waitstatus_to_exitcode(status) }))
`;

test("live tui itself, in a real terminal: six seconds with the orbit turning against six with it still", { skip: skip || !python ? "ORBIT_BENCH=1 and a POSIX pty to run" : false }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-orbit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const measuredWith = (animation) => {
    const env = sealed({ ORBIT_STORE_DIR: join(dir, `store-${animation}`), ORBIT_TRACE: "off", TERM: "xterm-256color", COLORTERM: "truecolor" });
    execFileSync(process.execPath, [join(ROOT, "cli", "live.mjs"), "settings", `--apply=${JSON.stringify({ pane: { animation } })}`], { cwd: repo, env, encoding: "utf8" });
    const id = JSON.parse(execFileSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "create", "PBI-482 Refund validation", "--json"], { cwd: repo, env, encoding: "utf8" })).task;
    execFileSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "stage", id, "BUILDING"], { cwd: repo, env });
    return JSON.parse(execFileSync(python, ["-c", DRIVER, JSON.stringify([process.execPath, join(ROOT, "cli", "live.mjs"), "tui", "--layout=pane"]), repo, "6"], { env, encoding: "utf8", timeout: 60_000 }));
  };
  const on = measuredWith("auto");
  const off = measuredWith("off");
  const line = (name, r) => `${name}: ${r.cpu.toFixed(3)} s CPU for the whole process (start included), ${r.heads} header rows written in 6 s, ${r.bytes} bytes`;
  console.log(line("orbit turning", on));
  console.log(line("orbit still  ", off));
  console.log(`the orbit's own cost: ${((on.cpu - off.cpu) * 1000).toFixed(0)} ms of CPU over 6 s -- ${(((on.cpu - off.cpu) / 6) * 100).toFixed(2)} % of one core`);
  assert.deepEqual([on.exit, off.exit], [0, 0]);
  assert.ok(on.heads >= 40, `the orbit turned: ${on.heads} header rows in six seconds`);
  assert.ok((on.cpu - off.cpu) / 6 < 0.1, "turning the orbit costs under a tenth of a core");
});
