// SATELLITE LIVE, full screen: the TERMINAL ADAPTER of the pure viewer in satellite/src/live/tui/. It owns what a pure
// module may not -- the raw keyboard, the alternate screen, the timers and the signals -- follows ONE mission's journal
// through Orbit Live's own follower (the journal's one keep-rule), and writes nothing anywhere but the terminal it was
// handed. Leaving -- q, Ctrl+C, a signal, a write that failed -- runs ONE teardown, once: the timer cleared, every
// listener removed, the keyboard given back, colour reset, the cursor shown, line wrap on, the alternate screen left.
// The mission is never touched.
//
//   runSatelliteTui(world, terminal, opts) -> Promise<{ why, mission, lifecycle, cursor }>   + .restore()
//     world     { follower: { pull() -> { items: [{ record }] } }, nowMs() }
//     terminal  { stdin, stdout, signals, term, colour }   process.stdin, process.stdout and process -- or a fake
//     opts      { ascii, timers, paintMs, untilDone: { lingerMs } }
//   tuiRefusal(terminal) -> null | why    a pipe or TERM=dumb gets `live watch --plain|--jsonl`
//   tuiMain(ports, args, term, id)        `live tui`
//   openMain(ports, args, term, id)       `live open`: the viewer beside this session -- a tmux pane, a Windows
//                                         Terminal pane, an iTerm2 pane, a macOS Terminal window -- through Orbit Live's
//                                         own openers, or the command printed (always with --print, and in VS Code,
//                                         whose companion starts only Orbit's own viewer)
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { Refused } from "../../src/errors.mjs";
import { flag, has } from "../../src/learn/args.mjs";
import { clearLine, clearScreen, cursorTo, enterAlt, hideCursor, leaveAlt, resetStyle, showCursor, wrapOff, wrapOn } from "../../src/live/render/ansi.mjs";
import { changedRows } from "../../src/live/tui/diff.mjs";
import { decodeKeys } from "../../src/live/tui/keys.mjs";
import { createFollower } from "../../src/store/follow.mjs";
import { frameOf } from "../src/live/tui/frame.mjs";
import { actionOf, initialState, reduce } from "../src/live/tui/state.mjs";
import { liveViewOf } from "../src/live/view.mjs";
import { viewerStateOf } from "../src/live/viewer.mjs";
import { TERMINAL } from "../src/mission/vocab.mjs";
import { journalOf } from "../src/mission/world.mjs";
import { createProjection } from "../src/projection/fold.mjs";
import { journalLine } from "../src/store/line.mjs";
import { quietly, refused } from "../src/store/text.mjs";

export const TUI_TIMING = Object.freeze({ paintMs: 100, lingerMs: 3000 });

const REFUSALS = [
  { when: (t) => !t.stdout?.isTTY || !t.stdin?.isTTY, why: "live tui needs an interactive terminal (this one is a pipe or a file): use `live watch --plain` or `live watch --jsonl`" },
  { when: (t) => t.term === "dumb", why: "live tui cannot draw on TERM=dumb: use `live watch --plain` or `live watch --jsonl`" },
];

export const tuiRefusal = (terminal) => REFUSALS.find((r) => r.when(terminal))?.why ?? null;

// ---- the viewer ---------------------------------------------------------------------------------------------------

function runOf(world, terminal, opts) {
  const state = initialState({ columns: terminal.stdout.columns || 100, rows: terminal.stdout.rows || 30, ascii: opts.ascii === true, colour: terminal.colour === true, view: opts.view });
  const timers = opts.timers ?? globalThis;
  return { world, terminal, timers, clock: timers.now ?? (() => performance.now()), paintMs: opts.paintMs ?? TUI_TIMING.paintMs, untilDone: opts.untilDone ?? null, state, projection: createProjection(), read: { reads: 0, failures: 0, good: 0 }, shown: null, frame: null, interval: null, listeners: [], closed: false, kept: false, endedAt: null };
}

