// Request and response bodies of the Orbit Web API (`/api/...`). One definition for both sides.
import type { ModelChoice } from "./models.js";
import type { ConnectionState, LoginState, SessionStatus, ThemePreference } from "./status.js";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ComponentCheck {
  ok: boolean;
  detail: string | null;
}

// GET /api/health -- what is installed and writable here. Never a path, a variable or an account. `az` is reported but
// optional (an image may be built without the Azure CLI): it never makes the status degraded.
export interface HealthReport {
  status: "ok" | "degraded";
  api: ComponentCheck;
  claude: ComponentCheck;
  gh: ComponentCheck;
  git: ComponentCheck;
  az: ComponentCheck;
  orbitPlugin: ComponentCheck;
  storage: ComponentCheck;
}

export interface BuildVersions {
  web: string;
  orbit: string | null;
  orbitCommit: string | null;
  claude: string | null;
  gh: string | null;
  git: string | null;
  az: string | null;
  node: string;
}

// One official CLI sign-in, as the API drives it.
export interface LoginSnapshot {
  state: LoginState;
  // The URL the CLI printed for a person to open, exactly as printed.
  url: string | null;
  // The one-time device code GitHub CLI or the Azure CLI printed, exactly as printed. Claude's flow has none.
  code: string | null;
  // Claude's flow waits for the code a person copies from the browser page.
  needsCode: boolean;
  message: string | null;
  startedAt: string | null;
  updatedAt: string;
}

// The Claude account Orbit Web is signed in with: the identity of this Orbit Web, as `claude auth status` says it.
export interface ClaudeAccount {
  email: string | null;
  organization: string | null;
  // The CLI's own word for the subscription (e.g. "pro", "max", "team"), when it says one.
  plan: string | null;
}

// The Claude sign-in IS the sign-in of Orbit Web: every API call but the health check, the access token and the Claude
// sign-in itself is refused (401 claude_sign_in_required) until `claude auth status` reports a Claude account
// (`authMethod: "claude.ai"`). An API key or a token variable the container was started with is not an account, and is
// never given to Claude Code.
export interface ClaudeStatus {
  state: ConnectionState;
  // The CLI's own word for how it is signed in (e.g. "claude.ai"), when it says one.
  method: string | null;
  account: ClaudeAccount | null;
  detail: string | null;
  flow: LoginSnapshot;
}

export interface ClaudeLoginCodeRequest {
  code: string;
}

export interface GitHubAccount {
  login: string;
  name: string | null;
}

export interface GitHubStatus {
  state: ConnectionState;
  account: GitHubAccount | null;
  detail: string | null;
  flow: LoginSnapshot;
}

// The Azure account the Azure CLI in this container is signed in to, as `az account show` says it. Optional: the chat
// workspace never waits for it.
export interface AzureAccount {
  user: string;
  userType: string | null;
  tenantId: string | null;
  subscription: string | null;
  subscriptionId: string | null;
}

export interface AzureStatus {
  state: ConnectionState;
  account: AzureAccount | null;
  detail: string | null;
  flow: LoginSnapshot;
  // Whether Claude Code may use this sign-in (a person's setting; off unless they turn it on).
  availableToClaude: boolean;
}

export interface AzureLoginRequest {
  // A tenant (directory) id or domain to sign in to; the CLI's own default when absent.
  tenant?: string;
}

export interface SetupStatus {
  versions: BuildVersions;
  claude: ClaudeStatus;
  github: GitHubStatus;
  azure: AzureStatus;
  health: HealthReport;
  // Both required accounts (Claude and GitHub) are connected: the chat workspace may open.
  ready: boolean;
}

export interface Repository {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string | null;
  updatedAt: string | null;
  archived: boolean;
  fork: boolean;
}

export interface RepositoryList {
  repositories: Repository[];
  fetchedAt: string;
  partial: boolean;
}

export interface Branch {
  name: string;
  protected: boolean;
  commit: string | null;
  isDefault: boolean;
}

export interface BranchList {
  repository: string;
  branches: Branch[];
}

export interface SessionSummary {
  id: string;
  title: string;
  repository: string;
  branch: string;
  workBranch: string | null;
  model: ModelChoice;
  status: SessionStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  runId: string | null;
  createdAt: string;
}

export interface SessionDetail extends SessionSummary {
  baseCommit: string | null;
  claudeSessionId: string | null;
  turns: number;
  lastSeq: number;
  messages: ChatMessage[];
}

export interface CreateSessionRequest {
  repository: string;
  branch: string;
  model: ModelChoice;
  title?: string;
  // The first message, sent once the workspace is ready.
  prompt?: string;
}

export interface UpdateSessionRequest {
  title?: string;
  model?: ModelChoice;
}

export interface SendMessageRequest {
  text: string;
}

export interface RunAccepted {
  sessionId: string;
  runId: string;
}

export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed" | "untracked" | "conflicted";

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  kind: ChangeKind;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface ChangesReport {
  sessionId: string;
  repository: string;
  baseBranch: string;
  workBranch: string | null;
  currentBranch: string | null;
  baseCommit: string | null;
  headCommit: string | null;
  upstream: string | null;
  files: ChangedFile[];
  totals: { files: number; additions: number; deletions: number };
  checkedAt: string;
}

export interface FileDiff {
  path: string;
  kind: ChangeKind;
  binary: boolean;
  tooLarge: boolean;
  diff: string | null;
  language: string | null;
}

export interface Settings {
  defaultModel: ModelChoice;
  // WebFetch and WebSearch are offered to Claude only when this is on.
  webTools: boolean;
  // Claude Code is given the Azure CLI's sign-in (it may then run `az` as the signed-in account) only when this is on.
  azureForClaude: boolean;
  theme: ThemePreference;
  // Read-only: the per-run budget cap the container was started with (ORBIT_WEB_MAX_BUDGET_USD), or none.
  maxBudgetUsd: number | null;
}

export interface UpdateSettingsRequest {
  defaultModel?: ModelChoice;
  webTools?: boolean;
  azureForClaude?: boolean;
  theme?: ThemePreference;
}

export interface AccessRequest {
  token: string;
}
