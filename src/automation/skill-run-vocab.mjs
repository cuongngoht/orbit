// The words of a DECLARED PLAYBOOK'S RUN (0.0.4, src/automation/skill-run.mjs): what a run and each of its steps came
// to, as the receipts the coordinator's own journal keeps -- `skillrun:<run>` for the run, `skillstep:<run>.<step>` for
// a step, `invocation:<run>.<step>.<n>` for each call a step made. A word is written by whoever saw it happen and read
// by every viewer; the run's own state (scheduled, binding, running, verifying ...) is DERIVED from them, never stored.
//
// A step's word, with its columns:
//   done       it answered and met its output contract: a later step may read its outputs
//   fails      a required step that ends with it ends the run as FAILED
//   waits      a required step that ends with it leaves the run BLOCKED, waiting for someone
//   again      a later attempt of the same run carries it again (a read is safe to ask again; an ambiguous
//              write never is)
export const STEP_WORDS = [
  { word: "RUNNING", done: false, fails: false, waits: true, again: false, say: "recorded before its call; still open" },
  { word: "VERIFIED", done: true, fails: false, waits: false, again: false, say: "answered, met its output contract, and an owner's record proves it" },
  { word: "CONTRACT_MET", done: true, fails: false, waits: false, again: false, say: "answered and met its output contract — reported, never proven" },
  { word: "VERIFY_FAILED", done: false, fails: true, waits: false, again: true, say: "answered, and its output contract or the owner's record says no" },
  { word: "FAILED", done: false, fails: true, waits: false, again: true, say: "its call failed, every retry spent" },
  { word: "REFUSED", done: false, fails: true, waits: false, again: true, say: "its provider's owner gate refused the call" },
  { word: "BLOCKED", done: false, fails: false, waits: true, again: true, say: "it could not run now — its provider, an approval, an input or the budget" },
  { word: "SKIPPED", done: false, fails: false, waits: false, again: true, say: "optional and unanswered, or a step it reads from did not answer" },
  { word: "INTERRUPTED", done: false, fails: true, waits: false, again: true, say: "what ran it is gone; it read, so the next attempt asks again" },
  { word: "AMBIGUOUS", done: false, fails: false, waits: true, again: false, say: "what ran it is gone and it may have changed something — never asked again; a person decides" },
];

export const STEP_WORD_IDS = STEP_WORDS.map((w) => w.word);

export const stepWord = (word) => STEP_WORDS.find((w) => w.word === word) ?? null;

export const SKILL_STEP = Object.fromEntries(STEP_WORD_IDS.map((w) => [w, w]));

// What a whole run came to. REPORTED is a run every required step of which answered and met its contract with no
// owner's record to prove it: a successful call is never a verified outcome.
export const RUN_WORD = { RUNNING: "RUNNING", VERIFIED: "VERIFIED", REPORTED: "REPORTED", FAILED: "FAILED", BLOCKED: "BLOCKED", INTERRUPTED: "INTERRUPTED" };

// Why a step could not run, as the first word of its receipt's summary -- what a viewer and a person read.
export const BLOCKS = {
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE",
  HOST_ONLY: "HOST_ONLY",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  APPROVAL_REJECTED: "APPROVAL_REJECTED",
  INPUT_MISSING: "INPUT_MISSING",
  BUDGET: "BUDGET",
  TIMEOUT: "TIMEOUT",
  SKILL_UNAVAILABLE: "SKILL_UNAVAILABLE",
  INPUT_MOVED: "INPUT_MOVED",
};

// The workflow a declared playbook's calls are made FOR, as a managed server's policy reads it: the coordinator that
// drafted it. A playbook never names a workflow of its own, so it can never grant itself one.
export const CALLED_UNDER = "orbit-help";
