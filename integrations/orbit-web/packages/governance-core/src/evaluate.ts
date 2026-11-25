// THE DECISION: one pure function from a policy and a request to a verdict with its reasons. No clock, no storage,
// no randomness -- the same policy and the same request always give the same answer, so a decision can be worked out
// again by anybody who holds both.
//
// The order is fixed, and every step can only make the answer stricter:
//   1. a request that cannot be judged (no policy, no identity, an action nobody declared, another account) is DENIED;
//   2. the account policy's rules that match -- the strictest wins; none matching gives the default decision. An
//      employee's connection (`network.egress` asked by an assignment's run) is the one exception: the policy's employee
//      network access answers it (any public host on 80 or 443, or only the allow-list's), and a rule that matches can
//      only make that answer stricter -- an allow rule never opens what the mode does not. An EMPLOYEE's request (an
//      assignment's run, naming its department) is decided with its department's policy too (department.ts): the
//      company's mandatory rules bind it, a department's own rules replace the company's defaults for an action the
//      company delegated (held to the delegation) and only narrow any other; its network access is the composed one.
//      A chat's, a research question's and a person's requests never read a department's policy;
//   2b. a grant the decision needs that the principal does not hold (a connector it was not granted) is a deny;
//   3. each override that applies to this chat, research workspace or employee -- the strictest wins again (an override
//      narrows, never widens);
//   4. the action's ceiling for this kind of principal;
//   5. an action nothing can carry out is denied.
// Nothing an agent says about itself is read here: who asks is what the caller PROVED and passed in.
import type { Constitution, PolicyOverlay, Rule } from "./constitution.js";
import { composeEmployeeNetwork, delegatedCap, type DepartmentPolicy } from "./department.js";
import { allowListed, egressTargetOf, EMPLOYEE_PORTS, type EmployeeNetwork } from "./network.js";
import { ACTIONS, isActionKind, rankOf, strictest, type ActionKind, type Effect, type EnforcementPoint, type Environment, type PrincipalType, type ReasonCode, type RunKind } from "./vocabulary.js";

export interface GovernanceRequest {
  // Null when nobody was verified: such a request is never granted anything.
  principalId: string | null;
  principalType: PrincipalType;
  // The account whose policy decides: the requester's own (an owner's, a run's), never one a request names.
  accountId: string;
  // The chat (Claude Code workspace), or the research workspace, the request is about -- what an override targets.
  workspaceId: string | null;
  researchWorkspaceId: string | null;
  action: string;
  resource: string;
  environment: Environment;
  // The kind of run that asks, when a run does (the run's binding says it, never the run). An employee's assignment
  // ("assignment") has its `network.egress` decided by the policy's employee network access; a chat's and a research
  // session's by the rules, as any request.
  runKind?: RunKind;
  // The employee whose assignment's run asks: what an `employee` override targets.
  employeeId?: string | null;
  // The employee's department (its policy decides with the company's), and the work it asks about.
  departmentId?: string | null;
  assignmentId?: string | null;
  missionId?: string | null;
}

export interface Policy {
  // Null while nothing is published.
  constitution: Constitution | null;
  overlays: readonly PolicyOverlay[];
  // The departments' policies in effect (each department's published one): read only for an employee's request.
  departments?: readonly DepartmentPolicy[];
}

// What the caller established outside the policy, for this one decision: whether the principal holds the grant the
// action needs (a connector granted to this employee, say). Absent: no grant is part of this decision.
export interface EvaluationFacts {
  grant?: "held" | "not_held";
}

export interface Evaluation {
  verdict: Effect;
  // `<layer>:<rule id>` for every rule that matched, in the order the layers were read.
  matchedRules: string[];
  reasonCodes: ReasonCode[];
  enforcement: EnforcementPoint;
}

const denied = (reason: ReasonCode, enforcement: EnforcementPoint = "none"): Evaluation => ({ verdict: "deny", matchedRules: [], reasonCodes: [reason], enforcement });

export function resourceMatches(pattern: string | undefined, resource: string): boolean {
  if (pattern === undefined) return true;
  return pattern.endsWith("*") ? resource.startsWith(pattern.slice(0, -1)) : pattern === resource;
}

const ruleMatches = (rule: Rule, request: GovernanceRequest): boolean =>
  rule.action === request.action &&
  resourceMatches(rule.resource, request.resource) &&
  (rule.principalType === undefined || rule.principalType === request.principalType) &&
  (rule.environment === undefined || rule.environment === request.environment);

const TARGET_OF: Record<PolicyOverlay["metadata"]["level"], (r: GovernanceRequest) => string | null> = {
  workspace: (r) => r.workspaceId,
  research_workspace: (r) => r.researchWorkspaceId,
  employee: (r) => r.employeeId ?? null,
};

