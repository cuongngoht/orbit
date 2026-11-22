// THE GOVERNANCE VOCABULARY: every word a policy, a decision or an audit record may use, declared once.
//
// An ACTION is a row of ACTIONS, never a command line and never a tool name. Each row says WHERE the action is
// enforced, because a decision is only worth what stands behind it:
//
//   boundary  the container, the broker or the egress proxy holds it -- the agent cannot change it. Only a boundary
//             action may ever be reported as PREVENTED.
//   control   the API refuses it for a caller without the authority (the account owner's session, a run's token).
//   runtime   the agent runtime is CONFIGURED to respect it (a flag, a tool list). Defence in depth: it rests on the
//             agent's own cooperation and is never called enforcement.
//   none      nothing here can carry the action out, so it can only ever be denied.
//
// A CEILING is the loosest effect a kind of principal may ever receive for an action, whatever a rule says: an agent
// can never be allowed to modify the policy that governs it, and nobody is ever allowed to read a raw credential.

export const EFFECTS = ["allow", "require_approval", "deny"] as const;
export type Effect = (typeof EFFECTS)[number];

const RANK: Record<Effect, number> = { allow: 0, require_approval: 1, deny: 2 };

export const rankOf = (effect: Effect): number => RANK[effect];

// Deny overrides approval, approval overrides allow.
export const strictest = (a: Effect, b: Effect): Effect => (RANK[a] >= RANK[b] ? a : b);

export const isEffect = (v: unknown): v is Effect => typeof v === "string" && (EFFECTS as readonly string[]).includes(v);

