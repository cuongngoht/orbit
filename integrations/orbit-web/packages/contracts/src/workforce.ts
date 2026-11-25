// THE VIRTUAL OFFICE (Orbit Web 0.8.0, ADR 0061): an account's office, its departments and AI employees, the missions
// and assignments they hold, what they hand in, what waits for a person, the schedules that make work, and the runtime
// connections an employee runs on. One definition for the API and the web app.
//
// FOUR THINGS, NEVER ONE WORD. A MISSION is what a person wants done. An ASSIGNMENT is the responsibility one employee
// holds for it. An ATTEMPT (a run) is one technical execution serving that responsibility. A HANDOFF is one concrete
// result handed to whoever accepts it. An assignment has many attempts and many handoffs; an employee holds at most ONE
// assignment at a time (the reservation), whatever is queued behind it.
//
// THREE AXES, NEVER ONE WORD. An employee's EMPLOYMENT (candidate ... archived) is the organisation's; their
// AVAILABILITY (available, busy, ineligible) is derived from the reservation and the conditions to run; the health of
// their CONNECTION and the state of a RUN are separate again. The office shows a WORK LABEL worked out from them.
import type { Checked } from "./validate.js";
import { isRuntimeKind, RUNTIME_KINDS, type RuntimeKind } from "./ai-connections.js";
import { checkResourceProfile, type ResourceEvidence, type ResourceProfile, type ResourceRevisionView, type SandboxState, type SandboxView, type UsageView } from "./resources.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const isWorkforceId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body).filter((k) => !allowed.includes(k)).map((k) => `${k} is not a field of this request`);
const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });
const NOT_OBJECT: Checked<never> = { ok: false, errors: ["the body must be a JSON object"] };

const line = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= max && !CONTROL.test(t) ? t : null;
};
const text = (v: unknown, max: number, allowEmpty = false): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n?/g, "\n").trim();
  if ((!allowEmpty && t.length === 0) || t.length > max || CONTROL.test(t)) return null;
  return t;
};
const lines = (v: unknown, maxItems: number, maxLength: number): string[] | null => {
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out = v.map((x) => line(x, maxLength));
  return out.every((x) => x !== null) ? (out as string[]) : null;
};

export const WORKFORCE_LIMITS = {
  nameLength: 80,
  titleLength: 120,
  goalLength: 8000,
  textLength: 8000,
  noteLength: 2000,
  listItems: 20,
  itemLength: 300,
  deliverables: 12,
  fileNameLength: 120,
  sources: 40,
  maxAssistants: 5,
  // The longest a temporary assistant is engaged (its mission's deadline, when sooner, ends it sooner).
  assistantDays: 7,
  delegationDepth: 3,
  reworkLimit: 5,
  replanLimit: 3,
  // Questions one assignment may ask (each ends its attempt), and how often a lead is woken for one question it has not
  // answered before the question goes one level up by itself.
  questionLimit: 3,
  answerWakes: 2,
} as const;

// ---- headers and error codes ----------------------------------------------------------------------------------------

// A command with a side effect names its request once: the same key and the same request answer the same result, the
// same key and another request is a conflict (409 idempotency_conflict). Kept for IDEMPOTENCY_TTL_HOURS.
export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENCY_TTL_HOURS = 24;
// The version of the record a change was made against (`If-Match: "<version>"`): a stale one is 412.
export const IF_MATCH_HEADER = "if-match";
export const CORRELATION_HEADER = "x-orbit-correlation";

export const WORKFORCE_ERRORS = {
  employeeBusy: "employee_busy",
  employeeIneligible: "employee_ineligible",
  staleVersion: "stale_version",
  staleHandoff: "stale_handoff",
  idempotencyConflict: "idempotency_conflict",
  invalidTransition: "invalid_transition",
  departmentNotEmpty: "department_not_empty",
  departmentArchived: "department_archived",
  quotaExceeded: "quota_exceeded",
  cycle: "relation_cycle",
  connectionUnavailable: "connection_unavailable",
  shellNotAttested: "shell_not_attested",
  officeNotSetUp: "office_not_set_up",
} as const;

// ---- the execution profile ----------------------------------------------------------------------------------------

// What a run is asked to use. Resolved in this order: the assignment's override, the employee's profile, the
// connection's recommendation. The backend holds every field to the connection's catalog at hire, at dispatch and at
// resume, and never silently changes the provider, the model or the effort to get past an error.
export interface ExecutionProfile {
  runtime: RuntimeKind;
  // The account's connection the employee runs on (null: the account's default connection of that runtime).
  connectionId: string | null;
  model: string;
  // Null: the model takes no effort level, or the runtime does not say.
  effort: string | null;
  // The runtime's own search (Claude Code's WebSearch, Codex's, AGY's), where the connection has it.
  webSearch: boolean;
  // Whether the run asks for the Orbit plugin's skills (Claude Code only; needs the owner's grant for the employee use
  // case). Its hooks are never loaded on the model plane.
  orbitPlugin: boolean;
  // The fields this profile leaves to its department's default, else the company's (execution precedence). Absent or
  // empty: every field is the profile's own, as every profile written before defaults existed. Never the runtime.
  inherit?: InheritableField[];
}

// What stands between an attempt and the rest of the machine, as the trusted side established it: the provider, whether
// the shell is granted and why, and how each limit is enforced (requested / applied / observed are kept apart).
export interface SandboxAttestation {
  provider: "container" | "process";
  // `attested`: filesystem, process, network and credential scope were checked from outside the shell for this attempt.
  // `not_isolated`: the development provider (no shell). `failed` / `expired`: the shell is refused, `detail` says why.
  state: "attested" | "not_isolated" | "failed" | "expired";
  shell: boolean;
  detail: string;
  checks: { name: string; ok: boolean; detail: string | null }[];
  checkedAt: string;
}

// ---- office, departments, employees ---------------------------------------------------------------------------------

export interface Office {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  // The company's execution defaults, per runtime (execution precedence).
  defaults: ExecutionDefaults;
}

export interface Department {
  id: string;
  name: string;
  position: number;
  archived: boolean;
  version: number;
  // Members not archived (the viewer's scope).
  members: number;
  // Its manager's appointment (null: none -- a department may have no manager yet), and its execution defaults.
  manager: AppointmentSummary | null;
  defaults: ExecutionDefaults;
}

// An incumbent appointment, as a card or a page shows it.
export interface AppointmentSummary {
  appointmentId: string;
  employeeId: string;
  name: string;
  state: AppointmentState;
  slotRevision: number;
  version: number;
}

// `deleted`: an archived employee whose desk its owner deleted (Governance → Employee desks); kept for what refers to it.
export const EMPLOYMENT_STATES = ["candidate", "probation", "active", "suspended", "archived", "deleted"] as const;
export type Employment = (typeof EMPLOYMENT_STATES)[number];

