// The full-screen viewer's ONE state, and what it wants open. Everything here is the VIEWER's: which task it
// shows, how far each list is scrolled, what was typed into search. A task's own state is only ever its
// journal's, as each feed delivered it (one slot per followed task), and none of this is written anywhere --
// quitting forgets it.
//
//   initialState(input) -> state
//   taskSlot(id, role) -> slot                    one followed task: its view, its lines (a bounded window)
//   wanted(state) -> { feeds: [id], console }      what the terminal adapter keeps open; it reconciles to this
//   childOf(state) · focusId(state) · engineeringId(state) · consoleTask(state)
import { DEPTHS } from "../render/theme.mjs";
import { claimedEnvironment, isRefusal } from "../logs.mjs";

export const LIMITS = Object.freeze({ EVENTS_KEPT: 3000, LOG_KEPT: 2000, NOTICES_SHOWN: 4, QUERY_MAX: 200, SEARCH_MAX: 500 });

export const TASK_ID = /^tsk-[a-f0-9]{12}$/;

export const FOCUS_RING = Object.freeze(["recent", "sandbox"]);

// The views a pane switches between (1.8.6: Plan and Timeline after the four of 1.8.5, so a key a person learned
// keeps its view), in the order keys 1 to 6 pick them -- the docked pane's tabs and the terminal's pane layout alike.
export const PANE_VIEWS = Object.freeze(["events", "tests", "changes", "notices", "plan", "timeline"]);

// How the full-screen viewer lays a task out: the dashboard of sections, or the pane a host docks (1.8.6) -- the
// layout a viewer opened beside an AI CLI starts in, `v` going from one to the other.
export const LAYOUTS = Object.freeze(["dashboard", "pane"]);

export const FILTERS = Object.freeze(["all", "task", "qa", "failed"]);

const emptyStream = () => ({ lines: [], dropped: 0, next: 0, size: null, held: false, truncated: false, reset: 0 });

export const emptyConsole = (open, session = null) => ({ open, task: null, env: null, session, sessions: [], stream: "out", streams: { out: emptyStream(), err: emptyStream() }, message: null, state: "idle" });

const viewerOf = (input) => ({
  mode: "normal", overlay: input.overlay ?? null, autoPicker: Boolean(input.overlay), focus: "recent", all: false, filter: "all", frozen: false,
  scroll: { recent: 0, sandbox: 0 }, hold: { recent: null, sandbox: null }, cursor: 0, detail: null,
  extents: { recent: { max: 0, page: 1 }, sandbox: { max: 0, page: 1 }, overlay: { max: 0, page: 1 } },
  search: { query: "", at: 0, jump: false }, size: { columns: input.columns ?? 100, rows: input.rows ?? 30 },
  colour: Boolean(input.colour), depth: DEPTHS.includes(input.depth) ? input.depth : "16", bands: Boolean(input.bands), ascii: Boolean(input.ascii), nowMs: input.nowMs ?? 0, settings: input.settings, redraw: true,
  quitting: null, message: input.message ?? null, followers: 0, refresh: 0, waiting: Boolean(input.waiting), inspect: { filter: "all" },
  layout: LAYOUTS.includes(input.layout) ? input.layout : "dashboard", view: PANE_VIEWS[0],
});

export const initialState = (input) => ({
  association: input.association ?? { how: "none", task: null, ids: [] }, place: input.place ?? null, root: input.root ?? null, focus: "root",
  pending: null, tasks: {}, picker: { projects: [], rows: {}, expanded: input.place ? { [input.place.checkoutId]: true } : {}, children: {}, views: {}, auto: input.auto ?? !input.root },
  console: emptyConsole(Boolean(input.console), input.session ?? null), viewer: viewerOf(input),
  // THIS SESSION's own tool activity (1.8.7, src/live/session.mjs), when the viewer knows its session: what it shows
  // when no task's journal speaks for the work. Null when nobody handed it in.
  session: input.activity ?? null,
  // THE WORK this session tracks (1.8.8): its one view (src/work/track/view.mjs), as the composition root last read it. Null
  // when the session has none, and then nothing about work is drawn.
  work: input.work ?? null,
});

export const taskSlot = (id, role) => ({ id, role, view: null, cursor: "t=0", end: null, events: [], dropped: 0, activity: {}, plan: null, skills: {}, seq: 0, read: { reads: 0, failures: 0, good: false, partial: false }, status: "opening", error: null });

// The last `n` of a list, and how many were let go: a viewer keeps a window, and says how much it dropped.
export function bounded(list, n) {
  const dropped = Math.max(0, list.length - n);
  return { kept: dropped ? list.slice(dropped) : list, dropped };
}

// ---- which tasks --------------------------------------------------------------------------------------

// The engineering task a coordinated workflow started: its latest `task:` receipt (as cli/live.mjs childIdOf and
// src/automation/dispatch.mjs childOf read it), and only when the id has a task's shape.
export const childIdOf = (view) => ((ref) => (TASK_ID.test(String(ref ?? "")) ? ref : null))(view?.receipts?.filter((r) => r.domain === "task").at(-1)?.ref);

export const isCoordinator = (view) => view?.task?.provider === "automation";

export const childOf = (state) => (state.root ? childIdOf(state.tasks[state.root]?.view) : null);

export const focusId = (state) => (state.focus === "child" && childOf(state) ? childOf(state) : state.root);

// Whose checks the ENGINEER section shows: a workflow's engineering task, or the task itself when it is not a
// workflow. A workflow with no engineering task yet has none.
export const engineeringId = (state) => childOf(state) ?? (isCoordinator(state.tasks[state.root]?.view) ? null : state.root);

const unique = (ids) => [...new Set(ids.filter(Boolean))];

const claimed = (state, id) => typeof claimedEnvironment(state.tasks[id]?.view ?? { receipts: [] }) === "string";

// Whose sandbox the console reads: the task shown, else the other task followed, whichever claims a sandbox.
export const consoleTask = (state) => unique([focusId(state), childOf(state), state.root]).find((id) => claimed(state, id)) ?? focusId(state);

function consoleWanted(state) {
  const task = state.console.open ? consoleTask(state) : null;
  const env = task ? claimedEnvironment(state.tasks[task]?.view ?? { receipts: [] }) : null;
  return task ? { task, env: typeof env === "string" ? env : null, refusal: isRefusal(env) ? env : null, session: state.console.session } : null;
}

export const wanted = (state) => ({ checkout: state.place?.checkoutId ?? null, feeds: unique([state.root, childOf(state)]), console: consoleWanted(state) });

// How many lines a list has had, counting those its window let go: what a frozen list is held at.
export const countOf = (state, section) => (section === "recent" ? ((s) => (s ? s.dropped + s.events.length : 0))(state.tasks[focusId(state)]) : ((s) => s.dropped + s.lines.length)(state.console.streams[state.console.stream]));
