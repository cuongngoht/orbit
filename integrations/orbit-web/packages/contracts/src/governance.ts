// GOVERNANCE: what the API and the web app say to each other about operators, the Company Constitution, decisions,
// approvals, the audit record, findings and reports -- and what the agent gateway says to a governed run. The rules
// themselves live in @orbit-web/governance-core; this file is the transport: request and response shapes, and the
// checks the API holds every request body to (plain functions over `unknown`, like validate.ts).
//
// Two sign-ins, never one: the Claude sign-in is the instance's (it opens the workspace); an OPERATOR's sign-in is a
// person's, verified by Orbit Web itself, and only it may administer governance. Nothing here derives the second from
// the first.
import {
  isOperatorRole,
  type ActionKind,
  type AuditEvent,
  type ChainProblem,
  type DailyReport,
  type EnforcementPoint,
  type EnforcementScope,
  type Environment,
  type Evaluation,
  type Finding,
  type Impact,
  type OperatorRole,
  type Permission,
  type PolicyOverlay,
  type PolicyWarning,
  type PrincipalType,
  type RevisionState,
  type RiskLevel,
} from "@orbit-web/governance-core";

type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${k} is not a field of this request`);

const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });

const objectOf = (body: unknown): Record<string, unknown> | null => (isRecord(body) ? body : null);

// The header an operator's change carries beside its session cookie: the session's own CSRF token.
export const OPERATOR_CSRF_HEADER = "x-orbit-operator-csrf";

// The header a governed run's agent sends to the agent gateway: the run's own token, minted when the run started.
export const RUN_TOKEN_HEADER = "x-orbit-run-token";

// The error codes a page answers with the operator sign-in, or with what governance refused.
export const OPERATOR_REQUIRED = "operator_required";
export const PERMISSION_REQUIRED = "permission_required";
export const CSRF_INVALID = "csrf_invalid";

export const GOVERNANCE_LIMITS = {
  usernameLength: 64,
  displayNameLength: 120,
  passwordMin: 12,
  passwordMax: 256,
  organizationNameLength: 120,
  noteLength: 500,
  resourceLength: 256,
  bootstrapCodeLength: 128,
  documentBytes: 128 * 1024,
} as const;

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;
const DIGEST = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isUsername = (v: unknown): v is string => typeof v === "string" && USERNAME.test(v);
const isPassword = (v: unknown): v is string => typeof v === "string" && v.length >= GOVERNANCE_LIMITS.passwordMin && v.length <= GOVERNANCE_LIMITS.passwordMax;
const isName = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !CONTROL.test(v);
export const isDigest = (v: unknown): v is string => typeof v === "string" && DIGEST.test(v);
const isNote = (v: unknown): boolean => v === undefined || (typeof v === "string" && v.length <= GOVERNANCE_LIMITS.noteLength);

const USERNAME_SAID = "username must be 2-64 characters: lower-case letters, digits, dots, dashes and underscores";
const PASSWORD_SAID = `password must be ${GOVERNANCE_LIMITS.passwordMin}-${GOVERNANCE_LIMITS.passwordMax} characters`;

// ---- operators ---------------------------------------------------------------------------------------------------

export const OPERATOR_STATUSES = ["active", "suspended"] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

export interface OperatorView {
  id: string;
  username: string;
  displayName: string;
  status: OperatorStatus;
  roles: OperatorRole[];
  createdAt: string;
}

export interface OperatorSessionView {
  operator: OperatorView;
  permissions: Permission[];
  // Sent back as the OPERATOR_CSRF_HEADER of every change this session makes.
  csrfToken: string;
  expiresAt: string;
}

export const DEPLOYMENTS = ["single", "governed"] as const;
// `single`: one container, the agent beside the control plane (isolation is not proven there). `governed`: the agent in a
// container of its own, reached through a runner, its egress through the control plane's proxy.
export type Deployment = (typeof DEPLOYMENTS)[number];

// GET /api/operator/state: whether governance is set up, and who is signed in as an operator in this browser.
export interface GovernanceState {
  initialized: boolean;
  organization: { id: string; name: string } | null;
  // Whether a first-owner code is waiting (it is printed in Orbit Web's own log, never shown here).
  bootstrapOpen: boolean;
  session: OperatorSessionView | null;
  deployment: Deployment;
}

export interface BootstrapRequest {
  code: string;
  organizationName: string;
  username: string;
  displayName: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateOperatorRequest {
  username: string;
  displayName: string;
  password: string;
  roles: OperatorRole[];
}

export interface RoleChangeRequest {
  grant: OperatorRole[];
  revoke: OperatorRole[];
}

export interface OperatorList {
  operators: OperatorView[];
}

const rolesOf = (v: unknown): v is OperatorRole[] => Array.isArray(v) && v.every(isOperatorRole) && new Set(v).size === v.length;

export function checkBootstrap(body: unknown): Checked<BootstrapRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["code", "organizationName", "username", "displayName", "password"]);
  if (typeof b.code !== "string" || b.code.length === 0 || b.code.length > GOVERNANCE_LIMITS.bootstrapCodeLength) errors.push("code must be the one-time code from Orbit Web's log");
  if (!isName(b.organizationName, GOVERNANCE_LIMITS.organizationNameLength)) errors.push(`organizationName must be 1-${GOVERNANCE_LIMITS.organizationNameLength} printable characters`);
  if (!isUsername(b.username)) errors.push(USERNAME_SAID);
  if (b.displayName !== undefined && !isName(b.displayName, GOVERNANCE_LIMITS.displayNameLength)) errors.push(`displayName must be 1-${GOVERNANCE_LIMITS.displayNameLength} printable characters`);
  if (!isPassword(b.password)) errors.push(PASSWORD_SAID);
  return checked(errors, () => ({ code: b.code as string, organizationName: (b.organizationName as string).trim(), username: b.username as string, displayName: typeof b.displayName === "string" ? b.displayName.trim() : (b.username as string), password: b.password as string }));
}

export function checkLogin(body: unknown): Checked<LoginRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["username", "password"]);
  if (typeof b.username !== "string" || b.username.length === 0 || b.username.length > GOVERNANCE_LIMITS.usernameLength) errors.push("username is required");
  if (typeof b.password !== "string" || b.password.length === 0 || b.password.length > GOVERNANCE_LIMITS.passwordMax) errors.push("password is required");
  return checked(errors, () => ({ username: (b.username as string).toLowerCase(), password: b.password as string }));
}

export function checkChangePassword(body: unknown): Checked<ChangePasswordRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["currentPassword", "newPassword"]);
  if (typeof b.currentPassword !== "string" || b.currentPassword.length === 0) errors.push("currentPassword is required");
  if (!isPassword(b.newPassword)) errors.push(`newPassword must be ${GOVERNANCE_LIMITS.passwordMin}-${GOVERNANCE_LIMITS.passwordMax} characters`);
  return checked(errors, () => ({ currentPassword: b.currentPassword as string, newPassword: b.newPassword as string }));
}

export function checkCreateOperator(body: unknown): Checked<CreateOperatorRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["username", "displayName", "password", "roles"]);
  if (!isUsername(b.username)) errors.push(USERNAME_SAID);
  if (b.displayName !== undefined && !isName(b.displayName, GOVERNANCE_LIMITS.displayNameLength)) errors.push(`displayName must be 1-${GOVERNANCE_LIMITS.displayNameLength} printable characters`);
  if (!isPassword(b.password)) errors.push(PASSWORD_SAID);
  if (!rolesOf(b.roles)) errors.push("roles must be a list of distinct operator roles");
  return checked(errors, () => ({ username: b.username as string, displayName: typeof b.displayName === "string" ? b.displayName.trim() : (b.username as string), password: b.password as string, roles: b.roles as OperatorRole[] }));
}

export function checkRoleChange(body: unknown): Checked<RoleChangeRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["grant", "revoke"]);
  const grant = b.grant ?? [];
  const revoke = b.revoke ?? [];
  if (!rolesOf(grant)) errors.push("grant must be a list of distinct operator roles");
  if (!rolesOf(revoke)) errors.push("revoke must be a list of distinct operator roles");
  if (rolesOf(grant) && rolesOf(revoke) && grant.some((r) => revoke.includes(r))) errors.push("a role cannot be granted and revoked at once");
  if (rolesOf(grant) && rolesOf(revoke) && grant.length + revoke.length === 0) errors.push("name a role to grant or revoke");
  return checked(errors, () => ({ grant: grant as OperatorRole[], revoke: revoke as OperatorRole[] }));
}

// ---- the Constitution ------------------------------------------------------------------------------------------------

export const REVISION_SOURCES = ["operator", "agent", "default", "copy"] as const;
// Who wrote a revision's first content: a person, an agent's proposal, the default Constitution, or a copy of another
// revision (a rollback is a copy of an earlier one, taken through the whole lifecycle again).
export type RevisionSource = (typeof REVISION_SOURCES)[number];

export interface RevisionSummary {
  id: string;
  // Assigned when it is published: 1, 2, 3 ...
  revision: number | null;
  state: RevisionState;
  digest: string;
  name: string;
  risk: RiskLevel | null;
  source: RevisionSource;
  basedOn: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface RevisionStep {
  // What happened: created, edited, validated, approval requested, approved, rejected, withdrawn, published, superseded.
  what: string;
  by: string;
  at: string;
  digest: string | null;
  eventId: string;
}

export interface RevisionView extends RevisionSummary {
  // The document as written. A draft may not be valid yet: `errors` says why.
  document: unknown;
  errors: string[];
  warnings: PolicyWarning[];
  // What publishing it would change, against the revision in effect (or the default Constitution before any).
  impact: Impact | null;
  // Everybody who wrote any of it: who created, edited, or asked for its approval. A high-risk change is approved by
  // somebody else.
  authors: string[];
  history: RevisionStep[];
}

export interface ConstitutionOverview {
  effective: RevisionView | null;
  revisions: RevisionSummary[];
}

export interface CreateRevisionRequest {
  // The content to start from: a document, a copy of a revision, or (neither) the revision in effect or the default.
  document?: unknown;
  from?: string;
}

export interface UpdateRevisionRequest {
  document: unknown;
  // The digest the editor read: a revision that moved since is refused, never overwritten.
  expectedDigest: string;
}

export interface DigestRequest {
  // The digest the person read: what is approved, rejected or published is exactly that content.
  digest: string;
  note?: string;
}

const documentFits = (v: unknown): boolean => {
  try {
    return JSON.stringify(v).length <= GOVERNANCE_LIMITS.documentBytes;
  } catch {
    return false;
  }
};

export function checkCreateRevision(body: unknown): Checked<CreateRevisionRequest> {
  if (body === undefined || body === null) return { ok: true, value: {} };
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["document", "from"]);
  if (b.document !== undefined && !documentFits(b.document)) errors.push(`document must be JSON of at most ${GOVERNANCE_LIMITS.documentBytes} bytes`);
  if (b.from !== undefined && (typeof b.from !== "string" || b.from.length === 0 || b.from.length > 64)) errors.push("from must name a revision");
  if (b.document !== undefined && b.from !== undefined) errors.push("give a document or a revision to copy, not both");
  return checked(errors, () => ({ ...(b.document !== undefined ? { document: b.document } : {}), ...(b.from !== undefined ? { from: b.from as string } : {}) }));
}

export function checkUpdateRevision(body: unknown): Checked<UpdateRevisionRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["document", "expectedDigest"]);
  if (b.document === undefined || !documentFits(b.document)) errors.push(`document must be JSON of at most ${GOVERNANCE_LIMITS.documentBytes} bytes`);
  if (!isDigest(b.expectedDigest)) errors.push("expectedDigest must be the digest the editor read");
  return checked(errors, () => ({ document: b.document, expectedDigest: b.expectedDigest as string }));
}

export function checkDigestRequest(body: unknown): Checked<DigestRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["digest", "note"]);
  if (!isDigest(b.digest)) errors.push("digest must be the digest of the content that was read");
  if (!isNote(b.note)) errors.push(`note must be text of at most ${GOVERNANCE_LIMITS.noteLength} characters`);
  return checked(errors, () => ({ digest: b.digest as string, ...(typeof b.note === "string" ? { note: b.note } : {}) }));
}

// ---- simulation, overlays ------------------------------------------------------------------------------------------

export interface SimulatedRequest {
  principalType: PrincipalType;
  action: string;
  resource: string;
  environment: Environment;
  workspaceId: string | null;
  agentId: string | null;
  projectId: string | null;
}

export interface SimulateRequest {
  request: SimulatedRequest;
  // A revision to ask (a draft, an earlier one); the revision in effect when absent.
  revisionId?: string;
}

export interface SimulateResult {
  revisionId: string | null;
  revision: number | null;
  evaluation: Evaluation;
}

const SIMULATED_FIELDS = ["principalType", "action", "resource", "environment", "workspaceId", "agentId", "projectId"];
const ENVIRONMENT_WORDS = ["local", "test", "development", "staging", "production", "unknown"];
const PRINCIPAL_WORDS = ["human", "agent", "service"];
const optionalId = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.length > 0 && v.length <= 128);

export function checkSimulate(body: unknown): Checked<SimulateRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["request", "revisionId"]);
  const r = objectOf(b.request);
  if (r === null) return { ok: false, errors: [...errors, "request must be an object"] };
  errors.push(...unknownFields(r, SIMULATED_FIELDS));
  if (!PRINCIPAL_WORDS.includes(String(r.principalType))) errors.push("request.principalType must be human, agent or service");
  if (typeof r.action !== "string" || r.action.length === 0 || r.action.length > 128) errors.push("request.action must name an action");
  if (typeof r.resource !== "string" || r.resource.length > GOVERNANCE_LIMITS.resourceLength) errors.push("request.resource must be text");
  if (!ENVIRONMENT_WORDS.includes(String(r.environment ?? "local"))) errors.push("request.environment is not an environment Orbit Web knows");
  for (const f of ["workspaceId", "agentId", "projectId"]) if (!optionalId(r[f])) errors.push(`request.${f} must be an id or null`);
  if (b.revisionId !== undefined && (typeof b.revisionId !== "string" || b.revisionId.length === 0)) errors.push("revisionId must name a revision");
  return checked(errors, () => ({
    request: {
      principalType: r.principalType as PrincipalType,
      action: r.action as string,
      resource: r.resource as string,
      environment: (r.environment ?? "local") as Environment,
      workspaceId: (r.workspaceId as string | undefined) ?? null,
      agentId: (r.agentId as string | undefined) ?? null,
      projectId: (r.projectId as string | undefined) ?? null,
    },
    ...(typeof b.revisionId === "string" ? { revisionId: b.revisionId } : {}),
  }));
}

export interface OverlayView {
  overlay: PolicyOverlay;
  digest: string;
  setAt: string;
  setBy: string;
}

export interface OverlayList {
  overlays: OverlayView[];
}

export interface SetOverlayRequest {
  overlay: unknown;
}

export function checkSetOverlay(body: unknown): Checked<SetOverlayRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["overlay"]);
  if (!isRecord(b.overlay) || !documentFits(b.overlay)) errors.push("overlay must be a PolicyOverlay document");
  return checked(errors, () => ({ overlay: b.overlay }));
}

// ---- agents and workspaces --------------------------------------------------------------------------------------------

export const AGENT_RUNTIMES = ["claude-code"] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];

export interface AgentView {
  id: string;
  name: string;
  runtime: AgentRuntime;
  status: OperatorStatus;
  createdAt: string;
  createdBy: string;
}

export interface AgentList {
  agents: AgentView[];
}

export interface RegisterAgentRequest {
  name: string;
}

export function checkRegisterAgent(body: unknown): Checked<RegisterAgentRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["name"]);
  if (!isName(b.name, GOVERNANCE_LIMITS.displayNameLength)) errors.push(`name must be 1-${GOVERNANCE_LIMITS.displayNameLength} printable characters`);
  return checked(errors, () => ({ name: (b.name as string).trim() }));
}

export const ENFORCEMENT_PROFILES = ["strict"] as const;
export type EnforcementProfile = (typeof ENFORCEMENT_PROFILES)[number];

export interface WorkspaceGovernanceView {
  sessionId: string;
  title: string;
  repository: string | null;
  status: string;
  scope: EnforcementScope;
  agentId: string | null;
  profile: EnforcementProfile | null;
  governedAt: string | null;
  governedBy: string | null;
}

export interface WorkspaceList {
  workspaces: WorkspaceGovernanceView[];
}

export interface GovernWorkspaceRequest {
  agentId: string;
  profile: EnforcementProfile;
}

export function checkGovernWorkspace(body: unknown): Checked<GovernWorkspaceRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["agentId", "profile"]);
  if (typeof b.agentId !== "string" || b.agentId.length === 0 || b.agentId.length > 64) errors.push("agentId must name a registered agent");
  if (b.profile !== undefined && b.profile !== "strict") errors.push('profile must be "strict"');
  return checked(errors, () => ({ agentId: b.agentId as string, profile: "strict" as const }));
}

// ---- decisions and approvals ------------------------------------------------------------------------------------------

export interface DecisionView {
  decisionId: string;
  eventId: string;
  at: string;
  principalType: string;
  principalId: string;
  agentId: string | null;
  workspaceId: string | null;
  runId: string | null;
  action: string;
  resource: string;
  environment: string;
  verdict: string;
  enforcement: EnforcementPoint | string;
  policyRevision: string | null;
  matchedRules: string[];
  reasonCodes: string[];
  fingerprint: string | null;
  scope: string | null;
}

export interface DecisionList {
  decisions: DecisionView[];
}

export const APPROVAL_VIEW_STATES = ["pending", "granted", "rejected", "expired", "consumed"] as const;

export interface ApprovalView {
  id: string;
  action: ActionKind | string;
  environment: string;
  fingerprint: string;
  state: (typeof APPROVAL_VIEW_STATES)[number];
  // Exactly what is approved: the action's bound parameters, as the fingerprint covers them.
  params: Record<string, string | number | boolean | null>;
  summary: string;
  requestedAt: string;
  requestedBy: string;
  agentId: string | null;
  workspaceId: string | null;
  runId: string | null;
  decisionId: string | null;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  consumedAt: string | null;
  outcome: string | null;
  // What would be pushed, read from Orbit Web's own copy of the commit -- never from the agent's workspace.
  change: { files: number; insertions: number; deletions: number; commits: number; diffstat: string } | null;
}

export interface ApprovalList {
  approvals: ApprovalView[];
}

export interface ApprovalDecisionRequest {
  // The fingerprint the person read: a decision binds exactly that action.
  fingerprint: string;
  note?: string;
}

export function checkApprovalDecision(body: unknown): Checked<ApprovalDecisionRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["fingerprint", "note"]);
  if (!isDigest(b.fingerprint)) errors.push("fingerprint must be the fingerprint of the action that was read");
  if (!isNote(b.note)) errors.push(`note must be text of at most ${GOVERNANCE_LIMITS.noteLength} characters`);
  return checked(errors, () => ({ fingerprint: b.fingerprint as string, ...(typeof b.note === "string" ? { note: b.note } : {}) }));
}

// ---- the audit record ------------------------------------------------------------------------------------------------

export interface AuditPage {
  events: AuditEvent[];
  // The seq to ask `before` for the next (older) page; null at the first record.
  next: number | null;
  head: { seq: number; hash: string } | null;
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  head: string | null;
  brokenAt: number | null;
  eventId: string | null;
  problem: ChainProblem | null;
  checkedAt: string;
}

// ---- findings and reports ----------------------------------------------------------------------------------------------

export const FINDING_RESOLUTIONS = ["open", "resolved", "accepted"] as const;
export type FindingResolution = (typeof FINDING_RESOLUTIONS)[number];

export interface FindingView extends Finding {
  resolution: FindingResolution;
  resolvedBy: string | null;
  resolvedAt: string | null;
  note: string | null;
}

export interface FindingList {
  findings: FindingView[];
  chain: ChainVerification;
}

export interface ResolveFindingRequest {
  resolution: FindingResolution;
  note?: string;
}

export function checkResolveFinding(body: unknown): Checked<ResolveFindingRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["resolution", "note"]);
  if (!(FINDING_RESOLUTIONS as readonly unknown[]).includes(b.resolution)) errors.push("resolution must be open, resolved or accepted");
  if (!isNote(b.note)) errors.push(`note must be text of at most ${GOVERNANCE_LIMITS.noteLength} characters`);
  return checked(errors, () => ({ resolution: b.resolution as FindingResolution, ...(typeof b.note === "string" ? { note: b.note } : {}) }));
}

export interface ReportSummary {
  id: string;
  day: string;
  generatedAt: string;
  generatedBy: string;
  head: string | null;
  findings: number;
  denied: number;
  integrityOk: boolean;
}

export interface ReportView extends ReportSummary {
  report: DailyReport;
  markdown: string;
}

export interface ReportList {
  reports: ReportSummary[];
}

export interface GenerateReportRequest {
  day: string;
}

export function checkGenerateReport(body: unknown): Checked<GenerateReportRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["day"]);
  if (typeof b.day !== "string" || !DAY.test(b.day) || Number.isNaN(Date.parse(`${b.day}T00:00:00Z`))) errors.push("day must be a UTC day, YYYY-MM-DD");
  return checked(errors, () => ({ day: b.day as string }));
}

// ---- isolation and the overview ------------------------------------------------------------------------------------

export const ISOLATION_STATES = ["not_proven", "attested", "failed"] as const;
export type IsolationState = (typeof ISOLATION_STATES)[number];

export interface IsolationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface IsolationStatus {
  deployment: Deployment;
  state: IsolationState;
  checkedAt: string | null;
  checks: IsolationCheck[];
  // What the state rests on, said plainly.
  detail: string;
}

export interface GovernanceOverview {
  organization: { id: string; name: string };
  effective: { id: string; revision: number; digest: string; publishedAt: string } | null;
  counts: { operators: number; agents: number; governedWorkspaces: number; pendingApprovals: number; openFindings: number; revisionsInReview: number };
  isolation: IsolationStatus;
  audit: { count: number; head: string | null; lastVerification: ChainVerification | null };
}

// ---- the agent gateway: what a governed run may ask ------------------------------------------------------------------

export interface AgentWhoAmI {
  runId: string;
  sessionId: string;
  workspaceId: string;
  agentId: string;
  organizationId: string;
  policyRevision: string;
  scope: EnforcementScope;
}

export interface AgentDecisionRequest {
  action: string;
  resource: string;
}

export interface AgentDecisionResult {
  decisionId: string;
  verdict: string;
  reasonCodes: string[];
  enforcement: string;
  policyRevision: string | null;
}

export function checkAgentDecision(body: unknown): Checked<AgentDecisionRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["action", "resource"]);
  if (typeof b.action !== "string" || b.action.length === 0 || b.action.length > 128) errors.push("action must name an action");
  if (typeof b.resource !== "string" || b.resource.length > GOVERNANCE_LIMITS.resourceLength || CONTROL.test(b.resource)) errors.push("resource must be printable text");
  return checked(errors, () => ({ action: b.action as string, resource: b.resource as string }));
}

export interface AgentPushRequest {
  // The workspace branch to push; the run's own working branch when absent.
  branch?: string;
  // The commit the agent means: refused when the branch no longer points at it.
  commit?: string;
}

export interface AgentPushResult {
  approvalId: string | null;
  state: string;
  fingerprint: string | null;
  decision: AgentDecisionResult;
  message: string;
}

const COMMIT = /^[0-9a-f]{40}$/;

export function checkAgentPush(body: unknown): Checked<AgentPushRequest> {
  if (body === undefined || body === null) return { ok: true, value: {} };
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["branch", "commit"]);
  if (b.branch !== undefined && (typeof b.branch !== "string" || b.branch.length === 0 || b.branch.length > 255 || b.branch.startsWith("-") || CONTROL.test(b.branch))) errors.push("branch must be a branch name");
  if (b.commit !== undefined && (typeof b.commit !== "string" || !COMMIT.test(b.commit))) errors.push("commit must be a full commit id");
  return checked(errors, () => ({ ...(typeof b.branch === "string" ? { branch: b.branch } : {}), ...(typeof b.commit === "string" ? { commit: b.commit } : {}) }));
}

export interface AgentProposalRequest {
  document: unknown;
  note?: string;
}

export interface AgentProposalResult {
  revisionId: string;
  state: RevisionState;
}

export function checkAgentProposal(body: unknown): Checked<AgentProposalRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["document", "note"]);
  if (b.document === undefined || !documentFits(b.document)) errors.push(`document must be JSON of at most ${GOVERNANCE_LIMITS.documentBytes} bytes`);
  if (!isNote(b.note)) errors.push(`note must be text of at most ${GOVERNANCE_LIMITS.noteLength} characters`);
  return checked(errors, () => ({ document: b.document, ...(typeof b.note === "string" ? { note: b.note } : {}) }));
}