export function runSatelliteTui(world, terminal, opts = {}) {
  const t = runOf(world, terminal, opts);
  const done = new Promise((resolve) => Object.assign(t, { resolve }));
  started(t);
  return Object.assign(done, { restore: () => finished(t, "the viewer's process is ending") });
}

function started(t) {
  written(t, `${enterAlt()}${wrapOff()}${hideCursor()}${clearScreen()}`);
  rawOn(t.terminal.stdin);
  listened(t);
  t.interval = t.timers.setInterval(() => ticked(t), t.paintMs);
  ticked(t);
}

function rawOn(stdin) {
  stdin.setRawMode?.(true);
  stdin.resume?.();
}

const LISTENED = Object.freeze([
  ["stdin", "data", (t) => (chunk) => keyed(t, chunk)],
  ["stdout", "resize", (t) => () => resized(t)],
  ["signals", "SIGINT", (t) => () => finished(t, "interrupted")],
  ["signals", "SIGTERM", (t) => () => finished(t, "terminated")],
  ["signals", "SIGHUP", (t) => () => finished(t, "the terminal hung up")],
]);

function listened(t) {
  for (const [where, event, make] of LISTENED) on(t, where, event, make(t));
}

function on(t, where, event, fn) {
  t.terminal[where]?.on?.(event, fn);
  t.listeners.push([where, event, fn]);
}

// ---- a turn: what was written since, folded once; what a key or a resize asks ----------------------------------------

function pulled(t) {
  const got = quietly(() => t.world.follower.pull());
  t.read = { reads: t.read.reads + 1, failures: t.read.failures + (got ? 0 : 1), good: t.read.good + (got ? 1 : 0) };
  return got?.items ?? [];
}

function ticked(t) {
  if (t.closed) return;
  for (const item of pulled(t)) t.projection.push(item.record);
  if (!t.state.frozen || !t.shown) t.shown = liveViewOf(t.projection.model(), t.projection.events());
  painted(t);
  lingered(t);
}

function keyed(t, chunk) {
  for (const key of decodeKeys(String(chunk))) t.state = reduce(t.state, actionOf(t.state, key));
  if (t.state.quit) return finished(t, t.state.quit);
  t.kept = true;
  return ticked(t);
}

function resized(t) {
  t.state = reduce(t.state, { type: "resize", columns: t.terminal.stdout.columns || t.state.columns, rows: t.terminal.stdout.rows || t.state.rows });
  ticked(t);
}

// Only the rows that changed are written: a quiet mission costs the orbit's row, and a new line the rows it moved.
function painted(t) {
  const frame = frameOf(t.state, t.shown, viewerStateOf(t.shown, t.read, t.world.nowMs()), t.clock());
  written(t, changedRows(t.frame, frame).map((r) => `${cursorTo(r.row + 1, 1)}${clearLine()}${r.text}`).join(""));
  t.frame = frame;
  t.state = reduce(t.state, { type: "painted", top: frame.top });
}

// --until-done: leave by itself once the mission has ENDED and stayed ended for lingerMs -- unless a key kept it open.
function lingered(t) {
  if (!t.untilDone || t.kept || !TERMINAL.includes(t.shown.mission.lifecycle)) return;
  t.endedAt ??= t.clock();
  if (t.clock() - t.endedAt >= t.untilDone.lingerMs) finished(t, "the mission ended");
}

function written(t, text) {
  if (!text || t.closed) return;
  try { t.terminal.stdout.write(text); }
  catch { finished(t, "the terminal could not be written"); }
}

// ---- leaving: once, whatever asked -----------------------------------------------------------------------------------

function finished(t, why) {
  if (t.closed) return;
  t.closed = true;
  t.timers.clearInterval(t.interval);
  restored(t);
  t.resolve({ why, mission: t.shown?.mission.id ?? null, lifecycle: t.shown?.mission.lifecycle ?? null, cursor: `o=${t.projection.model().position}` });
}

function restored(t) {
  for (const [where, event, fn] of t.listeners) quietly(() => t.terminal[where]?.off?.(event, fn));
  quietly(() => t.terminal.stdin.setRawMode?.(false));
  quietly(() => t.terminal.stdin.pause?.());
  quietly(() => t.terminal.stdout.write(`${resetStyle()}${showCursor()}${wrapOn()}${leaveAlt()}`));
}