export const AVAILABILITIES = ["available", "busy", "ineligible"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

// What the office shows on a card, worked out from the reservation and the newest business state.
export const WORK_LABELS = ["ready", "working", "waiting_resources", "waiting_team", "waiting_info", "waiting_review", "paused", "cancelling", "reconciling", "not_ready"] as const;
export type WorkLabel = (typeof WORK_LABELS)[number];

export const WORK_LABEL_TEXT: Record<WorkLabel, string> = {
  ready: "Ready",
  working: "Working",
  waiting_resources: "Waiting for resources",
  waiting_team: "Waiting for teammates",
  waiting_info: "Waiting for information",
  waiting_review: "Waiting for review",
  paused: "Paused",
  cancelling: "Cancelling",
  reconciling: "Reconciling",
  not_ready: "Not ready",
};

export const EMPLOYEE_KINDS = ["permanent", "assistant"] as const;
export type EmployeeKind = (typeof EMPLOYEE_KINDS)[number];

// What an employee is, as one immutable revision. An assignment pins the revision it was claimed under.
export interface EmployeeProfile {
  title: string;
  duties: string;
  instructions: string;
  skills: string[];
  languages: string[];
  // Research workspaces whose sources the employee may be handed (ids the owner chose; each use is checked again).
  knowledge: string[];
  execution: ExecutionProfile;
  handoffStandard: string;
  reportingRule: string;
  // Delegation: whether this employee may give parts of their work to others, and how many temporary assistants.
  canDelegate: boolean;
  maxAssistants: number;
  canHirePermanent: boolean;
}

export interface ProfileRevision {
  revision: number;
  note: string;
  basedOn: number | null;
  createdBy: string;
  createdAt: string;
}

export interface HeldWork {
  assignmentId: string;
  missionId: string;
  title: string;
  state: AssignmentState;
  since: string;
}

export interface EmployeeCard {
  id: string;
  name: string;
  title: string;
  kind: EmployeeKind;
  departmentId: string | null;
  managerId: string | null;
  employment: Employment;
  availability: Availability;
  workLabel: WorkLabel;
  // Why the employee is not ready (a profile not activated, a suspension, a connection that cannot run).
  notReadyReason: string | null;
  // The assignment held now; null when none, or when the viewer may not read it.
  holding: HeldWork | null;
  // How many assignments wait behind the held one.
  queued: number;
  execution: ExecutionProfile;
  // A warning about the connection the employee runs on, shown beside the work label, never instead of it.
  connectionWarning: string | null;
  // Set for a temporary assistant: when its engagement ends.
  expiresAt: string | null;
  // The appointment the employee holds now (CEO, or its department's manager), if any: authority is this, never a title.
  role: AppointmentRole | null;
  version: number;
  updatedAt: string;
}

export interface EmployeeDetail extends EmployeeCard {
  profile: EmployeeProfile;
  profileRevision: number;
  revisions: ProfileRevision[];
  // The employee's desk: the directory the enterprise owns for their work, and how many accepted results changed it.
  desk: { id: string; version: number; files: number };
  queue: AssignmentSummary[];
  history: AssignmentSummary[];
  // The Personal Sandbox: its state, areas with their quotas, real use and enforcement level, and its resources.
  sandbox: SandboxView;
  resourceRevisions: ResourceRevisionView[];
  // The attempt running now, if any: its containers' resources and use.
  activeRun: RunView | null;
  // Its appointment now (null: none) and every appointment it held; the colleagues it may give work to without one.
  appointment: AppointmentView | null;
  appointments: AppointmentView[];
  delegationGrants: DelegationGrantView[];
}

// GOVERNANCE → EMPLOYEE DESKS (ADR 0061): every employee's desk -- of those in the office, and of those who left (archived,
// or rejected at the trial), whose storage stays committed until the owner deletes the desk here (POST
// /api/employees/:id/employment { command: "delete" }, If-Match the employee's version). A desk being deleted is listed
// until it is gone. Each one may be looked into (desks.ts); one whose employee is in the office and holds no work may
// be cleaned up.
export interface EmployeeDesk {
  employeeId: string;
  name: string;
  employment: Employment;
  // Why it left, as the owner said (null while it is in the office).
  reason: string | null;
  // When it left; null while it is in the office.
  leftAt: string | null;
  sandbox: { state: SandboxState; reason: string | null } | null;
  // What its desk and cache hold committed of the account's storage budget, and what was last measured in them, when.
  deskMiB: number;
  cacheMiB: number;
  deskUsedMiB: number | null;
  cacheUsedMiB: number | null;
  measuredAt: string | null;
  // How many accepted results changed the desk.
  deskVersion: number;
  // It holds an assignment, or an attempt of it is running: its desk is not cleaned now.
  busy: boolean;
  canBrowse: boolean;
  canClean: boolean;
  // The employee's version: the delete names it.
  version: number;
}

export interface EmployeeDeskList {
  desks: EmployeeDesk[];
  storage: { budgetMiB: number; committedMiB: number };
  asOf: string;
}

export interface Roster {
  // Null: the account has no company yet (the page offers to activate it).
  office: Office | null;
  // The company's CEO (null: none yet -- a company works without one).
  ceo: AppointmentSummary | null;
  departments: Department[];
  employees: EmployeeCard[];
  nextCursor: string | null;
  // The account's office version this was read at, and when: a page says "data as of".
  version: number;
  asOf: string;
  counts: { employees: number; ready: number; busy: number; notReady: number; queued: number; inbox: number };
}

export interface EmployeeTemplate {
  id: string;
  name: string;
  description: string;
  profile: EmployeeProfile;
}

// Activating the company (POST /api/office/setup): its name, else the account's company name. A company starts EMPTY --
// no department, employee, mission or CEO -- so `departments` is accepted only empty: an older client's example
// departments are refused (422 departments_not_accepted), never made silently.
export interface SetUpOfficeRequest {
  name?: string;
  departments?: string[];
}

export interface CreateDepartmentRequest {
  name: string;
}

export interface UpdateDepartmentRequest {
  name?: string;
  position?: number;
  // Its execution defaults, whole (what its employees run on where their profile leaves a field to it).
  defaults?: ExecutionDefaults;
}

export interface ArchiveDepartmentRequest {
  // Where its members go first: another department, or null for "Unassigned". Required when it has members.
  moveTo?: string | null;
}

export interface HireEmployeeRequest {
  name: string;
  departmentId?: string | null;
  managerId?: string | null;
  templateId?: string | null;
  profile: EmployeeProfile;
  // The Personal Sandbox's resource profile (revision 1 of the employee's resources).
  resources: ResourceProfile;
  // A candidate works a trial first. Skipping it is the owner's explicit choice, recorded with its reason.
  skipProbation?: boolean;
  skipReason?: string;
  // Optional explicit appointment created atomically with the hire (only "ceo" is supported;
  // authority still comes strictly from the appointment record, never from profile.title).
  appointRole?: "ceo" | null;
  appointReason?: string;
}

// PATCH /api/employees/:id/resources (If-Match): a new resource revision, for FUTURE attempts (an admitted attempt keeps
// the revision it was admitted under).
export interface UpdateResourcesRequest {
  resources: ResourceProfile;
  note?: string;
}

export interface UpdateEmployeeRequest {
  name?: string;
  managerId?: string | null;
  profile?: EmployeeProfile;
  note?: string;
  // Restore: the revision this change was copied from.
  basedOn?: number;
}

export interface MoveEmployeeRequest {
  departmentId: string | null;
}

// `delete`: an archived employee's desk deleted for good (its sandbox removed, its storage released).
export const EMPLOYMENT_COMMANDS = ["start_probation", "activate", "reject", "suspend", "reinstate", "archive", "delete"] as const;
export type EmploymentCommand = (typeof EMPLOYMENT_COMMANDS)[number];

export interface EmploymentRequest {
  command: EmploymentCommand;
  reason?: string;
  // Suspension: what happens to the assignment held now.
  held?: "keep_paused" | "cancel";
}

// A TEMPORARY ASSISTANT, as a lead's plan engages one (a part of its `delegate` tool that hires instead of naming
// someone): who it is, never how long or on what. Its mission bounds its engagement (released when the mission ends, at
// most WORKFORCE_LIMITS.assistantDays), its department's execution defaults -- else its lead's own -- what it runs on,
// and its lead's profile.maxAssistants how many it may have at once.
export interface HireAssistantRequest {
  name: string;
  title: string;
  duties: string;
  skills: string[];
  languages: string[];
}

// ---- missions, assignments, handoffs ------------------------------------------------------------------------------

export const ASSIGNMENT_STATES = [
  "QUEUED",
  "ASSIGNED",
  "RUNNING",
  "WAITING_FOR_SUBORDINATES",
  "ANSWERING",
  "BLOCKED",
  "PAUSED",
  "RECOVERING",
  "REVIEWING",
  "AWAITING_ACCEPTANCE",
  "CANCELLING",
  "COMPLETED",
  "CANCELLED",
  "FAILED_FINAL",
] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export const TERMINAL_STATES: readonly AssignmentState[] = ["COMPLETED", "CANCELLED", "FAILED_FINAL"];
// The states in which the assignment holds its employee: everything but the queue and the ends.
export const HOLDING_STATES: readonly AssignmentState[] = ASSIGNMENT_STATES.filter((s) => s !== "QUEUED" && !TERMINAL_STATES.includes(s));

export const isHolding = (s: AssignmentState): boolean => HOLDING_STATES.includes(s);
export const isTerminal = (s: AssignmentState): boolean => TERMINAL_STATES.includes(s);

export const ASSIGNMENT_STATE_TEXT: Record<AssignmentState, string> = {
  QUEUED: "Queued",
  ASSIGNED: "Assigned",
  RUNNING: "Working",
  WAITING_FOR_SUBORDINATES: "Waiting for teammates",
  ANSWERING: "Answering its team",
  BLOCKED: "Blocked",
  PAUSED: "Paused",
  RECOVERING: "Reconciling",
  REVIEWING: "In review",
  AWAITING_ACCEPTANCE: "Awaiting acceptance",
  CANCELLING: "Cancelling",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED_FINAL: "Failed",
};

export const ACCEPTANCE_MODES = ["owner_review", "manager_review"] as const;
export type AcceptanceMode = (typeof ACCEPTANCE_MODES)[number];

export const WHEN_BUSY = ["reject", "enqueue"] as const;
export type WhenBusy = (typeof WHEN_BUSY)[number];

export interface Deliverable {
  name: string;
  required: boolean;
}

// POST /api/missions (Idempotency-Key). The account and the actor are the session's: no request names them.
//   201  the employee was free: mission and assignment exist and the employee is reserved (state ASSIGNED)
//   202  `whenBusy: "enqueue"` and the employee holds other work: the mission exists, its assignment is QUEUED
//   409  employee_busy -- `whenBusy` absent or "reject" and the employee holds other work: NOTHING was created
// WHO A MISSION IS GIVEN TO (ADR 0061 §8): an employee by name, a DEPARTMENT (its manager in office, resolved when the
// mission is made) or the CEO. What a person saw as responsible before sending may be named (`expectedAssignee`): when the
// appointment moved since, the mission is refused (409 target_changed, with who is responsible now) and nothing is made.
export type MissionTarget = { kind: "employee"; employeeId: string } | { kind: "department"; departmentId: string } | { kind: "ceo" };
export const MISSION_TARGET_KINDS = ["employee", "department", "ceo"] as const;

export interface ExpectedAssignee {
  employeeId: string;
  // The appointment that made it responsible, and its slot revision (null for a mission given to an employee by name).
  appointmentId: string | null;
  appointmentRevision: number | null;
}

// Who is responsible for a target NOW (GET /api/missions/target), or why nobody is: the CEO slot is empty (no_ceo), the
// department has no manager (no_manager), the incumbent is suspended (appointment_suspended) or does not work
// (not_working), or the CEO has no department with a manager to give the work to (ceo_needs_departments).
export interface MissionTargetPreview {
  target: MissionTarget;
  responsible: (ExpectedAssignee & { employeeName: string; role: "ceo" | "manager" | null; departmentName: string | null }) | null;
  code: "no_ceo" | "no_manager" | "appointment_suspended" | "not_working" | "ceo_needs_departments" | null;
  reason: string | null;
}

// What an assignment was given to, as kept on it: the target asked and the appointment that resolved it.
export interface AssignmentTarget {
  kind: "employee" | "department" | "ceo";
  departmentId: string | null;
  departmentName: string | null;
  appointmentId: string | null;
  appointmentRevision: number | null;
}

export interface CreateMissionRequest {
  goal: string;
  title?: string;
  // Who it is given to: `target` (an employee, a department, the CEO), or -- as before -- `targetEmployeeId` alone. Both
  // must name the same employee (422 target_conflict).
  target?: MissionTarget;
  expectedAssignee?: ExpectedAssignee;
  targetEmployeeId?: string;
  whenBusy?: WhenBusy;
  // A research workspace whose sources the work may use, and the revisions it is pinned to.
  workspaceId?: string | null;
  sourceRevisionIds?: string[];
  // Repositories the work brings in (each one the employee may use on its Access tab): a snapshot of each, at its branch
  // or the default one, given to every attempt as a git bundle in /input.
  repositories?: MissionRepositoryRequest[];
  deliverables: Deliverable[];
  acceptanceCriteria: string[];
  acceptanceMode?: AcceptanceMode;
  deadline?: string | null;
  priority?: number;
  // An override of the employee's own execution profile for this mission (model and effort only).
  execution?: { model?: string; effort?: string | null };
}

export const MAX_MISSION_REPOSITORIES = 5;

export interface MissionRepositoryRequest {
  source: "github" | "azure";
  // As GET /api/repositories names it.
  id: string;
  // null: the repository's default branch.
  branch: string | null;
}

// A repository a mission brings in, as it was granted.
export interface MissionRepositoryView {
  source: "github" | "azure";
  fullName: string;
  branch: string | null;
}

export interface MissionAccepted {
  missionId: string;
  assignmentId: string;
  state: AssignmentState;
  employeeId: string;
  // The account's office version after the command: a page keeps this result until its read catches up.
  resourceVersion: number;
  // Where to follow it.
  href: string;
  correlationId: string;
}

// What a 409 employee_busy carries in `error.details`.
export interface EmployeeBusyDetails {
  employeeId: string;
  // The work held, when the caller may read it.
  holding: HeldWork | null;
  correlationId: string;
}

export const MISSION_STATES = ["open", "completed", "cancelled", "failed"] as const;
export type MissionState = (typeof MISSION_STATES)[number];

export interface AssignmentSummary {
  id: string;
  missionId: string;
  title: string;
  employeeId: string;
  employeeName: string;
  state: AssignmentState;
  // Why it waits, and for whom.
  reason: string | null;
  waitingOn: string | null;
  deadline: string | null;
  version: number;
  updatedAt: string;
}

export interface RunView {
  id: string;
  attemptNo: number;
  state: RunState;
  // What was asked, what the backend resolved, what the runtime itself reported -- three records, never merged.
  requested: Partial<ExecutionProfile>;
  resolved: ExecutionProfile | null;
  observed: {
    model: string | null;
    effort: string | null | "unknown";
    plugins: string[] | "unknown";
    runtimeVersion: string | null;
    nativeSession: string | null;
    // Operational counts and CLI exit status reported by the worker (never prompt or file content).
    toolCalls?: number | null;
    webSearches?: number | null;
    exit?: { code: number | null; signal: string | null } | null;
  };
  // What the runtime reported about the model (null: it did not say -- never estimated as if it had).
  modelUsage: { costUsd: number | null; turns: number | null; durationMs: number | null };
  sandbox: SandboxAttestation | null;
  resources: ResourceEvidence | null;
  // What the two containers' cgroups showed.
  usage: { modelPlane: UsageView | null; toolPlane: UsageView | null };
  // Why it waits or cannot be scheduled, in words with the numbers.
  waitingReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  // How it ended, in words (a refusal, an exit status), masked.
  detail: string | null;
  // Why this attempt was started (claimed, a revision, an answer, a question to answer, its team to review, a resume).
  wakeReason: string | null;
}

// A run (an attempt) of an assignment. `waiting_for_resources`: it could be admitted as configured, but CPU, memory,
// concurrency or scratch is not free now -- it is admitted automatically when it is. `unschedulable`: as configured it can
// never fit (above the account's budget, the usable capacity, a per-employee limit, or it needs storage enforcement this
// host cannot give) -- a person changes something (Needs me says what). Neither changes the assignment's state, which
// keeps its employee.
export const RUN_STATES = ["requested", "waiting_for_resources", "unschedulable", "starting", "running", "succeeded", "failed", "interrupted", "cancelled", "unknown"] as const;
export type RunState = (typeof RUN_STATES)[number];

export interface AssignmentView extends AssignmentSummary {
  parentId: string | null;
  unitKey: string | null;
  // What it was given to (an employee, a department through its manager, the CEO) and by which appointment.
  target: AssignmentTarget | null;
  // Who reviews its hand-ins: the owner (a mission's root) or its lead (a part: the lead's own review, never the owner's).
  reviewedBy: "owner" | "lead";
  leadName: string | null;
  // How many plans it gave, and questions it asked (each bounded: WORKFORCE_LIMITS.replanLimit, questionLimit).
  planCount: number;
  questionCount: number;
  // `dependsOn`: the keys of the parts of the same plan this part waits for (a part of a team's plan; [] otherwise).
  brief: { goal: string; deliverables: Deliverable[]; acceptanceCriteria: string[]; dependsOn: string[] };
  handoffRevision: number;
  reworkCount: number;
  // Pinned when the employee claimed it: the profile revision, the department then (id and name), the execution asked.
  pinned: { profileRevision: number | null; departmentId: string | null; departmentName: string | null; execution: ExecutionProfile | null };
  lastRun: RunView | null;
  attempts: number;
  claimedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  // What the viewer may do now (the backend decides again when asked).
  actions: AssignmentAction[];
}

export const ASSIGNMENT_ACTIONS = ["accept", "request_revision", "cancel", "pause", "resume", "answer", "retry", "hand_over", "repin"] as const;
export type AssignmentAction = (typeof ASSIGNMENT_ACTIONS)[number];

export interface ArtifactView {
  id: string;
  name: string;
  kind: "deliverable" | "attachment";
  mediaType: string;
  size: number;
  sha256: string;
}

export interface HandoffClaim {
  text: string;
  // Passage labels the server verified against the sources the assignment was given; empty: unsupported.
  sources: { label: string; sourceId: string; revisionId: string; locator: string; excerpt: string }[];
  supported: boolean;
}

export const HANDOFF_STATUSES = ["submitted", "revision_requested", "accepted", "superseded"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export interface HandoffView {
  id: string;
  assignmentId: string;
  revision: number;
  // SHA-256 over the manifest and every artifact's hash: what an acceptance names.
  digest: string;
  summary: string;
  status: HandoffStatus;
  artifacts: ArtifactView[];
  claims: HandoffClaim[];
  // Required deliverables the handoff does not carry.
  missing: string[];
  submittedAt: string;
  submittedBy: string;
  review: { by: string; at: string; note: string } | null;
}

export interface TimelineEntry {
  seq: number;
  at: string;
  type: string;
  actor: string;
  summary: string;
  assignmentId: string | null;
}

export interface MissionSummary {
  id: string;
  title: string;
  goal: string;
  state: MissionState;
  // The root assignment: who holds the mission.
  assignment: AssignmentSummary;
  deadline: string | null;
  nextAction: string | null;
  scheduleId: string | null;
  createdAt: string;
  updatedAt: string;
}

// A QUESTION one assignment asked, and where it went (ADR 0061 §8): to its lead (a part's question), or to the person who
// gave the work (the root's, or one a lead escalated with why). Answered once; the asker resumes once.
export const CLARIFICATION_KINDS = ["information", "human_decision", "beyond_authority", "deadline", "unanswered"] as const;
export type ClarificationKind = (typeof CLARIFICATION_KINDS)[number];
export const CLARIFICATION_STATES = ["open", "answered", "withdrawn"] as const;
export type ClarificationState = (typeof CLARIFICATION_STATES)[number];

export interface ClarificationView {
  id: string;
  askerAssignmentId: string;
  askerName: string;
  question: string;
  // Who it waits for now: its lead (an assignment) or the owner.
  addressee: "lead" | "owner";
  addresseeAssignmentId: string | null;
  addresseeName: string | null;
  kind: ClarificationKind;
  state: ClarificationState;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  askedAt: string;
  // Every hop, oldest first: to whom, why, when.
  route: { addressee: "lead" | "owner"; addresseeName: string | null; why: string; at: string }[];
}

// Who holds the mission's next move now, and why (a lead reviewing, a part working, a person deciding).
export interface ResponsibleNow {
  assignmentId: string;
  employeeId: string | null;
  name: string;
  what: string;
  why: string;
}

export interface MissionDetail extends MissionSummary {
  createdBy: string;
  // Who it was given to (the root assignment's target).
  target: AssignmentTarget | null;
  responsibleNow: ResponsibleNow[];
  clarifications: ClarificationView[];
  dataShares: DataShareView[];
  acceptanceMode: AcceptanceMode;
  acceptanceCriteria: string[];
  deliverables: Deliverable[];
  workspaceId: string | null;
  sourceRevisionIds: string[];
  // The repositories it brings in (a git bundle of each in every attempt's /input).
  repositories: MissionRepositoryView[];
  planRevision: number;
  assignments: AssignmentView[];
  handoffs: HandoffView[];
  timeline: TimelineEntry[];
  deliveries: DeliveryView[];
  resourceVersion: number;
}

// ONE MISSION'S EXCHANGES, as one thread (GET /api/missions/:id/messages): who gave which work to whom, who asked and who
// answered, what was handed in (with its files) and how it was reviewed -- read from the records the mission already keeps,
// in the words they were written with, each sender and recipient named. Nothing in it is written anew or summarised.
export const MISSION_MESSAGE_KINDS = ["given", "asked", "answered", "moved", "handed_in", "accepted", "revision", "notice"] as const;
export type MissionMessageKind = (typeof MISSION_MESSAGE_KINDS)[number];

// Who sent or receives a message: the owner, an employee (with its department), or Orbit itself.
export interface MissionParty {
  kind: "owner" | "employee" | "orbit";
  name: string;
  employeeId: string | null;
  departmentName: string | null;
}

// A file a hand-in carried: served by GET /api/artifacts/:artifactId/content.
export interface MissionMessageAttachment {
  artifactId: string;
  name: string;
  mediaType: string;
  size: number;
}

export interface MissionMessage {
  // Stable across reads: the kind and the record it comes from.
  id: string;
  at: string;
  kind: MissionMessageKind;
  from: MissionParty;
  to: MissionParty | null;
  // The assignment it is about: the mission's root or one of its parts.
  assignmentId: string | null;
  subject: string;
  body: string;
  attachments: MissionMessageAttachment[];
}

export interface MissionMessages {
  missionId: string;
  // Oldest first.
  messages: MissionMessage[];
}

// One change of a mission's team room, as the room's history keeps it: which file, what it became (its hash and size; null
// when it was removed), and the attempt of which employee and assignment changed it.
export interface TeamRoomChange {
  path: string;
  sha256: string | null;
  size: number | null;
  employeeId: string | null;
  employeeName: string | null;
  assignmentId: string | null;
  at: string;
}

// WHAT A LEAD SHARED WITH A PART OF ITS TEAM, on purpose (ADR 0061 §9): a source revision it reads itself, or the accepted
// hand-in of a part the recipient waits for -- its summary, or in full -- and whether the share still holds. A part reads
// nothing else of its mission.
export interface DataShareView {
  id: string;
  kind: "source" | "handoff";
  // The source revision shared (a source share).
  sourceRevisionId: string | null;
  // The part whose hand-in is shared (a hand-in share), and how much of it.
  fromUnit: string | null;
  mode: "summary" | "full";
  recipientAssignmentId: string;
  recipientUnit: string;
  recipientName: string;
  leadAssignmentId: string;
  sharedBy: string;
  sharedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

export interface MissionList {
  missions: MissionSummary[];
  nextCursor: string | null;
  version: number;
  asOf: string;
}

// The commands on one assignment. Each carries `If-Match: "<assignment version>"`; a review names the handoff digest
// the person was looking at.
export interface RequestRevisionRequest {
  handoffDigest: string;
  criteria: string;
}

export interface AcceptRequest {
  handoffDigest: string;
  note?: string;
}

export interface ReasonRequest {
  reason?: string;
}

export interface AnswerRequest {
  answer: string;
}

export interface CommandResult {
  assignmentId: string;
  state: AssignmentState;
  version: number;
  resourceVersion: number;
  correlationId: string;
}

// ---- needs me (the inbox) ------------------------------------------------------------------------------------------

export const INBOX_KINDS = ["acceptance", "information", "external_action", "reconciliation", "delivery_channel", "unschedulable", "blocked", "report"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_KIND_TEXT: Record<InboxKind, string> = {
  acceptance: "Review a result",
  information: "Provide information",
  external_action: "Approve an outside action",
  reconciliation: "Reconcile a run",
  delivery_channel: "Set up delivery",
  unschedulable: "Work that can never start as configured",
  blocked: "Work that is blocked",
  report: "A report delivered to you",
};

export const INBOX_STATES = ["open", "resolved", "expired", "withdrawn"] as const;
export type InboxState = (typeof INBOX_STATES)[number];

export interface InboxItem {
  id: string;
  kind: InboxKind;
  state: InboxState;
  missionId: string;
  assignmentId: string | null;
  title: string;
  reason: string;
  // Who waits for the decision.
  waiting: string | null;
  deadline: string | null;
  // What the decision is pinned to: answering against anything else is refused.
  pin: { assignmentVersion: number | null; handoffDigest: string | null; deliveryId: string | null };
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface Inbox {
  items: InboxItem[];
  open: number;
  nextCursor: string | null;
  version: number;
  asOf: string;
}

// ---- schedules, occurrences, deliveries ------------------------------------------------------------------------------

export const SCHEDULE_KINDS = ["daily", "weekly", "monthly", "quarterly"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

// What a schedule does about a period nobody ran: make the newest missed one, make each missed one (bounded), or skip
// and say so.
export const MISSED_POLICIES = ["catch_up_latest", "catch_up_each", "skip"] as const;
export type MissedPolicy = (typeof MISSED_POLICIES)[number];

export const DELIVERY_CHANNELS = ["inbox", "external"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export interface ScheduleRule {
  kind: ScheduleKind;
  // An IANA time zone and a local time of day ("08:00"). A local time that does not exist (a DST gap) runs at the first
  // instant after it; one that happens twice runs at its first.
  timezone: string;
  localTime: string;
  // weekly: 1 (Monday) .. 7; monthly and quarterly: the day of the month (1 .. 28).
  dayOfWeek?: number;
  dayOfMonth?: number;
  // The data the work covers: the period that just ENDED (a quarterly report on the first day of a quarter is about the
  // quarter before), or the one that starts.
  period: "previous" | "current";
}

export interface ScheduleRecipient {
  // An email of an Orbit principal (delivered to their inbox) or an outside address (needs an external channel).
  address: string;
  channel: DeliveryChannel;
}

export interface CreateScheduleRequest {
  name: string;
  rule: ScheduleRule;
  employeeId: string;
  mission: { goal: string; deliverables: Deliverable[]; acceptanceCriteria: string[]; workspaceId?: string | null; sourceRevisionIds?: string[] };
  recipients: ScheduleRecipient[];
  missedPolicy?: MissedPolicy;
  catchUpLimit?: number;
}

export interface UpdateScheduleRequest {
  name?: string;
  rule?: ScheduleRule;
  employeeId?: string;
  recipients?: ScheduleRecipient[];
  missedPolicy?: MissedPolicy;
  catchUpLimit?: number;
  state?: "active" | "paused";
}

export interface ScheduleRun {
  // The instant it is due (UTC), the same moment in the schedule's own zone, and the period it reports on.
  dueAt: string;
  local: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}

export interface ScheduleView {
  id: string;
  name: string;
  rule: ScheduleRule;
  employeeId: string;
  employeeName: string;
  recipients: ScheduleRecipient[];
  missedPolicy: MissedPolicy;
  catchUpLimit: number;
  state: "active" | "paused";
  revision: number;
  version: number;
  next: ScheduleRun[];
  lastOccurrence: OccurrenceView | null;
}

export const OCCURRENCE_STATES = ["created", "skipped"] as const;

export interface OccurrenceView {
  id: string;
  scheduleId: string;
  periodKey: string;
  dueAt: string;
  scheduleRevision: number;
  state: (typeof OCCURRENCE_STATES)[number];
  missionId: string | null;
  // Where the work stands, and where its report is.
  assignmentState: AssignmentState | null;
  delivery: DeliveryState | "none";
  createdAt: string;
}

// Acceptance and delivery are two states: a report is `SENT` only with the receiver's receipt.
export const DELIVERY_STATES = ["PENDING_CHANNEL", "PENDING", "SENDING", "SENT", "NEEDS_RECONCILIATION", "FAILED"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const DELIVERY_STATE_TEXT: Record<DeliveryState, string> = {
  PENDING_CHANNEL: "No channel yet",
  PENDING: "Waiting to send",
  SENDING: "Sending",
  SENT: "Sent",
  NEEDS_RECONCILIATION: "Needs reconciliation",
  FAILED: "Failed",
};

export interface DeliveryView {
  id: string;
  missionId: string;
  handoffId: string;
  digest: string;
  recipient: ScheduleRecipient;
  state: DeliveryState;
  attempts: number;
  receipt: string | null;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResolveDeliveryRequest {
  // A person's word about a delivery nobody can prove: it reached the receiver, or it is to be sent again.
  outcome: "delivered" | "resend";
  reason: string;
}

// ---- the office's notification on the app stream -------------------------------------------------------------------

export const OFFICE_AREAS = ["roster", "missions", "inbox", "schedules", "connections"] as const;
export type OfficeArea = (typeof OFFICE_AREAS)[number];

// An invalidation, never content: the page reads what it may read again. `version` is the account's office version
// after the change.
export interface OfficeChangedData {
  areas: OfficeArea[];
  missionId: string | null;
  version: number;
}

// ---- integration events (the durable catalog) ------------------------------------------------------------------------

// Every durable event of the workforce contexts, with the schema version its payload is validated against when it is
// written AND when it is read. Adding one is a row here and its producer.
export const INTEGRATION_EVENTS = {
  OfficeSetUp: 1,
  DepartmentCreated: 1,
  DepartmentChanged: 1,
  DepartmentArchived: 1,
  EmployeeHired: 1,
  EmployeeProfileRevised: 1,
  EmployeeEmploymentChanged: 1,
  EmployeeDepartmentChanged: 1,
  EmployeeActivated: 1,
  MissionCreated: 1,
  MissionPlanRevised: 1,
  // A manager gave parts of its assignment to its team, and woke to review what they handed in.
  AssignmentDelegated: 1,
  AssignmentReviewing: 1,
  AssignmentQueued: 1,
  AssignmentClaimed: 1,
  RunRequested: 1,
  RunStarted: 1,
  RunFinished: 1,
  StaleResultRejected: 1,
  HandoffSubmitted: 1,
  RevisionRequested: 1,
  AssignmentAccepted: 1,
  AssignmentBlocked: 1,
  AssignmentPaused: 1,
  AssignmentResumed: 1,
  AssignmentCancelling: 1,
  AssignmentCancelled: 1,
  AssignmentFailed: 1,
  InformationProvided: 1,
  ReservationReleased: 1,
  DecisionRequested: 1,
  DecisionResolved: 1,
  OccurrenceCreated: 1,
  ExecutiveMissionLinked: 1,
  DeliveryRequested: 1,
  DeliveryReconciled: 1,
  PluginGrantChanged: 1,
  SandboxProvisionRequested: 1,
  SandboxReady: 1,
  SandboxFailed: 1,
  // An archived employee's desk, deleted by its owner, read back gone (ADR 0061).
  SandboxDeleted: 1,
  // An accepted assignment's workspace was published to its employee's desk (and its toolbox), or could not be.
  DeskPublished: 1,
  EmployeeResourcesRevised: 1,
  ResourcesReserved: 1,
  RunWaitingForResources: 1,
  RunUnschedulable: 1,
  ResourcesReleased: 1,
  BudgetChanged: 1,
  CapacityChanged: 1,
  ConnectionChanged: 1,
  // The company's authority: an appointment made, replaced, suspended, reinstated or revoked; a delegation granted or
  // revoked; open work handed from one employee to another.
  AppointmentChanged: 1,
  DelegationGrantChanged: 1,
  AssignmentHandedOver: 1,
  // A question one assignment asked (to its lead, or to the owner), answered once, moved one level up, or withdrawn; a
  // lead woken to answer its team.
  ClarificationRequested: 1,
  ClarificationAnswered: 1,
  ClarificationEscalated: 1,
  ClarificationWithdrawn: 1,
  AssignmentAnswering: 1,
} as const;

export type IntegrationEventType = keyof typeof INTEGRATION_EVENTS;

export const isIntegrationEventType = (v: unknown): v is IntegrationEventType => typeof v === "string" && Object.hasOwn(INTEGRATION_EVENTS, v);

export interface IntegrationEvent {
  id: string;
  type: IntegrationEventType;
  schemaVersion: number;
  accountId: string;
  aggregateType: "office" | "department" | "employee" | "sandbox" | "mission" | "assignment" | "run" | "schedule" | "delivery" | "connection" | "budget" | "appointment" | "delegation" | "clarification" | "conversation";
  aggregateId: string;
  aggregateVersion: number;
  // The order of events one save produced.
  ordinal: number;
  actor: string;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  payload: Record<string, string | number | boolean | null>;
}

// ---- validators -------------------------------------------------------------------------------------------------------

const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
const EFFORT_SHAPE = /^[a-z][a-z0-9-]{0,23}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ ()-]{0,119}$/;

export const isDeliverableName = (v: unknown): v is string => typeof v === "string" && FILE_NAME.test(v) && !v.includes("..");

export function checkExecutionProfile(v: unknown): Checked<ExecutionProfile> {
  if (!isRecord(v)) return { ok: false, errors: ["execution must be an object"] };
  const errors = unknownFields(v, ["runtime", "connectionId", "model", "effort", "webSearch", "orbitPlugin", "inherit"]);
  const inherit = v.inherit === undefined ? [] : Array.isArray(v.inherit) && v.inherit.every((f) => (INHERITABLE_FIELDS as readonly unknown[]).includes(f)) ? [...new Set(v.inherit as InheritableField[])] : null;
  if (inherit === null) errors.push(`execution.inherit must list fields of ${INHERITABLE_FIELDS.join(", ")}`);
  const inheritsModel = inherit?.includes("model") === true;
  if (!isRuntimeKind(v.runtime)) errors.push(`execution.runtime must be one of ${RUNTIME_KINDS.join(", ")}`);
  if (v.connectionId !== undefined && v.connectionId !== null && !isWorkforceId(v.connectionId)) errors.push("execution.connectionId must be an id");
  if (!(inheritsModel && (v.model === undefined || v.model === "")) && (typeof v.model !== "string" || !MODEL_SHAPE.test(v.model))) errors.push("execution.model must be a model the runtime names");
  if (v.effort !== undefined && v.effort !== null && (typeof v.effort !== "string" || !EFFORT_SHAPE.test(v.effort))) errors.push("execution.effort must be an effort level the runtime names, or null");
  if (v.webSearch !== undefined && typeof v.webSearch !== "boolean") errors.push("execution.webSearch must be true or false");
  if (v.orbitPlugin !== undefined && typeof v.orbitPlugin !== "boolean") errors.push("execution.orbitPlugin must be true or false");
  return checked(errors, () => ({
    runtime: v.runtime as RuntimeKind,
    connectionId: (v.connectionId as string | null | undefined) ?? null,
    model: typeof v.model === "string" ? v.model : "",
    effort: (v.effort as string | null | undefined) ?? null,
    webSearch: v.webSearch === true,
    orbitPlugin: v.orbitPlugin === true,
    ...(inherit !== null && inherit.length > 0 ? { inherit } : {}),
  }));
}

const PROFILE_FIELDS = ["title", "duties", "instructions", "skills", "languages", "knowledge", "execution", "handoffStandard", "reportingRule", "canDelegate", "maxAssistants", "canHirePermanent"];

export function checkEmployeeProfile(v: unknown): Checked<EmployeeProfile> {
  if (!isRecord(v)) return { ok: false, errors: ["profile must be an object"] };
  const errors = unknownFields(v, PROFILE_FIELDS).map((e) => `profile.${e}`);
  const title = line(v.title, WORKFORCE_LIMITS.titleLength);
  const duties = text(v.duties ?? "", WORKFORCE_LIMITS.textLength, true);
  const instructions = text(v.instructions ?? "", WORKFORCE_LIMITS.textLength, true);
  const skills = lines(v.skills ?? [], WORKFORCE_LIMITS.listItems, WORKFORCE_LIMITS.itemLength);
  const languages = lines(v.languages ?? [], WORKFORCE_LIMITS.listItems, 40);
  const knowledge = Array.isArray(v.knowledge ?? []) && (v.knowledge as unknown[] | undefined ?? []).every(isWorkforceId) ? [...new Set((v.knowledge as string[] | undefined) ?? [])] : null;
  const execution = checkExecutionProfile(v.execution);
  const handoffStandard = text(v.handoffStandard ?? "", WORKFORCE_LIMITS.noteLength, true);
  const reportingRule = text(v.reportingRule ?? "", WORKFORCE_LIMITS.noteLength, true);
  const maxAssistants = v.maxAssistants ?? 0;
  if (title === null) errors.push(`profile.title must be 1-${WORKFORCE_LIMITS.titleLength} printable characters`);
  if (duties === null) errors.push("profile.duties is too long");
  if (instructions === null) errors.push("profile.instructions is too long");
  if (skills === null) errors.push("profile.skills must be a short list of short lines");
  if (languages === null) errors.push("profile.languages must be a short list of short lines");
  if (knowledge === null || knowledge.length > WORKFORCE_LIMITS.listItems) errors.push("profile.knowledge must be a short list of research workspace ids");
  if (!execution.ok) errors.push(...execution.errors.map((e) => `profile.${e}`));
  if (handoffStandard === null) errors.push("profile.handoffStandard is too long");
  if (reportingRule === null) errors.push("profile.reportingRule is too long");
  if (v.canDelegate !== undefined && typeof v.canDelegate !== "boolean") errors.push("profile.canDelegate must be true or false");
  if (v.canHirePermanent !== undefined && typeof v.canHirePermanent !== "boolean") errors.push("profile.canHirePermanent must be true or false");
  if (!Number.isInteger(maxAssistants) || (maxAssistants as number) < 0 || (maxAssistants as number) > WORKFORCE_LIMITS.maxAssistants) errors.push(`profile.maxAssistants must be 0-${WORKFORCE_LIMITS.maxAssistants}`);
  return checked(errors, () => ({
    title: title as string,
    duties: duties as string,
    instructions: instructions as string,
    skills: skills as string[],
    languages: languages as string[],
    knowledge: knowledge as string[],
    execution: (execution as { ok: true; value: ExecutionProfile }).value,
    handoffStandard: handoffStandard as string,
    reportingRule: reportingRule as string,
    canDelegate: v.canDelegate === true,
    maxAssistants: maxAssistants as number,
    canHirePermanent: v.canHirePermanent === true,
  }));
}

// `name: null` -- none typed: the account's company name is the company's. `departments` is what the request named (the
// service refuses any), kept so the refusal can say what it was.
export function checkSetUpOffice(body: unknown): Checked<{ name: string | null; departments: string[] }> {
  if (body === undefined || body === null) return { ok: true, value: { name: null, departments: [] } };
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "departments"]);
  const name = body.name === undefined ? undefined : line(body.name, WORKFORCE_LIMITS.nameLength);
  const departments = body.departments === undefined ? [] : lines(body.departments, 12, WORKFORCE_LIMITS.nameLength);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (departments === null) errors.push("departments must be a list of names");
  return checked(errors, () => ({ name: name ?? null, departments: [...new Set(departments as string[])] }));
}

export function checkCreateDepartment(body: unknown): Checked<CreateDepartmentRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name"]);
  const name = line(body.name, WORKFORCE_LIMITS.nameLength);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  return checked(errors, () => ({ name: name as string }));
}

export function checkUpdateDepartment(body: unknown): Checked<UpdateDepartmentRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "position", "defaults"]);
  const name = body.name === undefined ? undefined : line(body.name, WORKFORCE_LIMITS.nameLength);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (body.position !== undefined && (!Number.isInteger(body.position) || (body.position as number) < 0 || (body.position as number) > 999)) errors.push("position must be 0-999");
  const defaults = body.defaults === undefined ? undefined : checkExecutionDefaults(body.defaults);
  if (defaults !== undefined && !defaults.ok) errors.push(...defaults.errors);
  if (body.name === undefined && body.position === undefined && body.defaults === undefined) errors.push("nothing to change: send name, position or defaults");
  return checked(errors, () => ({
    ...(name !== undefined ? { name: name as string } : {}),
    ...(body.position !== undefined ? { position: body.position as number } : {}),
    ...(defaults !== undefined && defaults.ok ? { defaults: defaults.value } : {}),
  }));
}

export function checkArchiveDepartment(body: unknown): Checked<ArchiveDepartmentRequest> {
  if (body === undefined || body === null) return { ok: true, value: {} };
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["moveTo"]);
  if (body.moveTo !== undefined && body.moveTo !== null && !isWorkforceId(body.moveTo)) errors.push("moveTo must be a department id, or null for Unassigned");
  return checked(errors, () => (body.moveTo !== undefined ? { moveTo: body.moveTo as string | null } : {}));
}

const optionalId = (v: unknown): boolean => v === undefined || v === null || isWorkforceId(v);

export function checkHireEmployee(body: unknown): Checked<HireEmployeeRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "departmentId", "managerId", "templateId", "profile", "resources", "skipProbation", "skipReason", "appointRole", "appointReason"]);
  const resources = checkResourceProfile(body.resources);
  if (!resources.ok) errors.push(...resources.errors);
  const name = line(body.name, WORKFORCE_LIMITS.nameLength);
  const profile = checkEmployeeProfile(body.profile);
  const skipReason = body.skipReason === undefined ? "" : text(body.skipReason, WORKFORCE_LIMITS.noteLength, true);
  const appointReason = body.appointReason === undefined ? "" : text(body.appointReason, WORKFORCE_LIMITS.noteLength, true);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (!optionalId(body.departmentId)) errors.push("departmentId must be an id or null");
  if (!optionalId(body.managerId)) errors.push("managerId must be an id or null");
  if (body.templateId !== undefined && body.templateId !== null && line(body.templateId, 80) === null) errors.push("templateId must be a template's id");
  if (!profile.ok) errors.push(...profile.errors);
  if (body.skipProbation !== undefined && typeof body.skipProbation !== "boolean") errors.push("skipProbation must be true or false");
  if (skipReason === null) errors.push("skipReason is too long");
  if (body.skipProbation === true && (skipReason ?? "").length === 0) errors.push("skipReason says why the trial is skipped: it is recorded with the decision");
  if (body.appointRole !== undefined && body.appointRole !== null && body.appointRole !== "ceo") errors.push("appointRole must be ceo or null");
  if (appointReason === null) errors.push("appointReason is too long");
  if (body.appointRole === "ceo" && body.departmentId !== undefined && body.departmentId !== null) errors.push("the CEO belongs to no department: departmentId must be null when appointRole is ceo");
  if (body.appointRole !== "ceo" && (appointReason ?? "").length > 0) errors.push("appointReason applies only when appointRole is ceo");
  return checked(errors, () => ({
    name: name as string,
    departmentId: (body.departmentId as string | null | undefined) ?? null,
    managerId: (body.managerId as string | null | undefined) ?? null,
    templateId: (body.templateId as string | null | undefined) ?? null,
    profile: (profile as { ok: true; value: EmployeeProfile }).value,
    resources: (resources as { ok: true; value: ResourceProfile }).value,
    skipProbation: body.skipProbation === true,
    skipReason: skipReason as string,
    ...(body.appointRole === "ceo" ? { appointRole: "ceo" as const, ...(appointReason ? { appointReason } : {}) } : {}),
  }));
}

