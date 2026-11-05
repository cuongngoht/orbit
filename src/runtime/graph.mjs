// The checkout's COMPONENT GRAPH, as understanding read it from the files: where each component lives, what it depends
// on, the shared files it inherits, and the references nothing read resolves -- the shape src/orchestration/impact.mjs
// derives a change's reach from. ONE definition for every composition root that hands a graph in
// (cli/autonomous-engineering.mjs for a task's verification plan, cli/context.mjs for what a task touches), so the two
// can never read one checkout as two graphs.
import { liveOf } from "./vocab.mjs";

const edgesOf = (c) => c.dependencies ?? [];

export const graphNodeOf = (c) => ({ key: c.key, dir: c.dir, kind: c.kind, live: liveOf(c.kind), dependsOn: edgesOf(c).filter((d) => d.dependsOn).map((d) => d.dependsOn), inherits: edgesOf(c).filter((d) => d.via === "shared").map((d) => d.reference), unresolved: edgesOf(c).filter((d) => d.via === "manifest" && !d.dependsOn).map((d) => d.reference) });

// -> { components: [{ key, dir, kind, live, dependsOn, inherits, unresolved }] } from understanding's view.
export const componentGraphOf = (components) => ({ components: (components ?? []).map(graphNodeOf) });
