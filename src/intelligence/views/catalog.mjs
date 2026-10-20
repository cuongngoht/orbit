// The subject-shaped views: ecosystems, dependencies, technologies,
// integrations, wiring. Read-only, and each prints what the facts say and
// nothing they do not -- a view never invents certainty, so every row carries
// its confidence, and every view ends with what it cannot tell.
import { words } from "../../learn/args.mjs";
import { out } from "../../query/format.mjs";
import { declares } from "../../ecosystems/contract.mjs";
import { descriptorsFor, recognising } from "../technology/match.mjs";
import { maturityOf } from "../technology/maturity.mjs";
import { technologiesOf } from "../usage/links.mjs";
import { empty, printLadder } from "./facts.mjs";

const kindOf = (ctx, kind) => ctx.intel.all().filter((f) => f.kind === kind).sort((a, b) => String(a.key).localeCompare(String(b.key)));

export function ecosystems(ctx) {
  const rows = kindOf(ctx, "ecosystem");
  if (!rows.length) return out(empty(ctx, "ecosystem"));
  for (const e of rows) out(`  ${e.root.padEnd(12)} ${e.ecosystem.padEnd(10)} ${String(e.units).padStart(3)} unit(s)  ${e.runtime ? `runtime ${e.runtime}` : ""}${e.targets ? `  targets ${e.targets.join(", ")}` : ""}${e.sdk ? `  sdk ${e.sdk}` : ""}`);
  out(`\n${rows.length} ecosystem(s) — every one of them is an adapter registration; nothing here branches on which`);
}

// EVERY dependency, recognised or not. `--unmatched` shows only what no
// descriptor knows: the internal packages a project may want to describe.
export function dependencies(ctx, args) {
  const compiled = recognising(ctx.registry.descriptors.list());
  const rows = kindOf(ctx, "manifest").flatMap((m) => (m.dependencies ?? []).map((d) => ({ m, d, techs: descriptorsFor(compiled, { ...d, ecosystem: m.ecosystem }).map((x) => x.id) })));
  const shown = args.includes("--unmatched") ? rows.filter((r) => !r.techs.length && declares(r.d.relationship)) : rows;
  for (const r of shown) out(`  ${r.d.name.padEnd(44)} ${r.d.relationship.padEnd(9)} ${(r.techs.join(", ") || "— no descriptor").padEnd(24)} ${r.m.key}`);
  out(`\n${shown.length} dependency record(s)${args.includes("--unmatched") ? " no descriptor recognises — a project can describe its own in `intelligence where`'s descriptors room" : ""} · managed versions are listed and never counted as used`);
}

export function technologies(ctx, args) {
  const [only] = words(args);
  const ladders = maturityOf(ctx.intel.all()).filter((l) => !only || l.technology === only);
  if (!ladders.length) return out(empty(ctx, "technology"));
  for (const l of ladders) printLadder(l);
  out(`\n${ladders.length} technology(ies) · declared is not used, used is not configured, and a repeated pattern is a candidate — never a rule`);
}

export function integrations(ctx) {
  const rows = kindOf(ctx, "integration");
  if (!rows.length) return out(empty(ctx, "integration"));
  for (const f of rows) out(`  ${f.confidence.padEnd(8)} ${f.root.padEnd(10)} ${`${f.integration}/${f.operation ?? "?"}`.padEnd(28)} ${f.technologies.join(" + ")}${f.roles ? `  (${f.roles.join(", ")})` : ""}`);
  out("\none row per system AND operation — the same system reached two ways is two rows, never one rule");
}

export function wiring(ctx) {
  const rows = kindOf(ctx, "wiring");
  if (!rows.length) return out(empty(ctx, "wiring"));
  const usages = kindOf(ctx, "usage");
  for (const w of rows) out(`  ${w.lifetime.padEnd(10)} ${w.abstraction.padEnd(28)} -> ${(w.implementation ?? "a factory").padEnd(26)} ${technologiesOf(w, usages).join(", ") || "—"}   ${w.scope[0]}`);
  out(`\n${rows.length} registration(s) · the last column is traced, not declared: the implementation is a type the code using that technology declares`);
}
