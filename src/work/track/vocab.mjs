// The words UNIFIED WORK TRACKING speaks, as tables with the columns a rule asks (1.8.8).
//
// A tracked work is the one thing a person asked for, followed from the request through whoever does it -- the host
// in the session (`developer`) or an engineering task / coordinated workflow (`autonomous`) -- to what it came to.
// It adds IDENTITY, LINKS and a REPORTED lifecycle to the work journal (src/work/) and nothing else: what a task did,
// which verdict it earned and what evidence exists stay with their owners (src/task/, src/run/), read back every time.
//
// Three axes, kept apart because a host saying "done" is not a check passing:
//   lifecycle  where the work stands          (this file: LIFECYCLE, derived on every read)
//   evidence   what stands behind it          (EVIDENCE: none · observed · reported · verified)
//   liveness   whether its session is moving  (src/live/session.mjs: ACTIVE · QUIET · ENDED · NONE; never a lifecycle)

export const TRACK_SCHEMA = 1;

// WHO executes. A coordinated workflow's host step is the host working inside the workflow: `autonomous`, with the
// workflow's task linked.
export const MODES = ["developer", "autonomous"];

// What a host or a person may SAY about a work that is going on, and how it ends. `failed` and `cancelled` close it.
export const REPORTED_STATES = ["working", "waiting", "blocked", "paused", "failed", "cancelled"];

export const CLOSING_STATES = ["failed", "cancelled"];

// A completion report: `blocked` is not an end, the others are.
export const OUTCOMES = ["done", "failed", "cancelled", "blocked"];

// What a waiting work waits FOR.
export const WAITS = ["user", "permission", "environment"];

// What a work may be linked to, and the shape of that thing's id.
export const LINKS = [
  { what: "task", pattern: /^tsk-[0-9a-f]{12}$/, doc: "an engineering task" },
  { what: "workflow", pattern: /^tsk-[0-9a-f]{12}$/, doc: "a coordinated workflow's own task" },
  { what: "investigation", pattern: /^inv-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/, doc: "a QA investigation" },
];

// A pointer a report may cite. It is a POINTER: the engine reads a `task:` back from its owner and never believes the
// report's word for what it holds.
export const EVIDENCE_REF = /^(task|investigation|requirement|run):[A-Za-z0-9._-]{1,64}$/;

export const LIMITS = Object.freeze({ OBJECTIVE: 240, SUMMARY: 240, ITEMS: 8, ITEM: 160, FILES: 20, CHECKS: 10, SCAN: 64, REF: 80 });

// Where the work stands, first row that holds, the last always. `terminal`: nothing moves it but a person's explicit
// reopening. `closed` rows come from the fold, the others from what is observed now.
export const LIFECYCLE = [
  { state: "CANCELLED", terminal: true, word: "CANCELLED", glyph: "✗", tone: "danger", say: "it was cancelled" },
  { state: "FAILED", terminal: true, word: "FAILED", glyph: "✗", tone: "danger", say: "it was reported failed" },
  { state: "REPORTED_DONE", terminal: true, word: "REPORTED DONE", glyph: "✓", tone: "success", say: "it was reported done; what stands behind that is the evidence level" },
  { state: "PAUSED", terminal: false, word: "PAUSED", glyph: "⏸", tone: "warning", say: "it is paused" },
  { state: "BLOCKED", terminal: false, word: "BLOCKED", glyph: "■", tone: "danger", say: "it cannot go on as it stands" },
  { state: "WAITING", terminal: false, word: "WAITING", glyph: "⏸", tone: "warning", say: "it waits for something" },
  { state: "INTERRUPTED", terminal: false, word: "INTERRUPTED", glyph: "!", tone: "warning", say: "every session that worked on it has ended, and it was not closed" },
  { state: "IN_PROGRESS", terminal: false, word: "IN PROGRESS", glyph: "●", tone: "success", say: "it is being worked on" },
  { state: "RECEIVED", terminal: false, word: "RECEIVED", glyph: "○", tone: "subtle", say: "it was taken on; nothing has been observed yet" },
];

export const lifecycleRow = (state) => LIFECYCLE.find((r) => r.state === state) ?? LIFECYCLE.at(-1);

// What stands behind the lifecycle, ordered weakest to strongest.
export const EVIDENCE = [
  { level: "none", say: "nothing has been observed or reported" },
  { level: "observed", say: "the host's hooks saw edits or commands; nothing reported them as an outcome" },
  { level: "reported", say: "the host or a person reported an outcome; no owner confirmed it" },
  { level: "verified", say: "an owner that decides (a completed task) confirmed it, and nothing changed after" },
];

export const EVIDENCE_LEVELS = EVIDENCE.map((e) => e.level);
