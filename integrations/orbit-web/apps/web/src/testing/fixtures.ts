// What the API answers, for the web app's tests.
import { composeEmployeeModels, composeEmployeeNetwork, defaultAccountPolicy, departmentTableOf, type AccountPolicy, type AuditEvent, type DepartmentPolicy, type Rule } from "@orbit-web/governance-core";
import {
  ORBIT_WEB_VERSION,
  type ApprovalView,
  type AuthAccount,
  type AuthSession,
  type AuthStatus,
  type AuthUser,
  type AzureStatus,
  type ConnectionState,
  type DepartmentPolicyOverview,
  type DepartmentRevisionView,
  type GitHubStatus,
  type GovernanceOverview,
  type LoginSnapshot,
  type OrbitPanel,
  type OverrideView,
  type ProjectInventory,
  type Repository,
  type ResourceGovernanceSummary,
  type ResourceGovernanceView,
  type ResourceKind,
  type RevisionSummary,
  type RevisionView,
  type SessionDetail,
  type SessionSummary,
  type SessionView,
  type Settings,
  type SetupStatus,
  type SourcesStatus,
  type TrialMode,
} from "@orbit-web/contracts";
import { DEPT_ACCOUNTING } from "./officeFixtures";

// GET /api/settings, as a fresh Orbit Web answers it.
export function settings(over: Partial<Settings> = {}): Settings {
  return { defaultRuntime: "claude", defaultModel: "sonnet", defaultEffort: "medium", defaultMode: "autonomous", projectSkills: true, projectPlugins: false, webTools: false, githubForClaude: false, azureForClaude: false, theme: "system", maxBudgetUsd: null, ...over };
}

// GET /api/sources: by default neither source is connected (a chat still starts, without a repository).
export function sources(github: ConnectionState = "not_connected", azure: ConnectionState = "not_connected"): SourcesStatus {
  return {
    sources: [
      { source: "github", state: github, account: github === "connected" ? "octo" : null },
      { source: "azure", state: azure, account: azure === "connected" ? "dev@contoso.com" : null },
    ],
  };
}

export const githubRepository = (over: Partial<Repository> = {}): Repository => ({
  source: "github",
  id: "octo/sum-fixture",
  fullName: "octo/sum-fixture",
  owner: "octo",
  project: null,
  name: "sum-fixture",
  private: true,
  defaultBranch: "main",
  updatedAt: null,
  archived: false,
  fork: false,
  ...over,
});

export const AZURE_REPOSITORY_ID = "contoso/3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b";

export const azureRepository = (over: Partial<Repository> = {}): Repository => ({
  source: "azure",
  id: AZURE_REPOSITORY_ID,
  fullName: "contoso/Platform/api",
  owner: "contoso",
  project: "Platform",
  name: "api",
  private: true,
  defaultBranch: "develop",
  updatedAt: null,
  archived: false,
  fork: false,
  ...over,
});

// What a repository brought, as the workspace's first fetch read it.
export function inventory(over: Partial<ProjectInventory> = {}): ProjectInventory {
  return {
    repository: "octo/sum-fixture",
    loadedAt: "2026-11-20T00:00:00.000Z",
    skills: [{ name: "release-notes", description: "Write the release notes from the merged PRs.", path: ".claude/skills/release-notes/SKILL.md" }],
    commands: [{ name: "deploy", description: "Deploy the preview.", path: ".claude/commands/deploy.md" }],
    agents: [],
    claudeMd: true,
    mcpServers: [],
    marketplaces: [],
    plugins: [{ id: "lint-kit@acme-tools", kind: "declared", source: "acme/claude-plugins", path: null, state: "declared", detail: null }],
    loaded: true,
    truncated: false,
    ...over,
  };
}

export const idleFlow = (): LoginSnapshot => ({ state: "idle", url: null, code: null, needsCode: false, message: null, startedAt: null, updatedAt: "2026-11-19T00:00:00.000Z" });

const ok = { ok: true, detail: null };

// The Orbit account (its OrbitId) every record of these tests belongs to.
export const ACCOUNT_ID = "0b6f1f0e-9c1e-4a5e-8a8b-1f2a3b4c5d6e";
export const USER_ID = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

// This browser session's CSRF token: every change carries it.
export const CSRF = "c".repeat(64);

