import { describe, layerItems, layersOf, screenEffects } from "../graph/index.mjs";
import { out } from "./format.mjs";

export function showEffect(ctx, args) {
  const id = args.join(" ");
  const fx = ctx.graph.screens.has(id) ? screenEffects(ctx.graph, id) : ctx.graph.effects.filter((e) => e.on === id);
  if (!fx.length) return out(`no traced effect for "${id}"`);
  for (const f of fx) one(ctx, f);
}

function one(ctx, f) {
  out(`${f.on}`);
  out(`  ${f.api ?? "(no backend call)"}  [${f.backend}]${f.auth ? `  ${f.auth}` : ""}`);
  out(`  timing: ${f.timing}${f.partial ? "   PARTIAL TRACE" : ""}`);
  out(`  ${f.src}`);
  rest(ctx, f);
}

function rest(ctx, f) {
  for (const l of layersOf(ctx.graph.meta)) for (const i of layerItems(f, l.key)) out(`    ${l.label.padEnd(11)} ${describe(l, i)}   ${i.src}`);
  if (f.note) out(`  ! ${f.note}`);
  out("");
}

export function regress(ctx, args) {
  const needle = args.join(" ");
  const hits = touching(ctx, needle.toLowerCase());
  if (!hits.length) return out(`nothing traced touches "${needle}" — note that only ${ctx.graph.effects.length} actions are traced so far`);
  out(`${hits.length} action(s) touch "${needle}" — each is a regression candidate:\n`);
  for (const [f, l, i] of hits) out(`  ${f.on}\n      ${l.key}: ${describe(l, i)}   ${i.src}`);
}

const touching = (ctx, q) => ctx.graph.effects.flatMap((f) => layersOf(ctx.graph.meta).flatMap((l) => layerItems(f, l.key).filter((i) => JSON.stringify(i).toLowerCase().includes(q)).map((i) => [f, l, i])));
