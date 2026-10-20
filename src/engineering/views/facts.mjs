// Reading the snapshot: the index and one fact in full --
// src/architecture/views/facts.mjs's identical split, for the same reason:
// the index has to stay small enough to paste, and `why` is allowed to be
// long. Neither re-measures anything: `why` reports the STAMPED status, and
// `engineering ensure` is the command that brings it up to date -- reading
// must never quietly write.
import { Refused } from "../../errors.mjs";
import { out } from "../../query/format.mjs";
import { verifiedAgainstSource } from "../model.mjs";
import { words } from "../../learn/args.mjs";

export function facts(ctx, args) {
  const [kind] = words(args);
  const all = ctx.eng.all().filter((f) => !kind || f.kind === kind);
  if (!all.length) return out(empty(ctx, kind));
  out(`${all.length} fact(s)${kind ? ` of kind ${kind}` : ""} — \`engineering why <id>\` for the evidence behind one\n`);
  listed(all);
}

const empty = (ctx, kind) => (ctx.eng.all().length ? `no fact of kind "${kind}"` : "nothing has recorded this project's engineering yet — `engineering record` (or the observer agent, piped through it) builds it up");

function listed(all) {
  for (const f of [...all].sort(byKind)) out(`  ${f.strength.padEnd(9)} ${f.status.padEnd(7)} ${f.confidence.padEnd(8)} ${f.kind.padEnd(16)} ${clip(f.statement, 56)}\n${"".padEnd(43)}${f.id}`);
}

const byKind = (a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.key).localeCompare(String(b.key));

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

export function why(ctx, args) {
  const [id] = words(args);
  const fact = ctx.eng.find(id);
  if (!fact) throw new Refused(`no fact "${id}" — \`engineering facts\` lists them`);
  chain(fact);
}

function chain(fact) {
  out(`FACT          ${fact.statement}\n`);
  out(`STATUS        ${fact.status}${fact.because ? ` — ${fact.because}` : ""}`);
  out(`CONFIDENCE    ${fact.confidence}`);
  out(`STRENGTH      ${fact.strength}`);
  provenance(fact);
}

function provenance(fact) {
  out(`SOURCE        ${fact.source} — ${verifiedAgainstSource(fact) ? "verified against source" : "NOT verified against source; nobody checked this against the code"}`);
  for (const s of fact.scope ?? []) out(`SCOPE         ${s}`);
  for (const e of fact.evidence ?? []) out(`EVIDENCE      ${e}`);
  support(fact);
}

function support(fact) {
  out(`SUPPORT       ${fact.support ? `${fact.support.examples} example(s) · ${fact.support.sessions} independent session(s) · ${fact.support.against ?? 0} against — \`engineering journal ${fact.id}\` for each one` : "recorded before reconciliation — its confidence was claimed, not derived, until something confirms it"}`);
  out(`LAST VERIFIED ${fact.commit ?? "no commit recorded"} on ${String(fact.at ?? "").slice(0, 10) || "an unknown date"}`);
  out(`STRENGTH SET  ${fact.adoptedBy ? `by an explicit human record on ${String(fact.adoptedBy.at ?? "").slice(0, 10)}` : "by observation — no person has decided it"}${fact.enforcedBy ? ` · enforced by ${fact.enforcedBy.join(", ")}` : ""}`);
  unknown(fact);
}

// Printed ALWAYS, even when empty -- src/architecture/views/facts.mjs's same
// habit: a section that vanishes teaches the reader that its absence means
// "everything is known".
function unknown(fact) {
  out("NOT KNOWN");
  const rows = fact.unknowns ?? [];
  if (!rows.length) return out("              nothing this analysis could not compute was recorded");
  for (const u of rows) out(`              ${u}`);
}