// This browser's session, as the API says it.
export const authSession = (over: Partial<AuthSession> = {}): AuthSession => ({ orbitId: ACCOUNT_ID, userId: USER_ID, csrfToken: CSRF, expiresAt: "2026-12-01T00:00:00.000Z", ...over });

// The user signed in: the first administrator, Ann Owner.
export const authUser = (over: Partial<AuthUser> = {}): AuthUser => ({ id: USER_ID, username: "admin", fullName: "Ann Owner", email: "ann@example.com", emailVerified: false, role: "owner", mustChangePassword: false, trialPassword: false, lastLoginAt: "2026-11-20T08:00:00.000Z", shareAddress: "admin@users.orbit.local", version: 1, ...over });

// The Orbit account, as GET /api/account says it.
export const authAccount = (over: Partial<AuthAccount> = {}): AuthAccount => ({ orbitId: ACCOUNT_ID, displayName: "Octo", companyName: "Octo & Co", contactEmail: null, timezone: "Asia/Ho_Chi_Minh", locale: "en", createdAt: "2026-11-19T00:00:00.000Z", version: 3, ...over });

export const NO_TRIAL: TrialMode = { enabled: false, username: null, password: null };
export const TRIAL: TrialMode = { enabled: true, username: "admin", password: "123456" };

// GET /api/auth/status: by default this browser is signed in.
export function authStatus(over: Partial<AuthStatus> = {}): AuthStatus {
  return { state: "signed_in", session: authSession(), user: authUser(), account: authAccount(), trial: NO_TRIAL, setupCode: null, ...over };
}

// A browser with no session (the installation has its first administrator).
export const signedOut = (over: Partial<AuthStatus> = {}): AuthStatus => authStatus({ state: "signed_out", session: null, user: null, account: null, ...over });

// A new installation: nobody can sign in before the first administrator is set up.
export const setupRequired = (over: Partial<AuthStatus> = {}): AuthStatus => authStatus({ state: "setup_required", session: null, user: null, account: null, ...over });

// GET /api/auth/sessions: this browser, and another.
export const sessionViews = (): SessionView[] => [
  { id: "s-1", current: true, createdAt: "2026-11-19T00:00:00.000Z", lastSeenAt: "2026-11-20T00:00:00.000Z", expiresAt: "2026-11-26T00:00:00.000Z", userAgent: "Firefox" },
  { id: "s-2", current: false, createdAt: "2026-11-18T00:00:00.000Z", lastSeenAt: "2026-11-18T00:00:00.000Z", expiresAt: "2026-11-25T00:00:00.000Z", userAgent: "Safari on a phone" },
];

// GET /api/setup/status: the system's checks, the AI CLIs installed here, and the GitHub and Azure connectors. (The
// first argument is kept for the callers that name it; the AI CLIs' sign-ins are per connection now.)
export function setupStatus(_runtimes: Record<string, never> = {}, github: Partial<GitHubStatus> = {}, azure: Partial<AzureStatus> = {}): SetupStatus {
  const g: GitHubStatus = { state: "not_connected", account: null, detail: null, flow: idleFlow(), availableToClaude: false, ...github };
  const a: AzureStatus = { state: "not_connected", account: null, detail: null, flow: idleFlow(), availableToClaude: false, ...azure };
  return {
    versions: { web: ORBIT_WEB_VERSION, orbit: "0.6.0", orbitCommit: "6c36207cd57204f6f50deb3431a5db516b27f4bc", claude: "2.1.328", codex: "0.169.0", agy: "1.5.14", gh: "2.89.0", git: "2.43.0", az: "2.91.0", python: "3.15.2", node: "24.11.0" },
    runtimes: [
      { runtime: "claude", state: "installed", version: "2.1.330", detail: null, checkedAt: "2026-11-21T00:00:00.000Z" },
      { runtime: "codex", state: "not_installed", version: null, detail: null, checkedAt: "2026-11-21T00:00:00.000Z" },
      { runtime: "agy", state: "not_installed", version: null, detail: null, checkedAt: "2026-11-21T00:00:00.000Z" },
    ],
    github: g,
    azure: a,
    health: {
      status: "ok",
      api: ok,
      claude: { ok: true, detail: "2.1.328" },
      gh: { ok: true, detail: "2.89.0" },
      git: ok,
      az: { ok: true, detail: "2.91.0" },
      python: { ok: true, detail: "3.15.2" },
      orbitPlugin: { ok: true, detail: "0.6.0" },
      storage: ok,
      database: { ok: true, detail: null, server: "17.6", schema: 3, latestSchema: 3, pgvector: "0.8.1" },
    },
  };
}

