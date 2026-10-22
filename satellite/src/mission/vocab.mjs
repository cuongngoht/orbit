// The words a MISSION speaks, as tables. A mission is one goal taken from understanding to evidence: its intent, its
// work graph and every revision of it, the roles, templates, skills and workflows it resolved, every agent run it
// started, every action through the execution gateway, every handoff, every piece of evidence read back from an
// owner, and how it ended. Everything about where a mission stands is DERIVED from its journal on every read
// (src/mission/fold.mjs); nothing is stored beside it.
export const MISSION_SCHEMA = 1;

export const DECISION_SCHEMA = 1;

export const REPORT_SCHEMA = 1;

export const MAX_EVIDENCE = 16;

export const MAX_LIST = 8;

export const GOAL_MAX_BYTES = 65536;

export const NO_PROGRESS_REPEATS = 3;

export const STALE_AFTER_MS = 6 * 3600000;

export const DECISION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

// Where a mission stands, first row that holds (lifecycle.mjs). REPORTED is a mission whose work ended without the
// evidence its acceptance criteria need: never COMPLETED, which only a VERIFIED verdict earns.
export const LIFECYCLES = Object.freeze(["CREATED", "ANALYZED", "PLANNED", "RUNNING", "BLOCKED", "SETTLED", "COMPLETED", "REPORTED", "FAILED", "CANCELLED"]);

export const TERMINAL = Object.freeze(["COMPLETED", "REPORTED", "FAILED", "CANCELLED"]);

export const VERDICTS = Object.freeze(["PENDING", "VERIFIED", "NOT_VERIFIED"]);

// Why a mission stopped. `writable` ones are recorded by `finish --stop=` and each must be shown by the journal
// (stop.mjs STOP_EVIDENCE); NO_PROGRESS is also the engine's own, written when one unit keeps failing the same way.
export const STOP_REASONS = Object.freeze([
  { id: "NO_PROGRESS", writable: true, say: "one unit's attempts keep ending the same way" },
  { id: "BUDGET_EXHAUSTED", writable: true, say: "the mission's budget is spent" },
  { id: "VERIFICATION_FAILED", writable: true, say: "a unit could not reach the evidence it is held to" },
  { id: "EXECUTION_FAILED", writable: true, say: "an action it needed could not be carried out" },
  { id: "CAPABILITY_BLOCKED", writable: true, say: "a capability it needs is provided by nothing here, and nothing may be generated for it" },
  { id: "PERMISSION_DENIED", writable: true, say: "what it needs is not granted" },
  { id: "CANCELLED", writable: true, say: "the session cancelled it (a session's word, never a person's proof)" },
]);

export const STOP_IDS = Object.freeze(STOP_REASONS.map((s) => s.id));

// What neither a decision nor a report may carry: whether something worked, where the mission stands, how strong
// evidence is, which mode or operation an action has, and a person's word are the engine's to derive. Sent anyway,
// each is refused BY NAME.
export const FORBIDDEN = Object.freeze(["outcome", "verdict", "status", "passed", "succeeded", "success", "done", "completed", "satisfied", "verified", "proven", "approved", "granted", "human", "door", "stage", "lifecycle", "state", "signature", "failureSignature", "repeats", "budget", "confidence", "mode", "operationKind", "effect", "grants", "level", "evidenceLevel", "actionStatus", "independent", "revision", "score"]);

export const DECISION_FIELDS = Object.freeze(["schemaVersion", "decisionId", "expectedRevision", "action", "observed", "hypothesis", "reason", "evidence"]);

