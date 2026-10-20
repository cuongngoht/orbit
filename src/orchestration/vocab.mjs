// The words the ORCHESTRATOR speaks, as tables.
//
// The orchestrator decides what engineering step comes next for a task and coordinates the
// subjects that own each step. It owns no lifecycle: a task's stage, attempt, approvals and
// ending are the task's (src/task/), written through the task's one door and read off its fold.
// So the stage, stop, need, cause and receipt words below are the TASK's words, spelled here as
// data because nothing under src/orchestration/ may import the task subject -- and a test holds
// every one of them equal to src/task/vocab.mjs, so there is never a second spelling.

export const DECISION_SCHEMA = 1;

// A sentence, never an essay: the task's own bound (asserted equal by a test).
export const TEXT_LIMIT = 240;

// Three completed attempts in a row that ended on one failure signature, and the loop is going
// round: NO_PROGRESS. The task counts the run (`repeats`); this is where the number lives.
export const NO_PROGRESS_REPEATS = 3;

// How long one declared build or test command may run before it is stopped as not answering.
export const CHECK_TIMEOUT_MS = 30 * 60000;

// What a check may print before it is stopped, what of it is kept, and what of it a host is shown.
export const CHECK_OUTPUT_BYTES = 16 * 1024 * 1024;
export const LOG_BYTES = 256 * 1024;
export const EXCERPT_LINES = 40;

// How many repository-relative paths a plan's scope may name, and pieces of evidence a decision cites.
export const MAX_SCOPE = 64;
export const MAX_EVIDENCE = 16;

// How many changed paths a context lists before it says "and n more".
export const MAX_PATHS = 50;

export const STAGE = Object.freeze({
  REQUIREMENT: "REQUIREMENT",
  CONTEXT: "CONTEXT",
  ENVIRONMENT: "ENVIRONMENT",
  WORKSPACE: "WORKSPACE",
  PLANNING: "PLANNING",
  IMPLEMENTING: "IMPLEMENTING",
  BUILDING: "BUILDING",
  TESTING: "TESTING",
  DIAGNOSING: "DIAGNOSING",
  FIXING: "FIXING",
  REGRESSION: "REGRESSION",
  REVIEWING: "REVIEWING",
});

// The stops the orchestrator may WRITE (the task's writable ones).
export const STOP = Object.freeze({
  REQUIREMENT_BLOCKED: "REQUIREMENT_BLOCKED",
  ENVIRONMENT_BLOCKED: "ENVIRONMENT_BLOCKED",
  NO_PROGRESS: "NO_PROGRESS",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  UNSAFE_CHANGE: "UNSAFE_CHANGE",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  EXECUTION_FAILED: "EXECUTION_FAILED",
});

// The lifecycle words it reads.
export const LIFE = Object.freeze({ CANCELLED: "CANCELLED", COMPLETED: "COMPLETED", FAILED: "FAILED", PAUSED: "PAUSED", WAITING_APPROVAL: "WAITING_APPROVAL", BLOCKED: "BLOCKED" });

// Who or what a blocked task waits for.
export const NEEDS = ["environment", "capability", "person", "requirement"];

// Why an attempt began: after a plan, after a diagnosis, the same change again, after the
// environment stopped one.
export const CAUSE = Object.freeze({ FRESH: "fresh", FIX: "fix", RETEST: "retest", RETRY: "retry" });

// The receipt domains it links: the checks it ran itself, the runtime sessions it asked for,
// the investigations it read, the sandbox it asked runtime to keep for the task, and what each plan
// or change was found to reach (`impact`).
export const DOMAIN = Object.freeze({ CHECK: "check", RUNTIME: "runtime", INVESTIGATION: "investigation", SANDBOX: "sandbox", IMPACT: "impact" });