export const overlayApplies = (overlay: PolicyOverlay, request: GovernanceRequest): boolean =>
  overlay.metadata.accountId === request.accountId && TARGET_OF[overlay.metadata.level](request) === overlay.metadata.target;

const layerOf = (overlay: PolicyOverlay): string => `${overlay.metadata.level}:${overlay.metadata.target}`;

function unjudgeable(policy: Policy, request: GovernanceRequest): Evaluation | null {
  if (!isActionKind(request.action)) return denied("UNKNOWN_ACTION");
  const enforcement = ACTIONS[request.action].enforcement;
  if (policy.constitution === null) return denied("NO_PUBLISHED_POLICY", enforcement);
  if (request.principalId === null || request.principalId === "") return denied("NO_VERIFIED_IDENTITY", enforcement);
  if (policy.constitution.metadata.accountId !== request.accountId) return denied("ACCOUNT_MISMATCH", enforcement);
  return null;
}

interface Step {
  verdict: Effect;
  matchedRules: string[];
  reasonCodes: ReasonCode[];
}

// The department whose policy decides with the company's: an employee's run (an assignment's, or its answer in CEO
// Chat) naming its department, and that department's published policy (none published: the company's alone).
export function departmentOf(policy: Policy, request: GovernanceRequest): DepartmentPolicy | null {
  if ((request.runKind !== "assignment" && request.runKind !== "executive") || request.departmentId === undefined || request.departmentId === null) return null;
  return policy.departments?.find((d) => d.metadata.accountId === request.accountId && d.metadata.departmentId === request.departmentId) ?? null;
}

const strictestOf = (rules: readonly Rule[]): Effect => rules.map((r) => r.effect).reduce(strictest);

function accountStep(constitution: Constitution, dept: DepartmentPolicy | null, request: GovernanceRequest): Step {
  if (request.runKind === "assignment" && request.action === "network.egress") return employeeConnectionStep(constitution, dept, request);
  const matched = constitution.rules.filter((r) => ruleMatches(r, request));
  if (dept === null) {
    if (matched.length === 0) return { verdict: constitution.defaults.decision, matchedRules: [], reasonCodes: ["DEFAULT_DECISION"] };
    return { verdict: strictestOf(matched), matchedRules: matched.map((r) => `account:${r.id}`), reasonCodes: ["RULE_MATCHED"] };
  }
  return departmentStep(constitution, dept, request, matched);
}

// An employee's request, its department's policy in effect: the company's MANDATORY rules always bind; for an action the
// company DELEGATED, the department's own rules (when it has any) replace the company's DEFAULT rules, held to the
// delegation's loosest effect; for any other action the department's rules only narrow what the company says.
function departmentStep(constitution: Constitution, dept: DepartmentPolicy, request: GovernanceRequest, matched: readonly Rule[]): Step {
  const mandatory = matched.filter((r) => (r.binding ?? "mandatory") === "mandatory");
  const defaults = matched.filter((r) => r.binding === "default");
  const own = dept.rules.filter((r) => ruleMatches(r, request));
  const cap = delegatedCap(constitution, request.action);
  const layer = `department:${dept.metadata.departmentId}`;
  const matchedRules: string[] = [];
  const reasonCodes: ReasonCode[] = [];
  let verdict: Effect | null = null;
  if (cap !== null && own.length > 0) {
    const said = strictestOf(own);
    verdict = rankOf(said) < rankOf(cap) ? cap : said;
    matchedRules.push(...own.map((r) => `${layer}:${r.id}`));
    reasonCodes.push("DEPARTMENT_DECIDED", ...(verdict !== said ? (["DELEGATION_CAPPED"] as const) : []));
  } else {
    if (defaults.length > 0) {
      verdict = strictestOf(defaults);
      matchedRules.push(...defaults.map((r) => `account:${r.id}`));
      reasonCodes.push("RULE_MATCHED");
    }
    if (own.length > 0) {
      const before = verdict ?? (mandatory.length === 0 ? constitution.defaults.decision : null);
      const said = strictestOf(own);
      verdict = before === null ? said : strictest(before, said);
      matchedRules.push(...own.map((r) => `${layer}:${r.id}`));
      if (before === null || rankOf(said) > rankOf(before)) reasonCodes.push("DEPARTMENT_NARROWED");
    }
  }
  if (mandatory.length > 0) {
    const bound = strictestOf(mandatory);
    verdict = verdict === null ? bound : strictest(verdict, bound);
    matchedRules.push(...mandatory.map((r) => `account:${r.id}`));
    if (!reasonCodes.includes("RULE_MATCHED")) reasonCodes.push("RULE_MATCHED");
  }
  if (verdict === null) return { verdict: constitution.defaults.decision, matchedRules: [], reasonCodes: ["DEFAULT_DECISION"] };
  return { verdict, matchedRules, reasonCodes };
}

