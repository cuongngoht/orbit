// WHAT A CHANGE OF POLICY DOES, worked out from the two policies and never from a list of rule names.
//
// A candidate is compared with the revision it would replace by asking BOTH the same questions: every action, for
// every kind of principal, in every environment, about every resource either of them names (and one nobody names).
// Where the candidate answers more loosely, the change WIDENS; where the widened action is a sensitive one, or an
// obligation moves to its weak word, the change is HIGH RISK and needs an approver who did not write it.
//
// The probes are sound for the only patterns a rule may hold (a name, or a prefix ending in `*`): a resource's
// matching rules are decided by which prefixes it starts with, and each prefix is asked about with a resource that
// starts with it and with nothing longer.
import type { Constitution, Obligations, Rule } from "./constitution.js";
import { evaluate } from "./evaluate.js";
import { ACTION_KINDS, ACTIONS, ENVIRONMENTS, PRINCIPAL_TYPES, rankOf, type ActionKind, type Effect, type Environment, type PrincipalType } from "./vocabulary.js";

export const RISK_LEVELS = ["low", "elevated", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface ImpactCell {
  action: ActionKind;
  principalType: PrincipalType;
  // The resource asked about: a name a rule holds, a prefix written `prefix*`, or `*` for one nobody names.
  resource: string;
  environments: Environment[];
  before: Effect;
  after: Effect;
  sensitive: boolean;
}

export interface ObligationChange {
  field: keyof Obligations | "defaults.decision";
  before: string;
  after: string;
  weakened: boolean;
}

export interface RuleChange {
  id: string;
  change: "added" | "removed" | "changed";
  before: Rule | null;
  after: Rule | null;
}

export interface Impact {
  risk: RiskLevel;
  widened: ImpactCell[];
  narrowed: ImpactCell[];
  obligations: ObligationChange[];
  rules: RuleChange[];
  // One sentence per reason the risk is what it is.
  reasons: string[];
}

// A character no rule's resource can hold after a prefix: the probe starts with the prefix and with nothing longer.
const PROBE = "\u0000";

const probeOf = (pattern: string): string => (pattern.endsWith("*") ? `${pattern.slice(0, -1)}${PROBE}` : pattern);

function patternsOf(action: ActionKind, policies: readonly Constitution[]): string[] {
  const named = policies.flatMap((p) => p.rules.filter((r) => r.action === action && r.resource !== undefined).map((r) => r.resource as string));
  return [...new Set([...named, "*"])].sort();
}

function verdictOf(policy: Constitution, action: ActionKind, principalType: PrincipalType, environment: Environment, resource: string): Effect {
  const organizationId = policy.metadata.organizationId;
  return evaluate({ constitution: policy, overlays: [] }, { principalId: "probe", principalType, organizationId, projectId: null, workspaceId: null, agentId: null, action, resource, environment }).verdict;
}

function cellsOf(base: Constitution, candidate: Constitution): ImpactCell[] {
  const cells = new Map<string, ImpactCell>();
  for (const action of ACTION_KINDS) {
    for (const pattern of patternsOf(action, [base, candidate])) {
      for (const principalType of PRINCIPAL_TYPES) {
        for (const environment of ENVIRONMENTS) {
          const before = verdictOf(base, action, principalType, environment, probeOf(pattern));
          const after = verdictOf(candidate, action, principalType, environment, probeOf(pattern));
          if (before === after) continue;
          const key = [action, principalType, pattern, before, after].join("\u0001");
          const cell = cells.get(key) ?? { action, principalType, resource: pattern, environments: [], before, after, sensitive: ACTIONS[action].sensitive };
          cell.environments.push(environment);
          cells.set(key, cell);
        }
      }
    }
  }
  return [...cells.values()];
}

const WEAK: Record<keyof Obligations, string> = { auditDecisions: "non_allow", dailyReport: "false", isolation: "optional" };

function obligationChanges(base: Constitution, candidate: Constitution): ObligationChange[] {
  const fields = Object.keys(WEAK) as (keyof Obligations)[];
  const changes: ObligationChange[] = fields
    .filter((f) => String(base.obligations[f]) !== String(candidate.obligations[f]))
    .map((f) => ({ field: f, before: String(base.obligations[f]), after: String(candidate.obligations[f]), weakened: String(candidate.obligations[f]) === WEAK[f] }));
  if (base.defaults.decision !== candidate.defaults.decision) {
    changes.push({ field: "defaults.decision", before: base.defaults.decision, after: candidate.defaults.decision, weakened: rankOf(candidate.defaults.decision) < rankOf(base.defaults.decision) });
  }
  return changes;
}

const sameRule = (a: Rule, b: Rule): boolean => JSON.stringify([a.action, a.effect, a.resource, a.principalType, a.environment, a.note]) === JSON.stringify([b.action, b.effect, b.resource, b.principalType, b.environment, b.note]);

export function ruleChanges(base: readonly Rule[], candidate: readonly Rule[]): RuleChange[] {
  const before = new Map(base.map((r) => [r.id, r]));
  const after = new Map(candidate.map((r) => [r.id, r]));
  const removed = base.filter((r) => !after.has(r.id)).map((r): RuleChange => ({ id: r.id, change: "removed", before: r, after: null }));
  const rest = candidate.flatMap((r): RuleChange[] => {
    const old = before.get(r.id);
    if (old === undefined) return [{ id: r.id, change: "added", before: null, after: r }];
    return sameRule(old, r) ? [] : [{ id: r.id, change: "changed", before: old, after: r }];
  });
  return [...removed, ...rest];
}

function reasonsOf(widened: ImpactCell[], obligations: ObligationChange[]): string[] {
  const actions = [...new Set(widened.filter((c) => c.sensitive).map((c) => c.action))];
  const loosened = actions.map((a) => `It loosens ${a}, a sensitive action.`);
  const weakened = obligations.filter((o) => o.weakened).map((o) => `It weakens ${o.field} from ${o.before} to ${o.after}.`);
  const other = widened.some((c) => !c.sensitive) ? ["It loosens an action that is not sensitive."] : [];
  return [...loosened, ...weakened, ...other];
}

function riskOf(widened: ImpactCell[], obligations: ObligationChange[]): RiskLevel {
  if (widened.some((c) => c.sensitive) || obligations.some((o) => o.weakened)) return "high";
  return widened.length > 0 ? "elevated" : "low";
}

// `base` is the revision in effect; for an organization's first revision, the default Constitution.
export function impactOf(base: Constitution, candidate: Constitution): Impact {
  const cells = cellsOf(base, candidate);
  const widened = cells.filter((c) => rankOf(c.after) < rankOf(c.before));
  const narrowed = cells.filter((c) => rankOf(c.after) > rankOf(c.before));
  const obligations = obligationChanges(base, candidate);
  return { risk: riskOf(widened, obligations), widened, narrowed, obligations, rules: ruleChanges(base.rules, candidate.rules), reasons: reasonsOf(widened, obligations) };
}
