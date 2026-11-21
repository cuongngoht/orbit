// GOVERNANCE: what the API and the web app say to each other about an ACCOUNT's governance -- its policy and the
// overrides that narrow it for one chat or one research workspace, decisions, approvals, the audit record, findings
// and reports -- and what the agent gateway says to a run. The rules themselves live in @orbit-web/governance-core;
// this file is the transport: request and response shapes, and the checks the API holds every request body to (plain
// functions over `unknown`, like validate.ts).
//
// One sign-in: the person whose browser finished the Claude sign-in is the OWNER of the account of that identity, and
// governs it -- its chats, its research, its policy. There is no operator, no password and no organization to set up.
// What is governed is that account's alone: nothing here names another account, and no request picks the account.
import { type ActionKind, type AuditEvent, type ChainProblem, type DailyReport, type EnforcementPoint, type EnforcementScope, type Environment, type Evaluation, type Finding, type Impact, type PolicyOverlay, type PolicyWarning, type PrincipalType, type RevisionState, type RiskLevel, type RunKind } from "@orbit-web/governance-core";

// What the Governance pages say about the employee network access (`employeeNetwork` of the account's policy), and the
// disclosure every page that chooses what an employee may reach shows: from governance-core, where the policy is checked.
export {
  EMPLOYEE_NETWORK_DISCLOSURE,
  EMPLOYEE_NETWORK_MODES,
  NETWORK_LIMIT_KEYS,
  NETWORK_LIMIT_TEXT,
  employeeNetworkOf,
  networkHostOf,
  type EmployeeNetwork,
  type EmployeeNetworkMode,
  type NetworkLimitKey,
  type NetworkLimits,
} from "@orbit-web/governance-core";

