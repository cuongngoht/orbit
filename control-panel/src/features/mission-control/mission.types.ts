// What control-server answers for task executions (control-server/src/mission-control/ and tasks/,
// from src/task/). Every word here is DERIVED by the engine from a task's journal -- one fold, one
// state function -- and the page only shows it. There is no field for a model's reasoning: a task
// records a decision as observed, hypothesis, next action and evidence, and nothing else.

import type { SandboxView } from "../runtime/sandbox.types";

export type Lifecycle = "QUEUED" | "PREPARING" | "EXECUTING" | "VERIFYING" | "WAITING_APPROVAL" | "PAUSED" | "BLOCKED" | "COMPLETED" | "FAILED" | "CANCELLED";

export type Stage = "REQUIREMENT" | "CONTEXT" | "ENVIRONMENT" | "WORKSPACE" | "PLANNING" | "IMPLEMENTING" | "BUILDING" | "TESTING" | "DIAGNOSING" | "FIXING" | "REGRESSION" | "REVIEWING";

export type ApprovalState = "pending" | "granted" | "rejected" | "expired" | "consumed";

export type ActionState = "running" | "succeeded" | "failed" | "abandoned" | "error" | "ended";

export type VerificationState = "satisfied" | "violated" | "not-verified" | "blocked" | "needs-requirement" | "not-applicable";

/** `receipt`: Orbit holds a receipt another domain issued. `reported`: only the agent said so. */
export type Evidence = "receipt" | "reported";

export interface AttemptSummary {
  current: string | null;
  open: boolean;
  number: number;
  count: number;
  limit: number | null;
}

export interface Spend {
  spent: number;
  limit: number | null;
}

export interface Readiness {
  state: string;
  ref: string | null;
  because?: string | null;
  at?: string | null;
  source?: "receipt" | "registry";
}

