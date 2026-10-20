// The words a COORDINATED WORKFLOW speaks. A coordinator is a task of its own (provider "automation") that
// takes one objective through several owners' workflows -- the requirement, project context, runtime, an
// engineering task, a QA investigation, a review -- one step at a time, each step decided by the host and
// settled on evidence the engine reads back from its owner.
//
// Every word that is also a TASK's word (a stage, a stop, a need, a cause, a lifecycle, a receipt domain)
// is spelled here and held equal to src/task/vocab.mjs by test/automation-vocab.test.mjs: this subject
// imports no task module, so the two lists are asserted, never shared.

export const DECISION_SCHEMA = 1;

// The provider word a coordinator's task is created with -- how a viewer and a resume tell it apart.
export const PROVIDER = "automation";

export const TEXT_LIMIT = 240;

export const MAX_STEPS = 12;

// A plan artifact's shape (1.8.6): 2 is a graph with revisions (plan.mjs). A plan with no `schema` is 1, a chain.
export const PLAN_SCHEMA = 2;

// How many revisions one plan keeps the reasons for -- retries after a failure and revisions on new evidence
// together (`execution.maxAttempts` and `execution.maxReplans` bound each; this bounds the artifact).
export const MAX_REVISIONS = 32;

// How many capabilities an objective is read for: what the router's table names and what a host names
// (`--capability`), resolved one by one.
export const MAX_CAPABILITIES = 12;

// A capability word, as the router's table and every catalog row spell one.
export const CAPABILITY = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;

export const MAX_EVIDENCE = 16;

export const NO_PROGRESS_REPEATS = 3;

// How long a host-run step may stay open before another session may call it gone (a child task
// can run for hours; its own journal says whether it still does, and is read first).
export const STALE_AFTER_MS = 6 * 3600000;

export const STAGE = { REQUIREMENT: "REQUIREMENT", CONTEXT: "CONTEXT", ENVIRONMENT: "ENVIRONMENT", WORKSPACE: "WORKSPACE", PLANNING: "PLANNING", IMPLEMENTING: "IMPLEMENTING", BUILDING: "BUILDING", TESTING: "TESTING", DIAGNOSING: "DIAGNOSING", FIXING: "FIXING", REGRESSION: "REGRESSION", REVIEWING: "REVIEWING" };

export const STOP = { REQUIREMENT_BLOCKED: "REQUIREMENT_BLOCKED", ENVIRONMENT_BLOCKED: "ENVIRONMENT_BLOCKED", NO_PROGRESS: "NO_PROGRESS", BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED", VERIFICATION_FAILED: "VERIFICATION_FAILED", EXECUTION_FAILED: "EXECUTION_FAILED" };

export const NEEDS = { ENVIRONMENT: "environment", CAPABILITY: "capability", PERSON: "person", REQUIREMENT: "requirement" };

export const CAUSE = { FRESH: "fresh", FIX: "fix", RETEST: "retest", RETRY: "retry" };

export const LIFE = { CANCELLED: "CANCELLED", COMPLETED: "COMPLETED", FAILED: "FAILED", PAUSED: "PAUSED", WAITING_APPROVAL: "WAITING_APPROVAL", BLOCKED: "BLOCKED", QUEUED: "QUEUED", PREPARING: "PREPARING", VERIFYING: "VERIFYING", EXECUTING: "EXECUTING" };

export const TERMINAL = [LIFE.CANCELLED, LIFE.COMPLETED, LIFE.FAILED];

// The receipt domains a coordinator links: its steps, its plans, the child tasks it started, the snapshot a
// requirement step read back, a project playbook it offered; and two it shares with every task.
export const DOMAIN = { STEP: "step", PLAN: "plan", TASK: "task", REQUIREMENT: "requirement", SKILL: "skill", INVESTIGATION: "investigation", RUNTIME: "runtime" };

// What an action of a coordinator IS: a skill the host runs, an agent the host dispatches, or something the
// engine does itself through an owner's port. Never a command line.
export const ACTION_TYPE = { SKILL: "skill.invoke", AGENT: "agent.dispatch", ENGINE: "engine.run" };

// The word a step's receipt carries, rewritten as the step moves. Lower case is the state a context shows.
export const STEP_WORD = { PENDING: "PENDING", RUNNING: "RUNNING", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED", BLOCKED: "BLOCKED", REPORTED: "REPORTED", SKIPPED: "SKIPPED" };

// What a host may say a step it ran came to. It is a REPORT: the engine reads the owner's evidence back
// before anything is recorded as done, and the word alone never satisfies a step.
export const EXECUTION_STATES = ["succeeded", "failed", "blocked"];

export const DECISION_FIELDS = ["schemaVersion", "decisionId", "expectedRevision", "action", "observed", "hypothesis", "reason", "evidence", "approval"];

export const OUTCOME_FIELDS = ["schemaVersion", "decisionId", "expectedRevision", "stepId", "providerId", "providerVersion", "executionState", "evidenceRefs", "receiptRefs", "blockingReasons", "requestedCapabilities", "summary"];

// What neither a decision nor an outcome may carry: whether something worked, where the task stands, a
// failure's identity and a person's word are the engine's to derive -- one sent anyway is refused by name.
export const FORBIDDEN = ["outcome", "verdict", "status", "passed", "succeeded", "success", "done", "completed", "satisfied", "verified", "proven", "approved", "granted", "human", "door", "stage", "lifecycle", "state", "signature", "failureSignature", "repeats", "budget", "confidence"];

export const DECISION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export const BLOCKING_LIMIT = 8;
