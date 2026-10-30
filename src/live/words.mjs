// Orbit Live's WORDS for a terminal: every state a glyph AND a word (colour is never the only signal, and a
// screen reader or a log hears the word), the same glyphs Orbit Control's page draws
// (control-panel/.../live/liveWords.ts GLYPHS), held equal by a test. Only LIVE pulses, and only because a
// line arrived lately: a viewer's pulse says its feed is healthy and the task is moving, never more. LIVE is the
// STATE; since 0.0.1 (ADR 0027) a terminal and a docked pane SAY it as ORBITING -- the word, never the key. The
// header's orbit (orbit.mjs) turns whatever the state (0.0.3, ADR 0029): it is the viewer's motion, never this word.
export const PRESENTATION_WORDS = Object.freeze({
  CONNECTING: { word: "CONNECTING", glyph: "◌", tone: "info", say: "opening the task's journal" },
  UNAVAILABLE: { word: "UNAVAILABLE", glyph: "!", tone: "danger", say: "the task's journal cannot be read here" },
  RECONNECTING: { word: "RECONNECTING", glyph: "⚠", tone: "warning", say: "a read failed; reading again from the last line received" },
  DEGRADED: { word: "DEGRADED", glyph: "~", tone: "warning", say: "part of what the task wrote could not be read" },
  FINISHED: { word: "FINISHED", glyph: "✓", tone: "subtle", say: "the task ended; this is its journal" },
  LIVE: { word: "ORBITING", glyph: "●", tone: "success", say: "lines are arriving as they are written" },
  IDLE: { word: "IDLE", glyph: "○", tone: "subtle", say: "nothing written lately" },
});

// The pulse: the LIVE glyph by wall-clock second, so a status line that refreshes every second visibly moves
// while lines arrive -- and stands still the moment they stop. No frame is another state's glyph: a pulse can
// never read as IDLE (○) or CONNECTING (◌) for the second it is shown.
export const PULSE = Object.freeze(["◐", "◓", "◑", "◒"]);

export const GLYPHS = Object.freeze({
  state: { char: "●", label: "state" },
  started: { char: "▶", label: "started" },
  ok: { char: "✓", label: "succeeded" },
  failed: { char: "✗", label: "failed" },
  decision: { char: "◇", label: "decision" },
  file: { char: "+", label: "file changed" },
  evidence: { char: "📸", label: "evidence" },
  warning: { char: "⚠", label: "warning" },
  paused: { char: "⏸", label: "paused" },
  person: { char: "👤", label: "a person" },
  qa: { char: "→", label: "browser step" },
});

// A task's lifecycle as a viewer's first word, when it says more than the viewer's own state does.
export const LIFECYCLE_WORDS = Object.freeze({
  WAITING_APPROVAL: { word: "WAITING APPROVAL", glyph: "⏸", tone: "warning" },
  PAUSED: { word: "PAUSED", glyph: "⏸", tone: "warning" },
  BLOCKED: { word: "BLOCKED", glyph: "■", tone: "danger" },
  COMPLETED: { word: "COMPLETED", glyph: "✓", tone: "success" },
  FAILED: { word: "FAILED", glyph: "✗", tone: "danger" },
  CANCELLED: { word: "CANCELLED", glyph: "■", tone: "subtle" },
});

// The stages in the order the loop strip draws them, with the short word a narrow terminal has room for.
export const STAGE_STRIP = Object.freeze([
  ["REQUIREMENT", "REQ"], ["CONTEXT", "CTX"], ["ENVIRONMENT", "ENV"], ["WORKSPACE", "WS"], ["PLANNING", "PLAN"],
  ["IMPLEMENTING", "IMPL"], ["BUILDING", "BUILD"], ["TESTING", "TEST"], ["DIAGNOSING", "DIAG"], ["FIXING", "FIX"],
  ["REGRESSION", "REGR"], ["REVIEWING", "REV"],
]);

// A step of a COORDINATED WORKFLOW is run by a skill, an agent or the engine (src/automation/): the running
// action's type says which, and a viewer says it in these words. The panel holds the same table.
export const DISPATCH_WORDS = Object.freeze({
  "skill.invoke": { word: "skill" },
  "agent.dispatch": { word: "agent" },
  "engine.run": { word: "engine" },
});