export const PRINCIPAL_TYPES = ["human", "agent", "service"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const isPrincipalType = (v: unknown): v is PrincipalType => typeof v === "string" && (PRINCIPAL_TYPES as readonly string[]).includes(v);

// Unknown is never production: an environment is production only when somebody declared it.
export const ENVIRONMENTS = ["local", "test", "development", "staging", "production", "unknown"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const isEnvironment = (v: unknown): v is Environment => typeof v === "string" && (ENVIRONMENTS as readonly string[]).includes(v);

export const ENFORCEMENT_POINTS = ["boundary", "control", "runtime", "none"] as const;
export type EnforcementPoint = (typeof ENFORCEMENT_POINTS)[number];

// The subjects a Constitution speaks about; every action belongs to one.
export const POLICY_SUBJECTS = ["execution", "resources", "credentials", "filesystem", "network", "tools", "git", "production", "governance"] as const;
export type PolicySubject = (typeof POLICY_SUBJECTS)[number];

export interface ActionSpec {
  summary: string;
  subject: PolicySubject;
  enforcement: EnforcementPoint;
  // Loosening it is a high-risk change of policy.
  sensitive: boolean;
  // The loosest effect each kind of principal may ever receive. A kind that is not named has no ceiling.
  ceiling: Partial<Record<PrincipalType, Effect>>;
  // The parameters that make one request THE SAME request as another: what an approval is bound to.
  fingerprint: readonly string[];
}

const NOBODY: Record<PrincipalType, Effect> = { human: "deny", agent: "deny", service: "deny" };
const PEOPLE_ONLY: Partial<Record<PrincipalType, Effect>> = { agent: "deny", service: "deny" };
// A production action is never simply allowed to an agent: the most it gets is one approval of exactly it.
const PROTECTED: Partial<Record<PrincipalType, Effect>> = { agent: "require_approval", service: "require_approval" };

export const ACTIONS = {
  "agent.run.start": { summary: "Start a run of an agent in a workspace.", subject: "execution", enforcement: "control", sensitive: false, ceiling: {}, fingerprint: ["workspace", "agent"] },
  "repository.read": { summary: "Read the workspace's repository.", subject: "resources", enforcement: "runtime", sensitive: false, ceiling: {}, fingerprint: ["workspace"] },
  "repository.write": { summary: "Change files of the workspace's repository.", subject: "resources", enforcement: "runtime", sensitive: false, ceiling: {}, fingerprint: ["workspace"] },
  "workspace.execute": { summary: "Run commands in the workspace: builds, tests, local tools.", subject: "tools", enforcement: "runtime", sensitive: false, ceiling: {}, fingerprint: ["workspace"] },
  "tool.web": { summary: "Use the runtime's own web fetch and web search tools.", subject: "tools", enforcement: "runtime", sensitive: true, ceiling: {}, fingerprint: ["workspace"] },
  // A connector of the account: one of its claude.ai connectors, or an installed plugin's MCP server. The account's owner
  // chooses which a chat and research may use; the policy then decides each one, for each run.
  "tool.connector": { summary: "Use one of the account's connectors (claude.ai's, an installed plugin's server, or -- an employee's ask, made by Orbit Web with the installation's sign-in -- GitHub or Azure DevOps).", subject: "tools", enforcement: "runtime", sensitive: true, ceiling: {}, fingerprint: ["connector"] },
  "network.egress": { summary: "Open a connection from the agent's runtime to a host.", subject: "network", enforcement: "boundary", sensitive: true, ceiling: {}, fingerprint: ["host", "port"] },
  "filesystem.outside_workspace": { summary: "Reach files outside the agent's own storage.", subject: "filesystem", enforcement: "boundary", sensitive: true, ceiling: { agent: "deny", service: "deny" }, fingerprint: ["path"] },
  "credential.read_raw": { summary: "Read a stored credential itself: a token, a sign-in file, a session.", subject: "credentials", enforcement: "boundary", sensitive: true, ceiling: NOBODY, fingerprint: ["credential"] },
  "settings.privileged.write": { summary: "Turn on a setting that hands the agent a sign-in or lets a repository's code run.", subject: "credentials", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["setting"] },
  // Git with the remote is the account policy's to decide, for an agent as for a person: allowed, Orbit Web pushes at once;
  // a person approves first, it waits for one approval of exactly that push. Never forced, never the default branch.
  "repository.push": { summary: "Git: push the work's branch to its remote repository.", subject: "git", enforcement: "boundary", sensitive: true, ceiling: {}, fingerprint: ["repository", "remote", "ref", "commit", "force", "expectedRemoteOid"] },
  "deployment.production": { summary: "Deploy to a production environment.", subject: "production", enforcement: "none", sensitive: true, ceiling: PROTECTED, fingerprint: ["environment", "target", "revision"] },
  "database.production.migrate": { summary: "Migrate a production database.", subject: "production", enforcement: "none", sensitive: true, ceiling: PROTECTED, fingerprint: ["environment", "target", "revision"] },
  "data.production.destroy": { summary: "Delete or overwrite production data.", subject: "production", enforcement: "none", sensitive: true, ceiling: PROTECTED, fingerprint: ["environment", "target", "operation"] },
  "governance.policy.propose": { summary: "Hand in a draft of the account's policy for its owner to consider.", subject: "governance", enforcement: "control", sensitive: false, ceiling: {}, fingerprint: ["account"] },
  "governance.policy.modify": { summary: "Change, confirm or publish the account's policy.", subject: "governance", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["account"] },
  "governance.approval.decide": { summary: "Approve or reject a protected action.", subject: "governance", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["approval"] },
  "governance.audit.modify": { summary: "Change or remove an audit record.", subject: "governance", enforcement: "control", sensitive: true, ceiling: NOBODY, fingerprint: ["event"] },
  // THE VIRTUAL OFFICE (0.8.0): what an account's owner -- or, within its grant, a manager employee -- does with it.
  "office.department.manage": { summary: "Create, rename, reorder or archive the office's departments.", subject: "governance", enforcement: "control", sensitive: false, ceiling: PEOPLE_ONLY, fingerprint: ["account"] },
  "office.roster.manage": { summary: "Move an employee between departments, or change who manages whom.", subject: "governance", enforcement: "control", sensitive: false, ceiling: PEOPLE_ONLY, fingerprint: ["employee"] },
  "employee.hire": { summary: "Hire a permanent AI employee, or change one's employment.", subject: "execution", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["employee"] },
  "employee.hire_assistant": { summary: "Engage a temporary assistant for one mission, within a manager's grant.", subject: "execution", enforcement: "control", sensitive: true, ceiling: {}, fingerprint: ["mission", "employee"] },
  "employee.resources.change": { summary: "Change the CPU, memory or storage an employee's attempts may use.", subject: "resources", enforcement: "control", sensitive: false, ceiling: PEOPLE_ONLY, fingerprint: ["employee"] },
  "work.assign": { summary: "Give a mission to an employee, or decide on its result.", subject: "execution", enforcement: "control", sensitive: false, ceiling: {}, fingerprint: ["employee"] },
  "work.delegate": { summary: "Give a part of an assignment to another employee.", subject: "execution", enforcement: "control", sensitive: false, ceiling: {}, fingerprint: ["employee"] },
  "artifact.publish": { summary: "Publish a handoff's files as immutable artifacts of the account.", subject: "resources", enforcement: "control", sensitive: false, ceiling: {}, fingerprint: ["assignment"] },
  "notification.send": { summary: "Deliver an accepted result to a recipient.", subject: "resources", enforcement: "control", sensitive: true, ceiling: {}, fingerprint: ["recipient", "digest"] },
  "budget.change": { summary: "Change the account's resource budget (never above the operator's authorization).", subject: "resources", enforcement: "control", sensitive: false, ceiling: PEOPLE_ONLY, fingerprint: ["account"] },
  "connection.manage": { summary: "Add, change, sign out or remove an AI connection of the account.", subject: "credentials", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["connection"] },
} as const satisfies Record<string, ActionSpec>;

export type ActionKind = keyof typeof ACTIONS;

export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[];

export const isActionKind = (v: unknown): v is ActionKind => typeof v === "string" && Object.hasOwn(ACTIONS, v);

export const actionSpec = (kind: ActionKind): ActionSpec => ACTIONS[kind];

// The settings the account's owner, and the policy, stand in front of. Widening one hands the agent authority.
export const PRIVILEGED_SETTINGS = ["githubForClaude", "azureForClaude", "projectPlugins"] as const;
export type PrivilegedSetting = (typeof PRIVILEGED_SETTINGS)[number];

// THE CLAUDE ACCOUNT'S OWN SERVICE: where the Claude Code CLI signs in and reaches its model (the hosts Anthropic
// documents for Claude Code: the API, Claude Console's sign-in and claude.ai's). Declared once: the default policy
// lets a chat's or a research session's agent reach exactly these.
export const CLAUDE_ACCOUNT_HOSTS = [
  { rule: "egress-model-api", host: "api.anthropic.com", port: 443 },
  { rule: "egress-model-auth", host: "platform.claude.com", port: 443 },
  { rule: "egress-model-account", host: "claude.ai", port: 443 },
] as const;

export const isClaudeAccountHost = (host: string, port: number): boolean => CLAUDE_ACCOUNT_HOSTS.some((h) => h.host === host.toLowerCase() && h.port === port);

// Why a decision came out the way it did. A decision carries every code that applied, in the order it applied.
export const REASON_CODES = [
  "RULE_MATCHED",
  "DEFAULT_DECISION",
  "OVERLAY_NARROWED",
  "PRINCIPAL_CEILING",
  "NO_EXECUTOR",
  "NO_PUBLISHED_POLICY",
  "UNKNOWN_ACTION",
  "NO_VERIFIED_IDENTITY",
  "ACCOUNT_MISMATCH",
  "ISOLATION_NOT_PROVEN",
  "AUDIT_UNAVAILABLE",
  // An employee's connection, decided by the policy's employee network access (network.ts): any public host on 80 or
  // 443 (AUTONOMOUS), a host the allow-list names (RESTRICTED), a host it does not name, a port that is not 80 or 443.
  "EMPLOYEE_NETWORK_AUTONOMOUS",
  "EMPLOYEE_NETWORK_ALLOWED",
  "EMPLOYEE_NETWORK_NOT_LISTED",
  "EMPLOYEE_NETWORK_PORT",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

// What a decision is about, inside one account: the account itself (its settings, its policy), one of its chats
// (Claude Code workspaces), one of its research workspaces, or one of its employees (an assignment's run). Every run is
// held to its account's policy, and says which.
export const ENFORCEMENT_SCOPES = ["ACCOUNT", "ACCOUNT_WORKSPACE", "ACCOUNT_RESEARCH", "ACCOUNT_EMPLOYEE"] as const;
export type EnforcementScope = (typeof ENFORCEMENT_SCOPES)[number];

// The kinds of run a policy decides for: a chat's, a research session's, an employee's assignment.
export const RUN_KINDS = ["chat", "research", "assignment"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const isRunKind = (v: unknown): v is RunKind => typeof v === "string" && (RUN_KINDS as readonly string[]).includes(v);

// What a run's decisions are about.
export const RUN_SCOPES: Record<RunKind, EnforcementScope> = { chat: "ACCOUNT_WORKSPACE", research: "ACCOUNT_RESEARCH", assignment: "ACCOUNT_EMPLOYEE" };
