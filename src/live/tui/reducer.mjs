// The full-screen viewer's transitions: one table, action type -> (state, action) -> state, pure, never mutating
// what it is handed. Two kinds of action arrive: what the terminal adapter READ (a feed's frames, a log's lines,
// the task list, the terminal's size and the clock) and what a person PRESSED (cli/live-tui.mjs turns keys into
// actions through keys.mjs). None of them is a decision about a task: a key moves what is shown, never the work.
//
//   reduce(state, action) -> state            an action no row names returns the state it was given
import { FILTERS, FOCUS_RING, LAYOUTS, LIMITS, PANE_VIEWS, bounded, childOf, countOf, emptyConsole, taskSlot } from "./model.mjs";
import { ACTIVITY_FILTERS } from "./overlays/activity.mjs";
import { pickerItems } from "./tree.mjs";

const same = (s) => s;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const viewer = (s, patch) => ({ ...s, viewer: { ...s.viewer, ...patch } });
const picker = (s, patch) => ({ ...s, picker: { ...s.picker, ...patch } });
const withSlot = (s, id, slot) => ({ ...s, tasks: { ...s.tasks, [id]: slot } });
const slotPatch = (s, id, patch) => (s.tasks[id] ? withSlot(s, id, { ...s.tasks[id], ...patch }) : s);
const without = (map, key) => Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
const overlayOpen = (s) => s.viewer.overlay !== null;

// ---- what a feed read ---------------------------------------------------------------------------------

const isEvent = (f) => f.event === "task-event" || f.event === "qa-event";
const readOk = (read) => ({ ...read, reads: read.reads + 1, failures: 0, good: true });
const readFailed = (read) => ({ ...read, reads: read.reads + 1, failures: read.failures + 1 });

// A batch of frames, folded at once: the lines into the window, the newest view, each check's observation, an end, the
// cursor after them.
function folded(slot, frames) {
  const got = bounded([...slot.events, ...frames.filter(isEvent).map((f) => f.data)], LIMITS.EVENTS_KEPT);
  const ended = frames.some((f) => f.event === "end" && f.data?.reason === "terminal");
  const view = frames.findLast((f) => f.event === "task-view")?.data?.view ?? slot.view;
  return { ...slot, events: got.kept, dropped: slot.dropped + got.dropped, view, activity: observationsAfter(slot.activity ?? {}, frames), plan: planAfter(slot.plan ?? null, frames), skills: skillsAfter(slot.skills ?? {}, frames), end: ended ? "terminal" : slot.end, cursor: frames.findLast((f) => f.id)?.id ?? slot.cursor, seq: slot.seq + 1, read: readOk(slot.read), status: ended || slot.end ? "finished" : "live", error: null };
}

// An observation is a projection the viewer REPLACES, by action, and only with a newer one (its revision grew, or its
// file was begun again): a frame that arrives late or twice moves nothing, and a late line of an old attempt can only
// ever update that attempt's own action.
const newer = (was, f) => !was || f.data.view.resets > (was.resets ?? 0) || (f.data.view.resets === (was.resets ?? 0) && f.data.revision > was.seq);

const observationsAfter = (acts, frames) => frames.filter((f) => f.event === "activity-view" && f.data?.view && typeof f.data.action === "string").reduce((all, f) => (newer(all[f.data.action], f) ? { ...all, [f.data.action]: f.data.view } : all), acts);

// A workflow's plan is a projection the viewer REPLACES with the newest one sent (1.8.6): a revision always counts up.
const planAfter = (was, frames) => ((f) => (f?.data?.view && (!was || f.data.view.n >= was.n) ? f.data.view : was))(frames.findLast((x) => x.event === "plan-view"));

// A declared playbook's workflow (0.0.4) is one projection per PIN, which never changes: kept as first sent.
const skillsAfter = (was, frames) => frames.filter((f) => f.event === "skill-view" && f.data?.view && typeof f.data.pin === "string").reduce((all, f) => (all[f.data.pin] ? all : { ...all, [f.data.pin]: f.data.view }), was);

const failed = (slot, error, status) => (slot ? { status, error: String(error ?? "").slice(0, 300), read: readFailed(slot.read), seq: slot.seq + 1 } : {});

// A journal begun again: the slot starts over, remembering that (and when) it had to.
const reset = (s, id) => ({ ...taskSlot(id, s.tasks[id]?.role ?? "root"), status: "reset", resets: (s.tasks[id]?.resets ?? 0) + 1, resetAt: new Date(s.viewer.nowMs).toISOString() });

// ---- which task ---------------------------------------------------------------------------------------

