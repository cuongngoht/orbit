// The words a TASK speaks, as tables with the columns a rule asks.
//
// A task is one autonomous EXECUTION of a work: what happened while trying to do it -- the
// stage it is in, the attempts it made, what it decided and why, the actions it started, the
// receipts other domains hold for them, and what a person approved, rejected, paused or
// cancelled. A work (src/work/) says what doing a requirement NEEDS; a task says what
// HAPPENED. A task references its work, its requirement and its snapshot by id and copies
// none of them.
//
// Everything about where a task stands is DERIVED on every read from its journal
// (src/task/model.mjs). Nothing is stored beside the journal to drift from it.

export const TASK_SCHEMA = 1;

// A sentence, not an essay: a decision says what was observed and why, never a chain of
// thought. Longer text is refused, not cut, so nothing is silently lost.
export const TEXT_LIMIT = 240;

// Engineering STAGES are not lifecycle states. `preparing` and `verifying` are the columns the
// lifecycle table reads; every other stage is execution.
export const STAGES = [
  { name: "REQUIREMENT", preparing: true, verifying: false, doc: "settling what the requirement asks" },
  { name: "CONTEXT", preparing: true, verifying: false, doc: "reading what the project already knows" },
  { name: "ENVIRONMENT", preparing: true, verifying: false, doc: "getting the checkout able to run" },
  { name: "WORKSPACE", preparing: true, verifying: false, doc: "setting up where the change is made" },
  { name: "PLANNING", preparing: false, verifying: false, doc: "deciding how to make the change" },
  { name: "IMPLEMENTING", preparing: false, verifying: false, doc: "making the change" },
  { name: "BUILDING", preparing: false, verifying: false, doc: "building what changed" },
  { name: "TESTING", preparing: false, verifying: true, doc: "running the tests the change is held to" },
  { name: "DIAGNOSING", preparing: false, verifying: false, doc: "working out why something failed" },
  { name: "FIXING", preparing: false, verifying: false, doc: "changing what the diagnosis pointed at" },
  { name: "REGRESSION", preparing: false, verifying: true, doc: "running what must still pass" },
  { name: "REVIEWING", preparing: false, verifying: true, doc: "checking the change as a whole" },
];

export const STAGE_NAMES = STAGES.map((s) => s.name);

export const stageRow = (name) => STAGES.find((s) => s.name === name) ?? null;

// Why an attempt began: the first one, a fix after a diagnosis, the same change tested again,
// or the same thing tried again after something outside it went wrong.
export const ATTEMPT_CAUSES = ["fresh", "fix", "retest", "retry"];

// What an attempt or an action came to. A receipt keeps its OWN domain's word instead -- an
// investigation's outcome is never translated into one of these.
export const OUTCOMES = ["succeeded", "failed", "abandoned"];

// Which domain owns a receipt a task links to. Generic words: `data` and never a database's
// name, `browser` and never a driver's. `check` is a declared build or test command the
// orchestrator ran in a task's workspace (src/orchestration/checks.mjs); `sandbox` is the
// environment a task owns to run what it changed (src/runtime/sandbox/). The last five are a
// COORDINATOR's (src/automation/): `step` one step of its workflow, rewritten as it moves; `plan` the
// plan artifact it follows, by digest; `task` a child task it started, by id; `requirement` a frozen
// snapshot a step read back; `skill` a project playbook it offered, pinned as <id>:<version>:<digest8>.
// `impact` is what one plan or one change was found to reach: which components, and why (src/orchestration/impact.mjs).
// `learning` (1.8.9) is what a FINISHED task taught engineering memory, linked after it ended: its ref names the
// observation (`task:<id>`), its outcome OBSERVED or NOTHING, its summary the candidates, kept and refused -- or why
// nothing was learned. Read by Live's lifecycle rows; never read to move a task.
// `goal` (0.0.4) is the goal and unit a coordinator was started for (`goal-…:gu-…`): lineage, never evidence. The
// three after it (0.0.4) are a declared playbook's RUN (src/automation/skill-run.mjs): `skillrun` the run, pinned to one
// version; `skillstep` one of its workflow's steps; `invocation` one call a step made through its provider's owner
// gate -- the provider's key, a digest of what was asked and of what came back, how it ended, and never either.
// `architecture` (0.1.0) is what a standalone reverse-engineering pass recorded: the system graph it left, by the
// projection's digest (src/architecture/graph-view.mjs) -- a receipt that names a graph, never a verdict about it.
export const RECEIPT_DOMAINS = ["runtime", "run", "investigation", "data", "browser", "work", "test", "check", "sandbox", "step", "plan", "task", "requirement", "skill", "impact", "learning", "goal", "skillrun", "skillstep", "invocation", "architecture"];

