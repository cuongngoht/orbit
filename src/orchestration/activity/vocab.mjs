// What an OBSERVATION of a running check may say (1.8.5, ADR 0020): the words, the shape of a line, and the bounds.
//
// An observation is what Orbit read off a declared build or test command WHILE it ran -- the cases its runner reported,
// the failures it printed, the totals it said at the end. It is never the check's verdict: that is the receipt the
// check runner writes when the command has ended (dispatch.mjs), from its exit, and nothing here is read by a rule
// that moves a task. It lives beside the task, never in it: one append-only file per check action in the
// orchestration room (`orchestration/<task>/activity/<act>.jsonl`), so writing it moves no revision and a person's
// decision is never made stale by a test finishing.
//
// Passive by contract: an observation reads only what the command already prints. Nothing here adds an argument, a
// variable or a reporter to a command, so the output a baseline was taken from (failure.mjs exactOf) is the output
// a later run is compared with.
export const ACTIVITY_SCHEMA = 1;

export const PRODUCER = "check-runner";

// Every line names its authority, and it is always this one: an observation, never evidence a rule may count.
export const AUTHORITY = "observation";

// One row per kind of line: the fields it may carry -- an allow-list, as the task journal's KINDS are, so a field
// nobody declared never reaches the disk. Every line also carries the envelope: v, seq, gen, at, kind.
export const KINDS = Object.freeze({
  "activity.started": ["task", "action", "attempt", "check", "producer", "authority", "command", "why", "adapter"],
  "activity.adapter": ["adapter"],
  "activity.progress": ["output"],
  "case.reported": ["key", "name", "suite", "state", "durationMs", "file"],
  "case.failure": ["key", "name", "suite", "category", "message", "location", "stack", "expected", "actual"],
  "runner.summary": ["totals", "scope"],
  "runner.aborted": ["why", "category"],
  "activity.gap": ["dropped", "why"],
  "activity.completed": ["outcome", "output"],
  "activity.failed": ["outcome", "output"],
  "activity.interrupted": ["why"],
});

export const KIND_NAMES = Object.freeze(Object.keys(KINDS));

export const ENDINGS = Object.freeze(["activity.completed", "activity.failed", "activity.interrupted"]);

// What a runner said of one case. `reported` is the only order a stream like TAP promises: a case is shown as what it
// came to, never as "running now".
export const CASE_STATES = Object.freeze(["passed", "failed", "skipped", "todo", "cancelled"]);

// What a failure is about, from words a runner printed -- only where they say it, else unknown. Never a verdict.
export const FAILURE_CATEGORIES = Object.freeze(["assertion", "timeout", "cancelled", "environment", "unknown"]);

// What an adapter can show of a command, said up front so a viewer never implies more:
//   lifecycle  the command started, ran for so long, printed so much, ended (every adapter)
//   cases      "reported" -- case results as the runner reported them, while it runs; "failures" -- only the cases
//              that did not pass; "none"
//   total      "at-end" -- the runner says how many when it ends; "none" -- nobody says
//   order      "reported" -- the order results were reported in, never a claim of what runs now
export const CAPABILITY_FIELDS = Object.freeze(["lifecycle", "cases", "total", "order"]);

export const LIMITS = Object.freeze({
  LINE_BYTES: 16 * 1024,
  NAME_CHARS: 300,
  MESSAGE_CHARS: 1000,
  // What a failed case says it expected and what it got (1.8.6): each bounded on its own, and only when the runner
  // printed it as such -- never parsed out of a sentence.
  VALUE_CHARS: 300,
  STACK_LINES: 12,
  STACK_CHARS: 300,
  EVENT_BYTES: 16 * 1024,
  ACTION_BYTES: 8 * 1024 * 1024,
  TASK_BYTES: 64 * 1024 * 1024,
  ENDING_BYTES: 64 * 1024,
  PROGRESS_MS: 500,
  CASES_KEPT: 200,
  FAILURES_KEPT: 50,
  KEYS_KEPT: 20_000,
  ACTIONS_FOLLOWED: 12,
});

export const ACTION_ID = /^act-\d{1,9}$/;
export const TASK_ID = /^tsk-[a-f0-9]{12}$/;
