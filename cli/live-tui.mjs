// Orbit LIVE, full screen: the TERMINAL ADAPTER of the pure viewer in src/live/tui/. It owns what a pure module
// may not: the raw keyboard, the alternate screen, the clock, the timers, the signals -- and the feeds, which it
// opens and closes to match what the viewer's state WANTS (model.mjs `wanted`). Everything it reads comes from
// a `world` cli/live.mjs binds (the stores, the task and QA sources, the runtime's sandbox door), so a test
// hands it a fake terminal and a world over real journals and nothing here touches a disk of its own.
//
//   tuiRefusal(terminal) -> null | why                      a pipe or TERM=dumb gets `watch --plain|--jsonl`
//   runTui(world, terminal, opts) -> Promise<{ why, task, lifecycle, stage, cursor }>   + .restore()
//     opts.untilDone { lingerMs }   leave by itself once the task shown has ENDED and stayed ended for lingerMs;
//                                   any key keeps it open, and a newly started task the viewer follows resets it
//     world.lease                   a viewer a launcher opened for a session (cli/live-ensure.mjs, ADR 0020): it
//                                   says it is ready once it has drawn, beats, follows a task the launcher asks it
//                                   to show unless a person picked one here, and says why it left
//
// It writes nothing anywhere but the terminal it was handed -- and, for a leased viewer, its own lease. Leaving --
// q, Ctrl+C, a signal, a write that failed, an error -- runs ONE teardown, once: timers cleared, feeds and log
// leases released, the keyboard given back, colour reset, the cursor shown, line wrap on, the alternate screen left,
// the lease told. The task is never touched.
import { HEARTBEAT_MS } from "../src/live/lease.mjs";
import { tickSubject } from "../src/live/subjects.mjs";
import { sessionRefusal } from "../src/live/logs.mjs";
import { clearLine, clearScreen, cursorTo, enterAlt, hideCursor, leaveAlt, resetStyle, showCursor, wrapOff, wrapOn } from "../src/live/render/ansi.mjs";
import { decodeKeys, actionOfKey } from "../src/live/tui/keys.mjs";
import { childIdOf, initialState, TASK_ID, wanted } from "../src/live/tui/model.mjs";
import { reduce, rootEnded } from "../src/live/tui/reducer.mjs";
import { frameOf } from "../src/live/tui/frame.mjs";
import { changedRows } from "../src/live/tui/diff.mjs";

export const TIMING = Object.freeze({ paintMs: 100, tickMs: 15_000, listMs: 5_000, retryMs: [1000, 2000, 4000, 8000, 16000], coordinatorsPerList: 5, expandedCheckouts: 3, leaseMs: HEARTBEAT_MS, selectionMs: 1000 });

const REFUSALS = [
  { when: (t) => !t.stdout?.isTTY || !t.stdin?.isTTY, why: "live tui needs an interactive terminal (this one is a pipe or a file): use `live watch --plain` or `live watch --jsonl`" },
  { when: (t) => t.term === "dumb", why: "live tui cannot draw on TERM=dumb: use `live watch --plain` or `live watch --jsonl`" },
];

export const tuiRefusal = (terminal) => REFUSALS.find((r) => r.when(terminal))?.why ?? null;

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

// ---- starting ---------------------------------------------------------------------------------------------

export function runTui(world, terminal, opts = {}) {
  const t = runOf(world, terminal, opts);
  const done = new Promise((resolve, reject) => Object.assign(t, { resolve, reject }));
  const got = attempted(() => started(t));
  if (got.error) failedStart(t, got.error);
  return Object.assign(done, { restore: () => finished(t, "the viewer's process is ending") });
}

function runOf(world, terminal, opts) {
  const timing = { ...TIMING, ...(opts.timing ?? {}) };
  const size = sizeOf(terminal);
  const state = initialState({ ...opts.start, columns: size.columns, rows: size.rows, colour: terminal.colour, depth: terminal.depth, bands: terminal.bands, ascii: opts.ascii, nowMs: world.nowMs(), settings: world.settings });
  return { world, terminal, timing, untilDone: opts.untilDone ?? null, ending: null, kept: false, timers: opts.timers ?? globalThis, state, frame: null, feeds: new Map(), console: { key: null, generation: 0, reader: null, leases: [], session: null, busy: {} }, intervals: [], retries: new Set(), listeners: [], closed: false, dirty: true, second: null, shows: new Map(), loaded: new Set() };
}

