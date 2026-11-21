// THE DECISION: one pure function from a policy and a request to a verdict with its reasons. No clock, no storage,
// no randomness -- the same policy and the same request always give the same answer, so a decision can be worked out
// again by anybody who holds both.
//
// The order is fixed, and every step can only make the answer stricter:
//   1. a request that cannot be judged (no policy, no identity, an action nobody declared, another account) is DENIED;
//   2. the account policy's rules that match -- the strictest wins; none matching gives the default decision. An
//      employee's connection (`network.egress` asked by an assignment's run) is the one exception: the policy's employee
//      network access answers it (any public host on 80 or 443, or only the allow-list's), and a rule that matches can
//      only make that answer stricter -- an allow rule never opens what the mode does not;
//   3. each override that applies to this chat, research workspace or employee -- the strictest wins again (an override
//      narrows, never widens);
//   4. the action's ceiling for this kind of principal;
//   5. an action nothing can carry out is denied.
// Nothing an agent says about itself is read here: who asks is what the caller PROVED and passed in.
import type { Constitution, PolicyOverlay, Rule } from "./constitution.js";
import { allowListed, egressTargetOf, EMPLOYEE_PORTS, employeeNetworkOf, type EmployeeNetwork } from "./network.js";
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
}

export interface Policy {
  // Null while nothing is published.
  constitution: Constitution | null;
  overlays: readonly PolicyOverlay[];
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

function accountStep(constitution: Constitution, request: GovernanceRequest): Step {
  if (request.runKind === "assignment" && request.action === "network.egress") return employeeConnectionStep(constitution, request);
  const matched = constitution.rules.filter((r) => ruleMatches(r, request));
  if (matched.length === 0) return { verdict: constitution.defaults.decision, matchedRules: [], reasonCodes: ["DEFAULT_DECISION"] };
  return { verdict: matched.map((r) => r.effect).reduce(strictest), matchedRules: matched.map((r) => `account:${r.id}`), reasonCodes: ["RULE_MATCHED"] };
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
function employeeConnectionStep(constitution: Constitution, request: GovernanceRequest): Step {
  const base = employeeNetworkStep(employeeNetworkOf(constitution), request.resource);
  const narrowing = constitution.rules.filter((r) => ruleMatches(r, request) && rankOf(r.effect) > rankOf(base.verdict));
  if (narrowing.length === 0) return base;
  return { verdict: narrowing.map((r) => r.effect).reduce(strictest, base.verdict), matchedRules: [...base.matchedRules, ...narrowing.map((r) => `account:${r.id}`)], reasonCodes: [...base.reasonCodes, "RULE_MATCHED"] };
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

export function evaluate(policy: Policy, request: GovernanceRequest): Evaluation {
  const refused = unjudgeable(policy, request);
  if (refused !== null) return refused;
  const action = request.action as ActionKind;
  const enforcement = ACTIONS[action].enforcement;
  const base = accountStep(policy.constitution as Constitution, request);
  const layered = overlayStep(base, policy.overlays, request);
  const step = executorStep(ceilingStep(layered, action, request.principalType), enforcement);
  return { ...step, enforcement };
}
