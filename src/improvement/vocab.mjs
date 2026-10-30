// The words of AUTONOMOUS SELF-IMPROVEMENT (0.3.0, ADR 0045): what a campaign is about, what its evidence can show,
// what it may conclude, and what its journal keeps -- as tables, so a rule reads a column and never a list of names.
//
// A campaign improves one REUSABLE DEFINITION -- a project playbook the skill factory keeps, or a Satellite role,
// agent template or workflow template -- from what its runs did, through the owners that keep them. It owns only its
// decisions: the runs, the versions, the verdicts, the lessons and which version runs stay with their owners, and a
// campaign references them by id, pin and digest.

export const CAMPAIGN_SCHEMA = 1;

export const OPPORTUNITY_SCHEMA = 1;

// One sentence, never an essay, and refused rather than cut when it is longer (ops.mjs).
export const TEXT_LIMIT = 240;

// What a campaign may be ABOUT, and who owns it: the owner keeps every version, and is the only one who may choose
// which runs (the skill factory's selectVersion, Satellite's selectDefinition).
export const SUBJECT_KINDS = [
  { id: "skill", owner: "skill-factory", say: "a project playbook the skill factory keeps", pin: /^[a-z0-9][a-z0-9-]{1,47}:\d+\.\d+\.\d+:[0-9a-f]{8}$/ },
  { id: "satellite", owner: "satellite", say: "a Satellite role, agent template or workflow template", pin: /^(rol|atp|skl|wft)-[a-z0-9][a-z0-9-]{0,47}:\d{1,4}\.\d{1,4}\.\d{1,4}:[0-9a-f]{8}$/ },
];

export const SUBJECT_IDS = SUBJECT_KINDS.map((k) => k.id);

export const subjectKind = (id) => SUBJECT_KINDS.find((k) => k.id === id) ?? null;

// The category of what a run showed, and whether a NEW VERSION of the definition could be what answers it. Only a
// `definition` category ever leads to a candidate: an environment, a provider, a person's policy or a cost the
// definition does not decide is reported, and nothing is generated to work around it.
export const CATEGORIES = [
  { id: "definition", candidate: true, say: "what the definition declares does not hold for what its providers answer" },
  { id: "provider", candidate: false, say: "a provider the definition asks failed or refused — the provider's owner answers it" },
  { id: "environment", candidate: false, say: "the environment stopped the run — a confounder, never a defect of the definition" },
  { id: "policy", candidate: false, say: "a person's approval or switch held the run — a person's to decide" },
  { id: "efficiency", candidate: false, say: "the run met its contract with more calls or retries than it needed" },
];

export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) ?? null;

// What ONE run showed, by its owner's own words (signals.mjs reads them). `healthy` rows are what a run that held looks
// like: they are counted AGAINST an opportunity about the same version, never for it.
export const SIGNALS = [
  { id: "contract-violation", category: "definition", healthy: false, say: "a required step answered outside its declared output contract" },
  { id: "input-missing", category: "definition", healthy: false, say: "a required step could not be asked: an input its workflow binds had no value" },
  { id: "budget-spent", category: "definition", healthy: false, say: "the workflow's own bounds were spent before a required step ran" },
  { id: "unverified-outcome", category: "definition", healthy: false, say: "a Satellite run ended without an independent owner's record proving it" },
  { id: "provider-failure", category: "provider", healthy: false, say: "a required step's provider failed or refused the call" },
  { id: "approval-wait", category: "policy", healthy: false, say: "a required step waited for a person's approval" },
  { id: "environment-blocked", category: "environment", healthy: false, say: "the run was blocked or interrupted by its environment" },
  { id: "excessive-retries", category: "efficiency", healthy: false, say: "the run met its contract only after steps were asked again" },
  { id: "verified", category: null, healthy: true, say: "every required step met its contract and an owner's record proved it" },
  { id: "answered", category: null, healthy: true, say: "every required step met its contract — reported, not proven" },
];

export const signalRow = (id) => SIGNALS.find((s) => s.id === id) ?? null;