export function checkUpdateEmployee(body: unknown): Checked<UpdateEmployeeRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "managerId", "profile", "note", "basedOn"]);
  const name = body.name === undefined ? undefined : line(body.name, WORKFORCE_LIMITS.nameLength);
  const profile = body.profile === undefined ? undefined : checkEmployeeProfile(body.profile);
  const note = body.note === undefined ? "" : text(body.note, WORKFORCE_LIMITS.noteLength, true);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (body.managerId !== undefined && !optionalId(body.managerId)) errors.push("managerId must be an id or null");
  if (profile !== undefined && !profile.ok) errors.push(...profile.errors);
  if (note === null) errors.push("note is too long");
  if (body.basedOn !== undefined && (!Number.isInteger(body.basedOn) || (body.basedOn as number) < 1)) errors.push("basedOn must be a profile revision");
  if (body.name === undefined && body.managerId === undefined && body.profile === undefined) errors.push("nothing to change: send name, managerId or profile");
  return checked(errors, () => ({
    ...(name !== undefined ? { name: name as string } : {}),
    ...(body.managerId !== undefined ? { managerId: body.managerId as string | null } : {}),
    ...(profile !== undefined ? { profile: (profile as { ok: true; value: EmployeeProfile }).value } : {}),
    note: note as string,
    ...(body.basedOn !== undefined ? { basedOn: body.basedOn as number } : {}),
  }));
}

