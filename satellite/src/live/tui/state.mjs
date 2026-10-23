// WHAT THE FULL SCREEN SHOWS, and what a key does to it: a pure state and a table of transitions. A key is a NAME
// from Orbit Live's own decoder (src/live/tui/keys.mjs decodeKeys); a key nobody named does nothing. No transition
// reads a clock or a journal, and none can touch the mission: the only words here are the viewer's own.
import { bodyHeightOf } from "./frame.mjs";
import { VIEWS } from "./views.mjs";

export const initialState = (o = {}) => ({ view: VIEWS.some((v) => v.id === o.view) ? o.view : VIEWS[0].id, top: 0, frozen: false, help: false, columns: o.columns ?? 100, rows: o.rows ?? 30, ascii: o.ascii === true, colour: o.colour === true, full: true, quit: null });

const act = (type, extra = {}) => Object.freeze({ type, ...extra });

export const KEYMAP = Object.freeze({
  q: act("quit"), "ctrl-c": act("quit"),
  tab: act("cycle", { by: 1 }), right: act("cycle", { by: 1 }), l: act("cycle", { by: 1 }),
  "shift-tab": act("cycle", { by: -1 }), left: act("cycle", { by: -1 }), h: act("cycle", { by: -1 }),
  j: act("move", { by: 1 }), down: act("move", { by: 1 }), k: act("move", { by: -1 }), up: act("move", { by: -1 }),
  pgdn: act("page", { by: 1 }), pgup: act("page", { by: -1 }),
  g: act("edge", { to: "start" }), home: act("edge", { to: "start" }), G: act("edge", { to: "end" }), end: act("edge", { to: "end" }),
  space: act("freeze"), r: act("redraw"), "?": act("help"),
  ...Object.fromEntries(VIEWS.map((v, i) => [v.key, act("view", { at: i })])),
});

// While the help is open, every key but a quit closes it.
export const actionOf = (state, key) => (state.help && KEYMAP[key]?.type !== "quit" ? act("help") : KEYMAP[key] ?? null);

const at = (s) => Math.max(0, VIEWS.findIndex((v) => v.id === s.view));

const cycled = (s, by) => VIEWS[(at(s) + by + VIEWS.length) % VIEWS.length].id;

const TRANSITIONS = Object.freeze({
  quit: (s) => ({ ...s, quit: "a person left" }),
  view: (s, a) => ({ ...s, view: VIEWS[a.at].id, top: 0, help: false, full: true }),
  cycle: (s, a) => ({ ...s, view: cycled(s, a.by), top: 0, full: true }),
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
