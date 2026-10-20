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

export const UNIT_STATES = ["planned", "ready", "running", "completed", "failed", "blocked", "skipped"];

export const KINDS = {
  created: ["id", "title", "project", "checkout", "sourceType", "sourceRef", "specDigest", "by", "session", "host", "schema"],
  spec: ["id", "digest", "bytes", "revision", "because"],
  analyzed: ["id", "objective", "requirements", "acceptance", "unknowns", "conflicts", "digest"],
  planned: ["id", "plan", "digest", "units", "because"],
  replanned: ["id", "plan", "digest", "previous", "trigger", "because", "affected"],
  unit: ["id", "unit", "state", "task", "work", "root", "because"],
  ac: ["id", "ac", "state", "evidence", "because", "revision"],
  verified: ["id", "outcome", "summary", "gaps", "because"],
  paused: ["id", "because", "session"],
  resumed: ["id", "session", "reconciled"],
  cancelled: ["id", "because", "session"],
};

export const PREFIX = { spec: "gsp", analyzed: "gan", planned: "gpl", replanned: "grl", unit: "gun", ac: "gac", verified: "gvf", paused: "gpa", resumed: "grs", cancelled: "gcn" };

export const FREE_TEXT = ["title", "objective", "because", "summary", "evidence", "sourceRef", "asks", "statement", "gaps"];