type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${k} is not a field of this request`);

const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });

const objectOf = (body: unknown): Record<string, unknown> | null => (isRecord(body) ? body : null);

// The header a run's agent sends to the agent gateway: the run's own token, minted when the run started.
export const RUN_TOKEN_HEADER = "x-orbit-run-token";

// A change without this browser session's CSRF token (CSRF_HEADER) is refused with this code.
export const CSRF_INVALID = "csrf_invalid";

export const GOVERNANCE_LIMITS = {
  noteLength: 500,
  nameLength: 120,
  resourceLength: 256,
  rules: 500,
  documentBytes: 128 * 1024,
} as const;

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;
const DIGEST = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isName = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !CONTROL.test(v);
export const isDigest = (v: unknown): v is string => typeof v === "string" && DIGEST.test(v);
const isNote = (v: unknown): boolean => v === undefined || (typeof v === "string" && v.length <= GOVERNANCE_LIMITS.noteLength);

const RISK_WORDS: readonly RiskLevel[] = ["low", "elevated", "high"];

const documentFits = (v: unknown): boolean => {
  try {
    return JSON.stringify(v).length <= GOVERNANCE_LIMITS.documentBytes;
  } catch {
    return false;
  }
};

// ---- the deployment -----------------------------------------------------------------------------------------------

export const DEPLOYMENTS = ["single", "governed"] as const;
// `single`: one container, the agent beside the control plane (isolation is not proven there). `governed`: the agent in a
// container of its own, reached through a runner, its egress through the control plane's proxy.
export type Deployment = (typeof DEPLOYMENTS)[number];

// ---- what an account governs: its chats and its research workspaces --------------------------------------------------

export const RESOURCE_KINDS = ["workspace", "research_workspace"] as const;
// `workspace`: a chat (a Claude Code workspace); `research_workspace`: a research workspace.
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const isResourceKind = (v: unknown): v is ResourceKind => typeof v === "string" && (RESOURCE_KINDS as readonly string[]).includes(v);

// ---- the account's policy -------------------------------------------------------------------------------------------

export const REVISION_SOURCES = ["owner", "agent", "default", "copy"] as const;
// Who wrote a revision's first content: the account's owner, an agent's proposal, the default policy, or a copy of
// another revision (a rollback is a copy of an earlier one, taken through the whole lifecycle again).
export type RevisionSource = (typeof REVISION_SOURCES)[number];

export interface RevisionSummary {
  id: string;
  // Assigned when it is published: 1, 2, 3 ... (1 is the default the account was given when it was created).
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
  // The owner's confirmation of exactly this content (null for one nobody confirmed: a draft, or the provisioned default).
  confirmedBy: string | null;
  confirmedAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface RevisionStep {
  // What happened: provisioned, created, edited, validated, discarded, confirmed, published.
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
  // What publishing it would change, against the revision in effect.
  impact: Impact | null;
  // The revision in effect it is compared with (what a publication names as `base`), null when none.
  base: string | null;
  // Everybody who wrote any of it.
  authors: string[];
  history: RevisionStep[];
}

export interface PolicyOverview {
  effective: RevisionView | null;
  revisions: RevisionSummary[];
}

export interface CreateRevisionRequest {
  // The content to start from: a document, a copy of a revision, or (neither) the revision in effect.
  document?: unknown;
  from?: string;
}

export interface UpdateRevisionRequest {
  document: unknown;
  // The digest the editor read: a revision that moved since is refused, never overwritten.
  expectedDigest: string;
}

export interface DigestRequest {
  // The digest of the content the person read.
  digest: string;
  note?: string;
}

// THE OWNER'S CONFIRMATION of a publication: exactly this content (`digest`), compared with exactly that revision in
// effect (`base`), having read its risk (`acknowledgedRisk`: at least the risk the server works out -- an elevated or
// high-risk change is refused without it). One person confirms; nobody else is asked.
export interface PublishRevisionRequest {
  digest: string;
  base: string | null;
  acknowledgedRisk: RiskLevel | null;
}

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

export function checkPublishRevision(body: unknown): Checked<PublishRevisionRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["digest", "base", "acknowledgedRisk"]);
  if (!isDigest(b.digest)) errors.push("digest must be the digest of the content that was read");
  if (b.base !== undefined && b.base !== null && (typeof b.base !== "string" || b.base.length === 0 || b.base.length > 64)) errors.push("base must name the revision in effect that was compared, or be null");
  if (b.acknowledgedRisk !== undefined && b.acknowledgedRisk !== null && !RISK_WORDS.includes(b.acknowledgedRisk as RiskLevel)) errors.push("acknowledgedRisk must be low, elevated or high");
  return checked(errors, () => ({ digest: b.digest as string, base: (b.base as string | null | undefined) ?? null, acknowledgedRisk: (b.acknowledgedRisk as RiskLevel | null | undefined) ?? null }));
}

// ---- simulation, overrides ------------------------------------------------------------------------------------------

export interface SimulatedRequest {
  principalType: PrincipalType;
  action: string;
  resource: string;
  environment: Environment;
  workspaceId: string | null;
  researchWorkspaceId: string | null;
  // Asked as a run of this kind (an employee's assignment: its `network.egress` is decided by the employee network
  // access), for this employee (what an employee's override targets). Absent: not a run.
  runKind?: RunKind;
  employeeId?: string | null;
}

export interface SimulateRequest {
  request: SimulatedRequest;
  // A revision of the account to ask (a draft, an earlier one); the revision in effect when absent.
  revisionId?: string;
}

export interface SimulateResult {
  revisionId: string | null;
  revision: number | null;
  evaluation: Evaluation;
}

const SIMULATED_FIELDS = ["principalType", "action", "resource", "environment", "workspaceId", "researchWorkspaceId", "runKind", "employeeId"];
const ENVIRONMENT_WORDS = ["local", "test", "development", "staging", "production", "unknown"];
const PRINCIPAL_WORDS = ["human", "agent", "service"];
const RUN_WORDS = ["chat", "research", "assignment"];
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
  for (const f of ["workspaceId", "researchWorkspaceId", "employeeId"]) if (!optionalId(r[f])) errors.push(`request.${f} must be an id or null`);
  if (r.runKind !== undefined && r.runKind !== null && !RUN_WORDS.includes(String(r.runKind))) errors.push("request.runKind must be chat, research or assignment");
  if (b.revisionId !== undefined && (typeof b.revisionId !== "string" || b.revisionId.length === 0)) errors.push("revisionId must name a revision");
  return checked(errors, () => ({
    request: {
      principalType: r.principalType as PrincipalType,
      action: r.action as string,
      resource: r.resource as string,
      environment: (r.environment ?? "local") as Environment,
      workspaceId: (r.workspaceId as string | undefined) ?? null,
      researchWorkspaceId: (r.researchWorkspaceId as string | undefined) ?? null,
      ...(r.runKind !== undefined && r.runKind !== null ? { runKind: r.runKind as RunKind } : {}),
      ...(r.employeeId !== undefined ? { employeeId: (r.employeeId as string | null) ?? null } : {}),
    },
    ...(typeof b.revisionId === "string" ? { revisionId: b.revisionId } : {}),
  }));
}

// An OVERRIDE: rules that narrow the account's policy for one chat or one research workspace -- never widen it (an
// allow in it changes nothing, and says so).
export interface OverrideView {
  kind: ResourceKind;
  resourceId: string;
  override: PolicyOverlay;
  digest: string;
  setAt: string;
  setBy: string;
  warnings: PolicyWarning[];
}

// The rules of an override (its document -- the account, the resource -- is made by the API, never taken from a body).
export interface SetOverrideRequest {
  name?: string;
  rules: unknown[];
}

export function checkSetOverride(body: unknown): Checked<SetOverrideRequest> {
  const b = objectOf(body);
  if (b === null) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(b, ["name", "rules"]);
  if (b.name !== undefined && !isName(b.name, GOVERNANCE_LIMITS.nameLength)) errors.push(`name must be 1-${GOVERNANCE_LIMITS.nameLength} printable characters`);
  if (!Array.isArray(b.rules) || b.rules.length > GOVERNANCE_LIMITS.rules || !documentFits(b.rules)) errors.push(`rules must be a list of at most ${GOVERNANCE_LIMITS.rules} rules`);
  return checked(errors, () => ({ ...(typeof b.name === "string" ? { name: b.name.trim() } : {}), rules: b.rules as unknown[] }));
}

// ---- the resources of the account, as governance sees them ------------------------------------------------------------

export interface ResourceGovernanceSummary {
  kind: ResourceKind;
  id: string;
  title: string;
  createdAt: string;
  // Set when the chat or research workspace was deleted: what concerned it stays on record.
  deletedAt: string | null;
  // Whether an override narrows the account's policy for it.
  overridden: boolean;
  runningRuns: number;
  pendingApprovals: number;
}

export interface ResourceGovernanceList {
  resources: ResourceGovernanceSummary[];
}

export interface ResourceGovernanceView extends ResourceGovernanceSummary {
  // The account's policy in effect, which it inherits.
  policy: { revisionId: string; revision: number | null; digest: string } | null;
  override: OverrideView | null;
  // Its most recent audit records, newest first.
  activity: AuditEvent[];
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
  // Who asked: the account's owner, or one of its runs' agents (which can never decide anything).
  requestedByType: string;
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

// The DEPLOYMENT's isolation of the agent from the control plane, said as what was checked. An account id in a record is
// not isolation: in the single deployment every account's runs share one container.
export interface IsolationStatus {
  deployment: Deployment;
  state: IsolationState;
  checkedAt: string | null;
  checks: IsolationCheck[];
  // What the state rests on, said plainly.
  detail: string;
}

export interface GovernanceOverview {
  account: { id: string; displayName: string; email: string };
  deployment: Deployment;
  effective: { id: string; revision: number; digest: string; publishedAt: string; source: RevisionSource } | null;
  counts: { workspaces: number; researchWorkspaces: number; runningRuns: number; pendingApprovals: number; openFindings: number; draftRevisions: number; overrides: number };
  isolation: IsolationStatus;
  audit: { count: number; head: string | null; lastVerification: ChainVerification | null };
}

// What each scope of a decision is about, as a page names it.
export const ENFORCEMENT_SCOPE_TEXT: Record<EnforcementScope, string> = {
  ACCOUNT: "The account",
  ACCOUNT_WORKSPACE: "A chat",
  ACCOUNT_RESEARCH: "A research workspace",
  ACCOUNT_EMPLOYEE: "An employee's assignment",
};

// ---- the agent gateway: what a run may ask ---------------------------------------------------------------------------

export interface AgentWhoAmI {
  runId: string;
  accountId: string;
  // A chat's run (the gateway answers only those; a research session's and an employee's assignment's are refused).
  kind: "chat" | "research" | "assignment";
  // The chat it works in.
  workspaceId: string;
  agentId: string;
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
