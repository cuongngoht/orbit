// What each `live` command may do, as data: a viewer READS; a pin and the live settings are a person's
// preferences about how things are SHOWN (STORE), never facts about a task. `cli/live.mjs` holds its command
// table to this one (the names and what each writes), and a test holds the usage header to both.
//
// NOT_LIVE names what no live command is, whoever asks: Orbit Live is delivery, never state (ADR 0015, 0016).
export const OPERATIONS = Object.freeze({
  status: { class: "READ", writes: "nothing", say: "the task this session or checkout is working on, as a few lines" },
  statusline: { class: "READ", writes: "nothing", say: "a host's status line: its session's task, read once" },
  pane: { class: "READ", writes: "this session's viewer lease, while the pane is open -- never a journal", say: "the view a host docks beside its session: a header, the overview, what runs now" },
  watch: { class: "READ", writes: "nothing", say: "one task, live, until the viewer leaves" },
  tui: { class: "READ", writes: "nothing of a task -- a viewer a launcher opened keeps its own lease", say: "one task, its workflow and its sandbox, full screen, until the viewer leaves" },
  ensure: { class: "OPEN", writes: "this session's viewer lease, and a viewer's launch file in Orbit's own store (macOS)", say: "this session's viewer, opened beside it once and reused after -- what /orbit-help runs; it grants nothing and starts nothing but Orbit's own viewer" },
  open: { class: "OPEN", writes: "a viewer's launch file in Orbit's own store (macOS)", say: "the full-screen viewer started beside this session, a person's choice each time; it starts nothing but Orbit's own viewer" },
  where: { class: "READ", writes: "nothing", say: "where the pins and the live settings are kept" },
  doctor: { class: "READ", writes: "nothing", say: "whether Live can show a task here, and why not" },
  pin: { class: "STORE", writes: "pin", say: "which task this session's (or this checkout's) viewers show" },
  unpin: { class: "STORE", writes: "pin", say: "forget a pin" },
  settings: { class: "STORE", writes: "live-settings", say: "how Live looks: lines, refresh, idle, rows" },
});

export const OPERATION_NAMES = Object.freeze(Object.keys(OPERATIONS));

export const NOT_LIVE = Object.freeze([
  "a line in a task's or an investigation's journal",
  "an approval, a rejection, a pause, a resume or a cancel",
  "a command, a build, a test or a browser step",
  "a signal to any process, a sandbox's included",
]);
