// WHAT A CHANGE OF POLICY DOES, worked out from the two policies and never from a list of rule names.
//
// A candidate is compared with the revision it would replace by asking BOTH the same questions: every action, for
// every kind of principal, in every environment, about every resource either of them names (and one nobody names).
// Where the candidate answers more loosely, the change WIDENS; where the widened action is a sensitive one, or an
// obligation moves to its weak word, the change is HIGH RISK: the account's owner acknowledges that risk, by name,
// when they confirm it.
//
// The probes are sound for the only patterns a rule may hold (a name, or a prefix ending in `*`): a resource's
// matching rules are decided by which prefixes it starts with, and each prefix is asked about with a resource that
// starts with it and with nothing longer.
//
// An employee's connection is decided by the employee network access first (evaluate.ts), so it is asked about too, as
// an assignment's run: every host:port a rule or an allow-list names, and a host nobody names, on ports 80 and 443. The
// employee network access itself is compared field by field (network.ts): RESTRICTED to AUTONOMOUS, an allow-list that
// lets in a host it did not, a limit raised or removed WEAKEN it, and are high risk; the reverse narrows.
import type { Constitution, Obligations, Rule } from "./constitution.js";
import { evaluate } from "./evaluate.js";
import { egressTargetOf, EMPLOYEE_PORTS, employeeNetworkChanges, employeeNetworkOf, type EmployeeNetworkChange, type EmployeeNetworkField } from "./network.js";
import { ACTION_KINDS, ACTIONS, ENVIRONMENTS, PRINCIPAL_TYPES, rankOf, type ActionKind, type Effect, type Environment, type PrincipalType, type RunKind } from "./vocabulary.js";

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
  // Set when the answers are an employee's connection's: asked as an assignment's run (resource `host:port`, or `*:port`
  // for a host nobody names).
  runKind?: RunKind;
}

export interface ObligationChange {
  // An obligation, the default decision, or a field of the employee network access.
  field: keyof Obligations | "defaults.decision" | EmployeeNetworkField;
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
  const accountId = policy.metadata.accountId;
  return evaluate({ constitution: policy, overlays: [] }, { principalId: "probe", principalType, accountId, workspaceId: null, researchWorkspaceId: null, action, resource, environment }).verdict;
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
  return [...cells.values(), ...employeeCellsOf(base, candidate)];
}

// A host no rule, allow-list or real network names (the `.invalid` top-level domain is reserved for that).
const NOBODY = "probe.invalid";

// The connections an employee's run could ask for that either policy says something about, each with how it is shown:
// every host:port a network.egress rule names (a prefix ending in `:` on both ports, another prefix with a host under
// it), every host an allow-list lets in (one host under a `*.` domain), and a host nobody names -- on ports 80 and 443.
function employeeProbes(policies: readonly Constitution[]): Map<string, string> {
  const probes = new Map<string, string>();
  const add = (resource: string, shown: string): void => {
    if (egressTargetOf(resource) !== null && !probes.has(resource)) probes.set(resource, shown);
  };
  for (const r of policies.flatMap((p) => p.rules.filter((x) => x.action === "network.egress" && x.resource !== undefined).map((x) => x.resource as string))) {
    if (!r.endsWith("*")) add(r, r);
    else for (const port of EMPLOYEE_PORTS) add(r.endsWith(":*") ? `${r.slice(0, -1)}${port}` : `${r.slice(0, -1)}${NOBODY}:${port}`, r);
  }
  for (const entry of policies.flatMap((p) => employeeNetworkOf(p).allow)) for (const port of EMPLOYEE_PORTS) add(`${entry.startsWith("*.") ? `probe${entry.slice(1)}` : entry}:${port}`, `${entry}:${port}`);
  for (const port of EMPLOYEE_PORTS) add(`${NOBODY}:${port}`, `*:${port}`);
  return new Map([...probes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function employeeVerdictOf(policy: Constitution, environment: Environment, resource: string): Effect {
  const accountId = policy.metadata.accountId;
  return evaluate({ constitution: policy, overlays: [] }, { principalId: "probe", principalType: "agent", accountId, workspaceId: null, researchWorkspaceId: null, action: "network.egress", resource, environment, runKind: "assignment" }).verdict;
}

function employeeCellsOf(base: Constitution, candidate: Constitution): ImpactCell[] {
  const cells = new Map<string, ImpactCell>();
  for (const [resource, shown] of employeeProbes([base, candidate])) {
    for (const environment of ENVIRONMENTS) {
      const before = employeeVerdictOf(base, environment, resource);
      const after = employeeVerdictOf(candidate, environment, resource);
      if (before === after) continue;
      const key = [shown, before, after].join("\u0001");
      const cell = cells.get(key) ?? { action: "network.egress", principalType: "agent", resource: shown, environments: [], before, after, sensitive: ACTIONS["network.egress"].sensitive, runKind: "assignment" };
      cell.environments.push(environment);
      cells.set(key, cell);
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

const isNetworkField = (field: ObligationChange["field"]): boolean => field.startsWith("employeeNetwork.");

function reasonsOf(widened: ImpactCell[], obligations: ObligationChange[], network: EmployeeNetworkChange[]): string[] {
  const actions = [...new Set(widened.filter((c) => c.sensitive && c.runKind === undefined).map((c) => c.action))];
  const loosened = actions.map((a) => `It loosens ${a}, a sensitive action.`);
  const weakened = obligations.filter((o) => o.weakened && !isNetworkField(o.field)).map((o) => `It weakens ${o.field} from ${o.before} to ${o.after}.`);
  const opened = network.flatMap((c) => (c.weakened && c.reason !== null ? [c.reason] : []));
  // What a rule's change opens for employees, when no change of the employee network access itself says it already.
  const employees = opened.length === 0 && widened.some((c) => c.runKind === "assignment") ? ["It lets employees' assignments reach hosts they could not reach before (network.egress), a sensitive change."] : [];
  const other = widened.some((c) => !c.sensitive) ? ["It loosens an action that is not sensitive."] : [];
  return [...loosened, ...weakened, ...opened, ...employees, ...other];
}

function riskOf(widened: ImpactCell[], obligations: ObligationChange[]): RiskLevel {
  if (widened.some((c) => c.sensitive) || obligations.some((o) => o.weakened)) return "high";
  return widened.length > 0 ? "elevated" : "low";
}

// `base` is the revision in effect (every account has one: its default policy is published when it is created).
export function impactOf(base: Constitution, candidate: Constitution): Impact {
  const cells = cellsOf(base, candidate);
  const widened = cells.filter((c) => rankOf(c.after) < rankOf(c.before));
  const narrowed = cells.filter((c) => rankOf(c.after) > rankOf(c.before));
  const network = employeeNetworkChanges(employeeNetworkOf(base), employeeNetworkOf(candidate));
  const obligations: ObligationChange[] = [...obligationChanges(base, candidate), ...network.map((c): ObligationChange => ({ field: c.field, before: c.before, after: c.after, weakened: c.weakened }))];
  return { risk: riskOf(widened, obligations), widened, narrowed, obligations, rules: ruleChanges(base.rules, candidate.rules), reasons: reasonsOf(widened, obligations, network) };
}
