// What an ENVIRONMENT must provide, normalised out of what the facts say.
//
// The designer must not be a case per stack: "if it is Node, write a Node
// template; if it is .NET, write a .NET one" is how an engine learns every
// product it will ever meet. So there is one model between what a checkout needs
// and what an environment is built from:
//
//   runtime facts  ->  NORMALISED REQUIREMENTS  ->  designer  ->  a proposal
//
// A normalised requirement is stack-independent: an id the catalog knows, a range,
// which components want it and at which stage, and what -- if anything -- provides
// it in a container. A polyglot checkout (a client, a worker, two servers, a
// browser driver) is just a longer list of the same thing.
//
// Every requirement is here whatever its STAGE: an environment built to DEVELOP in
// holds the browser driver a test run needs, even though starting the client does
// not. Only what a file DECLARES counts -- a base image's guess is a note -- and
// what the catalog cannot place is said, never invented.
import { requirement as row } from "./catalog.mjs";
import { lowerBound, readable } from "./ranges.mjs";

// -> { environment, services, ports, notes, unknowns }
export function requirementsOf(view, catalog) {
  const all = [...view.components.flatMap((c) => c.requirements.map((r) => ({ ...r, component: c.key }))), ...view.shared.requirements.map((r) => ({ ...r, component: null }))];
  const declared = all.filter((r) => r.confidence === "certain");
  const environment = implied([...grouped(declared)].map(([id, group]) => merged(id, group, catalog)), catalog).filter((r) => !r.brought);
  return { environment, services: view.services.map(({ service, name, port, image, file }) => ({ service, name, port, image, file })), ports: portsOf(view), notes: all.filter((r) => r.confidence !== "certain").map((r) => `${r.requirement} may also be needed (${r.source})`), unknowns: environment.filter((r) => r.wanted === null && r.range).map((r) => `${r.name}: ${r.range} is a range this engine cannot turn into a version to install`) };
}

const grouped = (list) => list.reduce((by, r) => by.set(r.requirement, [...(by.get(r.requirement) ?? []), r]), new Map());

// A requirement that comes WITH another (npm with Node.js) needs that other in the environment, named or
// not -- otherwise an environment made for an app that only says it uses npm would hold no Node.js at all.
function implied(list, catalog) {
  const needed = [...new Set(list.filter((r) => r.with && !list.some((x) => x.id === r.with)).map((r) => r.with))];
  return [...list, ...needed.map((id) => merged(id, list.filter((r) => r.with === id).map((r) => ({ requirement: id, range: null, stage: r.stages[0], component: r.components[0] ?? null })), catalog))];
}

function merged(id, group, catalog) {
  const entry = row(catalog, id);
  const ranges = [...new Set(group.map((r) => r.range).filter(Boolean))];
  const wanted = ranges.length && ranges.every(readable) ? [...new Set(ranges.map(lowerBound).filter(Boolean))].sort(byVersion).at(-1) ?? null : null;
  return { id, name: entry?.name ?? id, range: ranges.join(" ") || null, wanted, components: [...new Set(group.map((r) => r.component).filter(Boolean))], stages: [...new Set(group.map((r) => r.stage))], known: Boolean(entry), container: entry?.container ?? null, feature: entry?.feature ?? null, brought: Boolean(entry?.with), with: entry?.with ?? null, doc: entry?.doc ?? null };
}

// Numerically, part by part: 4.7.2 below 4.8, 5 below 10.
const byVersion = (a, b) => String(a).split(".").map(Number).reduce((d, n, i) => d || n - (Number(String(b).split(".")[i]) || 0), 0);

const portsOf = (view) => [...new Set(view.components.flatMap((c) => c.ports.map((p) => p.port)))].sort((a, b) => a - b);
