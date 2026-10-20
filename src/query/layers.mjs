// What a screen touches below the UI, laid out the way a QC sheet lists it.
import { describe, layerItems, layersOf, screenControls, screenEffects, surface } from "../graph/index.mjs";
import { noScreen, out } from "./format.mjs";

export function showLayers(ctx, [id]) {
  const s = ctx.graph.screens.get(id);
  if (!s) return noScreen(id);
  const fx = screenEffects(ctx.graph, id);
  header(ctx, s, fx);
  table(ctx, s, fx);
}

function table(ctx, s, fx) {
  for (const l of layersOf(ctx.graph.meta)) layer(s, fx, l);
  if (!s.traced) out(`\n! "?" = not traced yet, NOT a claim the layer is untouched. Set "traced":true on the screen node once every commit action here has an effect record — only then does "—" mean "proven untouched".`);
}

function header(ctx, s, fx) {
  const sub = [...surface(ctx.graph, s.id)].filter((x) => x !== s.id);
  out(`${s.name}${s.url ? `  ${s.url}` : ""}`);
  if (sub.length) out(`including ${sub.length} sub-surface(s): ${sub.join(", ")}`);
  out(`${fx.length} of ${screenControls(ctx.graph, s.id).length} controls have a traced effect\n`);
  api(s, fx);
}

function api(s, fx) {
  const backends = [...new Set(fx.map((f) => f.backend).filter(Boolean))];
  out(`Frontend    ✓   ${s.module ?? "(module not recorded)"}`);
  out(`API         ${backends.length ? backends.join("/") : "?"}   ${fx.map((f) => f.api).filter(Boolean).join("; ") || "-"}`);
}

// Absence only means "no" once the screen is declared fully traced; until then
// it means "not looked at yet". Conflating the two is how QC stops checking
// something that does happen.
function layer(s, fx, l) {
  const items = fx.flatMap((f) => layerItems(f, l.key).map((i) => [f, i]));
  if (!items.length) return out(`${l.label.padEnd(11)} ${s.traced ? "—" : "?"}`);
  items.forEach(([f, i], n) => entry(n ? "" : l.label, l, f, i));
}

function entry(label, l, f, i) {
  out(`${label.padEnd(11)} ✓   ${describe(l, i)}`);
  out(`${"".padEnd(11)}     ${i.src}   via ${f.on}`);
}
