// WHAT THE FULL SCREEN SHOWS, and what a key does to it: a pure state and a table of transitions. A key is a NAME
// from Orbit Live's own decoder (src/live/tui/keys.mjs decodeKeys); a key nobody named does nothing. No transition
// reads a clock or a journal, and none can touch the mission: the only words here are the viewer's own.
import { bodyHeightOf } from "./frame.mjs";
import { VIEWS, treeOf } from "./views.mjs";

// 0.2.2: `selected` is a RUN's id (never a row's index), so a run that arrives above it never moves the selection;
// `inspect` shows the selected run in full (inspect.mjs).
export const initialState = (o = {}) => ({ view: VIEWS.some((v) => v.id === o.view) ? o.view : VIEWS[0].id, top: 0, frozen: false, help: false, columns: o.columns ?? 100, rows: o.rows ?? 30, ascii: o.ascii === true, colour: o.colour === true, full: true, quit: null, selected: null, inspect: false });

const act = (type, extra = {}) => Object.freeze({ type, ...extra });

export const KEYMAP = Object.freeze({
  q: act("quit"), "ctrl-c": act("quit"),
  tab: act("cycle", { by: 1 }), right: act("cycle", { by: 1 }), l: act("cycle", { by: 1 }),
  "shift-tab": act("cycle", { by: -1 }), left: act("cycle", { by: -1 }), h: act("cycle", { by: -1 }),
  j: act("move", { by: 1 }), down: act("move", { by: 1 }), k: act("move", { by: -1 }), up: act("move", { by: -1 }),
  pgdn: act("page", { by: 1 }), pgup: act("page", { by: -1 }),
  g: act("edge", { to: "start" }), home: act("edge", { to: "start" }), G: act("edge", { to: "end" }), end: act("edge", { to: "end" }),
  space: act("freeze"), r: act("redraw"), "?": act("help"),
  enter: act("inspect"), o: act("inspect"), escape: act("close"),
  ...Object.fromEntries(VIEWS.map((v, i) => [v.key, act("view", { at: i })])),
});

// In the Agents view j and k (and the arrows) move the SELECTION from run to run in the order the view draws them;
// the run is named in the action, so the transition stays a pure function of the state.
const SELECT_KEYS = Object.freeze({ j: 1, down: 1, k: -1, up: -1 });

const nextRun = (view, current, by) => ((ids) => ids[Math.max(0, Math.min(ids.length - 1, ids.indexOf(current) < 0 ? 0 : ids.indexOf(current) + by))] ?? null)(treeOf(view?.agents ?? []).map((a) => a.id));

const selecting = (state, key, view) => (state.view === "agents" && !state.inspect && SELECT_KEYS[key] && view ? act("select", { id: nextRun(view, state.selected, SELECT_KEYS[key]) }) : null);

// While the help is open, every key but a quit closes it. `view` (0.2.2) is what is shown, so a selection names a run.
export const actionOf = (state, key, view = null) => (state.help && KEYMAP[key]?.type !== "quit" ? act("help") : selecting(state, key, view) ?? KEYMAP[key] ?? null);

const at = (s) => Math.max(0, VIEWS.findIndex((v) => v.id === s.view));

const cycled = (s, by) => VIEWS[(at(s) + by + VIEWS.length) % VIEWS.length].id;

const TRANSITIONS = Object.freeze({
  quit: (s) => ({ ...s, quit: "a person left" }),
  view: (s, a) => ({ ...s, view: VIEWS[a.at].id, top: 0, help: false, inspect: false, full: true }),
  cycle: (s, a) => ({ ...s, view: cycled(s, a.by), top: 0, inspect: false, full: true }),
  select: (s, a) => ({ ...s, selected: a.id, full: true }),
  inspect: (s) => ({ ...s, inspect: s.view === "agents" && Boolean(s.selected) ? !s.inspect : false, top: 0, full: true }),
  close: (s) => ({ ...s, inspect: false, help: false, top: 0, full: true }),
  move: (s, a) => ({ ...s, top: Math.max(0, s.top + a.by) }),
  page: (s, a) => ({ ...s, top: Math.max(0, s.top + a.by * bodyHeightOf(s)) }),
  edge: (s, a) => ({ ...s, top: a.to === "start" ? 0 : Number.MAX_SAFE_INTEGER }),
  freeze: (s) => ({ ...s, frozen: !s.frozen }),
  redraw: (s) => ({ ...s, full: true }),
  help: (s) => ({ ...s, help: !s.help, full: true }),
  resize: (s, a) => ({ ...s, columns: a.columns, rows: a.rows, full: true }),
  painted: (s, a) => ({ ...s, top: a.top, full: false }),
});

export const reduce = (state, action) => (action && TRANSITIONS[action.type] ? TRANSITIONS[action.type](state, action) : state);

export const TRANSITION_NAMES = Object.freeze(Object.keys(TRANSITIONS));
