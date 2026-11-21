// THE VIRTUAL OFFICE (Orbit Web 0.8.0, ADR 0067): an account's office, its departments and AI employees, the missions
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
import { checkResourceProfile, type ResourceEvidence, type ResourceProfile, type ResourceRevisionView, type SandboxView, type UsageView } from "./resources.js";

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
  delegationDepth: 3,
  reworkLimit: 5,
  replanLimit: 3,
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
}

export interface Department {
  id: string;
  name: string;
  position: number;
  archived: boolean;
  version: number;
  // Members not archived (the viewer's scope).
  members: number;
}

export const EMPLOYMENT_STATES = ["candidate", "probation", "active", "suspended", "archived"] as const;
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
}

export interface Roster {
  // Null: the account has no office yet (the page shows how to set one up).
  office: Office | null;
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

export interface SetUpOfficeRequest {
  name?: string;
  // Example departments to start with (skippable): names only.
  departments?: string[];
}

export interface CreateDepartmentRequest {
  name: string;
}

export interface UpdateDepartmentRequest {
  name?: string;
  position?: number;
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

export const EMPLOYMENT_COMMANDS = ["start_probation", "activate", "reject", "suspend", "reinstate", "archive"] as const;
export type EmploymentCommand = (typeof EMPLOYMENT_COMMANDS)[number];

export interface EmploymentRequest {
  command: EmploymentCommand;
  reason?: string;
  // Suspension: what happens to the assignment held now.
  held?: "keep_paused" | "cancel";
}

export interface HireAssistantRequest {
  name: string;
  // How long the engagement lasts, and the mission it is for.
  ttlMinutes: number;
  missionId: string;
  profile: EmployeeProfile;
}

// ---- missions, assignments, handoffs ------------------------------------------------------------------------------

export const ASSIGNMENT_STATES = [
  "QUEUED",
  "ASSIGNED",
  "RUNNING",
  "DELEGATING",
  "WAITING_FOR_SUBORDINATES",
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
  DELEGATING: "Delegating",
  WAITING_FOR_SUBORDINATES: "Waiting for teammates",
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
export interface CreateMissionRequest {
  goal: string;
  title?: string;
  targetEmployeeId: string;
  whenBusy?: WhenBusy;
  // A research workspace whose sources the work may use, and the revisions it is pinned to.
  workspaceId?: string | null;
  sourceRevisionIds?: string[];
  deliverables: Deliverable[];
  acceptanceCriteria: string[];
  acceptanceMode?: AcceptanceMode;
  deadline?: string | null;
  priority?: number;
  // An override of the employee's own execution profile for this mission (model and effort only).
  execution?: { model?: string; effort?: string | null };
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
  observed: { model: string | null; effort: string | null | "unknown"; plugins: string[] | "unknown"; runtimeVersion: string | null; nativeSession: string | null };
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
  brief: { goal: string; deliverables: Deliverable[]; acceptanceCriteria: string[] };
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

export const ASSIGNMENT_ACTIONS = ["accept", "request_revision", "cancel", "pause", "resume", "answer", "retry"] as const;
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

export interface MissionDetail extends MissionSummary {
  createdBy: string;
  acceptanceMode: AcceptanceMode;
  acceptanceCriteria: string[];
  deliverables: Deliverable[];
  workspaceId: string | null;
  sourceRevisionIds: string[];
  planRevision: number;
  assignments: AssignmentView[];
  handoffs: HandoffView[];
  timeline: TimelineEntry[];
  deliveries: DeliveryView[];
  resourceVersion: number;
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

export const INBOX_KINDS = ["acceptance", "information", "external_action", "reconciliation", "delivery_channel", "unschedulable", "blocked"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_KIND_TEXT: Record<InboxKind, string> = {
  acceptance: "Review a result",
  information: "Provide information",
  external_action: "Approve an outside action",
  reconciliation: "Reconcile a run",
  delivery_channel: "Set up delivery",
  unschedulable: "Work that can never start as configured",
  blocked: "Work that is blocked",
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
  DeliveryRequested: 1,
  DeliveryReconciled: 1,
  PluginGrantChanged: 1,
  SandboxProvisionRequested: 1,
  SandboxReady: 1,
  SandboxFailed: 1,
  EmployeeResourcesRevised: 1,
  ResourcesReserved: 1,
  RunWaitingForResources: 1,
  RunUnschedulable: 1,
  ResourcesReleased: 1,
  BudgetChanged: 1,
  CapacityChanged: 1,
  ConnectionChanged: 1,
} as const;

export type IntegrationEventType = keyof typeof INTEGRATION_EVENTS;

export const isIntegrationEventType = (v: unknown): v is IntegrationEventType => typeof v === "string" && Object.hasOwn(INTEGRATION_EVENTS, v);

export interface IntegrationEvent {
  id: string;
  type: IntegrationEventType;
  schemaVersion: number;
  accountId: string;
  aggregateType: "office" | "department" | "employee" | "sandbox" | "mission" | "assignment" | "run" | "schedule" | "delivery" | "connection" | "budget";
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
  const errors = unknownFields(v, ["runtime", "connectionId", "model", "effort", "webSearch", "orbitPlugin"]);
  if (!isRuntimeKind(v.runtime)) errors.push(`execution.runtime must be one of ${RUNTIME_KINDS.join(", ")}`);
  if (v.connectionId !== undefined && v.connectionId !== null && !isWorkforceId(v.connectionId)) errors.push("execution.connectionId must be an id");
  if (typeof v.model !== "string" || !MODEL_SHAPE.test(v.model)) errors.push("execution.model must be a model the runtime names");
  if (v.effort !== undefined && v.effort !== null && (typeof v.effort !== "string" || !EFFORT_SHAPE.test(v.effort))) errors.push("execution.effort must be an effort level the runtime names, or null");
  if (v.webSearch !== undefined && typeof v.webSearch !== "boolean") errors.push("execution.webSearch must be true or false");
  if (v.orbitPlugin !== undefined && typeof v.orbitPlugin !== "boolean") errors.push("execution.orbitPlugin must be true or false");
  return checked(errors, () => ({
    runtime: v.runtime as RuntimeKind,
    connectionId: (v.connectionId as string | null | undefined) ?? null,
    model: v.model as string,
    effort: (v.effort as string | null | undefined) ?? null,
    webSearch: v.webSearch === true,
    orbitPlugin: v.orbitPlugin === true,
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

export function checkSetUpOffice(body: unknown): Checked<Required<SetUpOfficeRequest>> {
  if (body === undefined || body === null) return { ok: true, value: { name: "Office", departments: [] } };
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "departments"]);
  const name = body.name === undefined ? "Office" : line(body.name, WORKFORCE_LIMITS.nameLength);
  const departments = body.departments === undefined ? [] : lines(body.departments, 12, WORKFORCE_LIMITS.nameLength);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (departments === null) errors.push("departments must be at most 12 names");
  return checked(errors, () => ({ name: name as string, departments: [...new Set(departments as string[])] }));
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
  const errors = unknownFields(body, ["name", "position"]);
  const name = body.name === undefined ? undefined : line(body.name, WORKFORCE_LIMITS.nameLength);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (body.position !== undefined && (!Number.isInteger(body.position) || (body.position as number) < 0 || (body.position as number) > 999)) errors.push("position must be 0-999");
  if (body.name === undefined && body.position === undefined) errors.push("nothing to change: send name or position");
  return checked(errors, () => ({ ...(name !== undefined ? { name: name as string } : {}), ...(body.position !== undefined ? { position: body.position as number } : {}) }));
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
  const errors = unknownFields(body, ["name", "departmentId", "managerId", "templateId", "profile", "resources", "skipProbation", "skipReason"]);
  const resources = checkResourceProfile(body.resources);
  if (!resources.ok) errors.push(...resources.errors);
  const name = line(body.name, WORKFORCE_LIMITS.nameLength);
  const profile = checkEmployeeProfile(body.profile);
  const skipReason = body.skipReason === undefined ? "" : text(body.skipReason, WORKFORCE_LIMITS.noteLength, true);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (!optionalId(body.departmentId)) errors.push("departmentId must be an id or null");
  if (!optionalId(body.managerId)) errors.push("managerId must be an id or null");
  if (body.templateId !== undefined && body.templateId !== null && line(body.templateId, 80) === null) errors.push("templateId must be a template's id");
  if (!profile.ok) errors.push(...profile.errors);
  if (body.skipProbation !== undefined && typeof body.skipProbation !== "boolean") errors.push("skipProbation must be true or false");
  if (skipReason === null) errors.push("skipReason is too long");
  if (body.skipProbation === true && (skipReason ?? "").length === 0) errors.push("skipReason says why the trial is skipped: it is recorded with the decision");
  return checked(errors, () => ({
    name: name as string,
    departmentId: (body.departmentId as string | null | undefined) ?? null,
    managerId: (body.managerId as string | null | undefined) ?? null,
    templateId: (body.templateId as string | null | undefined) ?? null,
    profile: (profile as { ok: true; value: EmployeeProfile }).value,
    resources: (resources as { ok: true; value: ResourceProfile }).value,
    skipProbation: body.skipProbation === true,
    skipReason: skipReason as string,
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
  const errors = unknownFields(body, ["name", "ttlMinutes", "missionId", "profile"]);
  const name = line(body.name, WORKFORCE_LIMITS.nameLength);
  const profile = checkEmployeeProfile(body.profile);
  if (name === null) errors.push(`name must be 1-${WORKFORCE_LIMITS.nameLength} printable characters`);
  if (!Number.isInteger(body.ttlMinutes) || (body.ttlMinutes as number) < 1 || (body.ttlMinutes as number) > 7 * 24 * 60) errors.push("ttlMinutes must be 1 minute to 7 days");
  if (!isWorkforceId(body.missionId)) errors.push("missionId must be a mission id");
  if (!profile.ok) errors.push(...profile.errors);
  return checked(errors, () => ({ name: name as string, ttlMinutes: body.ttlMinutes as number, missionId: body.missionId as string, profile: (profile as { ok: true; value: EmployeeProfile }).value }));
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

export function checkCreateMission(body: unknown): Checked<Required<Omit<CreateMissionRequest, "title" | "execution">> & Pick<CreateMissionRequest, "execution"> & { title: string }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["goal", "title", "targetEmployeeId", "whenBusy", "workspaceId", "sourceRevisionIds", "deliverables", "acceptanceCriteria", "acceptanceMode", "deadline", "priority", "execution"]);
  const goal = text(body.goal, WORKFORCE_LIMITS.goalLength);
  const title = body.title === undefined ? null : line(body.title, WORKFORCE_LIMITS.titleLength);
  const criteria = lines(body.acceptanceCriteria ?? [], WORKFORCE_LIMITS.listItems, WORKFORCE_LIMITS.itemLength);
  const deliverables = deliverablesOf(body.deliverables ?? [], errors);
  const sources = body.sourceRevisionIds ?? [];
  const execution = body.execution;
  if (goal === null) errors.push(`goal must be 1-${WORKFORCE_LIMITS.goalLength} characters`);
  if (body.title !== undefined && title === null) errors.push(`title must be 1-${WORKFORCE_LIMITS.titleLength} printable characters`);
  if (!isWorkforceId(body.targetEmployeeId)) errors.push("targetEmployeeId must be an employee's id");
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
    targetEmployeeId: body.targetEmployeeId as string,
    whenBusy: (body.whenBusy as WhenBusy | undefined) ?? "reject",
    workspaceId: (body.workspaceId as string | null | undefined) ?? null,
    sourceRevisionIds: [...new Set(sources as string[])],
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

export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return false;
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
