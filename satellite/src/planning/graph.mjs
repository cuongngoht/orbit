// The WORK GRAPH a host proposes, judged as a whole before any of it is accepted: a model proposes, the engine
// validates consistency, dependencies, policy, budget and depth -- and refuses the whole proposal on the first rule it
// breaks (an ordered table), so a graph is never half accepted.
//
// c: { m, states, limits, budget, spent, units: [normalized new units], cancel: [ids], reset: [ids] }
import { Refused } from "../../../src/errors.mjs";
import { list, refused } from "../store/text.mjs";

const live = (m, c) => [...m.units.values()].filter((u) => !c.cancel.includes(u.id) && !["cancelled", "skipped"].includes(c.states.get(u.id)));

const nodesOf = (c) => [...live(c.m, c).map((u) => ({ id: u.id, deps: u.dependencyIds ?? [] })), ...c.units.map((u) => ({ id: u.id, deps: u.dependencyIds }))];

// Kahn's order over the nodes, or null when they hold a cycle.
export function topo(nodes) {
  const order = [];
  let left = nodes.map((n) => ({ id: n.id, deps: n.deps.filter((d) => nodes.some((x) => x.id === d)) }));
  while (left.length > 0) left = drained(left, order);
  return order.length === nodes.length ? order : null;
}

function drained(left, order) {
  const ready = left.filter((n) => n.deps.every((d) => order.includes(d)));
  if (ready.length === 0) return [];
  order.push(...ready.map((n) => n.id));
  return left.filter((n) => !order.includes(n.id));
}

const depthOf = (c, id, seen = 0) => ((u) => (!u?.parentUnit || seen > 8 ? seen : depthOf(c, u.parentUnit, seen + 1)))(c.m.units.get(id) ?? c.units.find((x) => x.id === id));

const keysTaken = (c) => [...c.m.units.values()].map((u) => u.key);

export const GRAPH_RULES = Object.freeze([
  { rule: "PLAN_EMPTY", fails: (c) => c.units.length + c.cancel.length + c.reset.length === 0, say: () => "a plan adds, cancels or resets at least one unit" },
  { rule: "PLAN_DUPLICATE_KEY", fails: (c) => new Set([...keysTaken(c), ...c.units.map((u) => u.key)]).size !== keysTaken(c).length + c.units.length, say: () => "every unit key is unique in the mission, across every revision" },
  { rule: "PLAN_UNKNOWN_DEPENDENCY", fails: (c) => c.units.some((u) => u.dependencyIds.includes(null)), say: () => "dependsOn names a unit key or id this mission does not have" },
  { rule: "PLAN_CANCELLED_DEPENDENCY", fails: (c) => c.units.some((u) => u.dependencyIds.some((d) => c.cancel.includes(d) || c.states.get(d) === "cancelled")), say: () => "a unit cannot depend on a cancelled unit" },
  { rule: "PLAN_CANCEL_STATE", fails: (c) => c.cancel.some((id) => !c.m.units.has(id) || ["running", "cancelled", "skipped", "done"].includes(c.states.get(id))), say: () => "cancel names a unit that exists and is not running, done, cancelled or skipped" },
  { rule: "PLAN_RESET_STATE", fails: (c) => c.reset.some((id) => !["failed", "blocked", "done", "unresolved"].includes(c.states.get(id))), say: () => "reset names a unit that failed, is blocked, unresolved or done -- never one that is running" },
  { rule: "PLAN_BOUNDED", fails: (c) => live(c.m, c).length + c.units.length > c.limits.maxUnits, say: (c) => `a mission holds at most ${c.limits.maxUnits} live units (Satellite's maxUnits, never above Orbit's execution.maxPlanSteps)` },
  { rule: "PLAN_CYCLE", fails: (c) => topo(nodesOf(c)) === null, say: () => "the dependencies hold a cycle" },
  { rule: "PLAN_DEPTH", fails: (c) => c.units.some((u) => depthOf(c, u.id) > c.limits.maxDepth), say: (c) => `delegation nests at most ${c.limits.maxDepth} deep (parentUnit)` },
  { rule: "PLAN_BUDGET", fails: (c) => c.units.length + c.reset.length > c.limits.maxAgentRuns - c.spent.agentRuns, say: (c) => `${c.limits.maxAgentRuns - c.spent.agentRuns} agent run(s) are left in the budget, fewer than the units that would need one` },
]);

// The first rule a proposal breaks, or null: what the plan action refuses with, nothing written.
export const graphFinding = (c) => ((r) => (r ? { rule: r.rule, say: r.say(c) } : null))(GRAPH_RULES.find((x) => x.fails(c)));

export function validateGraph(c) {
  const failed = GRAPH_RULES.find((r) => r.fails(c));
  if (failed) throw refused(Refused, failed.rule, failed.say(c));
  return list(c.units);
}
