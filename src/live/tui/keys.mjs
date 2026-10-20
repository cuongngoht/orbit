// KEYS: what a terminal sent, as the names of the keys pressed, and what each key does in the layer the viewer
// is in. Both are tables. A byte sequence no row names is swallowed whole (an unknown CSI, an Alt combination, a
// control byte) and never becomes a command; a lone ESC is Escape. There is no state across chunks: a terminal
// sends one key's sequence in one write, and a sequence split by a slow link costs a swallowed key, never a
// wrong one. Bracketed paste is not turned on, so a paste is keys: in the normal layer a pasted `q` leaves the
// viewer exactly as a typed one does, and leaving costs a restart, nothing else.
//
//   decodeKeys(text) -> [key]                  "up", "pgdn", "shift-tab", "enter", "ctrl-c", "q", "/", ...
//   actionOfKey(viewer, key) -> action | null
export const KEY_SEQUENCES = Object.freeze([
  ["\u001b[A", "up"], ["\u001b[B", "down"], ["\u001b[C", "right"], ["\u001b[D", "left"],
  ["\u001bOA", "up"], ["\u001bOB", "down"], ["\u001bOC", "right"], ["\u001bOD", "left"],
  ["\u001b[5~", "pgup"], ["\u001b[6~", "pgdn"], ["\u001b[H", "home"], ["\u001b[F", "end"], ["\u001bOH", "home"], ["\u001bOF", "end"],
  ["\u001b[1~", "home"], ["\u001b[4~", "end"], ["\u001b[7~", "home"], ["\u001b[8~", "end"],
  ["\u001b[Z", "shift-tab"], ["\u001b\u001b", "escape"], ["\t", "tab"], ["\r\n", "enter"], ["\r", "enter"], ["\n", "enter"],
  ["\u007f", "backspace"], ["\b", "backspace"], ["\u0003", "ctrl-c"], [" ", "space"],
]);

const LONGEST = [...KEY_SEQUENCES].sort((a, b) => b[0].length - a[0].length);

const CHAR = Symbol("char");

// What is left when no sequence matched, in order: a whole CSI, an SS3, a lone ESC at the end, ESC with any one
// character (Alt), any other control byte, and finally one printable character, which is its own key.
const UNKNOWN = [
  { re: /\u001b\[[0-?]*[ -/]*[@-~]/y, key: null },
  { re: /\u001bO[\s\S]/uy, key: null },
  { re: /\u001b$/y, key: "escape" },
  { re: /\u001b[\s\S]/uy, key: null },
  { re: /[\u0000-\u001f\u007f-\u009f]/y, key: null },
  { re: /[\s\S]/uy, key: CHAR },
];

function sticky(row, s) {
  row.re.lastIndex = s.at;
  const m = row.re.exec(s.text);
  return m ? { length: m[0].length, key: row.key === CHAR ? m[0] : row.key } : null;
}

function matched(s) {
  const exact = LONGEST.find(([seq]) => s.text.startsWith(seq, s.at));
  return exact ? { length: exact[0].length, key: exact[1] } : UNKNOWN.map((row) => sticky(row, s)).find(Boolean);
}

function stepped(s) {
  const hit = matched(s);
  s.at += hit.length;
  if (hit.key !== null) s.keys.push(hit.key);
}

export function decodeKeys(text) {
  const s = { text: String(text ?? ""), at: 0, keys: [] };
  while (s.at < s.text.length) stepped(s);
  return s.keys;
}

// ---- what a key does -------------------------------------------------------------------------------------

const QUIT = Object.freeze({ type: "quit" });
const act = (type, extra = {}) => Object.freeze({ type, ...extra });
const one = (key) => [...key].length === 1;

const MOVING = {
  up: act("move", { by: -1 }), k: act("move", { by: -1 }), down: act("move", { by: 1 }), j: act("move", { by: 1 }),
  pgup: act("page", { by: -1 }), pgdn: act("page", { by: 1 }), g: act("edge", { to: "start" }), home: act("edge", { to: "start" }),
  G: act("edge", { to: "end" }), end: act("edge", { to: "end" }),
};

// The pane layout's views, by number (1.8.6): the same order a docked pane's tabs are in.
const VIEWING = Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((k, i) => [k, act("view", { at: i })]));