const unheld = { scroll: { recent: 0, sandbox: 0 }, hold: { recent: null, sandbox: null }, frozen: false, cursor: 0 };

// A task the PERSON chose: the viewer stops following the association for good.
const chose = (s, task) => ({ ...s, root: task, focus: "root", picker: { ...s.picker, auto: false }, console: emptyConsole(s.console.open), viewer: { ...s.viewer, ...unheld, overlay: null, autoPicker: false, redraw: true } });

// The association (src/live/association.mjs, asked again by the adapter) is followed until a person picks, and
// only into a task: AMBIGUOUS and none leave the picker open. A task it chose that has ENDED gives way to the task
// it names next, when that one is running -- a viewer opened before the work began follows the work, while a task
// a person picked stays shown whatever starts.
export const rootEnded = (s) => s.tasks[s.root]?.end === "terminal";

const follows = (s, a) => s.picker.auto && Boolean(a.task) && a.task !== s.root && (!s.root || (rootEnded(s) && a.how !== "finished"));

const followed = (s, a) => ({ ...s, association: a, root: a.task, focus: "root", console: emptyConsole(s.console.open), viewer: { ...s.viewer, ...unheld, overlay: s.viewer.autoPicker || !s.root ? null : s.viewer.overlay, autoPicker: false, redraw: true } });

const associated = (s, association) => (follows(s, association) ? followed(s, association) : { ...s, association });

// A task a launcher asked this viewer to show (src/live/lease.mjs `selection`): followed while the viewer follows its
// session, OFFERED when a person picked a task here -- a person's choice is never moved under them.
const selected = (s, a) => (a.task === s.root ? s : s.picker.auto ? followed(s, { how: "selection", task: a.task, ids: [a.task] }) : viewer(s, { message: `a new task to show: ${a.task} — t picks it` }));

// The checkout this directory turned out to be, once Orbit's first write in it bound it.
const located = (s, a) => (a.place?.checkoutId && !s.place ? { ...s, place: a.place, picker: { ...s.picker, expanded: { ...s.picker.expanded, [a.place.checkoutId]: true } }, viewer: { ...s.viewer, redraw: true } } : s);

const placed = (s, a) => (a.place?.checkoutId ? { ...chose(s, a.task), place: a.place, pending: null, tasks: {}, picker: { ...s.picker, auto: false, expanded: { ...s.picker.expanded, [a.place.checkoutId]: true } } } : s);

const ITEM_PICKS = {
  project: same,
  checkout: (s, item) => picker(s, { expanded: { ...s.picker.expanded, [item.checkoutId]: !s.picker.expanded[item.checkoutId] } }),
  task: (s, item) => (item.checkoutId === s.place?.checkoutId ? chose(s, item.task) : { ...s, pending: { key: item.key, checkoutId: item.checkoutId, task: item.task } }),
};

const pickedItem = (s, item) => (item ? ITEM_PICKS[item.kind](s, item) : s);

const detailToggled = (s) => viewer(s, { detail: s.viewer.detail === s.viewer.cursor ? null : s.viewer.cursor });

const PICKS = {
  picker: (s) => pickedItem(s, pickerItems(s)[s.viewer.cursor]),
  activity: detailToggled,
  evidence: detailToggled,
  inspect: detailToggled,
};

// `f` in the activity inspector: the next filter, the list from its top, no item open.
const inspectFiltered = (s) => (s.viewer.overlay === "activity" ? viewer(s, { inspect: { ...s.viewer.inspect, filter: nextIn(ACTIVITY_FILTERS, s.viewer.inspect?.filter ?? "all", 1) }, cursor: 0, detail: null }) : s);

// ---- scrolling, freezing ------------------------------------------------------------------------------

// Which way is away from the live edge: RECENT is newest on top, SANDBOX newest at the bottom, as a log reads.
const SIGN = { recent: 1, sandbox: -1 };
const EDGE = { recent: { start: () => 0, end: (max) => max }, sandbox: { start: (max) => max, end: () => 0 } };

// A list scrolled away from its live edge is HELD at the lines it had, so what a person reads does not move
// under them; back at the edge it follows again, unless the whole display is frozen.
function scrolled(s, section, value) {
  const scroll = clamp(value, 0, s.viewer.extents[section].max);
  const hold = scroll > 0 || s.viewer.frozen ? s.viewer.hold[section] ?? countOf(s, section) : null;
  return viewer(s, { scroll: { ...s.viewer.scroll, [section]: scroll }, hold: { ...s.viewer.hold, [section]: hold }, search: { ...s.viewer.search, jump: false } });
}

