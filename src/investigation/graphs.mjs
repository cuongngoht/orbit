// Freezing the SYSTEM GRAPH an obligation is derived from (doc §4.1 step 2, §4.2, §10).
//
// The graph is a projection, rebuilt on every read (src/architecture/graph-view.mjs), so the graph
// an obligation rested on must be kept AS IT WAS: written once into the investigation's
// artifacts/graphs, named by the digest of its bytes, under the journal lock (`keepArtifact`). A
// re-scan, a renamed queue or a vocabulary row added later then changes the next projection and
// never the one this obligation was derived from -- which is what lets a later read say the
// obligation is STALE instead of quietly re-deriving it.
//
// Only a projection whose own digest still names its content is frozen: a graph handed in that was
// edited after it was projected is refused whole, and nothing is written. Called from a composition
// root (cli/autonomous-qa.mjs, when it derives); nothing under src/architecture/ knows this exists.
import { Refused } from "../errors.mjs";
import { graphDigestOf } from "../architecture/graph-view.mjs";
import { keepArtifact } from "./index.mjs";

export function freezeGraph(w, graph) {
  if (typeof graph?.digest !== "string" || graphDigestOf(graph) !== graph.digest) throw new Refused("the graph handed in is not the projection its digest names — it was changed after it was projected, so nothing was frozen");
  const kept = keepArtifact(w, "graphs", graph);
  return { ...kept, graph: graph.digest };
}
