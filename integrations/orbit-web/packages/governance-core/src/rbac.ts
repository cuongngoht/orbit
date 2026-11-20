// WHO MAY DO WHAT in governance administration: six roles, one table. A role is a set of permissions and nothing
// else; a route asks for ONE permission, and whether an operator holds it is read from the store on every request --
// never from a request body, a header or anything the caller says about itself.
//
// An agent is not in this table at all: it is not a human principal and holds no role.

export const OPERATOR_ROLES = ["organization_owner", "security_admin", "policy_editor", "policy_approver", "auditor", "agent_operator"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const isOperatorRole = (v: unknown): v is OperatorRole => typeof v === "string" && (OPERATOR_ROLES as readonly string[]).includes(v);

export const PERMISSIONS = [
  "governance.read",
  "audit.read",
  "audit.verify",
  "reports.read",
  "reports.generate",
  "findings.read",
  "findings.manage",
  "constitution.edit",
  "constitution.approve",
  "constitution.publish",
  "operators.read",
  "operators.manage",
  "roles.manage",
  "agents.manage",
  "workspaces.govern",
  "approvals.read",
  "approvals.decide",
  "settings.privileged.write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READS: Permission[] = ["governance.read", "audit.read", "audit.verify", "reports.read", "findings.read", "operators.read", "approvals.read"];

export const ROLE_PERMISSIONS: Record<OperatorRole, readonly Permission[]> = {
  organization_owner: PERMISSIONS,
  security_admin: [...READS, "reports.generate", "findings.manage", "constitution.publish", "agents.manage", "workspaces.govern", "approvals.decide", "settings.privileged.write"],
  policy_editor: ["governance.read", "constitution.edit"],
  policy_approver: ["governance.read", "constitution.approve"],
  // Reads everything that is evidence, and changes nothing but the reports it asks for.
  auditor: [...READS, "reports.generate"],
  agent_operator: ["governance.read", "approvals.read", "workspaces.govern"],
};

export const permissionsOf = (roles: readonly OperatorRole[]): Permission[] => PERMISSIONS.filter((p) => roles.some((r) => ROLE_PERMISSIONS[r].includes(p)));

export const can = (roles: readonly OperatorRole[], permission: Permission): boolean => roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));

// An organization always keeps one owner who can sign in: the last one is neither suspended nor stripped of the role.
export const LAST_OWNER = "LAST_OWNER";
