// Where the snapshot is kept, and what this engine RECOGNISES -- the
// registrations, and the project's own descriptors that loaded or did not.
//
// The second half exists for the reason `query extensions` does: a descriptor
// that failed to load is the likeliest cause of the next "why is our SDK not
// listed", and until the refusal is printed the only way to find it is to guess.
import { out } from "../../query/format.mjs";

export function where(ctx) {
  out(`store        ${ctx.intel.paths.root}   (${ctx.store?.source ?? "?"})`);
  out(`  facts      ${ctx.intel.paths.facts}\n  state      ${ctx.intel.paths.state}`);
  out(`  your own   ${ctx.intel.paths.descriptors}   — one JSON technology descriptor (or a list) per file`);
  out(`source       ${ctx.source.root ?? "(no readable checkout)"} at ${ctx.source.commit() ?? "an unknown commit"}${ctx.source.roots ? ` · ${ctx.source.roots.length} checkout(s): ${ctx.source.roots.map((r) => r.alias).join(", ")}` : ""}`);
  out("  nothing this command writes ever lands in the repository it reads");
}

export function descriptors(ctx) {
  const r = ctx.registry;
  out(`${r.ecosystems.ids().length} ecosystem adapter(s): ${r.ecosystems.ids().join(", ")}`);
  out(`${r.descriptors.ids().length} technology descriptor(s) · ${r.analyzers.ids().length} usage analyser(s)\n`);
  for (const [from, n] of counts(r.descriptors.list())) out(`  ${String(n).padStart(3)} descriptor(s) from ${from}`);
  loaded(ctx.descriptors ?? { loaded: [], refused: [], room: "" });
}

const counts = (rows) => [...rows.reduce((m, d) => m.set(d.from, (m.get(d.from) ?? 0) + 1), new Map())];

function loaded(state) {
  out(`\nyour own (${state.room}): ${state.loaded.length} loaded, ${state.refused.length} refused`);
  for (const r of state.refused) out(`  REFUSED ${r.id}\n          ${r.why}`);
}
