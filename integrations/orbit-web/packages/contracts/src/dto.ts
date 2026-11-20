// Request and response bodies of the Orbit Web API (`/api/...`). One definition for both sides.
import type { EffortChoice, ModeChoice, ModelChoice, RepositorySource } from "./models.js";
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

// GET /api/setup/status: everything Settings → System shows. The chat never waits on it: once signed in to Claude, the
// chat is open; GitHub and Azure are connectors a repository picker uses.
export interface SetupStatus {
  versions: BuildVersions;
  claude: ClaudeStatus;
  github: GitHubStatus;
  azure: AzureStatus;
  health: HealthReport;
}

// GET /api/sources: which repository sources can list repositories right now, and as whom.
export interface SourceState {
  source: RepositorySource;
  state: ConnectionState;
  // GitHub's login, or the Azure account's user name.
  account: string | null;
}

export interface SourcesStatus {
  sources: SourceState[];
}

// A repository a source lists. `id` is how the API names it back: GitHub `owner/name`, Azure DevOps
// `organization/<repository id>`. `fullName` is what a person reads: `owner/name`, or `organization/project/name`.
export interface Repository {
  source: RepositorySource;
  id: string;
  fullName: string;
  // GitHub's owner, or the Azure DevOps organization.
  owner: string;
  // The Azure DevOps project; null on GitHub.
  project: string | null;
  name: string;
  private: boolean;
  defaultBranch: string | null;
  updatedAt: string | null;
  // GitHub's archived flag, or Azure DevOps' disabled one.
  archived: boolean;
  fork: boolean;
}

export interface RepositoryList {
  source: RepositorySource;
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
  source: RepositorySource;
  // The repository's id.
  repository: string;
  branches: Branch[];
}

// How a request names a repository: its source and the id that source listed it under.
export interface RepositoryRef {
  source: RepositorySource;
  id: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  // Where the workspace came from; all three are null for a chat started without a repository.
  source: RepositorySource | null;
  repository: string | null;
  branch: string | null;
  workBranch: string | null;
  model: ModelChoice;
  effort: EffortChoice;
  mode: ModeChoice;
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

// A chat starts with or without a repository. With one, `branch` defaults to the repository's default branch; the
// effort and the mode default to Settings'.
export interface CreateSessionRequest {
  repository?: RepositoryRef | null;
  branch?: string | null;
  model: ModelChoice;
  effort?: EffortChoice;
  mode?: ModeChoice;
  title?: string;
  // The first message, sent once the workspace is ready.
  prompt?: string;
}

// The model, effort and mode a session prefers apply from its next message.
export interface UpdateSessionRequest {
  title?: string;
  model?: ModelChoice;
  effort?: EffortChoice;
  mode?: ModeChoice;
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
  repository: string | null;
  // The branch the chat started from; null for a workspace with no repository.
  baseBranch: string | null;
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
  defaultEffort: EffortChoice;
  defaultMode: ModeChoice;
  // The plugins a repository is or declares are run for its chats. Off unless a person turns it on: a plugin runs code
  // (hooks, MCP servers) in the container. A repository's skills, commands and agents load either way, as instructions.
  projectPlugins: boolean;
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
  defaultEffort?: EffortChoice;
  defaultMode?: ModeChoice;
  projectPlugins?: boolean;
  webTools?: boolean;
  azureForClaude?: boolean;
  theme?: ThemePreference;
}

export interface AccessRequest {
  token: string;
}
