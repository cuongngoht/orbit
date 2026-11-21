// Request and response bodies of the Orbit Web API (`/api/...`). One definition for both sides.
import type { EffortChoice, ModeChoice, ModelChoice, RepositorySource } from "./models.js";
import type { ConnectionState, LoginState, SessionStatus, ThemePreference } from "./status.js";
import type { AnySessionEvent } from "./events/envelope.js";
import type { ImageRef } from "./images.js";

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

// The DATABASE, as the health check reads it: PostgreSQL answers, its schema is the one this build needs, pgvector is
// enabled. Never its address, user or password.
export interface DatabaseCheck extends ComponentCheck {
  // PostgreSQL's server version, as it says it.
  server: string | null;
  // The schema version applied, and the one this build needs.
  schema: number | null;
  latestSchema: number;
  // pgvector's version (null: not enabled).
  pgvector: string | null;
}

// GET /api/health -- what is installed and writable here. Never a path, a variable or an account. `az` and `python` are
// reported but optional (an image may be built without either): they never make the status degraded.
export interface HealthReport {
  status: "ok" | "degraded";
  api: ComponentCheck;
  claude: ComponentCheck;
  gh: ComponentCheck;
  git: ComponentCheck;
  az: ComponentCheck;
  python: ComponentCheck;
  orbitPlugin: ComponentCheck;
  storage: ComponentCheck;
  database: DatabaseCheck;
}