export interface TaskHead {
  id: string;
  project: string;
  checkout: string;
  objective: string;
  work: string | null;
  root: string | null;
  snapshot: string | null;
  snapshotDigest: string | null;
  baseRevision: string | null;
  workspace: string | null;
  provider: string | null;
  actor: string | null;
  host: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Decision {
  id: string;
  attempt: string | null;
  at: string;
  observed: string;
  hypothesis: string;
  nextAction: string;
  evidence: string[];
  reason: string | null;
}

export interface Attempt {
  id: string;
  number: number;
  cause: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
  failureSignature: string | null;
  actions: string[];
  files: number;
}

export interface Action {
  id: string;
  attempt: string | null;
  type: string;
  tool: string | null;
  label: string | null;
  mutates: boolean;
  approval: string | null;
  startedAt: string;
  endedAt: string | null;
  state: ActionState;
  summary: string | null;
  reason: string | null;
  receipts: string[];
  evidence: Evidence;
}

export interface ChangedPath {
  path: string;
  change: string;
  added: number;
  removed: number;
  attempts: string[];
  at: string;
}

export interface Changes {
  files: number;
  added: number;
  removed: number;
  paths: ChangedPath[];
}

export interface Receipt {
  key: string;
  domain: string;
  ref: string;
  outcome: string | null;
  summary: string | null;
  action: string | null;
  at: string;
}

export interface VerificationRow {
  subject: string | null;
  obligation: string;
  evidence: string | null;
  state: VerificationState;
  at: string;
}

export interface Approval {
  id: string;
  action: string;
  environment: string | null;
  reason: string | null;
  risk: string | null;
  attempt: string | null;
  requestedAt: string;
  expires: string | null;
  state: ApprovalState;
  open: boolean;
  decision: "granted" | "rejected" | null;
  decidedAt: string | null;
  decidedBy: string | null;
  consumedBy: string | null;
  consumedAt: string | null;
}

export interface Ended {
  kind: "completed" | "failed" | "cancelled";
  at: string;
  stop: string | null;
  summary: string | null;
  because: string | null;
  by: string | null;
}

export interface Paused {
  at: string;
  by: string | null;
  because: string | null;
}

export interface Blocked {
  at: string;
  stop: string;
  needs: string | null;
  because: string | null;
}

export interface TaskView {
  version: number;
  task: TaskHead;
  /** The journal's position: what a person's decision names, so a moved task refuses it. */
  revision: number;
  lifecycle: Lifecycle;
  terminal: boolean;
  stage: Stage | null;
  stopReason: string | null;
  attempt: AttemptSummary;
  repeats: number;
  budget: { attempts: Spend; actions: Spend; minutes: Spend };
  readiness: { requirement: Readiness; environment: Readiness; workspace: Readiness; agent: { actor: string | null; stage: Stage | null } };
  paused: Paused | null;
  blocked: Blocked | null;
  decision: Decision | null;
  decisions: Decision[];
  attempts: Attempt[];
  actions: Action[];
  changes: Changes;
  receipts: Receipt[];
  verification: VerificationRow[];
  approvals: Approval[];
  ended: Ended | null;
}

export interface TaskResponse {
  task: TaskView;
}

/** A task that asked for no sandbox gets `sandbox: null` and the sentence why: nothing was started to say it. */
export type TaskSandboxResponse = { sandbox: SandboxView; because?: undefined } | { sandbox: null; because: string };

/** One journal line, as kept: its kind, when, and the fields that kind allows. */
export interface TaskEvent {
  n: number;
  at: string;
  kind: string;
  [field: string]: unknown;
}

export interface TaskEvents {
  version: number;
  task: string;
  revision: number;
  since: number;
  events: TaskEvent[];
}

export interface ApprovalBrief {
  id: string;
  action: string;
  environment: string | null;
  reason: string | null;
  risk: string | null;
  attempt: string | null;
  requestedAt: string;
  expires: string | null;
}

export interface TaskRow {
  id: string;
  project: string;
  checkout: string;
  objective: string;
  work: string | null;
  /** The coordinated workflow that started this task, when one did: a link, never a second owner. */
  parent?: string | null;
  /** Who runs the task: `automation` for a coordinated workflow, `autonomous-engineering` for a change. */
  provider?: string | null;
  root: string | null;
  snapshot: string | null;
  actor: string | null;
  revision: number;
  lifecycle: Lifecycle;
  terminal: boolean;
  stage: Stage | null;
  stopReason: string | null;
  attempt: AttemptSummary;
  actions: Spend;
  running: number;
  decision: { observed: string; nextAction: string; at: string } | null;
  approvals: ApprovalBrief[];
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  projectName: string;
  checkoutRoot: string | null;
  checkoutKnown: boolean;
  checkoutPresent: boolean;
}

/** How much a Health row needs a person, least first. */
export type HealthLevel = "ok" | "info" | "attention" | "problem";

/** The one thing a person may do from a Health row: lift a restriction they kept, on the revision read. */

/** Where a person acts on a Health row: a page of this app, or one task. */
export interface HealthLink {
  to?: string;
  task?: TaskRef;
}

export interface HealthCheck {
  area: string;
  level: HealthLevel;
  title: string;
  say: string;
  link?: HealthLink;
}

export interface HealthHost {
  id: string;
  name: string;
  agents: boolean;
  promptRouter: boolean;
  statusLine: "installed" | "not-installed" | "unavailable";
}

/** What control-server answers for Health: every area, each with at least one row. */
export interface HealthView {
  version: number;
  at: string;
  status: HealthLevel;
  areas: string[];
  checks: HealthCheck[];
  hosts: HealthHost[];
}

export interface UnreadableRow {
  id: string;
  project: string;
  projectName: string;
  unreadable: true;
  why: string;
}

export type MachineRow = TaskRow | UnreadableRow;

export interface QueueItem extends ApprovalBrief {
  task: string;
  objective: string;
  project: string;
  projectName: string;
  checkout: string;
  revision: number;
  lifecycle: Lifecycle;
}

export interface Counts {
  projects: number;
  checkouts: number;
  tasks: number;
  running: number;
  queued: number;
  waitingApproval: number;
  blocked: number;
  paused: number;
  completedToday: number;
  unreadable: number;
}

export interface MachineView {
  version: number;
  at: string;
  since: string | null;
  counts: Counts;
  tasks: MachineRow[];
  approvals: QueueItem[];
  problems: { project: string; name: string; why: string }[];
}

export interface ApprovalQueue {
  version: number;
  approvals: QueueItem[];
}

/** Which task a page or a decision is about: both identities of its checkout, and its own. */
export interface TaskRef {
  key: string;
  checkout: string;
  task: string;
}

/** A person's decision, as the page sends it: always with the revision the person saw. */
export type TaskDecision =
  | { kind: "pause" | "resume" | "cancel"; expectedRevision: number; because?: string }
  | { kind: "approve"; approval: string; expectedRevision: number }
  | { kind: "reject"; approval: string; expectedRevision: number; reason?: string };

export const isUnreadable = (row: MachineRow): row is UnreadableRow => "unreadable" in row && row.unreadable;
