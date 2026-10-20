// Reading the snapshot: the index, one fact in full, and the capability catalog.
//
// Three commands rather than one, the split src/learn/views/lessons.mjs makes
// for the same reason: `facts` is an index and must stay small enough to paste,
// `why` is the whole chain and is allowed to be long, and `capabilities` answers
// a question a planner asks that neither of the others does.
import { Refused } from "../../errors.mjs";
import { factState, measure } from "../../freshness.mjs";
import { out } from "../../query/format.mjs";
import { verifiedAgainstSource } from "../model.mjs";
import { words } from "../../learn/args.mjs";

export function facts(ctx, args) {
  const [kind] = words(args);
  const all = ctx.arch.all().filter((f) => !kind || f.kind === kind);
  if (!all.length) return out(empty(ctx, kind));
  out(`${all.length} fact(s)${kind ? ` of kind ${kind}` : ""} — \`architecture why <id>\` for the evidence behind one\n`);
  listed(all);
}

const empty = (ctx, kind) => (ctx.arch.all().length ? `no fact of kind "${kind}"` : "nothing has scanned this project yet — `architecture ensure` builds a snapshot");

function listed(all) {
  for (const f of [...all].sort(byKind)) out(`  ${f.status.padEnd(7)} ${f.confidence.padEnd(8)} ${f.kind.padEnd(16)} ${clip(f.statement, 64)}\n${"".padEnd(35)}${f.id}`);
}

const byKind = (a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.key).localeCompare(String(b.key));

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

export function why(ctx, args) {
  const [id] = words(args);
  const fact = ctx.arch.find(id);
  if (!fact) throw new Refused(`no fact "${id}" — \`architecture facts\` lists them`);
  chain(ctx, fact);
}

function chain(ctx, fact) {
  const scopes = measure([fact], ctx.arch.model().model, ctx.source);
  out(`FACT          ${fact.statement}\n`);
  out(`STATUS        ${factState(fact, scopes)}${fact.because ? ` — ${fact.because}` : ""}`);
  out(`CONFIDENCE    ${fact.confidence}`);
  provenance(ctx, fact, scopes);
}

function provenance(ctx, fact, scopes) {
  out(`SOURCE        ${fact.source} — ${verifiedAgainstSource(fact) ? "verified against source" : "NOT verified against source; nobody checked this against the code"}`);
  for (const s of fact.scope ?? []) out(`SCOPE         ${s.padEnd(28)} ${scopes[s]?.say ?? "not measured"}`);
  for (const e of fact.evidence ?? []) out(`EVIDENCE      ${e}`);
  out(`LAST VERIFIED ${fact.commit ?? "no commit recorded"} on ${String(fact.at ?? "").slice(0, 10) || "an unknown date"}`);
  unknown(fact);
}

// Printed ALWAYS, even when empty. A section that vanishes teaches the reader
// that its absence means "everything is known" -- the habit every lesson's
// `not known` block keeps, and the one most worth copying.
function unknown(fact) {
  out("NOT KNOWN");
  const rows = fact.unknowns ?? [];
  if (!rows.length) return out("              nothing this analysis could not compute was recorded");
  for (const u of rows) out(`              ${u}`);
}