// Why an opportunity is what it is (diagnose.mjs), each with whether a successor of the definition is the change to
// try. `inconclusive` is a correct answer: it names what evidence is missing and generates nothing.
export const CAUSES = [
  { id: "definition", candidate: true, say: "the definition's own declaration — an output it reads, a binding, a bound — does not hold for what its providers answer" },
  { id: "flaky", candidate: false, say: "the same version also ran clean under comparable conditions: the failure does not follow the definition" },
  { id: "provider", candidate: false, say: "a provider failed or refused: its owner answers it, and a new definition would only hide it" },
  { id: "environment", candidate: false, say: "the environment stopped the runs: an environmental limitation, never a defect of the definition" },
  { id: "policy", candidate: false, say: "a person's approval or switch held the runs: a person's to decide" },
  { id: "efficiency", candidate: false, say: "the runs met their contracts; what they cost is the providers' retries, which a definition does not decide" },
  { id: "inconclusive", candidate: false, say: "the evidence cannot tell what caused it" },
];

export const causeRow = (id) => CAUSES.find((c) => c.id === id) ?? null;

// What ONE evaluation, and then all of a campaign's evaluations together, came to (evaluation.mjs).
export const VERDICTS = ["BETTER", "EQUIVALENT", "WORSE", "INCONCLUSIVE", "BLOCKED"];

// How a campaign ENDED, and the phase it then reads as. Every ending is a learning result (learning.mjs).
export const OUTCOMES = [
  { id: "improvement-verified", phase: "COMPLETED", say: "the candidate evaluated better in independent sessions, was chosen, and held in later runs" },
  { id: "regression-detected", phase: "ROLLED_BACK", say: "the chosen candidate regressed in later runs, and the version it replaced was chosen again" },
  { id: "candidate-rejected", phase: "REJECTED", say: "the candidate evaluated worse, broke a promotion gate, or a person rejected it" },
  { id: "no-measurable-improvement", phase: "REJECTED", say: "the candidate evaluated the same as the version it would replace" },
  { id: "insufficient-evidence", phase: "INCONCLUSIVE", say: "the evidence could not decide: too few independent sessions, mixed results, or a failure that did not reproduce" },
  { id: "environment-blocked", phase: "INCONCLUSIVE", say: "the environment stopped the runs or the evaluations: nothing about the definition was learned" },
  { id: "capability-gap", phase: "INCONCLUSIVE", say: "a provider, a person's policy or a missing capability answers it — not a new version of the definition" },
  { id: "superseded", phase: "INCONCLUSIVE", say: "a person or another campaign chose another version before this one was settled" },
];

export const OUTCOME_IDS = OUTCOMES.map((o) => o.id);

export const outcomeRow = (id) => OUTCOMES.find((o) => o.id === id) ?? null;

// The Satellite MODE word each stage is carried in (satellite/src/execution/modes.mjs MODES; a test holds the two
// vocabularies together). A mode is an action's, never a campaign's.
export const STAGE_MODES = { detect: "ANALYZING", diagnose: "DIAGNOSING", propose: "DESIGNING", generate: "SKILL_GENERATING", validate: "SKILL_VALIDATING", evaluate: "TESTING", gates: "VERIFYING", promote: "REUSING", monitor: "VERIFYING", rollback: "RECOVERING", learn: "RECALLING" };

// The operation kind each stage is (satellite/src/permissions/operations.mjs OPERATION_KINDS): what it does to the
// store, never a shell, an install, a push or a deploy.
export const STAGE_OPERATIONS = { detect: "evidence.read", diagnose: "evidence.read", propose: "store.read", generate: "skill.draft", validate: "schema.validate", evaluate: "provider.invoke", gates: "evidence.read", promote: "definition.register", monitor: "evidence.read", rollback: "definition.register", learn: "knowledge.recall" };