export const SESSION_ID = "0b6c2f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";

export function sessionDetail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SESSION_ID,
    title: "Fix sum",
    runtime: "claude",
    connectionId: null,
    source: "github",
    repository: "octo/sum-fixture",
    branch: "main",
    workBranch: "orbit-web/0b6c2f5e",
    model: "sonnet",
    effort: "medium",
    mode: "autonomous",
    status: "ready",
    statusReason: null,
    access: "owner",
    owner: "octo@example.com",
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    baseCommit: "a".repeat(40),
    claudeSessionId: null,
    turns: 0,
    lastSeq: 0,
    messages: [],
    ...over,
  };
}

// A chat as the sidebar lists it (the detail without its messages).
export function sessionSummary(over: Partial<SessionSummary> = {}): SessionSummary {
  const { id, title, source, repository, branch, workBranch, runtime, connectionId, model, effort, mode, status, statusReason, access, owner, createdAt, updatedAt } = sessionDetail(over);
  return { id, title, source, repository, branch, workBranch, runtime, connectionId, model, effort, mode, status, statusReason, access, owner, createdAt, updatedAt };
}

export function orbitPanel(over: Partial<OrbitPanel> = {}): OrbitPanel {
  return {
    state: "available",
    reason: null,
    checkedAt: "2026-11-19T00:00:00.000Z",
    association: { how: "none", taskId: null },
    presentation: "IDLE",
    task: null,
    work: null,
    planWord: null,
    checks: [],
    missing: [],
    verification: [],
    completion: null,
    approvals: [],
    sessionChecks: [],
    failure: null,
    stop: null,
    verdict: { word: "unknown", label: "Unknown", source: "No Orbit task is linked to this session, so Orbit has given no verdict." },
    ...over,
  };
}

// ---- governance -------------------------------------------------------------------------------------------------------
//
// One account, one owner: the user signed in to the Orbit account governs it. Records name the owner as
// `owner:<account>`, an agent as `agent:<id>`, Orbit Web itself as `system:<what>`.

export const OWNER = `owner:${ACCOUNT_ID}`;
export const POLICY_DIGEST = "d".repeat(64);
export const DRAFT_DIGEST = "e".repeat(64);
export const WORKSPACE_ID = SESSION_ID;
export const RESEARCH_WORKSPACE_ID = "4f8e2a1c-7b3d-4e5f-9a0b-1c2d3e4f5a6b";

// GET /api/governance/overview, for an account with one chat, one research workspace and its default policy in effect.
export function governanceOverview(over: Partial<GovernanceOverview> = {}): GovernanceOverview {
  return {
    account: { id: ACCOUNT_ID, displayName: "", email: "ann@example.com" },
    deployment: "single",
    effective: { id: "rev-1", revision: 1, digest: POLICY_DIGEST, publishedAt: "2026-11-20T09:00:00.000Z", source: "default" },
    counts: { workspaces: 1, researchWorkspaces: 1, runningRuns: 0, pendingApprovals: 1, openFindings: 0, draftRevisions: 0, overrides: 0 },
    isolation: { deployment: "single", state: "not_proven", checkedAt: null, checks: [], detail: "Claude Code runs in this container, as this container's user: its isolation from Orbit Web cannot be proven here." },
    audit: { count: 12, head: "a1".repeat(32), lastVerification: null },
    ...over,
  };
}

// One revision of the account's policy, as the revisions list says it: by default the default policy, in effect.
export function revisionSummary(over: Partial<RevisionSummary> = {}): RevisionSummary {
  return {
    id: "rev-1",
    revision: 1,
    state: "PUBLISHED",
    digest: POLICY_DIGEST,
    name: "default",
    risk: null,
    source: "default",
    basedOn: null,
    createdAt: "2026-11-20T09:00:00.000Z",
    createdBy: "system:provisioning",
    updatedAt: "2026-11-20T09:00:00.000Z",
    confirmedBy: null,
    confirmedAt: null,
    publishedAt: "2026-11-20T09:00:00.000Z",
    publishedBy: "system:provisioning",
    ...over,
  };
}