// The receipt domains a COORDINATOR'S ENGINE writes and reads its own state back from (0.0.4): its steps, its plans,
// the playbook versions it pinned, a declared playbook's runs, steps and calls, and the goal it serves. A line in one of
// them is what the engine says happened, so only the coordinator's own door writes one (`door: "coordinator"`, set by
// cli/automation.mjs, never typed) -- or Orbit Control's, which proves a person -- and a terminal's `task link` is
// refused: a host that could write `skillstep … VERIFIED` or a `skill:` pin could forge what a run proved.
export const ENGINE_DOMAINS = ["step", "plan", "skill", "skillrun", "skillstep", "invocation", "goal"];

// The doors a composition root may say it is: Orbit Control's (a person, behind its mutation token) and the
// coordinator's (the engine itself). A terminal is no door at all (`null`).
export const DOORS = { CONTROL: "control", COORDINATOR: "coordinator" };

export const ENGINE_WRITERS = [DOORS.COORDINATOR, DOORS.CONTROL];

// The tasks whose WHOLE journal is their engine's (0.0.4): a coordinated workflow (provider `automation`) reads every
// line it holds -- the child task it started, the snapshot it read back, its actions, its stops, its ending -- as what
// its engine did. So nothing but the coordinator's door (or Control's) records anything in one; from a terminal a
// person only stops it (pause, cancel, reject), and nothing a host types can link a child, complete it or prove a step.
export const ENGINE_OWNED = ["automation"];

// What a requirement or an obligation came to, as evidence shows it. `satisfied` and `violated`
// need a receipt; with none, it is `not-verified`, and nothing here may say otherwise.
export const VERIFICATION_STATES = ["satisfied", "violated", "not-verified", "blocked", "needs-requirement", "not-applicable"];

export const PROVEN_STATES = ["satisfied", "violated"];

// Who or what a blocked task waits for.
export const NEEDS = ["environment", "capability", "person", "requirement"];

export const CHANGES = ["modified", "added", "deleted", "renamed"];

// Why a task stopped going on. `writable` reasons are the engine's to record with `block` or
// `fail`; the others are DERIVED -- a pending approval is what waiting for a person means, and
// only a person's cancel is a cancel -- so writing one is refused.
export const STOP_REASONS = [
  { id: "REQUIREMENT_BLOCKED", writable: true, say: "the requirement cannot be worked on as it stands" },
  { id: "ENVIRONMENT_BLOCKED", writable: true, say: "the environment it needs is not available" },
  { id: "HUMAN_APPROVAL_REQUIRED", writable: false, say: "it waits for a person to approve one action" },
  { id: "NO_PROGRESS", writable: true, say: "its attempts keep ending the same way" },
  { id: "BUDGET_EXHAUSTED", writable: true, say: "its budget is spent" },
  { id: "UNSAFE_CHANGE", writable: true, say: "the next change would not be safe to make" },
  { id: "VERIFICATION_FAILED", writable: true, say: "what it changed could not be verified" },
  { id: "EXECUTION_FAILED", writable: true, say: "an action it needed could not be carried out" },
  { id: "CANCELLED_BY_HUMAN", writable: false, say: "a person cancelled it" },
];

export const WRITABLE_STOPS = STOP_REASONS.filter((r) => r.writable).map((r) => r.id);