// What the journal keeps, per kind of line -- an allow-list, so a field nobody declared never reaches the disk. No
// field is named `kind`: it is the journal's word for which line it is (a unit's kind is `unitKind` on its line).
// `material` says whether a line moves the mission in a way a later decision must have read (a viewer redraws on it).
export const KINDS = Object.freeze({
  "mission.created": { material: true, fields: ["id", "project", "checkout", "objective", "goalDigest", "bytes", "budget", "session", "host", "schema"] },
  "intent.recorded": { material: true, fields: ["n", "digest", "facts", "hypotheses", "assumptions", "constraints", "acceptanceCriteria", "unknowns", "evidence", "capabilities", "action"] },
  "plan.revised": { material: true, fields: ["n", "digest", "file", "replaces", "cause", "affectedUnits", "invalidatedResults", "evidenceRefs", "units", "cancelled", "reset", "workflow", "because", "action"] },
  "unit.created": { material: true, fields: ["id", "key", "planRevision", "unitKind", "objective", "dependencyIds", "requiredCapabilities", "requestedEffects", "scope", "outputContract", "acceptanceCriteriaRefs", "verificationContract", "executionBudget", "inputArtifactRefs", "parentUnit", "action"] },
  "unit.updated": { material: false, fields: ["id", "rolePin", "templatePin", "skillPins", "reset", "because", "action"] },
  "unit.cancelled": { material: true, fields: ["id", "because", "action"] },
  "unit.skipped": { material: true, fields: ["id", "because", "action"] },
  "role.reused": { material: true, fields: ["pin", "roleId", "displayName", "profile", "unit", "coverage", "action"] },
  "role.validated": { material: false, fields: ["roleId", "ok", "findings", "action"] },
  "role.generated": { material: true, fields: ["pin", "roleId", "displayName", "profile", "unit", "composedOf", "action"] },
  "role.registered": { material: false, fields: ["pin", "version", "action"] },
  "role.rejected": { material: true, fields: ["roleId", "findings", "say", "action"] },
  "template.reused": { material: true, fields: ["pin", "rolePin", "provider", "unit", "action"] },
  "template.generated": { material: true, fields: ["pin", "rolePin", "provider", "unit", "action"] },
  "template.registered": { material: false, fields: ["pin", "version", "action"] },
  "skill.discovered": { material: false, fields: ["capability", "label", "provider", "pin", "unit", "action"] },
  "skill.reused": { material: true, fields: ["capability", "pin", "orbitPin", "unit", "action"] },
  "skill.generated": { material: true, fields: ["capability", "draft", "shape", "action"] },
  "skill.written": { material: false, fields: ["draft", "files", "action"] },
  "skill.validated": { material: false, fields: ["draft", "ok", "findings", "dryRun", "action"] },
  "skill.registered": { material: true, fields: ["capability", "pin", "orbitPin", "status", "unit", "action"] },
  "skill.invoked": { material: false, fields: ["pin", "action", "agentRun", "runs"] },
  "workflow.reused": { material: true, fields: ["pin", "workflowId", "action"] },
  "workflow.validated": { material: false, fields: ["workflowId", "ok", "findings", "action"] },
  "workflow.generated": { material: true, fields: ["pin", "workflowId", "action"] },
  "workflow.registered": { material: false, fields: ["pin", "version", "action"] },
  "agentrun.created": { material: true, fields: ["id", "unit", "parentAgentRun", "templatePin", "rolePin", "skillPins", "actualHost", "actualProvider", "agent", "profile", "grants", "budget", "attempt", "mode", "action", "dispatch", "task", "depth", "tree"] },
  "agentrun.started": { material: true, fields: ["id", "action", "providerRef", "by"] },
  "agentrun.reported": { material: false, fields: ["id", "executionState", "findings", "artifacts", "evidenceRefs", "unknowns", "proposes", "digest", "summary"] },
  "agentrun.ended": { material: true, fields: ["id", "outcome", "failureSignature", "because"] },
  "action.proposed": { material: true, fields: ["id", "type", "mode", "operationKind", "provider", "effect", "profile", "fingerprint", "asked", "unit", "agentRun", "parentAction", "parentAgentRun", "decision", "observed", "hypothesis", "reason", "evidence"] },
  "action.refused": { material: false, fields: ["id", "rule", "say"] },
  "action.intended": { material: true, fields: ["id", "lease", "host", "pid"] },
  "action.accepted": { material: true, fields: ["id", "providerRef", "by"] },
  "action.observed": { material: false, fields: ["id", "refs", "digests", "outcome", "by"] },
  "action.recorded": { material: false, fields: ["id", "outcome", "level", "evidence", "summary"] },
  "action.ambiguous": { material: true, fields: ["id", "because"] },
  "permission.evaluated": { material: false, fields: ["action", "profile", "operationKind", "mode", "verdict", "rule"] },
  "permission.denied": { material: true, fields: ["action", "unit", "agentRun", "operationKind", "profile", "mode", "rule", "say"] },
  "handoff.published": { material: true, fields: ["id", "unit", "targets", "agentRun", "digest", "file", "proposes", "action"] },
  "handoff.consumed": { material: false, fields: ["id", "unit", "agentRun", "action"] },
  "handoff.rejected": { material: true, fields: ["id", "unit", "rule", "say", "action"] },
  "evidence.linked": { material: false, fields: ["id", "action", "unit", "agentRun", "owner", "ref", "level", "independent", "digest", "acceptance", "supports", "refutes", "verified", "say"] },
  "verification.derived": { material: false, fields: ["verdict", "owed", "digest"] },
  "replan.triggered": { material: true, fields: ["trigger", "response", "unit", "revision", "because", "action"] },
  "mission.completed": { material: true, fields: ["verdict", "summary"] },
  "mission.reported": { material: true, fields: ["verdict", "owed", "summary"] },
  "mission.failed": { material: true, fields: ["stop", "because"] },
  "mission.cancelled": { material: true, fields: ["by", "session", "because"] },
  "checkpoint.written": { material: false, fields: ["n", "digest", "file", "revision", "action"] },
  "recovery.reconciled": { material: true, fields: ["action", "from", "to", "because"] },
  "tool.observed": { material: false, fields: ["eid", "phase", "tool", "toolName", "cmdClass", "exe", "ok", "durationMs", "agentRun", "attribution", "mode"] },
});

export const KIND_NAMES = Object.freeze(Object.keys(KINDS));

export const isMaterial = (kind) => KINDS[kind]?.material === true;

// Text that came from a host or an agent: one printable line, scrubbed by shape on the way to the disk.
export const FREE_TEXT = Object.freeze(["objective", "because", "summary", "observed", "hypothesis", "reason", "say", "displayName"]);

export const ENDINGS = Object.freeze(["mission.completed", "mission.reported", "mission.failed", "mission.cancelled"]);