// One revision with its document (by default the governed deployment's default policy), as GET /revisions/:id says it.
export function revisionView(over: Partial<RevisionView> = {}): RevisionView {
  return {
    ...revisionSummary(),
    document: defaultAccountPolicy(ACCOUNT_ID, "governed"),
    errors: [],
    warnings: [],
    impact: null,
    base: null,
    authors: ["system:provisioning"],
    history: [],
    ...over,
  };
}

// A draft of the owner's, compared with the revision in effect (`rev-1`).
export function draftView(over: Partial<RevisionView> = {}): RevisionView {
  return revisionView({ id: "rev-2", revision: null, state: "DRAFT", digest: DRAFT_DIGEST, name: "next", source: "copy", basedOn: "rev-1", createdBy: OWNER, updatedAt: "2026-11-20T10:05:00.000Z", publishedAt: null, publishedBy: null, base: "rev-1", authors: [OWNER], ...over });
}

// An override's view, of the rules given.
export function overrideView(rules: Rule[], over: Partial<OverrideView> = {}): OverrideView {
  const kind = over.kind ?? "workspace";
  const resourceId = over.resourceId ?? WORKSPACE_ID;
  return {
    kind,
    resourceId,
    override: { apiVersion: "orbit.governance/v2", kind: "PolicyOverride", metadata: { accountId: ACCOUNT_ID, level: kind, target: resourceId, name: "override for Fix sum" }, rules },
    digest: "b".repeat(64),
    setAt: "2026-11-20T11:00:00.000Z",
    setBy: OWNER,
    warnings: rules.filter((r) => r.effect === "allow").map((r) => ({ ruleId: r.id, code: "OVERLAY_CANNOT_WIDEN" as const, message: "An override only narrows: an allow rule in it changes nothing." })),
    ...over,
  };
}

// A chat or research workspace of the account, as governance lists it.
export function resourceSummary(kind: ResourceKind = "workspace", over: Partial<ResourceGovernanceSummary> = {}): ResourceGovernanceSummary {
  return {
    kind,
    id: kind === "workspace" ? WORKSPACE_ID : RESEARCH_WORKSPACE_ID,
    title: kind === "workspace" ? "Fix sum" : "Market study",
    createdAt: "2026-11-19T00:00:00.000Z",
    deletedAt: null,
    overridden: false,
    runningRuns: 0,
    pendingApprovals: 0,
    ...over,
  };
}

// One audit record of the account.
export function auditEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    schemaVersion: 2,
    eventId: "evt-1",
    eventType: "policy.decision",
    occurredAt: "2026-11-20T10:00:00.000Z",
    recordedAt: "2026-11-20T10:00:00.000Z",
    accountId: ACCOUNT_ID,
    principalId: "agt-1",
    principalType: "agent",
    agentId: "agt-1",
    workspaceId: WORKSPACE_ID,
    runId: "run-1",
    correlationId: "cor-1",
    causationId: null,
    policyRevision: "rev-1",
    decisionId: "dec-1",
    outcome: "allow",
    reasonCodes: ["RULE_MATCHED"],
    evidenceRefs: [],
    data: { action: "repository.write", resource: "", environment: "development" },
    seq: 7,
    previousHash: "f0".repeat(32),
    hash: "f1".repeat(32),
    ...over,
  };
}

// One chat or research workspace as governance shows it: the policy it inherits, its override, what runs, its activity.
export function resourceView(kind: ResourceKind = "workspace", over: Partial<ResourceGovernanceView> = {}): ResourceGovernanceView {
  return {
    ...resourceSummary(kind),
    policy: { revisionId: "rev-1", revision: 1, digest: POLICY_DIGEST },
    override: null,
    activity: [auditEvent()],
    ...over,
  };
}

export const FINGERPRINT = "f".repeat(64);

export function approval(over: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: "apr-1",
    action: "repository.push",
    environment: "development",
    fingerprint: FINGERPRINT,
    state: "pending",
    params: { repository: "github:octo/sum-fixture", remote: "https://github.com/octo/sum-fixture.git", ref: "refs/heads/orbit-web/0b6c2f5e", commit: "a".repeat(40), force: false, expectedRemoteOid: null, branch: "orbit-web/0b6c2f5e", sourceRef: "refs/orbit/push/x", sessionId: SESSION_ID },
    summary: "Push aaaaaaaaaaaa to orbit-web/0b6c2f5e of octo/sum-fixture (GitHub): 1 commit(s), 1 file(s)",
    requestedAt: "2026-11-20T10:00:00.000Z",
    requestedBy: "agent:agt-1",
    requestedByType: "agent",
    agentId: "agt-1",
    workspaceId: SESSION_ID,
    runId: "run-1",
    decisionId: "dec-1",
    expiresAt: "2026-11-21T10:00:00.000Z",
    decidedBy: null,
    decidedAt: null,
    consumedAt: null,
    outcome: null,
    change: { files: 1, insertions: 1, deletions: 1, commits: 1, diffstat: " sum.mjs | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n" },
    ...over,
  };
}

