// --dry: the resolved plan, grouped by screen, and not one browser command.
//
// It binds what it KNOWS -- the params, and their defaults -- and says plainly
// what it does not. A `resolve` target comes from SQL this run will not run, and
// an `into` value does not exist until the step that binds it has executed.
// Printing a plausible value for either would be the same lie as leaving an
// unfilled placeholder in a query: it reads like an answer.
import { interpolateStep, unresolved } from "../dsl/interpolate.mjs";
import { waitOf } from "../dsl/selector.mjs";
import { DEFAULT_TIMEOUT_SEC, DEFAULT_TRIES, trunc } from "./errors.mjs";
import { label } from "./printer.mjs";

export function printDry(ctx, say, slice, values = {}) {
  const from = binders(slice);
  let shown = null;
  for (const raw of slice) shown = one(ctx, say, interpolateStep(raw, values, ctx.dsl), shown, from);
  say(`\n${slice.length} step(s) resolved${counted(from)}, no browser touched.`);
}

const binders = (slice) => new Map(slice.filter((s) => s.into).map((s) => [s.into, s.i]));

const counted = (from) => (from.size ? `, ${from.size} value(s) bound while the run happens` : "");

function one(ctx, say, s, shown, from) {
  if (s.screen !== shown) say(`▶ ${s.screen}  ${ctx.graph.screens.get(s.screen)?.url ?? ""}`);
  printStep(ctx, say, s);
  pending(ctx, say, s, from);
  return s.screen;
}

function printStep(ctx, say, s) {
  say(`  ${String(s.i).padStart(2)} ${s.do.padEnd(10)} ${label(s, ctx.executors)}`);
  if (s.selector) say(`     selector: ${s.selector}`);
  if (waitOf(s)) say(`     wait: ${trunc(waitOf(s), 90)}  (max ${s.tries ?? DEFAULT_TRIES} polls / ${s.timeout ?? DEFAULT_TIMEOUT_SEC(ctx.env)}s)`);
  if (s.into) say(`     binds \${${s.into}}`);
  printEffect(ctx, say, s);
}

function pending(ctx, say, s, from) {
  for (const n of unresolved(s, ctx.dsl)) say(`     \${${n}} ${source(n, from)}`);
}

const source = (n, from) =>
  (from.has(n)
    ? `is bound by step ${from.get(n)} while it runs — --dry cannot know it`
    : `is filled by resolve before the browser — --dry reads no database`);

function printEffect(ctx, say, s) {
  const fx = ctx.graph.effectOn.get(s.on);
  if (!fx) return;
  const layers = Object.keys(fx.layers ?? {}).join(", ") || "nothing below the UI";
  say(`     effect: ${fx.api ?? "no backend call"} [${fx.backend}] ${fx.timing} — hand back: ${layers}`);
}