// What each word a workflow step's receipt carries looks like on a strip.
export const WORKFLOW_GLYPHS = Object.freeze({ RUNNING: "●", SUCCEEDED: "✓", FAILED: "✗", BLOCKED: "■", REPORTED: "~", PENDING: "·", SKIPPED: "-" });

// The lifecycle rows' marks (1.8.9, src/live/tui/lifecycle-view.mjs): done on evidence, partly known, under way, not yet,
// and failed -- each with its tone. No mark is a percentage, and none is drawn without a journal line behind it.
export const LIFECYCLE_GLYPHS = Object.freeze({ done: { glyph: "✓", tone: "success" }, partial: { glyph: "◐", tone: "warning" }, running: { glyph: "●", tone: "info" }, waiting: { glyph: "○", tone: "subtle" }, failed: { glyph: "✗", tone: "danger" } });

// A workflow step's id, as a milestone says it when the step is done.
export const STEP_DONE = Object.freeze({
  requirement: "Requirement snapshot loaded",
  context: "Project context resolved",
  runtime: "Runtime understood",
  engineering: "Engineering task completed",
  qa: "QA investigation passed",
  regression: "Regression passed",
  review: "Change reviewed",
  "propose-skill": "Playbook drafted",
  "register-skill": "Playbook verified and registered",
  playbook: "Playbook followed",
});

// What a check or a step came to, as the workspace pane says it (1.8.5): seven words, each only on its evidence. PASSED
// and FAILED need what the engine recorded; BLOCKED is a check that could not run at all (it errored, or its runner
// aborted before any case -- an environment's doing, never a pass); NOT_RUN is owed or not affected; RUNNING is
// running now; UNKNOWN is what nothing recorded verifies; UNAVAILABLE is a source a viewer cannot read.
export const STATUS_WORDS = Object.freeze({
  PASSED: { word: "PASSED", glyph: "✓", tone: "success" },
  FAILED: { word: "FAILED", glyph: "✗", tone: "danger" },
  BLOCKED: { word: "BLOCKED", glyph: "■", tone: "warning" },
  NOT_RUN: { word: "NOT RUN", glyph: "○", tone: "subtle" },
  RUNNING: { word: "RUNNING", glyph: "●", tone: "info" },
  UNKNOWN: { word: "UNKNOWN", glyph: "?", tone: "subtle" },
  UNAVAILABLE: { word: "UNAVAILABLE", glyph: "!", tone: "danger" },
});

// An engineering task's own steps, named by the action that IS the step (src/orchestration/: what the journal
// records), in the words a checklist shows. A build, test or verify is grouped as the baseline before the change
// and the verification after it; an action of a kind not listed is shown by its own word.
export const STEP_WORDS = Object.freeze({
  "gather-context": "Project context",
  "check-environment": "Environment",
  "prepare-workspace": "Workspace",
  plan: "Plan",
  baseline: "Baseline (before the change)",
  implement: "Implement",
  "record-changes": "Changes recorded",
  verify: "Verify",
  diagnose: "Diagnose",
  review: "Review",
});

// A coordinated workflow's step, by the id its plan names it with, as a checklist says it (STEP_DONE says it done).
export const WORKFLOW_STEP_WORDS = Object.freeze({
  requirement: "Requirements",
  context: "Project context",
  runtime: "Runtime discovery",
  engineering: "Engineering",
  qa: "QA verification",
  regression: "Regression",
  review: "Final review",
  "propose-skill": "Playbook drafted",
  "register-skill": "Playbook registered",
  playbook: "Playbook",
});

// The workspace pane's two blocks, as a host's drawer titles them (1.8.5): what the work went through, and what it is
// doing now. The drawer adds no word of its own; these are the engine's.
export const PANE_TITLES = Object.freeze({ checklist: "TASK EXECUTION", current: "NOW" });