// ---- a department's policy (governance-core department.ts) ------------------------------------------------------------
//
// The company delegates to its departments: tool.web up to allowed (its own rule for it a default a department's answer
// replaces), repository.push up to "you approve first" (its own rule for it mandatory), employee network access up to
// Restricted within *.example.com, and two models. A department's rows, network access and models are worked out by
// governance-core itself, as the API works them out.

export const DEPARTMENT_ID = DEPT_ACCOUNTING;
export const DEPARTMENT_DIGEST = "8".repeat(64);
export const DEPARTMENT_DRAFT_DIGEST = "7".repeat(64);

// The company's policy: the governed deployment's default, delegating to its departments.
export function delegatingPolicy(): AccountPolicy {
  const policy = defaultAccountPolicy(ACCOUNT_ID, "governed");
  return {
    ...policy,
    delegation: { departments: { actions: { "tool.web": "allow", "repository.push": "require_approval" }, employeeNetwork: { mode: "RESTRICTED", allowWithin: ["*.example.com"] }, models: { allow: ["claude:sonnet", "claude:opus"] } } },
    rules: policy.rules.map((r) => (r.id === "web-tools" ? { ...r, binding: "default" as const } : r)),
  };
}

// The department's own document: by default it says nothing, and inherits everything.
export function departmentDocument(over: Partial<DepartmentPolicy> = {}): DepartmentPolicy {
  return { apiVersion: "orbit.governance/v2", kind: "DepartmentPolicy", metadata: { accountId: ACCOUNT_ID, departmentId: DEPARTMENT_ID, name: "Accounting policy" }, rules: [], ...over };
}

// A revision of the department's policy, as GET .../policy/revisions/:id says it: by default its revision 1, in effect.
export function departmentRevisionView(over: Partial<DepartmentRevisionView> = {}): DepartmentRevisionView {
  return {
    ...revisionView({ id: "dpr-1", digest: DEPARTMENT_DIGEST, name: "Accounting policy", source: "owner", createdBy: OWNER, updatedAt: "2026-11-21T09:00:00.000Z", confirmedBy: OWNER, confirmedAt: "2026-11-21T09:00:00.000Z", publishedAt: "2026-11-21T09:00:00.000Z", publishedBy: OWNER, authors: [OWNER] }),
    document: departmentDocument(),
    departmentId: DEPARTMENT_ID,
    companyBase: "rev-1",
    ...over,
  };
}

// A draft of the department's policy, compared with its revision in effect (`dpr-1`).
export function departmentDraftView(over: Partial<DepartmentRevisionView> = {}): DepartmentRevisionView {
  return departmentRevisionView({ id: "dpr-2", revision: null, state: "DRAFT", digest: DEPARTMENT_DRAFT_DIGEST, name: "Accounting next", source: "copy", basedOn: "dpr-1", updatedAt: "2026-11-21T10:00:00.000Z", confirmedBy: null, confirmedAt: null, publishedAt: null, publishedBy: null, base: "dpr-1", ...over });
}

// GET /api/governance/departments/:id/policy, under the delegating company policy (revision 1) and the department's
// revision in effect (none: it inherits the company's).
export function departmentPolicyOverview(effective: DepartmentRevisionView | null, revisions: RevisionSummary[] = effective === null ? [] : [revisionSummary(effective)], over: Partial<DepartmentPolicyOverview> = {}): DepartmentPolicyOverview {
  const company = delegatingPolicy();
  const dept = effective === null ? null : (effective.document as DepartmentPolicy);
  return {
    departmentId: DEPARTMENT_ID,
    departmentName: "Accounting",
    companyRevision: { id: "rev-1", revision: 1 },
    effective,
    revisions,
    rows: departmentTableOf(company, dept, DEPARTMENT_ID),
    network: composeEmployeeNetwork(company, dept),
    models: composeEmployeeModels(company, dept),
    delegation: company.delegation?.departments ?? null,
    ...over,
  };
}
