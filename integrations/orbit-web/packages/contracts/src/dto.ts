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

// GET /api/health -- what is installed and writable here. Never a path, a variable or an account.
export interface HealthReport {
  status: "ok" | "degraded";
  api: ComponentCheck;
  claude: ComponentCheck;
  gh: ComponentCheck;
  git: ComponentCheck;
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
  node: string;
}

// One official CLI sign-in, as the API drives it.
export interface LoginSnapshot {
  state: LoginState;
  // The URL the CLI printed for a person to open, exactly as printed.
  url: string | null;
  // GitHub CLI's one-time device code, exactly as printed. Claude's flow has none.
  code: string | null;
  // Claude's flow waits for the code a person copies from the browser page.
  needsCode: boolean;
  message: string | null;
  startedAt: string | null;
  updatedAt: string;
}

export interface ClaudeStatus {
  state: ConnectionState;
  // The CLI's own word for how it is signed in (e.g. "claude.ai", "oauth_token"), when it says one.
  method: string | null;
  // "environment" when the container was given the CLI's own credential variable.
  source: "cli" | "environment" | null;
  detail: string | null;
  flow: LoginSnapshot;
}

export type ClaudeLoginMode = "claudeai" | "console";

export interface ClaudeLoginRequest {
  mode?: ClaudeLoginMode;
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

export interface SetupStatus {
  versions: BuildVersions;
  claude: ClaudeStatus;
  github: GitHubStatus;
  health: HealthReport;
  // Both accounts are connected: the chat workspace may open.
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
  theme: ThemePreference;
  // Read-only: the per-run budget cap the container was started with (ORBIT_WEB_MAX_BUDGET_USD), or none.
  maxBudgetUsd: number | null;
}

export interface UpdateSettingsRequest {
  defaultModel?: ModelChoice;
  webTools?: boolean;
  theme?: ThemePreference;
}

export interface AccessRequest {
  token: string;
}
