import { edgeKey } from "../graph/index.mjs";
import { flags, noScreen, out } from "./format.mjs";

export function showScreen(ctx, [id]) {
  const s = ctx.graph.screens.get(id);
  if (!s) return noScreen(id);
  header(s);
  for (const e of ctx.graph.edges.filter((e) => e.from === id)) control(ctx, e);
}

function header(s) {
  out(`${s.name}${s.url ? `  ${s.url}` : "  (no url — reached by navigation)"}`);
  out(`  ${flags(s)}`);
  if (s.note) out(`  ! ${s.note}`);
  out("");
}

function control(ctx, e) {
  const dest = e.to ? ` -> ${e.opens}:${e.to}` : ` (${e.opens})`;
  const fx = ctx.graph.effectOn.get(edgeKey(e));
  out(`  [${e.kind}] ${e.via}${dest}${e.required ? "  REQUIRED" : ""}${e.destructive ? "  DESTRUCTIVE" : ""}${fx ? `  EFFECT:${fx.timing}` : ""}`);
  out(`      ${e.selector}`);
  details(e);
}

function details(e) {
  if (e.options) out(`      options: ${e.options.join(" | ")}`);
  if (e.note) out(`      ! ${e.note}`);
}

export function listScreens(ctx) {
  for (const s of ctx.graph.screens.values()) out(`${(s.url ?? "-").padEnd(42)} ${s.id.padEnd(26)} ${flags(s)}`);
}

export function leadsTo(ctx, [id]) {
  for (const e of ctx.graph.edges.filter((e) => e.to === id)) out(`${e.from}: ${e.via}  [${e.kind}]`);
}
