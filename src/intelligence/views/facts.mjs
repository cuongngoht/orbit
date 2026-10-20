// Reading the snapshot: the index, and one subject in full.
//
// `why` takes a fact id OR a technology id. A technology is not one fact -- it
// is a declared fact, some usages, perhaps a registration -- and "why does this
// tool think we use the Acme client" is answered by the whole ladder, rung by rung, with
// what each rung could not settle.
import { Refused } from "../../errors.mjs";
import { factState, measure } from "../../freshness.mjs";
import { words } from "../../learn/args.mjs";
import { out } from "../../query/format.mjs";
import { verifiedAgainstSource } from "../model.mjs";
import { maturityOf } from "../technology/maturity.mjs";

export function facts(ctx, args) {
  const [kind] = words(args);
  const all = ctx.intel.all().filter((f) => !kind || f.kind === kind);
  if (!all.length) return out(empty(ctx, kind));
  out(`${all.length} fact(s)${kind ? ` of kind ${kind}` : ""} — \`intelligence why <id>\` for the evidence behind one\n`);
  for (const f of [...all].sort(byKind)) out(`  ${f.status.padEnd(7)} ${f.confidence.padEnd(8)} ${f.kind.padEnd(11)} ${clip(f.statement, 70)}\n${"".padEnd(30)}${f.id}`);
}

export const empty = (ctx, kind) => (ctx.intel.all().length ? `no fact of kind "${kind}"` : "nothing has read this project's technologies yet — `intelligence ensure` builds the snapshot");

const byKind = (a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.key).localeCompare(String(b.key));

export const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

export function why(ctx, args) {
  const [id] = words(args);
  const fact = ctx.intel.find(id);
  return fact ? chain(ctx, fact) : technologyWhy(ctx, id);
}

function technologyWhy(ctx, id) {
  const ladders = maturityOf(ctx.intel.all()).filter((l) => l.technology === id);
  if (!ladders.length) throw new Refused(`no fact and no technology "${id}" — \`intelligence facts\` and \`intelligence technologies\` list them`);
  for (const l of ladders) printLadder(l);
}

function chain(ctx, fact) {
  const scopes = measure([fact], ctx.intel.model().model, ctx.source);
  out(`FACT          ${fact.statement}\n`);
  out(`STATUS        ${factState(fact, scopes)}${fact.because ? ` — ${fact.because}` : ""}`);
  out(`CONFIDENCE    ${fact.confidence}`);
  details(fact, scopes);
}

function details(fact, scopes) {
  out(`SOURCE        ${fact.source} — ${verifiedAgainstSource(fact) ? "verified against source" : "NOT verified against source"}\nROOT          ${fact.root}`);
  for (const s of fact.scope ?? []) out(`SCOPE         ${s.padEnd(34)} ${scopes[s]?.say ?? "not measured"}`);
  for (const e of fact.evidence ?? []) out(`EVIDENCE      ${e}`);
  for (const d of fact.dependencies ?? []) out(`DEPENDENCY    ${d.name.padEnd(40)} ${d.relationship}${d.role ? ` · ${d.role}` : ""}${d.conditional ? " · conditional" : ""}`);
  notKnown(fact.unknowns ?? []);
}

// Printed ALWAYS, even when empty: a section that vanishes teaches the reader
// that its absence means everything is known.
export function notKnown(rows) {
  out("NOT KNOWN");
  if (!rows.length) return out("              nothing this analysis could not compute was recorded");
  for (const u of rows) out(`              ${u}`);
}

export function printLadder(l) {
  out(`technology: ${l.technology}   (${l.root})\n`);
  rungs(l);
  out("\nevidence");
  for (const e of l.evidence) out(`  ${e}`);
  notKnown(l.unknowns);
}

function rungs(l) {
  for (const r of l.rungs.filter((x) => x.name !== "used-for")) out(`  ${r.name.padEnd(22)} ${r.reached ? "yes" : "no"}`);
  out(`  ${"used-for".padEnd(22)} ${l.usedFor.length ? l.usedFor.join(", ") : "nothing the code names"}`);
  for (const w of l.wiring) out(`  ${"wired".padEnd(22)} ${w.abstraction} -> ${w.implementation ?? "a factory"} (${w.lifetime})`);
}