// What the journal keeps, per kind of line -- an allow-list, so a field nobody declared never
// reaches the disk. No field is named `kind`: it is the journal's word for which line it is,
// and a record carrying one would overwrite it (an action's kind is `type`, a receipt's
// owner is `domain`, a verification's result is `state`).
//
// `material` says whether a line MOVES the task in a way a person's decision rests on: a new
// attempt, an action starting, an approval asked or decided, a block, a pause, an ending. A
// person who decided on revision n is refused when a material line was written at or after n;
// a decision, a changed file, a receipt or a finished action are evidence accruing, and leave
// what the person decided on as it was.
export const KINDS = {
  created: { material: true, fields: ["id", "project", "checkout", "objective", "work", "parent", "root", "snapshot", "snapshotDigest", "baseRevision", "workspace", "provider", "actor", "budget", "by", "session", "host", "schema"] },
  stage: { material: true, fields: ["stage", "because"] },
  "attempt-started": { material: true, fields: ["id", "cause"] },
  "attempt-completed": { material: true, fields: ["id", "outcome", "failureSignature"] },
  decision: { material: false, fields: ["id", "attempt", "observed", "hypothesis", "nextAction", "evidence", "reason", "ref"] },
  "action-started": { material: true, fields: ["id", "attempt", "type", "tool", "label", "fingerprint", "approval", "mutates"] },
  "action-completed": { material: false, fields: ["id", "outcome", "receipt", "summary"] },
  "action-failed": { material: false, fields: ["id", "reason", "receipt", "summary"] },
  workspace: { material: false, fields: ["workspace", "baseRevision"] },
  "file-changed": { material: false, fields: ["attempt", "path", "change", "added", "removed"] },
  receipt: { material: false, fields: ["domain", "ref", "outcome", "summary", "action", "environment", "sourceTree", "pin", "providerKey", "queryDigest", "resultDigest", "operation"] },
  verification: { material: false, fields: ["subject", "obligation", "evidence", "state"] },
  "approval-requested": { material: true, fields: ["id", "action", "fingerprint", "environment", "reason", "risk", "expires", "attempt"] },
  "approval-granted": { material: true, fields: ["id", "by", "session", "seen"] },
  "approval-rejected": { material: true, fields: ["id", "by", "session", "seen", "reason"] },
  "approval-consumed": { material: true, fields: ["id", "action", "fingerprint"] },
  "approval-expired": { material: true, fields: ["id"] },
  paused: { material: true, fields: ["by", "session", "seen", "because"] },
  resumed: { material: true, fields: ["by", "session", "seen", "because"] },
  cancelled: { material: true, fields: ["by", "session", "seen", "because"] },
  blocked: { material: true, fields: ["stop", "needs", "because"] },
  unblocked: { material: true, fields: ["because"] },
  completed: { material: true, fields: ["summary"] },
  failed: { material: true, fields: ["stop", "because"] },
};

export const KIND_NAMES = Object.keys(KINDS);

export const isMaterial = (kind) => KINDS[kind]?.material === true;

// The prefix of a counted id, by the kind of line that introduces it.
export const PREFIX = { "attempt-started": "att", decision: "dec", "action-started": "act", "approval-requested": "apr" };

// Text that came from an agent or a person: refused above TEXT_LIMIT, kept as one printable
// line (src/task/ops.mjs), and scrubbed by shape on the way to the disk (src/task/store.mjs).
export const FREE_TEXT = ["objective", "because", "observed", "hypothesis", "reason", "summary", "label", "obligation", "risk"];

// The codes a refusal carries, for whoever must answer with a status (Orbit Control maps the
// first two to 404 and the rest to 409). A stale revision carries src/store/revisioned.mjs's
// STALE_REVISION, the one every revision-protected write in Orbit already answers with.
export const CODES = {
  TASK_UNKNOWN: "TASK_UNKNOWN",
  APPROVAL_UNKNOWN: "APPROVAL_UNKNOWN",
  TASK_ACTIVE: "TASK_ACTIVE",
  TASK_ENDED: "TASK_ENDED",
  TASK_PAUSED: "TASK_PAUSED",
  TASK_NOT_PAUSED: "TASK_NOT_PAUSED",
  APPROVAL_DECIDED: "APPROVAL_DECIDED",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  APPROVAL_NOT_GRANTED: "APPROVAL_NOT_GRANTED",
  FINGERPRINT_MISMATCH: "FINGERPRINT_MISMATCH",
  PERSON_UNPROVEN: "PERSON_UNPROVEN",
};

export const MISSING_CODES = [CODES.TASK_UNKNOWN, CODES.APPROVAL_UNKNOWN];

export const CONFLICT_CODES = [CODES.TASK_ACTIVE, CODES.TASK_ENDED, CODES.TASK_PAUSED, CODES.TASK_NOT_PAUSED, CODES.APPROVAL_DECIDED, CODES.APPROVAL_EXPIRED, CODES.APPROVAL_NOT_GRANTED, CODES.FINGERPRINT_MISMATCH];