// What a sandbox is, in the words its receipt keeps: the states runtime answers with, and the two
// words an ending adds -- released, or refused because something it held could not be proven the
// task's own.
export const SANDBOX_STATE = Object.freeze({ READY: "READY", STALE: "STALE", AMBIGUOUS: "AMBIGUOUS", BLOCKED: "BLOCKED", RELEASED: "RELEASED", REFUSED: "REFUSED" });

// What a session of a sandbox is, in the words its receipt keeps: running, stopped on request, or
// gone by itself (the application stopped without being asked).
export const SESSION_WORD = Object.freeze({ RUNNING: "RUNNING", STOPPED: "STOPPED", EXITED: "EXITED" });

// A component a sandbox may be asked to start: the key understanding gave it, never a command.
export const COMPONENT_KEY = /^[a-z][a-z0-9.:_-]{0,63}$/;

// What a step's action came to. `error` is an action that could not be carried out at all.
export const RESULT = Object.freeze({ SUCCEEDED: "succeeded", FAILED: "failed", ERROR: "error" });

// What a check runs: the declared purposes runtime understanding names, never another. `verifies` says
// whether a pass is evidence the change WORKS -- a test, or a check of what is there without running it --
// rather than only that it builds; `building` says it runs in BUILDING, before the tests.
export const CHECK_PURPOSES = [
  { name: "build", verifies: false, building: true },
  { name: "verify", verifies: true, building: true },
  { name: "test", verifies: true, building: false },
];

export const PURPOSES = CHECK_PURPOSES.map((p) => p.name);

export const VERIFYING = CHECK_PURPOSES.filter((p) => p.verifies).map((p) => p.name);

export const BUILDING_PURPOSES = CHECK_PURPOSES.filter((p) => p.building).map((p) => p.name);

export const TESTING_PURPOSES = CHECK_PURPOSES.filter((p) => !p.building).map((p) => p.name);

// The word a check's receipt keeps when it failed exactly as it did before the change: a failure that
// was already there, kept visible, never a pass and never a regression.
export const AS_BEFORE = "failed-as-before";

// The words an impact receipt keeps: every reached component is known and verified by something declared,
// something the change reaches has nothing that verifies it, or no component graph was there to read so
// every component with a check is held to it.
export const IMPACT_WORD = Object.freeze({ SCOPED: "SCOPED", MISSING: "MISSING", WIDENED: "WIDENED" });

// The fields a decision carries, and the ones it may never carry: each of those is the engine's to
// derive from evidence -- whether something worked, where the task stands, what a failure is and
// whether a person allowed something. One sent anyway is refused by name, never ignored.
export const DECISION_FIELDS = ["schemaVersion", "expectedRevision", "action", "observed", "hypothesis", "reason", "evidence", "approval"];

export const DECISION_FORBIDDEN = ["outcome", "verdict", "status", "passed", "succeeded", "success", "done", "completed", "stage", "signature", "failureSignature", "class", "confidence", "approved", "granted", "human", "door"];

// What a failure is ABOUT -- what to look at next, never a verdict. The words the existing
// classifier already uses (src/query/classify.mjs: ENVIRONMENT, DATA, UNKNOWN) mean the same here.
export const FAILURE_CLASSES = [
  { id: "ENVIRONMENT", say: "the check could not run here, or failed the same way before any change: look at the machine, not the change" },
  { id: "CODE", say: "the build failed after the change: look at what changed" },
  { id: "TEST", say: "a test failed after the change: look at what it expects and what changed" },
  { id: "CAPABILITY", say: "a capability the verification needs could not be asked" },
  { id: "REQUIREMENT", say: "what the change is held to is not settled: the requirement decides, not the code" },
  { id: "DATA", say: "the data the check ran against is not what it expects" },
  { id: "SCOPE", say: "the change reaches outside what its plan said it would change" },
  { id: "UNKNOWN", say: "nothing shown is enough to say what it is about: read the log" },
];

export const FAILURE_IDS = FAILURE_CLASSES.map((c) => c.id);