// The LIVE INDICATOR a docked pane, a status bar and a status line show (1.8.6, ADR 0022): one state of the session's
// view and the task's lifecycle together, each a glyph AND a word -- the word is never only a colour. Only ACTIVE
// pulses, and only on evidence (presentation.mjs): its frames are PULSE, its phase the newest evidence's second.
export const INDICATOR_WORDS = Object.freeze({
  DISCONNECTED: { word: "DISCONNECTED", glyph: "○", tone: "subtle", say: "this viewer cannot read the task's journal now" },
  NONE: { word: "NO TASK", glyph: "○", tone: "subtle", say: "no task of this session or checkout to show yet" },
  COMPLETED: { word: "COMPLETED", glyph: "✓", tone: "success", say: "the task completed on its journal's proof" },
  FAILED: { word: "FAILED", glyph: "✗", tone: "danger", say: "the task failed; its stop says why" },
  CANCELLED: { word: "CANCELLED", glyph: "■", tone: "subtle", say: "a person cancelled the task" },
  WAITING: { word: "WAITING", glyph: "⏸", tone: "warning", say: "the task waits for a person" },
  BLOCKED: { word: "BLOCKED", glyph: "■", tone: "warning", say: "the task is blocked; its blocker says on whom" },
  DEGRADED: { word: "DEGRADED", glyph: "~", tone: "warning", say: "part of what the task wrote could not be read" },
  ACTIVE: { word: "ORBITING", glyph: "●", tone: "success", say: "the task is moving: evidence arrived lately" },
  IDLE: { word: "IDLE", glyph: "●", tone: "success", say: "connected; nothing written lately" },
});

// What a task's provider is called where a header names it (0.0.3): its kind, never the provider's long name, which
// squeezed the header beside an AI CLI. A provider not here is named as it is.
export const PROVIDER_WORDS = Object.freeze({ "autonomous-engineering": "engineering", automation: "workflow" });

// THIS SESSION's own activity (1.8.7, session.mjs): what the host's hooks observed this session's tools do, shown when
// no task's journal speaks for the work, and beside a task while the host works a step itself. A state of what the
// TOOLS did, never of a task: ACTIVE needs a command running or a line written lately, and nothing here is a pass.
export const SESSION_WORDS = Object.freeze({
  ACTIVE: { word: "SESSION ACTIVE", glyph: "●", tone: "success", say: "this session's tools are working: the host's hooks reported it lately" },
  QUIET: { word: "SESSION QUIET", glyph: "○", tone: "subtle", say: "this session's tools have reported nothing lately" },
  ENDED: { word: "SESSION ENDED", glyph: "■", tone: "subtle", say: "the host said this session ended" },
  NONE: { word: "NO ACTIVITY", glyph: "○", tone: "subtle", say: "nothing observed in this session yet" },
});

// Why a session's activity may be missing, said instead of an empty block (1.8.7).
export const SESSION_SOURCE_WORDS = Object.freeze({
  ok: "nothing observed in this session yet: what its tools read, change and run appears here as the host's hooks report it",
  off: "this session's tool activity is not recorded here (the working_set switch, or ORBIT_WORKING_SET, is off)",
  "no-session": "the host named no session, so only a task this checkout runs, or one you pin, can be shown",
  "no-project": "Orbit does not know this checkout yet (/orbit-help binds it), so the host's hooks record no activity here",
  unreadable: "this session's activity could not be read just now; asking again",
});

// What one observed tool call was, in a word: the working set's kinds (1.8.7).
export const SESSION_KIND_WORDS = Object.freeze({ read: "read", edit: "edited", search: "searched", command: "ran", skill: "started skill", agent: "launched agent", other: "used a tool" });

// Where each piece of what a pane shows comes from (1.8.6): OBSERVED -- a trusted record or a check runner's own
// output; REPORTED -- what a host or an agent said, a receipt that proves nothing; INFERRED -- what a viewer worked
// out from those, never presented as either.
export const PROVENANCE_WORDS = Object.freeze({
  observed: { word: "observed", tone: "subtle" },
  reported: { word: "reported", tone: "warning" },
  inferred: { word: "inferred", tone: "subtle" },
});