// ---- the commands ------------------------------------------------------------------------------------------------------

const untilDoneOf = (args) => (flag(args, "until-done") !== undefined ? { lingerMs: Math.max(0, Number(flag(args, "until-done")) || 0) * 1000 } : has(args, "until-done") ? { lingerMs: TUI_TIMING.lingerMs } : null);

const realTerminal = (term) => ({ stdin: process.stdin, stdout: process.stdout, signals: process, term: term.env.TERM, colour: term.colour });

export async function tuiMain(ports, args, term, id) {
  const terminal = realTerminal(term);
  const why = tuiRefusal(terminal);
  if (why) throw refused(Refused, "TUI_NEEDS_TERMINAL", why);
  const out = await runSatelliteTui({ follower: createFollower(ports.io, journalOf(ports, id).file, { parse: journalLine, keep: false }), nowMs: () => Date.now() }, terminal, { ascii: has(args, "ascii"), untilDone: untilDoneOf(args) });
  return term.write(`${JSON.stringify(out)}\n`);
}

// ---- open: beside this session, through Orbit Live's own openers ------------------------------------------------------

const OPEN_TIMEOUT_MS = 5000;

const realOf = (dir) => quietly(() => realpathSync(dir)) ?? dir;

// A program is started by its ABSOLUTE path, found only in PATH directories outside the checkout: a checkout cannot
// plant a `tmux` of its own.
const binIn = (env, root) => (name) => String(env.PATH ?? "").split(delimiter).filter((dir) => isAbsolute(dir) && !`${realOf(dir)}${sep}`.startsWith(`${realOf(root)}${sep}`)).flatMap((dir) => [name, `${name}.exe`].map((f) => join(dir, f))).find((f) => existsSync(f)) ?? null;

const viewerOf = (o, ports, env, id) => ({ argv: [process.execPath, join(ports.roots.satellite, "cli", "satellite.mjs"), "live", "tui", id, "--until-done"], cwd: ports.project.root, env: o.passedEnv(env), width: 36, focusCli: true, ancestry: () => [] });

function scriptWritten(ports, id, plan) {
  const file = join(ports.rooms.live, "open", `${id}${plan.scriptExt ?? ".command"}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, plan.script, { mode: 0o700 });
  chmodSync(file, 0o700);
  return file;
}

// Opened only when the opener's own exit says so; a sandbox that lets the command run and not the window appear is
// told so, with the command to run instead.
function launched(ports, id, plan) {
  if (!plan.argv) return false;
  const argv = quietly(() => (plan.script ? [...plan.argv, scriptWritten(ports, id, plan)] : plan.argv));
  const got = argv ? spawnSync(argv[0], argv.slice(1), { stdio: "ignore", timeout: OPEN_TIMEOUT_MS }) : null;
  if (got?.status === 0 && plan.then) quietly(() => spawnSync(plan.then[0], plan.then.slice(1), { stdio: "ignore", timeout: OPEN_TIMEOUT_MS }));
  return got?.status === 0;
}

const openSay = (plan, started) => (started ? plan.say : plan.argv ? "could not open a pane or a window from here: run this in a second terminal:" : plan.say);

export async function openMain(ports, args, term, id) {
  const o = await import("../../cli/live-open.mjs");
  const viewer = viewerOf(o, ports, term.env, id);
  const plan = o.openPlan(has(args, "print") ? o.OPENERS.at(-1) : o.openerOf(term.env, process.platform, binIn(term.env, ports.project.root), () => false), viewer, binIn(term.env, ports.project.root));
  const started = launched(ports, id, plan);
  return term.write(`${has(args, "json") ? JSON.stringify({ opener: plan.id, started, say: openSay(plan, started), command: o.typed(viewer) }) : `${openSay(plan, started)}${started ? "" : `\n  ${o.typed(viewer)}`}`}\n`);
}