export function checkMoveEmployee(body: unknown): Checked<MoveEmployeeRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["departmentId"]);
  if (body.departmentId !== null && !isWorkforceId(body.departmentId)) errors.push("departmentId must be a department id, or null for Unassigned");
  return checked(errors, () => ({ departmentId: body.departmentId as string | null }));
}

export function checkUpdateResources(body: unknown): Checked<Required<UpdateResourcesRequest>> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["resources", "note"]);
  const resources = checkResourceProfile(body.resources);
  const note = body.note === undefined ? "" : text(body.note, WORKFORCE_LIMITS.noteLength, true);
  if (!resources.ok) errors.push(...resources.errors);
  if (note === null) errors.push("note is too long");
  return checked(errors, () => ({ resources: (resources as { ok: true; value: ResourceProfile }).value, note: note as string }));
}

export function checkEmployment(body: unknown): Checked<EmploymentRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["command", "reason", "held"]);
  const reason = body.reason === undefined ? "" : text(body.reason, WORKFORCE_LIMITS.noteLength, true);
  if (!(EMPLOYMENT_COMMANDS as readonly unknown[]).includes(body.command)) errors.push(`command must be one of ${EMPLOYMENT_COMMANDS.join(", ")}`);
  if (reason === null) errors.push("reason is too long");
  if (body.held !== undefined && body.held !== "keep_paused" && body.held !== "cancel") errors.push("held must be keep_paused or cancel");
  return checked(errors, () => ({ command: body.command as EmploymentCommand, reason: reason as string, ...(body.held !== undefined ? { held: body.held as "keep_paused" | "cancel" } : {}) }));
}