const sizeOf = (terminal) => ({ columns: terminal.stdout.columns || 100, rows: terminal.stdout.rows || 30 });

function started(t) {
  entered(t);
  listsRead(t, true);
  reconciled(t);
  painted(t);
  return scheduled(t);
}

function failedStart(t, why) {
  t.reject(new Error(`live tui could not start: ${why}`));
  finished(t, `live tui could not start (${why}); the terminal was given back`);
}

// The screen first, then the keyboard: a failure between them still leaves through the one teardown.
function entered(t) {
  write(t, `${enterAlt()}${wrapOff()}${hideCursor()}${resetStyle()}`);
  t.terminal.stdin.setRawMode(true);
  t.terminal.stdin.resume();
  listened(t);
}

function on(t, emitter, event, fn) {
  emitter.on(event, fn);
  t.listeners.push(() => emitter.off(event, fn));
}

function listened(t) {
  on(t, t.terminal.stdin, "data", (chunk) => keyed(t, chunk));
  on(t, t.terminal.stdout, "resize", () => resized(t));
  on(t, t.terminal.stdout, "error", () => finished(t, "the terminal could not be written to"));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) on(t, t.terminal.signals, signal, () => finished(t, "detached"));
}

function scheduled(t) {
  const every = (ms, fn) => t.intervals.push(t.timers.setInterval(() => quietly(fn) ?? null, ms));
  every(t.timing.paintMs, () => painted(t));
  every(t.timing.tickMs, () => [...t.feeds.values()].forEach((e) => e.feed?.tick()));
  every(t.timing.listMs, () => listsRead(t, false));
  return leased(t, every);
}

// ---- a leased viewer: ready, a beat, what a launcher asks it to show --------------------------------------------

function leased(t, every) {
  if (!t.world.lease) return true;
  t.world.lease.ready({ shows: t.state.root, picked: !t.state.picker.auto });
  every(t.timing.leaseMs, () => leaseBeat(t));
  every(t.timing.selectionMs, () => selectionSeen(t, t.world.lease.peek()));
  return true;
}

function leaseBeat(t) {
  if (t.leaseLost) return;
  const got = t.world.lease.beat({ shows: t.state.root, picked: !t.state.picker.auto });
  if (!got.held) return leaseLost(t);
  selectionSeen(t, got.selection);
}

// A launcher replaced this viewer (it had been silent too long): it keeps showing, as any viewer a person opened.
function leaseLost(t) {
  t.leaseLost = true;
  dispatch(t, { type: "message", message: "another viewer now serves this session; this one stays until you leave it" });
}

// Each ask once: the viewer follows it unless a person picked a task here (the reducer offers it instead).
function selectionSeen(t, selection) {
  if (t.leaseLost || !selection || !TASK_ID.test(String(selection.task)) || selection.at === t.selectionAt) return;
  t.selectionAt = selection.at;
  dispatch(t, { type: "selection", task: selection.task });
}

// ---- state --------------------------------------------------------------------------------------------

const apply = (t, action) => {
  t.state = reduce(t.state, action);
};

function dispatch(t, action) {
  apply(t, action);
  t.dirty = true;
  if (t.state.viewer.quitting) return finished(t, t.state.viewer.quitting);
  reconciled(t);
}

