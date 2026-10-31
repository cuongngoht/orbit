// THE SPEC of ORBIT-SAT-002: what Satellite's judge of a proposed work graph must answer, written from its contract and
// never from its code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it
// never imports the subject. A proposal is refused WHOLE on the first rule of an ordered table it breaks, so every check
// expects exactly that one rule, or nothing at all: a judge that accepts every graph, one that refuses every graph and
// one that names the wrong rule all fail.
//
// Each limit is checked AT it and one PAST it (exactly maxUnits live units, exactly maxDepth deep, exactly the agent
// runs that are left), every kind of cycle is checked beside a graph that holds none, and seeded missions -- units it
// already holds in every state, delegation chains through them, resets -- meet seeded proposals with the run's seed.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-SAT-002";

export const GROUPS = {
  "acyclic-accepted": "a plan whose dependencies hold no cycle, within every limit, is accepted: nothing is reported",
  "cycle-refused": "dependencies that hold a cycle -- two units waiting for each other, a longer ring, a unit waiting for itself, a ring behind an acyclic part -- are refused PLAN_CYCLE",
  "dead-units-ignored": "a cancelled or skipped unit, or one this plan cancels, holds no place under the bound, and a dependency on it is no edge of a cycle",
  "bound-held": "live units and new ones together above maxUnits are refused PLAN_BOUNDED, and exactly maxUnits is accepted",
  "depth-held": "delegation exactly maxDepth deep is accepted, and one deeper or more is refused PLAN_DEPTH, through new units and units the mission already holds",
  "budget-held": "new units and resets needing exactly the agent runs left are accepted, and one more is refused PLAN_BUDGET",
  "first-broken-rule": "a plan that breaks several rules is refused on the first of them in the table's order",
  "plan-contract": "an empty plan, a key used twice, an unknown or cancelled dependency, and a cancel or reset of a unit in the wrong state are refused by their own rules",
  "topo-order": "topo orders every node of an acyclic graph, and answers no order for nodes that hold a cycle",
  "seeded-graph": "seeded missions and proposals: exactly the first rule the proposal breaks, or nothing",
};

// The policy's defaults: 12 agent runs, delegation 2 deep, 12 units.
const DEFAULTS = { maxUnits: 12, maxDepth: 2, maxAgentRuns: 12 };

const DEAD = ["cancelled", "skipped"];

const NOT_CANCELLABLE = ["running", "cancelled", "skipped", "done"];

const RESETTABLE = ["failed", "blocked", "done", "unresolved"];

// ---- the reference model: the ordered table, as the contract words it --------------------------------------------------

const liveOf = (p) => p.existing.filter((x) => !p.cancel.includes(x.id) && !DEAD.includes(p.states[x.id]));

const nodesOf = (p) => [...liveOf(p), ...p.units].map((x) => ({ id: x.id, deps: x.dependencyIds }));

const nodeIn = (nodes, id) => nodes.find((n) => n.id === id);

// Whether `target` is reached from a node by following dependencies among the nodes alone (an id outside them is no edge).
const reaches = (nodes, from, target, seen) => from.deps.filter((d) => nodeIn(nodes, d)).some((d) => d === target || (!seen.has(d) && Boolean(seen.add(d)) && reaches(nodes, nodeIn(nodes, d), target, seen)));

export const cyclic = (nodes) => nodes.some((n) => reaches(nodes, n, n.id, new Set()));

const unitIn = (p, id) => p.existing.find((x) => x.id === id) ?? p.units.find((x) => x.id === id);

// How deep a unit nests: one for every parentUnit above it, until a unit that names none.
const depthOf = (p, id, hops = 0) => ((x) => (!x?.parentUnit || hops > 16 ? hops : depthOf(p, x.parentUnit, hops + 1)))(unitIn(p, id));

const keysOf = (p) => [...p.existing, ...p.units].map((x) => x.key);