export function checkHireAssistant(body: unknown): Checked<HireAssistantRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "title", "duties", "skills", "languages"]);
  const name = line(body.name, WORKFORCE_LIMITS.nameLength);
  const title = line(body.title, WORKFORCE_LIMITS.titleLength);
  const duties = text(body.duties ?? "", WORKFORCE_LIMITS.textLength, true);
  const skills = lines(body.skills ?? [], WORKFORCE_LIMITS.listItems, WORKFORCE_LIMITS.itemLength);
  const languages = lines(body.languages ?? [], WORKFORCE_LIMITS.listItems, 40);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (title === null) errors.push(`title must be 1-${WORKFORCE_LIMITS.titleLength} printable characters`);
  if (duties === null) errors.push("duties is too long");
  if (skills === null) errors.push("skills must be a short list of short lines");
  if (languages === null) errors.push("languages must be a short list of short lines");
  return checked(errors, () => ({ name: name as string, title: title as string, duties: duties as string, skills: skills as string[], languages: languages as string[] }));
}

function deliverablesOf(v: unknown, errors: string[]): Deliverable[] {
  if (!Array.isArray(v) || v.length > WORKFORCE_LIMITS.deliverables) {
    errors.push(`deliverables must be a list of at most ${WORKFORCE_LIMITS.deliverables} { name, required }`);
    return [];
  }
  const out: Deliverable[] = [];
  for (const d of v) {
    if (!isRecord(d) || !isDeliverableName(d.name) || (d.required !== undefined && typeof d.required !== "boolean")) errors.push("each deliverable is { name: a plain file name, required: true or false }");
    else out.push({ name: d.name, required: d.required !== false });
  }
  if (new Set(out.map((d) => d.name.toLowerCase())).size !== out.length) errors.push("two deliverables share a name");
  return out;
}

