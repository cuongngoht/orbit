// The REQUIREMENT GRAPH: what a task asks for, and what satisfying it asks for
// in turn -- expanded through the providers the resolver chooses, never
// through a list somebody keeps.
//
//   required      the intent implies it, or a chosen provider `needs` it
//   conditional   a refinement cue in the prompt added it
//   optional      a chosen provider could use it (`optional`) -- resolved only
//                 when the task itself names a provider for it
//   transitive    any node a provider pulled in rather than the prompt; `from`
//                 says which requirement it serves, `via` through whom
//
// So `development.implementation` -> orbit-develop -> `project.context` ->
// the engine's project-context provider -> its own optional needs, and every
// node knows why it is there. Nothing here says a skill needs a SERVER: a skill
// needs capabilities, a server provides them, and the resolver joins the two.
//
// Deterministic: breadth first, in the order requirements were asked and
// declared. Bounded: at most MAX_NODES. A requirement is resolved ONCE; meeting
// it again adds an edge, and upgrades it if it is now asked more strongly. A
// requirement that would lead back to one of its own ancestors is a CYCLE: it
// is recorded, and not followed.
import { resolveRequirement } from "./select.mjs";

export const MAX_NODES = 24;
const STRENGTH = { optional: 1, conditional: 2, required: 3 };
const PULLS = [["needs", "required"], ["optional", "optional"]];

// asked: classify()'s `asked`   ctx: { resources, grams }
export function expandGraph(asked, ctx) {
  const graph = { nodes: [], byId: new Map(), cycles: [], truncated: false, ctx: { ...ctx, asked: new Set(asked.map((n) => n.requirement)) } };
  const queue = asked.map((n) => ({ ...n, from: null, via: null, path: [], transitive: false, workflow: null }));
  while (queue.length) visit(graph, queue, queue.shift());
  return { nodes: graph.nodes.map(({ path: _p, ...n }) => n), cycles: graph.cycles, truncated: graph.truncated };
}

function visit(graph, queue, item) {
  if (item.path.includes(item.requirement)) return void graph.cycles.push([...item.path, item.requirement]);
  const seen = graph.byId.get(item.requirement);
  if (seen) return revisit(graph, queue, seen, item);
  if (graph.nodes.length >= MAX_NODES) return void (graph.truncated = true);
  added(graph, queue, item);
}

function added(graph, queue, item) {
  const node = { ...item, from: item.from ? [item.from] : [], ...resolveRequirement(item, { ...graph.ctx, workflow: item.workflow }) };
  graph.nodes.push(node);
  graph.byId.set(node.requirement, node);
  pulled(queue, node);
}

// Met again: one more parent, and -- if it is now asked more strongly and
// nothing was chosen the first time -- resolved again at the stronger level.
function revisit(graph, queue, node, item) {
  if (item.from && !node.from.includes(item.from)) node.from.push(item.from);
  if (STRENGTH[item.level] <= STRENGTH[node.level]) return;
  Object.assign(node, { level: item.level }, node.provider ? {} : resolveRequirement({ ...node, level: item.level }, { ...graph.ctx, workflow: item.workflow }));
  if (node.provider && node.status !== "blocked" && node.status !== "missing") pulled(queue, node);
}

// A chosen provider's own needs join the queue -- but a provider that cannot be
// used (blocked, missing) pulls nothing in: its needs would never be met.
function pulled(queue, node) {
  if (!["selected", "approval"].includes(node.status)) return;
  const workflow = workflowOf(node);
  for (const [field, level] of PULLS) for (const requirement of node.provider.routing[field]) queue.push({ requirement, level, from: node.requirement, via: node.provider.key, viaId: node.provider.id, path: [...node.path, node.requirement], transitive: true, workflow, because: `${node.provider.id} ${field === "needs" ? "needs" : "can use"} it` });
}

// A workflow exception (src/policy.mjs) is about the SKILL a requirement
// serves: the nearest skill that pulled it in, directly or through a provider.
const workflowOf = (node) => (node.provider.kind === "skill" ? node.provider.id : node.workflow ?? null);