// What a campaign's journal keeps, per kind of line: an ALLOW-list (a field nobody declared never reaches the disk).
// `material` lines move the campaign in a way a person's decision rests on: a person who read revision n is refused
// when one was written at or after it (rules.mjs STALE).
export const KINDS = {
  started: { material: true, fields: ["id", "opportunity", "fingerprint", "subjectKind", "subjectId", "pin", "signal", "category", "signature", "providers", "runs", "sessions", "against", "evidence", "tasks", "attribution", "session", "host", "schema"] },
  diagnosed: { material: true, fields: ["cause", "confidence", "hypothesis", "supporting", "contradicting", "unknowns", "affected", "risk", "test", "expected", "mode"] },
  proposed: { material: true, fields: ["strategy", "change", "expected", "mode"] },
  generating: { material: true, fields: ["draft", "of", "mode", "operation", "mission", "agentRun"] },
  generated: { material: true, fields: ["candidate", "pin", "digest", "successorOf", "reused", "changed", "mode"] },
  "generation-refused": { material: false, fields: ["findings", "attempts", "because"] },
  validated: { material: true, fields: ["candidate", "parentDigest", "oracleDigest", "mode"] },
  "evaluation-started": { material: true, fields: ["evaluation", "task", "baseline", "candidate", "inputs", "inputsDigest", "oracleDigest", "isolation", "session", "host", "pid", "planned", "mode", "eid"] },
  "evaluation-run": { material: false, fields: ["evaluation", "side", "n", "run", "word", "met", "failing", "blocked", "retries", "calls", "ms", "attribution", "evidence", "eid"] },
  "evaluation-settled": { material: true, fields: ["evaluation", "verdict", "because", "regressions", "metrics", "eid"] },
  "evaluation-interrupted": { material: true, fields: ["evaluation", "because", "eid"] },
  qualified: { material: true, fields: ["verdict", "sessions", "because"] },
  gated: { material: true, fields: ["rows", "failed", "mode"] },
  "awaiting-authority": { material: true, fields: ["because"] },
  "promotion-started": { material: true, fields: ["from", "to", "door", "mode", "eid"] },
  "promotion-interrupted": { material: true, fields: ["because"] },
  promoted: { material: true, fields: ["from", "to", "door", "by", "eid"] },
  rejected: { material: true, fields: ["reason", "because", "by"] },
  observed: { material: false, fields: ["runs", "sessions", "clean", "failing", "blocked", "word", "because", "mode"] },
  regression: { material: true, fields: ["runs", "sessions", "evidence", "because"] },
  "rollback-started": { material: true, fields: ["from", "to", "door", "mode", "eid"] },
  "rollback-interrupted": { material: true, fields: ["because"] },
  "rolled-back": { material: true, fields: ["from", "to", "door", "by", "eid"] },
  linked: { material: false, fields: ["evaluation", "mission", "side", "goalDigest", "agentRuns", "eid"] },
  blocked: { material: true, fields: ["stop", "needs", "because"] },
  unblocked: { material: true, fields: ["because"] },
  ended: { material: true, fields: ["outcome", "because"] },
  learned: { material: false, fields: ["lesson", "state", "kept", "because"] },
};

export const KIND_NAMES = Object.keys(KINDS);

export const isMaterial = (kind) => KINDS[kind]?.material === true;

// Text a line may carry: engine-composed sentences, scrubbed by shape on the way to the disk (store.mjs).
export const FREE_TEXT = ["hypothesis", "change", "expected", "because", "test"];

// Why a campaign waits, and for whom.
export const STOPS = ["SUBJECT_WITHHELD", "PROMOTION_WITHHELD", "ROLLBACK_WITHHELD", "SELECTION_AMBIGUOUS", "EVALUATION_BLOCKED", "ISOLATION_UNPROVEN", "BUDGET_EXHAUSTED"];

export const NEEDS = ["person", "environment", "session"];

// The doors a composition root may say it is: the improvement engine itself, and Orbit Control, which proves a
// person. A terminal is no door: it reads, and steps a campaign only through the engine's own commands.
export const DOORS = { ENGINE: "improvement", CONTROL: "control" };

export const WRITERS = [DOORS.ENGINE, DOORS.CONTROL];

export const CODES = {
  UNKNOWN: "IMP_UNKNOWN",
  PHASE: "IMP_PHASE",
  DOOR: "IMP_DOOR",
  FIELDS: "IMP_FIELDS",
  TEXT: "IMP_TEXT",
  ENDED: "IMP_ENDED",
  STALE: "STALE_REVISION",
  OFF: "IMP_OFF",
  BUSY: "IMP_BUSY",
  INVALID: "IMP_INVALID",
};

export const ID = { campaign: /^imp-[a-f0-9]{12}$/, opportunity: /^opp-[a-f0-9]{16}$/, candidate: /^cand-[a-f0-9]{12}$/ };