const isInstant = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

// A branch's name as git takes it: no leading dash, no "..", nothing a ref may not hold.
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*[\u0000-\u0020~^:?*[\\\u007f])(?!.*\/\/)(?!.*\.lock$)[^/][\s\S]{0,199}$/;
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const REPO_ID = /^[^\u0000-\u001f\u007f]{1,300}$/;

function repositoriesOf(v: unknown): MissionRepositoryRequest[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_MISSION_REPOSITORIES) return null;
  const out: MissionRepositoryRequest[] = [];
  for (const r of v) {
    if (!isRecord(r) || Object.keys(r).some((k) => !["source", "id", "branch"].includes(k))) return null;
    if ((r.source !== "github" && r.source !== "azure") || typeof r.id !== "string" || !REPO_ID.test(r.id)) return null;
    const branch = r.branch === undefined || r.branch === null ? null : typeof r.branch === "string" && BRANCH.test(r.branch) && !r.branch.endsWith("/") ? r.branch : undefined;
    if (branch === undefined || out.some((o) => o.source === r.source && o.id === r.id)) return null;
    out.push({ source: r.source, id: r.id, branch });
  }
  return out;
}

// The target a mission names: `target`, or the legacy `targetEmployeeId` (both: they must agree -- target_conflict).
function targetOf(t: unknown, legacy: unknown, errors: string[]): MissionTarget | null {
  if (t === undefined) {
    if (legacy === undefined) errors.push("target must name who the mission is given to: an employee, a department or the CEO");
    else if (!isWorkforceId(legacy)) errors.push("targetEmployeeId must be an employee's id");
    return isWorkforceId(legacy) ? { kind: "employee", employeeId: legacy } : null;
  }
  if (!isRecord(t) || !(MISSION_TARGET_KINDS as readonly unknown[]).includes(t.kind)) {
    errors.push(`target.kind must be one of ${MISSION_TARGET_KINDS.join(", ")}`);
    return null;
  }
  const keys = t.kind === "employee" ? ["kind", "employeeId"] : t.kind === "department" ? ["kind", "departmentId"] : ["kind"];
  if (Object.keys(t).some((k) => !keys.includes(k))) errors.push(`target of kind ${String(t.kind)} names only ${keys.join(", ")}`);
  if (t.kind === "employee" && !isWorkforceId(t.employeeId)) errors.push("target.employeeId must be an employee's id");
  if (t.kind === "department" && !isWorkforceId(t.departmentId)) errors.push("target.departmentId must be a department's id");
  const target: MissionTarget = t.kind === "employee" ? { kind: "employee", employeeId: t.employeeId as string } : t.kind === "department" ? { kind: "department", departmentId: t.departmentId as string } : { kind: "ceo" };
  if (legacy !== undefined && (target.kind !== "employee" || legacy !== target.employeeId)) errors.push("target_conflict: targetEmployeeId and target name different employees");
  return target;
}

function expectedOf(v: unknown, errors: string[]): ExpectedAssignee | null {
  if (!isRecord(v) || !isWorkforceId(v.employeeId) || !(v.appointmentId === null || isWorkforceId(v.appointmentId)) || !(v.appointmentRevision === null || (Number.isInteger(v.appointmentRevision) && (v.appointmentRevision as number) >= 1))) {
    errors.push("expectedAssignee must be { employeeId, appointmentId (or null), appointmentRevision (or null) }");
    return null;
  }
  return { employeeId: v.employeeId, appointmentId: v.appointmentId as string | null, appointmentRevision: v.appointmentRevision as number | null };
}

export function checkCreateMission(body: unknown): Checked<Required<Omit<CreateMissionRequest, "title" | "execution" | "expectedAssignee">> & Pick<CreateMissionRequest, "execution" | "expectedAssignee"> & { title: string }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["goal", "title", "target", "expectedAssignee", "targetEmployeeId", "whenBusy", "workspaceId", "sourceRevisionIds", "repositories", "deliverables", "acceptanceCriteria", "acceptanceMode", "deadline", "priority", "execution"]);
  const target = targetOf(body.target, body.targetEmployeeId, errors);
  const expected = body.expectedAssignee === undefined ? undefined : expectedOf(body.expectedAssignee, errors);
  const goal = text(body.goal, WORKFORCE_LIMITS.goalLength);
  const title = body.title === undefined ? null : line(body.title, WORKFORCE_LIMITS.titleLength);
  const criteria = lines(body.acceptanceCriteria ?? [], WORKFORCE_LIMITS.listItems, WORKFORCE_LIMITS.itemLength);
  const deliverables = deliverablesOf(body.deliverables ?? [], errors);
  const sources = body.sourceRevisionIds ?? [];
  const repositories = repositoriesOf(body.repositories);
  if (repositories === null) errors.push(`repositories must be at most ${MAX_MISSION_REPOSITORIES} repositories, each named once: { source: github or azure, id, branch? }`);
  const execution = body.execution;
  if (goal === null) errors.push(`goal must be 1-${WORKFORCE_LIMITS.goalLength} characters`);
  if (body.title !== undefined && title === null) errors.push(`title must be 1-${WORKFORCE_LIMITS.titleLength} printable characters`);

  if (body.whenBusy !== undefined && !(WHEN_BUSY as readonly unknown[]).includes(body.whenBusy)) errors.push(`whenBusy must be one of ${WHEN_BUSY.join(", ")}`);
  if (!optionalId(body.workspaceId)) errors.push("workspaceId must be a research workspace id or null");
  if (!Array.isArray(sources) || sources.length > WORKFORCE_LIMITS.sources || !sources.every(isWorkforceId)) errors.push(`sourceRevisionIds must be at most ${WORKFORCE_LIMITS.sources} revision ids`);
  else if (sources.length > 0 && (body.workspaceId === undefined || body.workspaceId === null)) errors.push("sourceRevisionIds needs the workspaceId they belong to");
  if (criteria === null) errors.push("acceptanceCriteria must be a short list of short lines");
  if (body.acceptanceMode !== undefined && !(ACCEPTANCE_MODES as readonly unknown[]).includes(body.acceptanceMode)) errors.push(`acceptanceMode must be one of ${ACCEPTANCE_MODES.join(", ")}`);
  if (body.deadline !== undefined && body.deadline !== null && !isInstant(body.deadline)) errors.push("deadline must be an ISO time or null");
  if (body.priority !== undefined && (!Number.isInteger(body.priority) || (body.priority as number) < 0 || (body.priority as number) > 9)) errors.push("priority must be 0-9");
  if (execution !== undefined) {
    if (!isRecord(execution) || Object.keys(execution).some((k) => k !== "model" && k !== "effort")) errors.push("execution may override model and effort only");
    else {
      if (execution.model !== undefined && (typeof execution.model !== "string" || !MODEL_SHAPE.test(execution.model))) errors.push("execution.model must be a model the runtime names");
      if (execution.effort !== undefined && execution.effort !== null && (typeof execution.effort !== "string" || !EFFORT_SHAPE.test(execution.effort))) errors.push("execution.effort must be an effort level the runtime names, or null");
    }
  }
  return checked(errors, () => ({
    goal: goal as string,
    title: title ?? (goal as string).split("\n")[0]!.slice(0, WORKFORCE_LIMITS.titleLength),
    target: target as MissionTarget,
    targetEmployeeId: (target as MissionTarget).kind === "employee" ? (target as { employeeId: string }).employeeId : "",
    ...(expected !== undefined && expected !== null ? { expectedAssignee: expected } : {}),
    whenBusy: (body.whenBusy as WhenBusy | undefined) ?? "reject",
    workspaceId: (body.workspaceId as string | null | undefined) ?? null,
    sourceRevisionIds: [...new Set(sources as string[])],
    repositories: repositories ?? [],
    deliverables,
    acceptanceCriteria: criteria as string[],
    acceptanceMode: (body.acceptanceMode as AcceptanceMode | undefined) ?? "owner_review",
    deadline: body.deadline === undefined || body.deadline === null ? null : new Date(body.deadline as string).toISOString(),
    priority: (body.priority as number | undefined) ?? 5,
    ...(execution !== undefined ? { execution: execution as { model?: string; effort?: string | null } } : {}),
  }));
}

