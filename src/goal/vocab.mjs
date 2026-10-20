// The words a GOAL speaks, as tables. A goal orchestrates work units above existing work,
// requirements and automation tasks; it keeps no second mutable state beside its journal.

export const GOAL_API = "orbit.goal/v1";
export const GOAL_SCHEMA = 1;
export const SPEC_MAX_BYTES = 512_000;
export const TITLE_LIMIT = 240;

export const AC_STATES = ["verified", "failed", "not-verified", "blocked", "not-applicable"];
export const REQ_KINDS = ["explicit", "derived", "assumption", "unknown", "conflict", "decision"];

export const LIFECYCLE = [
  { name: "created", doc: "accepted, not yet analyzed" },
  { name: "analyzing", doc: "analysis in progress" },
  { name: "ready", doc: "planned and waiting to run" },
  { name: "running", doc: "at least one unit active" },
  { name: "waiting-input", doc: "needs a person" },
  { name: "waiting-approval", doc: "needs approval" },
  { name: "blocked", doc: "cannot proceed safely" },
  { name: "paused", doc: "stopped by a person" },
  { name: "verifying", doc: "checking acceptance" },
  { name: "completed", doc: "every gate passed" },
  { name: "failed", doc: "stopped with failure" },
  { name: "cancelled", doc: "cancelled" },
  { name: "partial", doc: "some work done, completion gate not met" },
];

export const LIFECYCLE_NAMES = LIFECYCLE.map((s) => s.name);

// `unresolved`: the analysis says a prerequisite of this unit is missing (`intent.missing`), so it is never started on
// a guess -- a person answers, the goal is analyzed again, and the next plan says what it can do.
export const UNIT_STATES = ["planned", "ready", "running", "completed", "failed", "blocked", "skipped", "unresolved"];

// What a goal IS ABOUT, in the host model's own structured reading of the specification (0.0.4) -- never a word
// this engine looks for in the text, so a goal written in any language plans the same way. The engine validates
// the reading and decides from its fields alone.
//
//   change          the product's code is to change
//   quality         something is to be verified or assessed
//   investigation   something is to be found out about how the product behaves
//   procedure       a reusable workflow is to exist for the project
//   question        something is to be understood, and nothing built
export const INTENT_CATEGORIES = ["change", "quality", "investigation", "procedure", "question"];

// The KINDS of work a goal may take, one work unit each, in this order: a unit waits for the one before it. A row's
// columns are what a unit of it carries into the coordinated workflow it starts (src/goal/execute.mjs):
//
//   intent    the routing intent its workflow is planned under (src/routing/intents.mjs, held equal by
//             test/goal-intent.test.mjs) -- a declared word, so the objective's text is never classified again
//   ref       it settles the goal's work item, so the item is handed on
//   accepts   it answers for the acceptance criteria
//   named     it takes the capabilities the analysis names, and is unresolved without one
//   title     what the unit is called: the analysis's own objective, or a fixed sentence
export const WORK_KINDS = [
  { id: "analyze", intent: "architecture", ref: false, accepts: false, named: false, title: () => "Analyze requirements and architecture" },
  { id: "change", intent: "development", ref: true, accepts: true, named: false, title: (a) => a.objective },
  { id: "investigate", intent: "investigation", ref: false, accepts: true, named: false, title: (a) => a.objective },
  { id: "procedure", intent: "engineering", ref: false, accepts: true, named: true, title: (a) => a.objective },
  { id: "verify", intent: "qa", ref: false, accepts: true, named: false, title: () => "Verify acceptance criteria and regression" },
];

export const WORK_KIND_IDS = WORK_KINDS.map((k) => k.id);

export const workKindOf = (id) => WORK_KINDS.find((k) => k.id === id) ?? null;

// How much a structured reading may hold.
export const INTENT_LIMITS = { workKinds: 5, capabilities: 8, verification: 8, dependencies: 8, missing: 8 };

export const KINDS = {
  created: ["id", "title", "project", "checkout", "sourceType", "sourceRef", "specDigest", "by", "session", "host", "schema"],
  spec: ["id", "digest", "bytes", "revision", "because"],
  analyzed: ["id", "objective", "intent", "requirements", "acceptance", "unknowns", "conflicts", "digest"],
  planned: ["id", "plan", "digest", "units", "because"],
  replanned: ["id", "plan", "digest", "previous", "trigger", "because", "affected", "units"],
  unit: ["id", "unit", "state", "task", "work", "root", "because"],
  ac: ["id", "ac", "state", "evidence", "because", "revision"],
  verified: ["id", "outcome", "summary", "gaps", "because"],
  paused: ["id", "because", "session"],
  resumed: ["id", "session", "reconciled"],
  cancelled: ["id", "because", "session"],
};

export const PREFIX = { spec: "gsp", analyzed: "gan", planned: "gpl", replanned: "grl", unit: "gun", ac: "gac", verified: "gvf", paused: "gpa", resumed: "grs", cancelled: "gcn" };

export const FREE_TEXT = ["title", "objective", "because", "summary", "evidence", "sourceRef", "asks", "statement", "gaps"];