const RULES = [
  ["PLAN_EMPTY", (p) => p.units.length + p.cancel.length + p.reset.length === 0],
  ["PLAN_DUPLICATE_KEY", (p) => new Set(keysOf(p)).size !== keysOf(p).length],
  ["PLAN_UNKNOWN_DEPENDENCY", (p) => p.units.some((x) => x.dependencyIds.includes(null))],
  ["PLAN_CANCELLED_DEPENDENCY", (p) => p.units.some((x) => x.dependencyIds.some((d) => p.cancel.includes(d) || p.states[d] === "cancelled"))],
  ["PLAN_CANCEL_STATE", (p) => p.cancel.some((id) => !p.existing.some((x) => x.id === id) || NOT_CANCELLABLE.includes(p.states[id]))],
  ["PLAN_RESET_STATE", (p) => p.reset.some((id) => !RESETTABLE.includes(p.states[id]))],
  ["PLAN_BOUNDED", (p) => liveOf(p).length + p.units.length > p.limits.maxUnits],
  ["PLAN_CYCLE", (p) => cyclic(nodesOf(p))],
  ["PLAN_DEPTH", (p) => p.units.some((x) => depthOf(p, x.id) > p.limits.maxDepth)],
  ["PLAN_BUDGET", (p) => p.units.length + p.reset.length > p.limits.maxAgentRuns - p.spent.agentRuns],
];

// The first rule the proposal breaks, or null.
export const ruleOf = (p) => RULES.find(([, fails]) => fails(p))?.[0] ?? null;

const expectOf = (rule) => ({ exactly: rule ? [rule] : [] });

// ---- what the inputs are made of ---------------------------------------------------------------------------------------

const idOf = (n) => (n === null ? null : `wu-${n}`);

const unit = (n, deps = [], parent = null) => ({ id: idOf(n), key: `unit-${n}`, dependencyIds: deps.map(idOf), ...(parent ? { parentUnit: idOf(parent) } : {}) });

const held = (n, state, deps = [], parent = null) => ({ ...unit(n, deps, parent), state });

const bare = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== "state"));

const plan = (o) => ({ call: "graph", existing: (o.held ?? []).map(bare), states: Object.fromEntries((o.held ?? []).map((x) => [x.id, x.state])), limits: { ...DEFAULTS, ...o.limits }, spent: { agentRuns: o.spent ?? 0 }, units: o.units ?? [], cancel: (o.cancel ?? []).map(idOf), reset: (o.reset ?? []).map(idOf) });

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

// A delegation chain: unit `from` at the top, each next one nesting under the one before.
const chain = (from, to) => range(from, to).map((n) => unit(n, [], n > from ? n - 1 : null));

const heldMany = (states) => states.map((s, k) => held(k + 1, s));

const TEN = ["done", "done", "ready", "planned", "planned", "failed", "blocked", "unresolved", "ready", "planned"];

const renamed = (x, key) => ({ ...x, key });

// ---- the checks written by hand: a proposal -> the rule it breaks first, or none ---------------------------------------