const DIGEST = /^[0-9a-f]{64}$/;

export function checkRequestRevision(body: unknown): Checked<RequestRevisionRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["handoffDigest", "criteria"]);
  const criteria = text(body.criteria, WORKFORCE_LIMITS.textLength);
  if (typeof body.handoffDigest !== "string" || !DIGEST.test(body.handoffDigest)) errors.push("handoffDigest must be the digest of the handoff being reviewed");
  if (criteria === null) errors.push("criteria says what must change");
  return checked(errors, () => ({ handoffDigest: body.handoffDigest as string, criteria: criteria as string }));
}

export function checkAccept(body: unknown): Checked<Required<AcceptRequest>> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["handoffDigest", "note"]);
  const note = body.note === undefined ? "" : text(body.note, WORKFORCE_LIMITS.noteLength, true);
  if (typeof body.handoffDigest !== "string" || !DIGEST.test(body.handoffDigest)) errors.push("handoffDigest must be the digest of the handoff being accepted");
  if (note === null) errors.push("note is too long");
  return checked(errors, () => ({ handoffDigest: body.handoffDigest as string, note: note as string }));
}

export function checkReason(body: unknown): Checked<Required<ReasonRequest>> {
  if (body === undefined || body === null) return { ok: true, value: { reason: "" } };
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["reason"]);
  const reason = body.reason === undefined ? "" : text(body.reason, WORKFORCE_LIMITS.noteLength, true);
  if (reason === null) errors.push("reason is too long");
  return checked(errors, () => ({ reason: reason as string }));
}

export function checkAnswer(body: unknown): Checked<AnswerRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["answer"]);
  const answer = text(body.answer, WORKFORCE_LIMITS.textLength);
  if (answer === null) errors.push("answer must say something");
  return checked(errors, () => ({ answer: answer as string }));
}


const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// An IANA zone NAME ("Asia/Ho_Chi_Minh", "UTC", "Etc/GMT-7"), never a UTC offset ("+07:00"): an offset is no zone, and
// PostgreSQL reads one with the POSIX sign (east becomes west).
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;

export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 64 || !ZONE_NAME.test(v)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

export function checkScheduleRule(v: unknown): Checked<ScheduleRule> {
  if (!isRecord(v)) return { ok: false, errors: ["rule must be an object"] };
  const errors = unknownFields(v, ["kind", "timezone", "localTime", "dayOfWeek", "dayOfMonth", "period"]).map((e) => `rule.${e}`);
  if (!(SCHEDULE_KINDS as readonly unknown[]).includes(v.kind)) errors.push(`rule.kind must be one of ${SCHEDULE_KINDS.join(", ")}`);
  if (!isTimeZone(v.timezone)) errors.push("rule.timezone must be an IANA time zone (Asia/Ho_Chi_Minh)");
  if (typeof v.localTime !== "string" || !LOCAL_TIME.test(v.localTime)) errors.push("rule.localTime must be HH:MM");
  if (v.kind === "weekly" && (!Number.isInteger(v.dayOfWeek) || (v.dayOfWeek as number) < 1 || (v.dayOfWeek as number) > 7)) errors.push("rule.dayOfWeek must be 1 (Monday) to 7");
  if ((v.kind === "monthly" || v.kind === "quarterly") && v.dayOfMonth !== undefined && (!Number.isInteger(v.dayOfMonth) || (v.dayOfMonth as number) < 1 || (v.dayOfMonth as number) > 28)) errors.push("rule.dayOfMonth must be 1-28");
  if (v.period !== undefined && v.period !== "previous" && v.period !== "current") errors.push("rule.period must be previous or current");
  return checked(errors, () => ({
    kind: v.kind as ScheduleKind,
    timezone: v.timezone as string,
    localTime: v.localTime as string,
    ...(v.kind === "weekly" ? { dayOfWeek: v.dayOfWeek as number } : {}),
    ...(v.kind === "monthly" || v.kind === "quarterly" ? { dayOfMonth: (v.dayOfMonth as number | undefined) ?? 1 } : {}),
    period: (v.period as "previous" | "current" | undefined) ?? "previous",
  }));
}

const ADDRESS = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function recipientsOf(v: unknown, errors: string[]): ScheduleRecipient[] {
  if (!Array.isArray(v) || v.length > 10) {
    errors.push("recipients must be a list of at most 10 { address, channel }");
    return [];
  }
  const out: ScheduleRecipient[] = [];
  for (const r of v) {
    const address = isRecord(r) && typeof r.address === "string" ? r.address.trim().toLowerCase() : "";
    if (!isRecord(r) || !ADDRESS.test(address) || !(DELIVERY_CHANNELS as readonly unknown[]).includes(r.channel)) errors.push(`each recipient is { address: an email, channel: ${DELIVERY_CHANNELS.join(" | ")} }`);
    else out.push({ address, channel: r.channel as DeliveryChannel });
  }
  return out;
}

export function checkCreateSchedule(body: unknown): Checked<Required<CreateScheduleRequest>> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "rule", "employeeId", "mission", "recipients", "missedPolicy", "catchUpLimit"]);
  const name = line(body.name, WORKFORCE_LIMITS.nameLength);
  const rule = checkScheduleRule(body.rule);
  const mission = isRecord(body.mission) ? body.mission : {};
  const goal = text(mission.goal, WORKFORCE_LIMITS.goalLength);
  const criteria = lines(mission.acceptanceCriteria ?? [], WORKFORCE_LIMITS.listItems, WORKFORCE_LIMITS.itemLength);
  const deliverables = deliverablesOf(mission.deliverables ?? [], errors);
  const sources = mission.sourceRevisionIds ?? [];
  const recipients = recipientsOf(body.recipients ?? [], errors);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (!rule.ok) errors.push(...rule.errors);
  if (!isWorkforceId(body.employeeId)) errors.push("employeeId must be an employee's id");
  if (goal === null) errors.push("mission.goal says what each period's work is");
  if (criteria === null) errors.push("mission.acceptanceCriteria must be a short list of short lines");
  if (!optionalId(mission.workspaceId)) errors.push("mission.workspaceId must be a research workspace id or null");
  if (!Array.isArray(sources) || !sources.every(isWorkforceId) || sources.length > WORKFORCE_LIMITS.sources) errors.push("mission.sourceRevisionIds must be revision ids");
  else if (sources.length > 0 && (mission.workspaceId === undefined || mission.workspaceId === null)) errors.push("mission.sourceRevisionIds needs the workspaceId they belong to");
  if (body.missedPolicy !== undefined && !(MISSED_POLICIES as readonly unknown[]).includes(body.missedPolicy)) errors.push(`missedPolicy must be one of ${MISSED_POLICIES.join(", ")}`);
  if (body.catchUpLimit !== undefined && (!Number.isInteger(body.catchUpLimit) || (body.catchUpLimit as number) < 1 || (body.catchUpLimit as number) > 8)) errors.push("catchUpLimit must be 1-8");
  return checked(errors, () => ({
    name: name as string,
    rule: (rule as { ok: true; value: ScheduleRule }).value,
    employeeId: body.employeeId as string,
    mission: { goal: goal as string, deliverables, acceptanceCriteria: criteria as string[], workspaceId: (mission.workspaceId as string | null | undefined) ?? null, sourceRevisionIds: [...new Set(sources as string[])] },
    recipients,
    missedPolicy: (body.missedPolicy as MissedPolicy | undefined) ?? "catch_up_each",
    catchUpLimit: (body.catchUpLimit as number | undefined) ?? 4,
  }));
}

export function checkUpdateSchedule(body: unknown): Checked<UpdateScheduleRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const fields = ["name", "rule", "employeeId", "recipients", "missedPolicy", "catchUpLimit", "state"];
  const errors = unknownFields(body, fields);
  const name = body.name === undefined ? undefined : line(body.name, WORKFORCE_LIMITS.nameLength);
  const rule = body.rule === undefined ? undefined : checkScheduleRule(body.rule);
  const recipients = body.recipients === undefined ? undefined : recipientsOf(body.recipients, errors);
  if (fields.every((f) => body[f] === undefined)) errors.push("nothing to change");
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (rule !== undefined && !rule.ok) errors.push(...rule.errors);
  if (body.employeeId !== undefined && !isWorkforceId(body.employeeId)) errors.push("employeeId must be an employee's id");
  if (body.missedPolicy !== undefined && !(MISSED_POLICIES as readonly unknown[]).includes(body.missedPolicy)) errors.push(`missedPolicy must be one of ${MISSED_POLICIES.join(", ")}`);
  if (body.catchUpLimit !== undefined && (!Number.isInteger(body.catchUpLimit) || (body.catchUpLimit as number) < 1 || (body.catchUpLimit as number) > 8)) errors.push("catchUpLimit must be 1-8");
  if (body.state !== undefined && body.state !== "active" && body.state !== "paused") errors.push("state must be active or paused");
  return checked(errors, () => ({
    ...(name !== undefined ? { name: name as string } : {}),
    ...(rule !== undefined ? { rule: (rule as { ok: true; value: ScheduleRule }).value } : {}),
    ...(body.employeeId !== undefined ? { employeeId: body.employeeId as string } : {}),
    ...(recipients !== undefined ? { recipients } : {}),
    ...(body.missedPolicy !== undefined ? { missedPolicy: body.missedPolicy as MissedPolicy } : {}),
    ...(body.catchUpLimit !== undefined ? { catchUpLimit: body.catchUpLimit as number } : {}),
    ...(body.state !== undefined ? { state: body.state as "active" | "paused" } : {}),
  }));
}

