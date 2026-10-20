import { route } from "../graph/index.mjs";
import { out } from "./format.mjs";

export function showPath(ctx, [from, to]) {
  const steps = route(ctx.graph, from, to);
  if (!steps) return out(`no path ${from} -> ${to}`);
  steps.forEach((s, i) => hop(ctx, s, i));
}

function hop(ctx, s, i) {
  out(`${i + 1}. on ${ctx.graph.screens.get(s.at)?.name ?? s.at}: ${s.e.via}`);
  out(`   ${s.e.selector}`);
  if (s.e.note) out(`   ! ${s.e.note}`);
}