const HAND = [
  ["acyclic-accepted", plan({ units: [unit(1)] }), null],
  ["acyclic-accepted", plan({ units: [unit(1), unit(2, [1]), unit(3, [2])] }), null],
  ["acyclic-accepted", plan({ units: [unit(1), unit(2, [1]), unit(3, [1]), unit(4, [2, 3])] }), null],
  ["acyclic-accepted", plan({ units: [unit(1, [2]), unit(2)] }), null],
  ["acyclic-accepted", plan({ held: [held(1, "done"), held(2, "ready", [1])], units: [unit(3, [2]), unit(4, [1, 3])] }), null],
  ["cycle-refused", plan({ units: [unit(1, [2]), unit(2, [1])] }), "PLAN_CYCLE"],
  ["cycle-refused", plan({ units: [unit(1, [3]), unit(2, [1]), unit(3, [2])] }), "PLAN_CYCLE"],
  ["cycle-refused", plan({ units: [unit(1, [1])] }), "PLAN_CYCLE"],
  ["cycle-refused", plan({ units: [unit(1), unit(2, [1, 4]), unit(3, [2]), unit(4, [3])] }), "PLAN_CYCLE"],
  ["cycle-refused", plan({ held: [held(1, "done")], units: [unit(2, [1, 3]), unit(3, [2])] }), "PLAN_CYCLE"],
  ["cycle-refused", plan({ units: [unit(1), unit(2, [6]), unit(3, [2]), unit(4, [3]), unit(5, [4]), unit(6, [5, 1])] }), "PLAN_CYCLE"],
  ["dead-units-ignored", plan({ held: [held(1, "cancelled"), held(2, "skipped"), held(3, "planned", [2])], units: [unit(4, [3])], limits: { maxUnits: 2 } }), null],
  ["dead-units-ignored", plan({ held: [held(1, "ready"), held(2, "planned")], cancel: [2], units: [unit(3, [1])], limits: { maxUnits: 2 } }), null],
  ["dead-units-ignored", plan({ held: [held(1, "ready"), held(2, "planned")], units: [unit(3, [1])], limits: { maxUnits: 2 } }), "PLAN_BOUNDED"],
  ["dead-units-ignored", plan({ held: [held(1, "skipped")], units: [unit(2, [1]), unit(3, [2])] }), null],
  ["bound-held", plan({ held: heldMany(TEN), units: [unit(11), unit(12, [11])] }), null],
  ["bound-held", plan({ held: heldMany(TEN), units: [unit(11), unit(12), unit(13)] }), "PLAN_BOUNDED"],
  ["bound-held", plan({ held: heldMany(["done", "done", "cancelled"]), units: [unit(4), unit(5)], limits: { maxUnits: 4 } }), null],
  ["bound-held", plan({ held: heldMany(["done", "failed", "ready"]), units: [unit(4), unit(5)], limits: { maxUnits: 4 } }), "PLAN_BOUNDED"],
  ["depth-held", plan({ units: chain(1, 3) }), null],
  ["depth-held", plan({ units: chain(1, 4) }), "PLAN_DEPTH"],
  ["depth-held", plan({ held: [held(1, "done"), held(2, "running", [], 1)], units: [unit(3, [], 2)] }), null],
  ["depth-held", plan({ held: [held(1, "done"), held(2, "running", [], 1), held(3, "ready", [], 2)], units: [unit(4, [], 3)] }), "PLAN_DEPTH"],
  ["depth-held", plan({ units: chain(1, 2), limits: { maxDepth: 1 } }), null],
  ["depth-held", plan({ units: chain(1, 3), limits: { maxDepth: 1 } }), "PLAN_DEPTH"],
  ["depth-held", plan({ units: chain(1, 4), limits: { maxDepth: 3 } }), null],
  ["depth-held", plan({ units: chain(1, 5), limits: { maxDepth: 3 } }), "PLAN_DEPTH"],
  ["depth-held", plan({ units: chain(1, 6) }), "PLAN_DEPTH"],
  ["depth-held", plan({ units: [unit(1), unit(2, [], 1), unit(3, [], 1), unit(4, [], 2)] }), null],
  ["budget-held", plan({ units: [unit(1), unit(2), unit(3)], spent: 9 }), null],
  ["budget-held", plan({ units: [unit(1), unit(2), unit(3)], spent: 10 }), "PLAN_BUDGET"],
  ["budget-held", plan({ units: [unit(1)], spent: 12 }), "PLAN_BUDGET"],
  ["budget-held", plan({ held: [held(1, "failed"), held(2, "done")], reset: [1, 2], units: [unit(3)], spent: 9 }), null],
  ["budget-held", plan({ held: [held(1, "failed"), held(2, "done")], reset: [1, 2], units: [unit(3)], spent: 10 }), "PLAN_BUDGET"],
  ["budget-held", plan({ held: [held(1, "failed")], reset: [1], spent: 11 }), null],
  ["budget-held", plan({ units: range(1, 5).map((n) => unit(n)), limits: { maxAgentRuns: 4 } }), "PLAN_BUDGET"],
  ["first-broken-rule", plan({ units: [unit(1), unit(2, [3], 1), unit(3, [2], 2)], limits: { maxDepth: 1 } }), "PLAN_CYCLE"],
  ["first-broken-rule", plan({ units: [unit(1, [2]), unit(2, [1])], spent: 11 }), "PLAN_CYCLE"],
  ["first-broken-rule", plan({ units: chain(1, 3), limits: { maxDepth: 1 }, spent: 10 }), "PLAN_DEPTH"],
  ["first-broken-rule", plan({ units: [unit(1, [3]), unit(2, [1]), unit(3, [2])], limits: { maxUnits: 2 } }), "PLAN_BOUNDED"],
  ["first-broken-rule", plan({ units: [unit(1, [2]), renamed(unit(2, [1]), "unit-1")] }), "PLAN_DUPLICATE_KEY"],
  ["first-broken-rule", plan({ units: range(1, 4).map((n) => unit(n)), limits: { maxUnits: 3, maxAgentRuns: 3 }, spent: 1 }), "PLAN_BOUNDED"],
  ["plan-contract", plan({}), "PLAN_EMPTY"],
  ["plan-contract", plan({ held: [held(1, "cancelled")], units: [renamed(unit(2), "unit-1")] }), "PLAN_DUPLICATE_KEY"],
  ["plan-contract", plan({ units: [unit(1), renamed(unit(2), "unit-1")] }), "PLAN_DUPLICATE_KEY"],
  ["plan-contract", plan({ units: [unit(1, [null])] }), "PLAN_UNKNOWN_DEPENDENCY"],
  ["plan-contract", plan({ held: [held(1, "planned")], cancel: [1], units: [unit(2, [1])] }), "PLAN_CANCELLED_DEPENDENCY"],
  ["plan-contract", plan({ held: [held(1, "cancelled")], units: [unit(2, [1])] }), "PLAN_CANCELLED_DEPENDENCY"],
  ["plan-contract", plan({ held: [held(1, "running")], cancel: [1] }), "PLAN_CANCEL_STATE"],
  ["plan-contract", plan({ held: [held(1, "done")], cancel: [1] }), "PLAN_CANCEL_STATE"],
  ["plan-contract", plan({ cancel: [9] }), "PLAN_CANCEL_STATE"],
  ["plan-contract", plan({ held: [held(1, "running")], reset: [1] }), "PLAN_RESET_STATE"],
  ["plan-contract", plan({ held: [held(1, "planned")], reset: [1] }), "PLAN_RESET_STATE"],
  ["plan-contract", plan({ held: [held(1, "planned")], cancel: [1] }), null],
];