export function checkResolveDelivery(body: unknown): Checked<ResolveDeliveryRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["outcome", "reason"]);
  const reason = text(body.reason, WORKFORCE_LIMITS.noteLength);
  if (body.outcome !== "delivered" && body.outcome !== "resend") errors.push("outcome must be delivered or resend");
  if (reason === null) errors.push("reason says how this is known: it is recorded");
  return checked(errors, () => ({ outcome: body.outcome as "delivered" | "resend", reason: reason as string }));
}

// `If-Match: "7"` (or 7): the version a change was made against. Null: absent or not a version.
export function versionOf(header: unknown): number | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") return null;
  const m = /^(?:W\/)?"?(\d{1,12})"?$/.exec(raw.trim());
  return m ? Number(m[1]) : null;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export const isIdempotencyKey = (v: unknown): v is string => typeof v === "string" && IDEMPOTENCY_KEY.test(v);

// ---- the organization: appointments, delegation grants, execution defaults --------------------------------------------

// AN APPOINTMENT is the company's authority -- its CEO, a department's MANAGER -- held by an existing employee, never a
// title, instructions or a profile switch (canDelegate grants nothing). At most one INCUMBENT (active or suspended) per
// slot and per employee; a manager is a member of its department. Each slot's appointments are numbered (`slotRevision`)
// so a mission given "to the Research department" names the appointment it was resolved to. An appointment that ended
// (revoked, or replaced by the next) is history: who held it, when, and why it ended.
export const APPOINTMENT_ROLES = ["ceo", "manager"] as const;
export type AppointmentRole = (typeof APPOINTMENT_ROLES)[number];
export const APPOINTMENT_STATES = ["active", "suspended", "revoked", "replaced"] as const;
export type AppointmentState = (typeof APPOINTMENT_STATES)[number];
export const isIncumbent = (s: AppointmentState): boolean => s === "active" || s === "suspended";

export interface AppointmentView {
  id: string;
  role: AppointmentRole;
  // The manager's department (null for the CEO).
  departmentId: string | null;
  departmentName: string | null;
  employeeId: string;
  employeeName: string;
  state: AppointmentState;
  slotRevision: number;
  // The appointment this one replaced, when it did.
  replaces: string | null;
  reason: string;
  appointedBy: string;
  appointedAt: string;
  endedBy: string | null;
  endedAt: string | null;
  endReason: string | null;
  version: number;
}

// GET /api/office/appointments: the incumbents, then every appointment newest first.
export interface AppointmentsView {
  ceo: AppointmentView | null;
  managers: AppointmentView[];
  history: AppointmentView[];
  asOf: string;
}

// POST /api/office/appointments (a slot with no incumbent: 409 appointment_conflict otherwise -- replace it).
export interface AppointRequest {
  role: AppointmentRole;
  departmentId?: string;
  employeeId: string;
  reason?: string;
}

// POST /api/office/appointments/:id/replace (If-Match the appointment's version): the incumbent ends `replaced` and the
// new one starts, in one transaction. Open work the replaced one holds stays with it until it is handed over.
export interface ReplaceAppointmentRequest {
  employeeId: string;
  reason?: string;
}

// POST /api/office/appointments/:id/{suspend,reinstate,revoke} (If-Match).
export interface AppointmentChangeRequest {
  reason?: string;
}

export function checkAppoint(body: unknown): Checked<{ role: AppointmentRole; departmentId: string | null; employeeId: string; reason: string }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["role", "departmentId", "employeeId", "reason"]);
  if (!(APPOINTMENT_ROLES as readonly unknown[]).includes(body.role)) errors.push(`role must be one of ${APPOINTMENT_ROLES.join(", ")}`);
  if (body.role === "manager" && !isWorkforceId(body.departmentId)) errors.push("a manager's departmentId must be the department's id");
  if (body.role === "ceo" && body.departmentId !== undefined && body.departmentId !== null) errors.push("a CEO has no department");
  if (!isWorkforceId(body.employeeId)) errors.push("employeeId must be an employee's id");
  const reason = body.reason === undefined ? "" : text(body.reason, 1000, true);
  if (reason === null) errors.push("reason must be at most 1000 printable characters");
  return checked(errors, () => ({ role: body.role as AppointmentRole, departmentId: body.role === "manager" ? (body.departmentId as string) : null, employeeId: body.employeeId as string, reason: reason as string }));
}

export function checkReplaceAppointment(body: unknown): Checked<{ employeeId: string; reason: string }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["employeeId", "reason"]);
  if (!isWorkforceId(body.employeeId)) errors.push("employeeId must be an employee's id");
  const reason = body.reason === undefined ? "" : text(body.reason, 1000, true);
  if (reason === null) errors.push("reason must be at most 1000 printable characters");
  return checked(errors, () => ({ employeeId: body.employeeId as string, reason: reason as string }));
}

export function checkAppointmentChange(body: unknown): Checked<{ reason: string }> {
  if (body === undefined || body === null) return { ok: true, value: { reason: "" } };
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["reason"]);
  const reason = body.reason === undefined ? "" : text(body.reason, 1000, true);
  if (reason === null) errors.push("reason must be at most 1000 printable characters");
  return checked(errors, () => ({ reason: reason as string }));
}

// A DELEGATION GRANT: what lets an employee who holds no appointment give work to colleagues -- named employees, or a
// department's members -- made by a person (office.roster.manage), revoked by a new row's state, never silently.
export type DelegationTarget = { kind: "employee"; employeeId: string } | { kind: "department"; departmentId: string };

export interface DelegationGrantView {
  id: string;
  employeeId: string;
  target: DelegationTarget & { name: string };
  state: "active" | "revoked";
  note: string;
  grantedBy: string;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  version: number;
}

export interface GrantDelegationRequest {
  target: DelegationTarget;
  note?: string;
}

export function checkGrantDelegation(body: unknown): Checked<{ target: DelegationTarget; note: string }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["target", "note"]);
  const t = body.target;
  let target: DelegationTarget | null = null;
  if (isRecord(t) && t.kind === "employee" && isWorkforceId(t.employeeId) && Object.keys(t).length === 2) target = { kind: "employee", employeeId: t.employeeId };
  else if (isRecord(t) && t.kind === "department" && isWorkforceId(t.departmentId) && Object.keys(t).length === 2) target = { kind: "department", departmentId: t.departmentId };
  if (target === null) errors.push('target must be {"kind":"employee","employeeId":…} or {"kind":"department","departmentId":…}');
  const note = body.note === undefined ? "" : text(body.note, 500, true);
  if (note === null) errors.push("note must be at most 500 printable characters");
  return checked(errors, () => ({ target: target as DelegationTarget, note: note as string }));
}

// EXECUTION DEFAULTS: what a department -- else the company -- chooses for an employee of a runtime that leaves a field to
// it (ExecutionProfile.inherit). A default of another runtime never applies: nothing here switches an employee's
// provider. Precedence, field by field: the mission's own override > the employee's profile > its department's default
// > the company's default.
export const INHERITABLE_FIELDS = ["connection", "model", "effort"] as const;
export type InheritableField = (typeof INHERITABLE_FIELDS)[number];

export interface ExecutionDefault {
  connectionId?: string | null;
  model?: string;
  effort?: string | null;
}

export type ExecutionDefaults = Partial<Record<RuntimeKind, ExecutionDefault>>;

// Which layer gave each field of a pinned execution.
export const EXECUTION_LAYERS = ["mission", "employee", "department", "company", "runtime"] as const;
export type ExecutionLayer = (typeof EXECUTION_LAYERS)[number];
export type ExecutionSources = Record<InheritableField, ExecutionLayer>;

export function checkExecutionDefaults(v: unknown): Checked<ExecutionDefaults> {
  if (!isRecord(v)) return { ok: false, errors: ["defaults must be an object"] };
  const errors = unknownFields(v, [...RUNTIME_KINDS]);
  const out: ExecutionDefaults = {};
  for (const runtime of RUNTIME_KINDS) {
    const d = v[runtime];
    if (d === undefined) continue;
    if (!isRecord(d)) {
      errors.push(`defaults.${runtime} must be an object`);
      continue;
    }
    errors.push(...unknownFields(d, ["connectionId", "model", "effort"]).map((e) => `defaults.${runtime}.${e}`));
    if (d.connectionId !== undefined && d.connectionId !== null && !isWorkforceId(d.connectionId)) errors.push(`defaults.${runtime}.connectionId must be an id`);
    if (d.model !== undefined && (typeof d.model !== "string" || !MODEL_SHAPE.test(d.model))) errors.push(`defaults.${runtime}.model must be a model the runtime names`);
    if (d.effort !== undefined && d.effort !== null && (typeof d.effort !== "string" || !EFFORT_SHAPE.test(d.effort))) errors.push(`defaults.${runtime}.effort must be an effort level, or null`);
    out[runtime] = {
      ...(d.connectionId !== undefined ? { connectionId: d.connectionId as string | null } : {}),
      ...(d.model !== undefined ? { model: d.model as string } : {}),
      ...(d.effort !== undefined ? { effort: d.effort as string | null } : {}),
    };
  }
  return checked(errors, () => out);
}

// PATCH /api/office/defaults (If-Match the office's version).
export interface UpdateOfficeDefaultsRequest {
  defaults: ExecutionDefaults;
}

export function checkUpdateOfficeDefaults(body: unknown): Checked<UpdateOfficeDefaultsRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["defaults"]);
  const defaults = checkExecutionDefaults(body.defaults);
  if (!defaults.ok) errors.push(...defaults.errors);
  return checked(errors, () => ({ defaults: (defaults as { ok: true; value: ExecutionDefaults }).value }));
}

// POST /api/assignments/:id/hand-over (If-Match): open work moves to another employee -- a person's act, never a side
// effect of a replaced appointment.
export interface HandOverRequest {
  employeeId: string;
  reason?: string;
}

export function checkHandOver(body: unknown): Checked<{ employeeId: string; reason: string }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["employeeId", "reason"]);
  if (!isWorkforceId(body.employeeId)) errors.push("employeeId must be an employee's id");
  const reason = body.reason === undefined ? "" : text(body.reason, 1000, true);
  if (reason === null) errors.push("reason must be at most 1000 printable characters");
  return checked(errors, () => ({ employeeId: body.employeeId as string, reason: reason as string }));
}