const OPENING = { t: act("overlay", { name: "picker" }), i: act("overlay", { name: "activity" }), e: act("overlay", { name: "evidence" }), d: act("overlay", { name: "diagnostics" }), "?": act("overlay", { name: "help" }) };

export const KEYMAP = Object.freeze({
  normal: {
    q: QUIT, "ctrl-c": QUIT, escape: act("escape"), tab: act("focus", { by: 1 }), "shift-tab": act("focus", { by: -1 }), ...MOVING,
    space: act("freeze"), "/": act("search-open"), n: act("search-step", { by: 1 }), N: act("search-step", { by: -1 }),
    l: act("console"), s: act("stream"), S: act("session"), c: act("child"), a: act("all"), f: act("filter"), r: act("refresh"), ...OPENING,
    v: act("layout"), ...VIEWING,
  },
  search: {
    "ctrl-c": QUIT, escape: act("search-cancel"), enter: act("search-commit"), backspace: act("search-erase"),
    up: act("search-step", { by: -1 }), down: act("search-step", { by: 1 }), space: act("search-type", { ch: " " }),
    "*": (key) => (one(key) ? act("search-type", { ch: key }) : null),
  },
  overlay: { "ctrl-c": QUIT, q: act("overlay-close"), escape: act("overlay-close"), ...MOVING, enter: act("pick"), space: act("pick"), right: act("pick"), f: act("inspect-filter"), ...OPENING },
  help: { "ctrl-c": QUIT, "*": () => act("overlay-close") },
});

const LAYERS = [
  { layer: "search", when: (v) => v.mode === "search" },
  { layer: "help", when: (v) => v.overlay === "help" },
  { layer: "overlay", when: (v) => v.overlay !== null },
  { layer: "normal", when: () => true },
];

export const layerOf = (viewer) => LAYERS.find((r) => r.when(viewer)).layer;

export function actionOfKey(viewer, key) {
  const row = KEYMAP[layerOf(viewer)];
  const found = Object.hasOwn(row, key) ? row[key] : row["*"];
  return typeof found === "function" ? found(key) : found ?? null;
}

// The keys a person is told about, in the order the help overlay lists them; a test holds each to a KEYMAP row.
export const HELP = Object.freeze([
  ["q", "leave the viewer: the task, its QA and its sandbox keep running"],
  ["i", "every activity the task started: why, where, how far, how it ended; enter opens one, f filters"],
  ["t", "pick a task: this checkout's, or another known one"],
  ["c", "move between a workflow and the engineering task it started"],
  ["l", "the sandbox console: masked, read-only, never a shell"],
  ["s", "the console's stdout or stderr"],
  ["S", "the console's next session"],
  ["tab", "move the scrolling between RECENT and SANDBOX"],
  ["j", "scroll down (also the down arrow)"],
  ["k", "scroll up (also the up arrow)"],
  ["pgdn", "a page down (pgup a page up)"],
  ["g", "the newest line (G the oldest; in SANDBOX the other way round)"],
  ["space", "freeze the display, or follow again: the task keeps running"],
  ["/", "search the section that scrolls; n and N for the next and previous"],
  ["a", "every journal line, or only the milestones"],
  ["f", "which lines RECENT shows: all, the task's, QA's, or what went wrong"],
  ["e", "the evidence: receipts, verifications, approvals"],
  ["d", "how this viewer's reads are going"],
  ["r", "read the task list again and draw the whole screen"],
  ["v", "the pane: the work's checklist, NOW, a view, progress and the LIVE indicator -- or the dashboard again"],
  ["1", "in the pane, a view: 1 Events · 2 Tests · 3 Changes · 4 Notices · 5 Plan · 6 Timeline"],
  ["?", "this list; any key closes it"],
]);