// What the employee network access alone says about a connection to `host:port`. The address it resolves to is not
// judged here (nothing here resolves a name): the egress proxy refuses one that is not on the public internet.
function employeeNetworkStep(network: EmployeeNetwork, resource: string): Step {
  const target = egressTargetOf(resource);
  if (target === null || !EMPLOYEE_PORTS.includes(target.port)) return { verdict: "deny", matchedRules: [], reasonCodes: ["EMPLOYEE_NETWORK_PORT"] };
  if (network.mode === "AUTONOMOUS") return { verdict: "allow", matchedRules: ["employee-network:autonomous"], reasonCodes: ["EMPLOYEE_NETWORK_AUTONOMOUS"] };
  const entry = allowListed(network.allow, target.host);
  if (entry === null) return { verdict: "deny", matchedRules: [], reasonCodes: ["EMPLOYEE_NETWORK_NOT_LISTED"] };
  return { verdict: "allow", matchedRules: [`employee-network:${entry}`], reasonCodes: ["EMPLOYEE_NETWORK_ALLOWED"] };
}

// An employee's connection: the employee network access answers, and a rule of the policy that matches it can only make
// the answer stricter (a deny still wins; an allow never opens what the mode does not). Only the rules that narrowed it
// are named.
// With a department, the network access is the composed one (department.ts), and a department's rule narrows it too --
// a company's rule (mandatory or not) is never lifted by a department for a connection.
function employeeConnectionStep(constitution: Constitution, dept: DepartmentPolicy | null, request: GovernanceRequest): Step {
  const base = employeeNetworkStep(composeEmployeeNetwork(constitution, dept), request.resource);
  const layer = dept === null ? "" : `department:${dept.metadata.departmentId}`;
  const narrowing = [...constitution.rules.map((r) => ({ r, id: `account:${r.id}` })), ...(dept?.rules ?? []).map((r) => ({ r, id: `${layer}:${r.id}` }))].filter(({ r }) => ruleMatches(r, request) && rankOf(r.effect) > rankOf(base.verdict));
  if (narrowing.length === 0) return base;
  return { verdict: narrowing.map(({ r }) => r.effect).reduce(strictest, base.verdict), matchedRules: [...base.matchedRules, ...narrowing.map(({ id }) => id)], reasonCodes: [...base.reasonCodes, "RULE_MATCHED"] };
}

// A grant the decision needs that the principal does not hold: denied, whatever the rules said.
function grantStep(step: Step, facts: EvaluationFacts): Step {
  if (facts.grant !== "not_held" || step.verdict === "deny") return step;
  return { ...step, verdict: "deny", reasonCodes: [...step.reasonCodes, "NO_GRANT"] };
}

function overlayStep(step: Step, overlays: readonly PolicyOverlay[], request: GovernanceRequest): Step {
  let verdict = step.verdict;
  const matchedRules = [...step.matchedRules];
  for (const overlay of overlays.filter((o) => overlayApplies(o, request))) {
    for (const rule of overlay.rules.filter((r) => ruleMatches(r, request))) {
      matchedRules.push(`${layerOf(overlay)}:${rule.id}`);
      verdict = strictest(verdict, rule.effect);
    }
  }
  const narrowed = rankOf(verdict) > rankOf(step.verdict);
  return { verdict, matchedRules, reasonCodes: narrowed ? [...step.reasonCodes, "OVERLAY_NARROWED"] : step.reasonCodes };
}

function ceilingStep(step: Step, action: ActionKind, principalType: PrincipalType): Step {
  const most = (ACTIONS[action].ceiling as Partial<Record<PrincipalType, Effect>>)[principalType];
  if (most === undefined || rankOf(step.verdict) >= rankOf(most)) return step;
  return { ...step, verdict: most, reasonCodes: [...step.reasonCodes, "PRINCIPAL_CEILING"] };
}

function executorStep(step: Step, enforcement: EnforcementPoint): Step {
  if (enforcement !== "none" || step.verdict === "deny") return step;
  return { ...step, verdict: "deny", reasonCodes: [...step.reasonCodes, "NO_EXECUTOR"] };
}

export function evaluate(policy: Policy, request: GovernanceRequest, facts: EvaluationFacts = {}): Evaluation {
  const refused = unjudgeable(policy, request);
  if (refused !== null) return refused;
  const action = request.action as ActionKind;
  const enforcement = ACTIONS[action].enforcement;
  const base = accountStep(policy.constitution as Constitution, departmentOf(policy, request), request);
  const layered = grantStep(overlayStep(base, policy.overlays, request), facts);
  const step = executorStep(ceilingStep(layered, action, request.principalType), enforcement);
  return { ...step, enforcement };
}