const node = (id, deps = []) => ({ id, deps });

const TOPO = [
  [[node("a"), node("b", ["a"]), node("c", ["a", "b"]), node("d", ["c"])], false],
  [[node("a", ["b"]), node("b", ["a"])], true],
  [[node("a", ["a"])], true],
  [[node("a", ["gone"]), node("b", ["a", "elsewhere"])], false],
  [[node("t"), node("a", ["t", "c"]), node("b", ["a"]), node("c", ["b"])], true],
  [[], false],
];

const FIXED = [...HAND.map(([group, input, rule]) => ({ group, input, expect: expectOf(rule) })), ...TOPO.map(([nodes, ring]) => ({ group: "topo-order", input: { call: "topo", nodes }, expect: { exactly: ring ? ["CYCLE"] : nodes.map((n) => n.id) } }))];

// ---- a seeded generator, the same missions and proposals for the same seed ---------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const STATES = ["planned", "ready", "running", "done", "failed", "blocked", "unresolved", "skipped", "cancelled"];

const some = (r, list, p) => list.filter(() => r() < p);

const parentOf = (r, before, p) => (before.length && r() < p ? pick(r, before) : null);

// What a mission already holds: units in every state, each resting on earlier ones and nesting under one of them.
const heldOf = (r) => range(1, Math.floor(r() * 5)).map((n) => held(n, pick(r, STATES), some(r, range(1, n - 1), 0.3), parentOf(r, range(1, n - 1), 0.4)));

// A unit a plan adds: resting on live units it can see and on earlier new ones, now and then on itself or a later one.
const added = (r, n, first, last, live) => unit(n, [...new Set([...some(r, live, 0.25), ...some(r, range(first, n - 1), 0.35), ...(r() < 0.15 ? [first + Math.floor(r() * (last - first + 1))] : [])])], parentOf(r, [...live, ...range(first, n - 1)], 0.45));

const numberOf = (x) => Number(x.id.slice(3));

const limitsOf = (r) => ({ maxUnits: pick(r, [4, 6, 8, 12]), maxDepth: pick(r, [1, 2, 3]), maxAgentRuns: pick(r, [4, 8, 12]) });

// A proposal over the mission: its own units, resets of units that may be reset, and now and then a cancel.
function proposed(r, mission, limits) {
  const live = mission.filter((x) => x.state !== "cancelled").map(numberOf);
  const first = mission.length + 1;
  const last = first + Math.floor(r() * 4);
  return plan({ held: mission, units: range(first, last).map((n) => added(r, n, first, last, live)), limits, spent: Math.floor(r() * (limits.maxAgentRuns + 1)), reset: mission.filter((x) => RESETTABLE.includes(x.state) && r() < 0.3).map(numberOf), cancel: mission.filter((x) => ["planned", "ready"].includes(x.state) && r() < 0.15).map(numberOf) });
}

const seededGraph = (r) => ((input) => ({ group: "seeded-graph", input, expect: expectOf(ruleOf(input)) }))(proposed(r, heldOf(r), limitsOf(r)));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seededGraph(r))]);
}

// ---- the reference model, held to what the contract says in words ------------------------------------------------------

export const selfTest = () => [...HAND.filter(([, input, rule]) => ruleOf(input) !== rule).map(([group, input]) => `the reference model disagrees with the contract on ${group}: ${JSON.stringify(input.units.map((x) => x.id))}`), ...TOPO.filter(([nodes, ring]) => cyclic(nodes) !== ring).map(([nodes]) => `the reference model disagrees with the contract on a cycle among ${nodes.map((n) => n.id).join(", ")}`)];
