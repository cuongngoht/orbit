// What control-server answers for a tracked work (control-server/src/works/, from src/work/track/view.mjs `workViewOf`): the
// ONE read model the terminal (`cli/track.mjs status`) and Orbit Live read too. Three axes, never folded into one word: the
// LIFECYCLE says where the work stands, the EVIDENCE says what stands behind it, and the LIVENESS says whether a session that
// worked on it is moving. A work keeps identity, links and what was REPORTED; files and checks are what the host's hooks
// OBSERVED, and a linked task's state is its own journal's.

export type Mode = "developer" | "autonomous";

export type LifecycleState = "RECEIVED" | "IN_PROGRESS" | "WAITING" | "BLOCKED" | "PAUSED" | "INTERRUPTED" | "REPORTED_DONE" | "FAILED" | "CANCELLED";

export type EvidenceLevel = "none" | "observed" | "reported" | "verified";

export type Liveness = "ACTIVE" | "QUIET" | "ENDED" | "NONE";

export type LifecycleTone = "danger" | "success" | "warning" | "subtle";

export interface Lifecycle {
  state: LifecycleState;
  word: string;
  glyph: string;
  tone: LifecycleTone;
  terminal: boolean;
  say: string;
  why: string | null;
  wait: string | null;
}

export interface Evidence {
  level: EvidenceLevel;
  why: string;
  say: string;
}

export interface Route {
  to: string | null;
  because: string | null;
  skill: string | null;
  at: string;
}

export interface Requirement {
  root: string | null;
  snapshot: string | null;
}

export interface SessionView {
  session: string;
  host: string | null;
  state: Liveness;
  lastAt: string | null;
}

/** A linked task: its lifecycle and stage are its OWN journal's, read back; null when it could not be read here. */
export interface TaskLink {
  task: string;
  what: string;
  role: string | null;
  lifecycle: string | null;
  stage: string | null;
  terminal: boolean;
  readable: boolean;
  linkedAt: string;
}

export interface Handoff {
  at: string;
  from: Mode | null;
  to: Mode;
  task: string | null;
  because: string | null;
}

/** `shared`: another session was also seen writing the path, so its hunks cannot be told apart. */
export interface FileSeen {
  path: string;
  attribution: "observed" | "shared";
}

/** A command NAMED like a check (its words), and how it ended. `current` is false once an edit was seen after it. */
export interface CheckSeen {
  at: string;
  class: string;
  exe?: string | null;
  what: string;
  result: "exit-ok" | "exit-error" | "unknown" | "running";
  current: boolean;
  basis?: string;
}

export interface Activity {
  observed: number;
  partial: boolean;
  truncated: boolean;
  files: FileSeen[];
  checks: CheckSeen[];
}

export interface Report {
  at: string;
  outcome: "done" | "failed" | "cancelled" | "blocked";
  summary: string | null;
  changed: FileSeen[];
  checks: CheckSeen[];
  proved: string[];
  unverified: string[];
  blocked: string[];
  evidence: string[];
}

export interface Summary {
  request: string | null;
  changes: { files: FileSeen[]; count: number; shared: number; basis: string };
  checks: CheckSeen[];
  proved: string[];
  unverified: string[];
  reportedBy: string | null;
}

export interface Coverage {
  host: string | null;
  observation: string;
  edits: string;
  commands: string;
  outcome: string;
  sessionEnd: boolean;
  limits: string[];
}

export interface WorkView {
  schema: number;
  work: string;
  title: string | null;
  ref: string | null;
  requirement: Requirement;
  checkout: string | null;
  tracked: boolean;
  mode: Mode;
  route: Route | null;
  lifecycle: Lifecycle;
  liveness: Liveness;
  evidence: Evidence;
  sessions: SessionView[];
  tasks: TaskLink[];
  handoffs: Handoff[];
  activity: Activity;
  report: Report | null;
  summary: Summary;
  coverage: Coverage;
  warnings: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkResponse {
  work: WorkView;
}

/** One line of the list: what was REPORTED, never a lifecycle (that needs the session and the tasks, which only the work's own page reads). */
export interface WorkRow {
  work: string;
  title: string | null;
  ref: string | null;
  mode: Mode;
  standing: string;
  sessions: number;
  links: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkList {
  works: WorkRow[];
}

/** Which work a page is about: both identities of its checkout, and its own. */
export interface WorkRef {
  key: string;
  checkout: string;
  work: string;
}
