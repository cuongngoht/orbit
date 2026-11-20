// What the API answers, for the web app's tests.
import type { Permission } from "@orbit-web/governance-core";
import {
  ORBIT_WEB_VERSION,
  type ApprovalView,
  type GovernanceState,
  type AzureStatus,
  type ClaudeStatus,
  type ConnectionState,
  type GitHubStatus,
  type LoginSnapshot,
  type OrbitPanel,
  type ProjectInventory,
  type Repository,
  type SessionDetail,
  type SessionSummary,
  type Settings,
  type SetupStatus,
  type SourcesStatus,
} from "@orbit-web/contracts";

// GET /api/settings, as a fresh Orbit Web answers it.
export function settings(over: Partial<Settings> = {}): Settings {
  return { defaultModel: "sonnet", defaultEffort: "medium", defaultMode: "autonomous", projectSkills: true, projectPlugins: false, webTools: false, githubForClaude: false, azureForClaude: false, theme: "system", maxBudgetUsd: null, ...over };
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

// The Claude sign-in, as GET /api/claude/status says it: by default signed in to a Claude account.
export function claudeStatus(over: Partial<ClaudeStatus> = {}): ClaudeStatus {
  return { state: "connected", method: "claude.ai", account: { email: "octo@example.com", organization: "Octo Org", plan: "max" }, detail: null, flow: idleFlow(), ...over };
}

export const signedOutClaude = (over: Partial<ClaudeStatus> = {}): ClaudeStatus => claudeStatus({ state: "not_connected", method: null, account: null, ...over });

// GET /api/setup/status, which answers only once Orbit Web is signed in to Claude: so Claude is signed in by default.
export function setupStatus(claude: Partial<ClaudeStatus> = {}, github: Partial<GitHubStatus> = {}, azure: Partial<AzureStatus> = {}): SetupStatus {
  const c: ClaudeStatus = claudeStatus(claude);
  const g: GitHubStatus = { state: "not_connected", account: null, detail: null, flow: idleFlow(), availableToClaude: false, ...github };
  const a: AzureStatus = { state: "not_connected", account: null, detail: null, flow: idleFlow(), availableToClaude: false, ...azure };
  return {
    versions: { web: ORBIT_WEB_VERSION, orbit: "0.6.0", orbitCommit: "6c36207cd57204f6f50deb3431a5db516b27f4bc", claude: "2.1.328", gh: "2.89.0", git: "2.43.0", az: "2.91.0", python: "3.15.2", node: "24.11.0" },
    claude: c,
    github: g,
    azure: a,
    health: { status: "ok", api: ok, claude: { ok: true, detail: "2.1.328" }, gh: { ok: true, detail: "2.89.0" }, git: ok, az: { ok: true, detail: "2.91.0" }, python: { ok: true, detail: "3.15.2" }, orbitPlugin: { ok: true, detail: "0.6.0" }, storage: ok },
  };
}

export const SESSION_ID = "0b6c2f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";

export function sessionDetail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SESSION_ID,
    title: "Fix sum",
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
  const { id, title, source, repository, branch, workBranch, model, effort, mode, status, statusReason, access, owner, createdAt, updatedAt } = sessionDetail(over);
  return { id, title, source, repository, branch, workBranch, model, effort, mode, status, statusReason, access, owner, createdAt, updatedAt };
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

export const ORG = { id: "org-0123456789ab", name: "Acme" };

const OWNER_PERMISSIONS = ["governance.read", "audit.read", "audit.verify", "reports.read", "reports.generate", "findings.read", "findings.manage", "constitution.edit", "constitution.approve", "constitution.publish", "operators.read", "operators.manage", "roles.manage", "agents.manage", "workspaces.govern", "approvals.read", "approvals.decide", "settings.privileged.write"];
const AUDITOR_PERMISSIONS = ["governance.read", "audit.read", "audit.verify", "reports.read", "reports.generate", "findings.read", "operators.read", "approvals.read"];

export const CSRF = "c".repeat(64);

export function governanceState(role: "none" | "uninitialized" | "organization_owner" | "auditor" = "organization_owner"): GovernanceState {
  if (role === "uninitialized") return { initialized: false, organization: null, bootstrapOpen: true, session: null, deployment: "single" };
  if (role === "none") return { initialized: true, organization: ORG, bootstrapOpen: false, session: null, deployment: "single" };
  const permissions = (role === "auditor" ? AUDITOR_PERMISSIONS : OWNER_PERMISSIONS) as Permission[];
  return {
    initialized: true,
    organization: ORG,
    bootstrapOpen: false,
    deployment: "single",
    session: { operator: { id: "op-1", username: role === "auditor" ? "audrey" : "owner", displayName: role === "auditor" ? "Audrey" : "Olivia", status: "active", roles: [role], createdAt: "2026-11-20T00:00:00.000Z" }, permissions, csrfToken: CSRF, expiresAt: "2026-11-21T00:00:00.000Z" },
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
