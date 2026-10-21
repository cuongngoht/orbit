// What the binder is told a logical ref IS (doc §6.1; PBI 06): read off the SYSTEM GRAPH -- the
// node facts reverse engineering recorded with their evidence (src/architecture/graph-view.mjs) --
// and off the design's own observation plan, never off a case. A ref's alias is its node's name as
// a logical alias (`aliasOf`), so a generator proposes `channelRef: "billing-reminders"` from the
// graph and the binder finds the same node. What the graph does not hold is null: the binder then
// says it is a gap.
//
// A node is placed on the topology node of the component that holds it (`of`); a component's
// test hooks are where its own `hooksPort` attribute says. Which role a ref kind is read from is a
// row, never a branch.
const SLUG = /[^a-z0-9]+/g;

export const aliasOf = (name) => String(name ?? "").toLowerCase().replace(SLUG, "-").replace(/^-+|-+$/g, "").slice(0, 64);

// A node's attributes are what a checkout said, so only its own NAMES travel as an address: never a
// key that says where to connect or as whom (the binder lays the host's over them anyway).
const RESERVED = new Set(["alias", "transport", "endpoint", "host", "port", "origin", "credential", "adapter", "namespace", "env"]);
const namesOf = (attributes) => Object.fromEntries(Object.entries(attributes ?? {}).filter(([k]) => !RESERVED.has(k)));

// A base path is a plain path: a leading slash, plain segments -- never a userinfo, a host or a scheme.
const PATH = /^\/(?![\/\\])[A-Za-z0-9/_.~-]{0,200}$/;

const ownerOf = (node) => (node?.of ? String(node.of).replace(/^[a-z-]+:/, "") : null);

// in: { graph: graphOf(...) view, design: the design sidecar }
export function declarationsFrom({ graph, design }) {
  const nodes = graph?.nodes ?? [];
  return (kind, alias) => (DECLARE[kind] ? DECLARE[kind](nodes, alias, design ?? {}) : null);
}

const named = (nodes, roles, alias) => nodes.find((n) => roles.includes(n.role) && aliasOf(n.name) === alias) ?? null;

const componentOf = (nodes, node) => nodes.find((n) => n.role === "component" && aliasOf(n.name) === aliasOf(ownerOf(node))) ?? null;

const hooksPortOf = (nodes, node) => Number(componentOf(nodes, node)?.attributes?.hooksPort) || null;

function channel(nodes, alias) {
  const node = named(nodes, ["channel"], alias);
  return node ? { node: ownerOf(node), ...(node.transport ? { transport: node.transport } : {}), address: namesOf(node.attributes) } : null;
}

function endpoint(nodes, alias) {
  const node = named(nodes, ["interface"], alias);
  return node ? { node: ownerOf(node), ...(Number.isInteger(Number(node.attributes?.port)) && Number(node.attributes.port) > 0 ? { port: Number(node.attributes.port) } : {}), ...(PATH.test(String(node.attributes?.path ?? "")) ? { path: String(node.attributes.path) } : {}) } : null;
}

// A schedule, or a workload, is reached through the test hooks of the component that holds it.
function hooked(roles, field) {
  return (nodes, alias) => {
    const node = named(nodes, roles, alias);
    return node && hooksPortOf(nodes, node) ? { node: ownerOf(node), port: hooksPortOf(nodes, node), address: { [field]: node.name } } : null;
  };
}

// A clock is a component's own -- the one whose hooks inject it -- named by the component.
function clock(nodes, alias) {
  const component = nodes.find((n) => n.role === "component" && aliasOf(n.name) === alias && Number(n.attributes?.hooksPort));
  return component ? { node: component.name, port: Number(component.attributes.hooksPort) } : null;
}

const observer = (nodes, alias, design) => ((o) => (o?.channelRef ? { channel: o.channelRef } : null))((design.observationPlan ?? []).find((x) => x.observerRef === alias));

const fixture = (nodes, alias, design) => ((design.fixtureRefs ?? []).includes(alias) ? {} : null);

const DECLARE = { channel, queue: channel, endpoint, schedule: hooked(["schedule"], "schedule"), workload: hooked(["workload"], "workload"), clock, observer, fixture };