export interface BuildVersions {
  web: string;
  orbit: string | null;
  orbitCommit: string | null;
  claude: string | null;
  gh: string | null;
  git: string | null;
  az: string | null;
  python: string | null;
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

// THIS BROWSER's session, issued when this browser finished a Claude sign-in: the internal account of the verified Claude
// identity, of which the person is the owner. `csrfToken` goes with every change this browser makes (CSRF_HEADER).
export interface BrowserSession {
  accountId: string;
  // The account's display name (a business name, editable; empty until somebody sets one).
  displayName: string;
  email: string;
  csrfToken: string;
  expiresAt: string;
}

// The Claude sign-in IS the sign-in of Orbit Web, and it is a BROWSER's: every API call but the health check, the access
// token and the Claude sign-in itself is refused (401 claude_sign_in_required) until THIS browser finished a sign-in with a
// Claude account (`authMethod: "claude.ai"`) -- the runtime's CLI being signed in already is not enough: a browser that
// did not finish the sign-in itself is asked to. An API key or a token variable the container was started with is not an
// account, and is never given to Claude Code.
export interface ClaudeStatus {
  // `connected` when this browser holds a valid session; otherwise what keeps it out.
  state: ConnectionState;
  // What the runtime's Claude CLI says about its own sign-in (never which account, to a browser without a session).
  runtime: ConnectionState;
  // The CLI's own word for how it is signed in (e.g. "claude.ai"), when it says one.
  method: string | null;
  // The account of this browser's session (null without one).
  account: ClaudeAccount | null;
  session: BrowserSession | null;
  detail: string | null;
  // This browser's own sign-in flow (another browser's is never shown).
  flow: LoginSnapshot;
}

// A browser session of the account, as its owner sees them (Settings → Account).
export interface BrowserSessionView {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export interface AccountView {
  id: string;
  displayName: string;
  email: string;
  organization: string | null;
  plan: string | null;
  createdAt: string;
  sessions: BrowserSessionView[];
}

export interface UpdateAccountRequest {
  displayName: string;
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
  // Whether Claude Code may use this sign-in to push and open pull requests (a person's setting; off unless they turn
  // it on).
  availableToClaude: boolean;
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

// Whose a chat (or a research workspace) is, as the Claude account signed in now sees it: its own (`owner`), or one its
// owner shared with this account's email (`shared`). An account sees nothing else.
export type AccessLevel = "owner" | "shared";

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
  access: AccessLevel;
  // The owner's email (null for a chat that predates owners and was never claimed).
  owner: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  runId: string | null;
  createdAt: string;
  // The images a person's message carried (images.ts), in the order sent; absent when none.
  images?: ImageRef[];
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
  // The first message, sent once the workspace is ready -- its words, its images, or both.
  prompt?: string;
  images?: string[];
}

// The model, effort and mode a session prefers apply from its next message.
export interface UpdateSessionRequest {
  title?: string;
  model?: ModelChoice;
  effort?: EffortChoice;
  mode?: ModeChoice;
}

// THE WORKING BRANCH of an open chat: the branch its workspace has checked out, where Claude Code commits. A chat starts
// on a branch of its own (orbit-web/<id>); a person may move it to another branch of the repository (fetched for it)
// or of the workspace, or to a new branch made from the work as it is. Never the repository's default branch.

// One branch a chat can work on: the workspace's (local), the repository's (remote), or both.
export interface WorkBranch {
  name: string;
  local: boolean;
  remote: boolean;
  // The repository's default branch: listed, never worked on directly.
  isDefault: boolean;
}

// GET /api/sessions/:id/branches
export interface WorkBranches {
  // The branch the workspace has checked out; null when HEAD names none.
  current: string | null;
  // The branch the chat compares its changes against (the one it started from); null without a repository.
  base: string | null;
  branches: WorkBranch[];
  // The repository's branches could not be read now (its source said why): the workspace's are listed alone.
  remoteError: string | null;
}

// POST /api/sessions/:id/branch -- an existing branch, or (create) a new one from the work as it is.
export interface ChangeBranchRequest {
  branch: string;
  create?: boolean;
}

// GET /api/access/link: this Orbit Web's access token, for whoever is already in -- Settings → Account offers the
// access link (`<origin>/#access=<token>`) to open it in another browser. Null on this machine alone (no token).
export interface AccessLink {
  token: string | null;
}

// SHARING A CHAT: a read-only link to a SNAPSHOT of its conversation, taken when it is shared -- what comes after is in
// it only once its owner updates it. Anyone with the link reads it, without the access token or a Claude sign-in; it
// shows the conversation and nothing else of Orbit Web. Tools are said by their title only unless the owner chose to
// include what they did (their input and output may hold the repository's code). Everything is masked by token shape.
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface ShareInfo {
  // The link is `<origin>/#/share/<token>`: in the fragment, so no server or Referer ever sees it.
  token: string;
  includeTools: boolean;
  createdAt: string;
  updatedAt: string;
  // How many entries the snapshot holds (messages, tool calls, plans).
  entries: number;
}

// GET /api/sessions/:id/share
export interface ShareState {
  share: ShareInfo | null;
}

// POST /api/sessions/:id/share -- share the conversation as it is now, or update the shared copy (same link).
export interface ShareRequest {
  includeTools?: boolean;
}

// GET /api/shared/:token -- what a shared link shows.
export interface SharedChat {
  title: string;
  repository: string | null;
  source: RepositorySource | null;
  sharedAt: string;
  includeTools: boolean;
  events: AnySessionEvent[];
}

export interface SendMessageRequest {
  // May be empty when the message carries an image: the image is the message.
  text: string;
  // Images uploaded first (POST /api/images), by id.
  images?: string[];
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
  // A repository's skills, commands and agents are loaded for its chats, as instructions only (their hooks,
  // allowed-tools and pre-run commands removed). On unless a person turns it off.
  projectSkills: boolean;
  // The plugins a repository is or declares are run for its chats. Off unless a person turns it on: a plugin runs code
  // (hooks, MCP servers) in the container.
  projectPlugins: boolean;
  // WebFetch and WebSearch are offered to Claude only when this is on.
  webTools: boolean;
  // Claude Code is given GitHub CLI's sign-in (it may then push and open pull requests with `gh` as the signed-in
  // account) only when this is on.
  githubForClaude: boolean;
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
  projectSkills?: boolean;
  projectPlugins?: boolean;
  webTools?: boolean;
  githubForClaude?: boolean;
  azureForClaude?: boolean;
  theme?: ThemePreference;
}

export interface AccessRequest {
  token: string;
}

// SHARING BETWEEN CLAUDE ACCOUNTS. A chat, or a research workspace, is its owner's alone until the owner names the
// emails of other Claude accounts that may open it too: they read it and carry on with it as themselves; only the owner
// deletes it, shares it on, or makes a public link of it.
export interface AccessEntry {
  email: string;
  grantedBy: string;
  grantedAt: string;
}

// GET /api/sessions/:id/access, GET /api/research/workspaces/:id/access
export interface AccessList {
  access: AccessLevel;
  owner: string | null;
  people: AccessEntry[];
}

// PUT …/access: the whole list of emails it is shared with (an empty list: shared with nobody).
export interface UpdateAccessRequest {
  people: string[];
}