const cursorAt = (s, value) => viewer(s, { cursor: clamp(value, 0, s.viewer.extents.overlay.max) });
const focused = (s) => s.viewer.focus;
const page = (s, section) => Math.max(1, s.viewer.extents[section].page);

function frozen(s) {
  const on = !s.viewer.frozen;
  const hold = on ? { recent: countOf(s, "recent"), sandbox: countOf(s, "sandbox") } : { recent: null, sandbox: null };
  return viewer(s, { frozen: on, hold, scroll: on ? s.viewer.scroll : { recent: 0, sandbox: 0 } });
}

const clampedScroll = (s) => viewer(s, { scroll: { recent: clamp(s.viewer.scroll.recent, 0, s.viewer.extents.recent.max), sandbox: clamp(s.viewer.scroll.sandbox, 0, s.viewer.extents.sandbox.max) }, cursor: clamp(s.viewer.cursor, 0, s.viewer.extents.overlay.max) });

const ring = (s) => (s.console.open ? FOCUS_RING : FOCUS_RING.slice(0, 1));
const nextIn = (list, at, by) => list[(((list.indexOf(at) + by) % list.length) + list.length) % list.length];

// ---- search ---------------------------------------------------------------------------------------------

const searchOf = (s, patch) => viewer(s, { search: { ...s.viewer.search, ...patch } });
const typed = (s, ch) => searchOf(s, { query: [...`${s.viewer.search.query}${ch}`].slice(0, LIMITS.QUERY_MAX).join(""), at: 0, jump: true });

// ---- the console ----------------------------------------------------------------------------------------

const consoleOf = (s, patch) => ({ ...s, console: { ...s.console, ...patch } });
const freshStreams = () => emptyConsole(false).streams;

function logged(stream, got) {
  const base = got.reset ? { ...freshStreams().out, reset: stream.reset + 1 } : stream;
  const kept = bounded([...base.lines, ...(got.lines ?? [])], LIMITS.LOG_KEPT);
  return { ...base, lines: kept.kept, dropped: base.dropped + kept.dropped, next: got.next ?? base.next, size: got.size ?? base.size, truncated: Boolean(got.truncated), held: Boolean(got.held) };
}

const isCurrent = (s, a) => a.session === s.console.session && a.task === s.console.task;

const targeted = (s, a) => consoleOf(s, { task: a.task, env: a.env ?? null, sessions: a.sessions ?? [], session: a.session ?? null, message: a.message ?? null, state: a.state ?? "reading", streams: freshStreams() });

function nextSession(s) {
  const ids = s.console.sessions.map((x) => x.session);
  return ids.length > 1 ? consoleOf(s, { session: nextIn(ids, s.console.session, 1), streams: freshStreams(), state: "idle" }) : s;
}

// The picker opens on the task shown, so Enter on it changes nothing and the person sees where they are.
const openedAt = (s, name) => (name === "picker" ? Math.max(0, pickerItems(s).findIndex((it) => it.kind === "task" && it.task === s.root)) : 0);

// ---- the table ------------------------------------------------------------------------------------------

