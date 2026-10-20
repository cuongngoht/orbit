// `knowledge vocabulary` and `knowledge where` -- what relations mean here, who
// said so, and where every room is. Both read only.
//
// The vocabulary view is what an extension author starts from: every relation
// a layer declares (and which layer), what was refused and why, the relations
// claims USE that nobody declares -- kept and shown, deriving nothing -- and
// which interpreter understands what.
import { out } from "../../query/format.mjs";
import { interpretersOf } from "../vocabulary.mjs";

export function vocabulary(ctx) {
  const rows = ctx.parts.relations();
  out(`${rows.length} relation(s) declared — extensions first, then orbit · organization · project\n`);
  for (const r of rows) out(`  ${r.id.padEnd(32)} ${String(r.role ?? "no role").padEnd(15)} ${r.cardinality.padEnd(5)} ${r.layer.padEnd(12)} ${r.from}`);
  inUse(ctx);
  refusals(ctx);
}

function inUse(ctx) {
  const used = [...new Set(ctx.know.all().map((c) => c.relation))].filter((id) => !ctx.parts.relation(id)).sort();
  if (used.length) out(`\nin use, declared by nobody (kept, shown, derive nothing): ${used.join(", ")}`);
  for (const i of ctx.parts.interpreters()) out(`\ninterpreter ${i.id} (${i.from}) understands ${i.understands.join(", ")}`);
  for (const id of used.filter((u) => interpretersOf(ctx.parts, u).length)) out(`  ${id} is understood by ${interpretersOf(ctx.parts, id).join(", ")}`);
}

function refusals(ctx) {
  for (const r of ctx.parts.refused()) out(`\nREFUSED  ${r.id}  (${r.layer} · ${r.from})\n         ${r.why}`);
  for (const a of ctx.parts.also()) out(`  also declared: ${a.id} by ${a.from}, the same meaning ${a.first} gave it`);
  for (const l of (ctx.vocabularyLayers ?? []).filter((x) => x.problem)) out(`  ! ${l.from}: ${l.problem}`);
}

export function where(ctx) {
  out(`store         ${ctx.know.paths.root}   (${ctx.store.source ?? "layout 3"})`);
  out(`  claims      ${ctx.know.paths.claims}\n  journal     ${ctx.know.paths.journal}\n  opportunities ${ctx.know.paths.opportunities}\n  vocabulary  ${ctx.know.paths.vocabulary}   (a person writes relation rows here)`);
  out(`organization  ${ctx.organization?.root ?? "(no store base)"}   (read only: vocabulary/*.json, claims/*.jsonl)`);
  out(`host memory   ${(ctx.hostMemory?.() ?? []).map((p) => p.id).join(", ") || "none bound"} — read for one invocation, never stored`);
  out("nothing this command writes ever lands in the repository it reads");
}
