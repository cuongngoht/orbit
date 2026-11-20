// THE GOVERNANCE VOCABULARY: every word a policy, a decision or an audit record may use, declared once.
//
// An ACTION is a row of ACTIONS, never a command line and never a tool name. Each row says WHERE the action is
// enforced, because a decision is only worth what stands behind it:
//
//   boundary  the container, the broker or the egress proxy holds it -- the agent cannot change it. Only a boundary
//             action may ever be reported as PREVENTED.
//   control   the API refuses it for a caller without the authority (an operator's permission, a run's token).
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
// A protected action is never simply allowed to an agent: the most it gets is one approval of exactly it.
const PROTECTED: Partial<Record<PrincipalType, Effect>> = { agent: "require_approval", service: "require_approval" };

export const ACTIONS = {
  "agent.run.start": { summary: "Start a run of an agent in a workspace.", subject: "execution", enforcement: "control", sensitive: false, ceiling: {}, fingerprint: ["workspace", "agent"] },
  "repository.read": { summary: "Read the workspace's repository.", subject: "resources", enforcement: "runtime", sensitive: false, ceiling: {}, fingerprint: ["workspace"] },
  "repository.write": { summary: "Change files of the workspace's repository.", subject: "resources", enforcement: "runtime", sensitive: false, ceiling: {}, fingerprint: ["workspace"] },
  "workspace.execute": { summary: "Run commands in the workspace: builds, tests, local tools.", subject: "tools", enforcement: "runtime", sensitive: false, ceiling: {}, fingerprint: ["workspace"] },
  "tool.web": { summary: "Use the runtime's own web fetch and web search tools.", subject: "tools", enforcement: "runtime", sensitive: true, ceiling: {}, fingerprint: ["workspace"] },
  "network.egress": { summary: "Open a connection from the agent's runtime to a host.", subject: "network", enforcement: "boundary", sensitive: true, ceiling: {}, fingerprint: ["host", "port"] },
  "filesystem.outside_workspace": { summary: "Reach files outside the agent's own storage.", subject: "filesystem", enforcement: "boundary", sensitive: true, ceiling: { agent: "deny", service: "deny" }, fingerprint: ["path"] },
  "credential.read_raw": { summary: "Read a stored credential itself: a token, a sign-in file, a session.", subject: "credentials", enforcement: "boundary", sensitive: true, ceiling: NOBODY, fingerprint: ["credential"] },
  "settings.privileged.write": { summary: "Turn on a setting that hands the agent a sign-in or lets a repository's code run.", subject: "credentials", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["setting"] },
  "repository.push": { summary: "Push one commit to a remote repository.", subject: "git", enforcement: "boundary", sensitive: true, ceiling: PROTECTED, fingerprint: ["repository", "remote", "ref", "commit", "force", "expectedRemoteOid"] },
  "deployment.production": { summary: "Deploy to a production environment.", subject: "production", enforcement: "none", sensitive: true, ceiling: PROTECTED, fingerprint: ["environment", "target", "revision"] },
  "database.production.migrate": { summary: "Migrate a production database.", subject: "production", enforcement: "none", sensitive: true, ceiling: PROTECTED, fingerprint: ["environment", "target", "revision"] },
  "data.production.destroy": { summary: "Delete or overwrite production data.", subject: "production", enforcement: "none", sensitive: true, ceiling: PROTECTED, fingerprint: ["environment", "target", "operation"] },
  "governance.policy.propose": { summary: "Hand in a draft of a policy for people to consider.", subject: "governance", enforcement: "control", sensitive: false, ceiling: {}, fingerprint: ["organization"] },
  "governance.policy.modify": { summary: "Change, approve or publish the Constitution.", subject: "governance", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["organization"] },
  "governance.role.grant": { summary: "Give or take an operator's role.", subject: "governance", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["organization", "operator"] },
  "governance.approval.decide": { summary: "Approve or reject a protected action.", subject: "governance", enforcement: "control", sensitive: true, ceiling: PEOPLE_ONLY, fingerprint: ["approval"] },
  "governance.audit.modify": { summary: "Change or remove an audit record.", subject: "governance", enforcement: "control", sensitive: true, ceiling: NOBODY, fingerprint: ["event"] },
} as const satisfies Record<string, ActionSpec>;

export type ActionKind = keyof typeof ACTIONS;

export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[];

export const isActionKind = (v: unknown): v is ActionKind => typeof v === "string" && Object.hasOwn(ACTIONS, v);

export const actionSpec = (kind: ActionKind): ActionSpec => ACTIONS[kind];

// The settings an operator's permission, and the policy, stand in front of. Widening one hands the agent authority.
export const PRIVILEGED_SETTINGS = ["githubForClaude", "azureForClaude", "projectPlugins"] as const;
export type PrivilegedSetting = (typeof PRIVILEGED_SETTINGS)[number];

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
  "ORGANIZATION_MISMATCH",
  "ISOLATION_NOT_PROVEN",
  "AGENT_NOT_REGISTERED",
  "WORKSPACE_NOT_GOVERNED",
  "AUDIT_UNAVAILABLE",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

// The two scopes a run is held to. They are never mixed: a run is one or the other, and says which.
export const ENFORCEMENT_SCOPES = ["LEGACY_ORBIT", "GOVERNED_WORKSPACE"] as const;
export type EnforcementScope = (typeof ENFORCEMENT_SCOPES)[number];