export const TRANSITIONS = Object.freeze({
  frames: (s, a) => (s.tasks[a.task] ? withSlot(s, a.task, folded(s.tasks[a.task], a.frames)) : s),
  "feed-opened": (s, a) => (s.tasks[a.task] ? s : withSlot(s, a.task, taskSlot(a.task, a.role))),
  "feed-reset": (s, a) => withSlot(s, a.task, reset(s, a.task)),
  "feed-error": (s, a) => slotPatch(s, a.task, failed(s.tasks[a.task], a.error, "reconnecting")),
  "feed-unavailable": (s, a) => slotPatch(s, a.task, failed(s.tasks[a.task], a.error, "unavailable")),
  "feed-closed": (s, a) => ({ ...s, tasks: without(s.tasks, a.task) }),
  association: (s, a) => associated(s, a.association),
  // THIS SESSION's tool activity, as the terminal adapter last read it (1.8.7): a viewer's input, never a task's state.
  session: (s, a) => ({ ...s, session: a.activity ?? null }),
  // THE TRACKED WORK's view (1.8.8), as the terminal adapter last read it: a viewer's input, never written back.
  work: (s, a) => ({ ...s, work: a.view ?? null }),
  selection: selected,
  located,
  projects: (s, a) => picker(s, { projects: a.projects }),
  rows: (s, a) => picker(s, { rows: { ...s.picker.rows, [a.checkoutId]: a.rows } }),
  children: (s, a) => picker(s, { children: { ...s.picker.children, ...a.children }, views: { ...s.picker.views, ...a.views } }),
  place: placed,
  "console-target": (s, a) => targeted(s, a),
  "console-sessions": (s, a) => consoleOf(s, { sessions: a.sessions }),
  log: (s, a) => (isCurrent(s, a) ? consoleOf(s, { state: "reading", streams: { ...s.console.streams, [a.stream]: logged(s.console.streams[a.stream], a.got) } }) : s),
  "console-message": (s, a) => consoleOf(s, { message: a.message, state: a.state ?? "stopped" }),
  resize: (s, a) => viewer(s, { size: { columns: a.columns, rows: a.rows }, redraw: true }),
  tick: (s, a) => viewer(s, { nowMs: a.nowMs }),
  extents: (s, a) => clampedScroll(viewer(s, { extents: a.extents })),
  painted: (s) => viewer(s, { redraw: false }),
  followers: (s, a) => viewer(s, { followers: a.count }),
  message: (s, a) => viewer(s, { message: a.message }),
  quit: (s) => viewer(s, { quitting: "detached" }),
  escape: (s) => viewer(s, { search: { query: "", at: 0, jump: false }, message: null }),
  focus: (s, a) => viewer(s, { focus: nextIn(ring(s), focused(s), a.by) }),
  move: (s, a) => (overlayOpen(s) ? cursorAt(s, s.viewer.cursor + a.by) : scrolled(s, focused(s), s.viewer.scroll[focused(s)] + a.by * SIGN[focused(s)])),
  page: (s, a) => (overlayOpen(s) ? cursorAt(s, s.viewer.cursor + a.by * page(s, "overlay")) : scrolled(s, focused(s), s.viewer.scroll[focused(s)] + a.by * SIGN[focused(s)] * page(s, focused(s)))),
  edge: (s, a) => (overlayOpen(s) ? cursorAt(s, a.to === "start" ? 0 : s.viewer.extents.overlay.max) : scrolled(s, focused(s), EDGE[focused(s)][a.to](s.viewer.extents[focused(s)].max))),
  freeze: frozen,
  "search-open": (s) => viewer(s, { mode: "search", search: { query: "", at: 0, jump: false } }),
  "search-type": (s, a) => typed(s, a.ch),
  "search-erase": (s) => searchOf(s, { query: [...s.viewer.search.query].slice(0, -1).join(""), at: 0 }),
  "search-commit": (s) => viewer(s, { mode: "normal", search: { ...s.viewer.search, jump: s.viewer.search.query !== "" } }),
  "search-cancel": (s) => viewer(s, { mode: "normal", search: { query: "", at: 0, jump: false } }),
  "search-step": (s, a) => (s.viewer.search.query ? searchOf(s, { at: s.viewer.search.at + a.by, jump: true }) : s),
  console: (s) => viewer(consoleOf(s, { open: !s.console.open }), { focus: s.console.open ? "recent" : "sandbox", redraw: true }),
  stream: (s) => viewer(consoleOf(s, { stream: s.console.stream === "out" ? "err" : "out" }), { scroll: { ...s.viewer.scroll, sandbox: 0 }, hold: { ...s.viewer.hold, sandbox: null } }),
  session: nextSession,
  child: (s) => (childOf(s) ? viewer({ ...s, focus: s.focus === "child" ? "root" : "child" }, { ...unheld, redraw: true }) : viewer(s, { message: "no engineering task yet: the workflow has not started one" })),
  all: (s) => viewer(s, { all: !s.viewer.all, scroll: { ...s.viewer.scroll, recent: 0 } }),
  filter: (s) => viewer(s, { filter: nextIn(FILTERS, s.viewer.filter, 1), scroll: { ...s.viewer.scroll, recent: 0 } }),
  refresh: (s) => viewer(s, { refresh: s.viewer.refresh + 1, redraw: true }),
  layout: (s) => viewer(s, { layout: nextIn(LAYOUTS, s.viewer.layout, 1), redraw: true }),
  view: (s, a) => (PANE_VIEWS[a.at] ? viewer(s, { view: PANE_VIEWS[a.at], layout: "pane" }) : s),
  overlay: (s, a) => viewer(s, s.viewer.overlay === a.name ? { overlay: null, autoPicker: false, redraw: true } : { overlay: a.name, autoPicker: false, cursor: openedAt(s, a.name), detail: null, redraw: true }),
  "overlay-close": (s) => viewer(s, { overlay: null, autoPicker: false, redraw: true }),
  pick: (s) => (PICKS[s.viewer.overlay] ?? same)(s),
  "inspect-filter": inspectFiltered,
});

export const ACTIONS = Object.freeze(Object.keys(TRANSITIONS));

export const reduce = (state, action) => (action && Object.hasOwn(TRANSITIONS, action.type) ? TRANSITIONS[action.type](state, action) : state);
