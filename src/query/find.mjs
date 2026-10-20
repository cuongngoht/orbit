import { out } from "./format.mjs";

// The map only knows screens someone has recorded. When it does not, say so
// plainly rather than leaving the caller with nothing: the project's own
// tooling (a route crawler) is where an unknown screen gets added.
export function find(ctx, args) {
  const q = args.join(" ").toLowerCase();
  const hit = (v) => v && String(v).toLowerCase().includes(q);
  const found = [...screenHits(ctx, hit), ...controlHits(ctx, hit)];
  if (found.length) return found.forEach((line) => out(line));
  out(`GRAPH: no record for "${args.join(" ")}" — add the screen to ${ctx.project.graphDir}/screens.json (seen:src) or crawl it, then record its controls.`);
}

const screenHits = (ctx, hit) => [...ctx.graph.screens.values()].filter((s) => hit(s.id) || hit(s.name) || hit(s.url)).map((s) => `screen  ${s.id}  ${s.name}  ${s.url ?? ""}`);
const controlHits = (ctx, hit) => ctx.graph.edges.filter((e) => hit(e.via) || hit(e.key)).map((e) => `control ${e.from} :: ${e.via}  [${e.kind}]`);