function keyed(t, chunk) {
  const keys = decodeKeys(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
  if (t.ending && !t.kept) kept(t);
  for (const key of keys) dispatchKey(t, key);
  if (!t.closed) painted(t);
}

function dispatchKey(t, key) {
  const action = t.closed ? null : actionOfKey(t.state.viewer, key);
  if (action) dispatch(t, action);
}

function resized(t) {
  dispatch(t, { type: "resize", ...sizeOf(t.terminal) });
  painted(t);
}

// ---- what is wanted open ------------------------------------------------------------------------------

function reconciled(t) {
  if (t.closed) return;
  feedsReconciled(t);
  placeReconciled(t);
  consoleReconciled(t);
  apply(t, { type: "followers", count: t.world.followers.size() });
}

function feedsReconciled(t) {
  const want = wanted(t.state).feeds;
  [...t.feeds.keys()].filter((id) => !want.includes(id)).forEach((id) => feedDropped(t, id));
  want.filter((id) => !t.feeds.has(id)).forEach((id) => feedOpened(t, id, id === t.state.root ? "root" : "child"));
}

// A task picked in ANOTHER checkout: its place is found through the registry, and only then is it opened.
function placeReconciled(t) {
  const p = t.state.pending;
  const place = p ? quietly(() => t.world.locate(p.key, p.checkoutId)) : null;
  if (p && !place) t.state = { ...t.state, pending: null, viewer: { ...t.state.viewer, message: "that checkout is no longer where the registry says" } };
  if (place) placedAt(t, place, p.task);
}

function placedAt(t, place, task) {
  apply(t, { type: "place", place, task });
  feedsReconciled(t);
}

// ---- feeds ----------------------------------------------------------------------------------------------

const sinkOf = (t, entry) => ({ get closed() { return t.closed || entry.closed; }, send: (frame) => entry.inbox.push(frame) > 0, end: () => {} });

function feedOpened(t, id, role) {
  apply(t, { type: "feed-opened", task: id, role });
  const entry = { id, inbox: [], feed: null, closed: false, retries: 0, timer: null };
  t.feeds.set(id, entry);
  feedStarted(t, entry, t.state.tasks[id]?.cursor ?? "t=0");
}

function feedStarted(t, entry, cursor) {
  const got = attempted(() => t.world.open(t.state.place, entry.id, cursor));
  if (got.error) return apply(t, { type: "feed-unavailable", task: entry.id, error: got.error });
  Object.assign(entry, { feed: got.value, closed: false });
  attempted(() => got.value.start(sinkOf(t, entry)));
}

function attempted(fn) {
  try { return { value: fn() }; }
  catch (e) { return { error: String(e?.message ?? e) }; }
}

function feedClosed(entry) {
  entry.closed = true;
  quietly(() => entry.feed?.close());
  entry.feed = null;
}

function feedDropped(t, id) {
  const entry = t.feeds.get(id);
  feedClosed(entry);
  if (entry.timer) t.timers.clearTimeout(entry.timer);
  t.feeds.delete(id);
  apply(t, { type: "feed-closed", task: id });
}

// What arrived since the last frame, ONE action per task however many lines it was; then what the end means.
function drained(t, entry) {
  if (!entry.inbox.length) return;
  const frames = entry.inbox.splice(0);
  dispatch(t, { type: "frames", task: entry.id, frames });
  const end = frames.find((f) => f.event === "end")?.data?.reason;
  return end ? ENDINGS[end]?.(t, entry) : Object.assign(entry, { retries: 0 });
}

const ENDINGS = {
  terminal: (t, entry) => feedClosed(entry),
  reset: (t, entry) => {
    feedClosed(entry);
    apply(t, { type: "feed-reset", task: entry.id });
    feedStarted(t, entry, "t=0");
  },
  error: (t, entry) => {
    feedClosed(entry);
    apply(t, { type: "feed-error", task: entry.id, error: "its journal could not be followed" });
    retried(t, entry);
  },
};

// A journal that could not be followed is read again from the cursor the viewer holds, a few times, further
// apart each time; then the viewer says it is UNAVAILABLE and stops asking.
function retried(t, entry) {
  const wait = t.timing.retryMs[entry.retries];
  if (wait === undefined) return apply(t, { type: "feed-unavailable", task: entry.id, error: "its journal could not be followed; the viewer stopped asking" });
  entry.retries += 1;
  entry.timer = t.timers.setTimeout(() => quietly(() => (t.closed || t.feeds.get(entry.id) !== entry ? null : feedStarted(t, entry, t.state.tasks[entry.id]?.cursor ?? "t=0"))), wait);
}

// ---- the lists: the registry, a checkout's tasks, the association, a workflow's engineering task ---------

// Whether the lists are read again: while the viewer follows the association and has nothing running to show,
// while the picker is open, and once after `r`.
const following = (t) => t.state.picker.auto && (!t.state.root || rootEnded(t.state));

const LIST_WANTED = (t) => following(t) || t.state.viewer.overlay === "picker" || t.state.viewer.refresh !== t.refreshSeen;

function listsRead(t, first) {
  observedNow(t);
  if (!first && !LIST_WANTED(t)) return;
  t.refreshSeen = t.state.viewer.refresh;
  apply(t, { type: "projects", projects: quietly(() => t.world.projects()) ?? [] });
  listsOfPlace(t);
}

// What the sandbox console and THIS session's own tools did (1.8.7) are read on every list beat, a task or not.
function observedNow(t) {
  consoleSessions(t);
  if (t.world.session) apply(t, { type: "session", activity: quietly(() => t.world.session(t.state.place)) ?? t.state.session });
  if (t.world.work) apply(t, { type: "work", view: workNow(t) });
  t.dirty = true;
}

// The tracked work's view, or what the viewer already holds when this read failed: a failure to read it never blanks the pane,
// and never reaches the task.
const workNow = (t) => ((got) => (got ? got.view : t.state.work))(quietly(() => ({ view: t.world.work(t.state.place) })));

function listsOfPlace(t) {
  if (!t.state.place) placeFound(t);
  expandedRows(t);
  if (following(t) && t.state.place) dispatch(t, { type: "association", association: quietly(() => t.world.associate(t.state.place)) ?? t.state.association });
  coordinatorsRead(t);
  t.dirty = true;
}

function expandedRows(t) {
  const ids = Object.entries(t.state.picker.expanded).filter(([, open]) => open).map(([id]) => id).slice(0, t.timing.expandedCheckouts + 1);
  for (const id of ids) rowsRead(t, id);
}

function rowsRead(t, checkoutId) {
  const place = checkoutId === t.state.place?.checkoutId ? t.state.place : quietly(() => t.world.locate(keyOf(t, checkoutId), checkoutId));
  const rows = place ? quietly(() => t.world.rows(place)) : null;
  if (rows) apply(t, { type: "rows", checkoutId, rows });
  t.loaded.add(checkoutId);
}

// A directory Orbit had not written for when the viewer opened is looked for again: the first task started there
// binds it, and from then on its tasks are followed like any other checkout's.
function placeFound(t) {
  const place = t.world.relocate ? quietly(() => t.world.relocate()) : null;
  if (place) apply(t, { type: "located", place });
}

const keyOf = (t, checkoutId) => t.state.picker.projects.find((p) => p.checkouts.some((c) => c.id === checkoutId))?.key ?? t.state.place?.key;

// Which engineering task a RUNNING workflow started is known only from its view: read through `show`, at most a
// few per look, and only while the picker is open.
function coordinatorsRead(t) {
  const rows = (t.state.picker.rows[t.state.place?.checkoutId] ?? []).filter((r) => r.coordinates && !r.terminal && !t.state.tasks[r.id]).slice(0, t.timing.coordinatorsPerList);
  if (t.state.viewer.overlay !== "picker" || !rows.length) return;
  const views = Object.fromEntries(rows.map((r) => [r.id, quietly(() => t.world.show(t.state.place, r.id))]).filter(([, v]) => v));
  apply(t, { type: "children", children: Object.fromEntries(Object.entries(views).map(([id, v]) => [id, childIdOf(v)])), views: Object.fromEntries(Object.entries(views).map(([id, v]) => [id, { lifecycle: v.lifecycle, stage: v.stage }])) });
}

// ---- the sandbox console --------------------------------------------------------------------------------

const consoleKey = (want) => (want ? `${want.task}|${want.env ?? ""}|${want.refusal?.code ?? ""}` : null);

function consoleReconciled(t) {
  const want = wanted(t.state).console;
  if (consoleKey(want) !== t.console.key) consoleTargeted(t, want);
  if (want && t.console.reader && t.state.console.session !== t.console.session) readersStarted(t);
}

function consoleTargeted(t, want) {
  consoleReleased(t);
  Object.assign(t.console, { key: consoleKey(want), reader: null, session: null, generation: t.console.generation + 1 });
  if (!want) return;
  if (want.refusal) return apply(t, { type: "console-target", task: want.task, message: want.refusal.why, state: "stopped" });
  consoleAsked(t, want, t.console.generation);
}

function consoleAsked(t, want, generation) {
  apply(t, { type: "console-target", task: want.task, message: "finding the task's sandbox…", state: "idle" });
  const view = t.state.tasks[want.task]?.view ?? { receipts: [] };
  Promise.resolve().then(() => t.world.console(t.state.place, want.task, view)).then((got) => consoleGot(t, want, generation, got), (e) => consoleFailed(t, generation, e));
}

const current = (t, generation) => !t.closed && generation === t.console.generation;

const defaultSession = (sessions) => sessions.find((s) => s.state === "RUNNING")?.session ?? sessions.at(-1)?.session ?? null;

function consoleGot(t, want, generation, got) {
  if (!current(t, generation)) return;
  const session = got.message ? null : want.session ?? defaultSession(got.sessions ?? []);
  t.console.reader = got.message ? null : got;
  dispatch(t, { type: "console-target", task: want.task, env: got.env ?? null, sessions: got.sessions ?? [], session, message: got.message ?? (session ? null : "this sandbox has run no session yet"), state: got.message || !session ? "stopped" : "reading" });
}

function consoleFailed(t, generation, error) {
  if (!current(t, generation)) return;
  dispatch(t, { type: "console-message", message: `unavailable: ${String(error?.message ?? error).slice(0, 200)}`, state: "stopped" });
}

// One clock per stream, shared through the follower registry as Orbit Control shares it (a tick subject), and
// each read at this viewer's own offset through the runtime's `sandbox-logs` -- the one door to a log.
function readersStarted(t) {
  consoleReleased(t);
  const c = t.state.console;
  t.console.session = c.session;
  if (!c.session || !c.env) return;
  t.console.leases = ["out", "err"].map((stream) => streamLeased(t, c, stream));
}

function streamLeased(t, c, stream) {
  const lease = t.world.followers.acquire(`log:${c.env}/${c.session}/${stream}`, tickSubject);
  const generation = t.console.generation;
  lease.listen(() => streamRead(t, generation, c.task, c.session, stream));
  lease.refresh();
  return lease;
}

function streamRead(t, generation, task, session, stream) {
  const refusal = sessionRefusal(session, stream);
  if (!current(t, generation) || t.console.busy[stream] || !t.console.reader) return;
  if (refusal) return dispatch(t, { type: "console-message", message: refusal.why, state: "stopped" });
  t.console.busy[stream] = true;
  Promise.resolve().then(() => t.console.reader.read(session, stream, t.state.console.streams[stream].next)).then((got) => streamGot(t, generation, { task, session, stream, got }), (e) => streamFailed(t, generation, stream, e));
}

function streamGot(t, generation, log) {
  t.console.busy[log.stream] = false;
  if (current(t, generation)) dispatch(t, { type: "log", ...log });
}

function streamFailed(t, generation, stream, error) {
  t.console.busy[stream] = false;
  if (!current(t, generation)) return;
  consoleReleased(t);
  dispatch(t, { type: "console-message", message: `${stream === "out" ? "stdout" : "stderr"} stopped: ${String(error?.message ?? error).slice(0, 200)}`, state: "stopped" });
}

function consoleReleased(t) {
  t.console.leases.forEach((lease) => quietly(() => lease.release()));
  Object.assign(t.console, { leases: [], busy: {} });
}

function consoleSessions(t) {
  const reader = t.console.reader;
  const generation = t.console.generation;
  if (!reader?.refresh || !t.state.console.open) return;
  Promise.resolve().then(() => reader.refresh()).then((sessions) => current(t, generation) && Array.isArray(sessions) && dispatch(t, { type: "console-sessions", sessions }), () => null);
}

// ---- painting ---------------------------------------------------------------------------------------------

// A new second moves the pulse and every "ago"; within one, nothing that is drawn moved with the clock.
function clockMoved(t) {
  const now = t.world.nowMs();
  const moved = Math.floor(now / 1000) !== t.second;
  apply(t, { type: "tick", nowMs: now });
  t.second = Math.floor(now / 1000);
  return moved;
}

const extentsMoved = (t, frame) => JSON.stringify(frame.extents) !== JSON.stringify(t.state.viewer.extents);

// 0.0.2: while the header's orbit turns (the frame last drawn says so) every paint is a frame of it, so the satellite
// goes round at its own speed instead of once a second; only the rows that changed are written.
const spinning = (t) => t.frame?.orbiting === true;

function painted(t) {
  if (t.closed) return;
  [...t.feeds.values()].forEach((entry) => drained(t, entry));
  const moved = clockMoved(t) || spinning(t);
  if (!endingChecked(t) && (t.dirty || moved)) drawn(t, frameOf(t.state));
}

// The rows that changed, each placed and cleared before it is written; the whole screen cleared first when the
// frame is the first, a new size, or asked to be drawn whole.
function bytesOf(prev, frame) {
  const head = !prev || frame.full || prev.columns !== frame.columns || prev.rows !== frame.rows ? clearScreen() : "";
  const ops = changedRows(prev, frame);
  return ops.length || head ? `${head}${ops.map((op) => `${cursorTo(op.row + 1, 1)}${clearLine()}${op.text}`).join("")}${resetStyle()}` : "";
}

// After a frame, the scroll limits it measured go back into the state; when they moved, the next frame is drawn.
function drawn(t, frame) {
  const bytes = bytesOf(t.frame, frame);
  if (bytes) write(t, bytes);
  Object.assign(t, { frame, dirty: extentsMoved(t, frame) });
  apply(t, { type: "painted" });
  if (t.dirty) apply(t, { type: "extents", extents: frame.extents });
}

function write(t, text) {
  try { t.terminal.stdout.write(text); }
  catch { finished(t, "the terminal could not be written to"); }
}

// ---- leaving when the work is done (--until-done) ------------------------------------------------------

const ENDING = "the task ended";

// Whether the viewer left because the task it shows ended long enough ago; it says so while it counts down.
function endingChecked(t) {
  if (!t.untilDone || t.kept || !rootEnded(t.state)) return endingCleared(t);
  t.ending = t.ending?.task === t.state.root ? t.ending : { task: t.state.root, at: t.world.nowMs() };
  const left = t.untilDone.lingerMs - (t.world.nowMs() - t.ending.at);
  if (left <= 0) finished(t, ENDING);
  return left <= 0 || endingSaid(t, left);
}

function endingSaid(t, left) {
  const message = `${ENDING} · this viewer closes in ${Math.ceil(left / 1000)}s · any key keeps it open`;
  if (t.state.viewer.message !== message) dispatch(t, { type: "message", message });
  return false;
}

function endingCleared(t) {
  if (t.ending && String(t.state.viewer.message ?? "").startsWith(ENDING)) dispatch(t, { type: "message", message: null });
  t.ending = null;
  return false;
}

function kept(t) {
  t.kept = true;
  dispatch(t, { type: "message", message: "kept open: q leaves (the task has ended)" });
}

// ---- leaving --------------------------------------------------------------------------------------------

function finished(t, why) {
  if (t.closed) return;
  t.closed = true;
  released(t);
  restoredAndLeft(t, why);
  t.resolve?.(outcome(t, why));
}

// The terminal given back, then the lease told why the viewer left: a person's q is a detach a workflow's own ask
// never undoes (src/live/ensure.mjs NOT_REOPENED).
function restoredAndLeft(t, why) {
  quietly(() => t.terminal.stdout.write(`${resetStyle()}${wrapOn()}${showCursor()}${leaveAlt()}`));
  if (t.world.lease && !t.leaseLost) quietly(() => t.world.lease.left(why));
}

function released(t) {
  t.intervals.forEach((id) => t.timers.clearInterval(id));
  [...t.feeds.values()].forEach((entry) => entryReleased(t, entry));
  consoleReleased(t);
  t.listeners.splice(0).forEach((off) => quietly(off));
  keyboardReturned(t.terminal.stdin);
}

function entryReleased(t, entry) {
  feedClosed(entry);
  if (entry.timer) t.timers.clearTimeout(entry.timer);
}

function keyboardReturned(stdin) {
  quietly(() => stdin.setRawMode(false));
  quietly(() => stdin.pause());
}

function outcome(t, why) {
  const slot = t.state.tasks[t.state.root];
  return { why, task: t.state.root, lifecycle: slot?.view?.lifecycle ?? null, stage: slot?.view?.stage ?? null, cursor: slot?.cursor ?? null };
}
