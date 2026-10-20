// `knowledge claims [--for="…"] [--subject=a,b] [--context=k=v,…] [--json]` and
// `knowledge why <claim-id>` -- the read side. Neither writes anything: freshness
// is MEASURED for the answer and never stamped back, and what host memory hinted
// is shown for this invocation only.
//
// `claims` is what project context shows (src/context/sections.mjs): the few
// answers a task touches, each settled per (subject, relation) in the context
// asked, with its authority tier and its conflicts -- bounded, so a project that
// knows a great deal still answers in a screenful. UNKNOWN is said, never filled.
import { Refused } from "../../errors.mjs";
import { words } from "../../learn/args.mjs";
import { out } from "../../query/format.mjs";
import { askOf, gathered } from "../gather.mjs";
import { interpreted } from "../interpreters.mjs";
import { isReference, said, whenOf, watched } from "../model.mjs";
import { graded, measured, query, rivalsOf } from "../query.mjs";
import { authorityOf, sourceRow } from "../vocab.mjs";
import { interpretersOf, relationOf } from "../vocabulary.mjs";

const OPEN = ["candidate", "offered", "deferred", "accepted"];

export function claims(ctx, args) {
  const g = gathered(ctx, askOf(ctx, args));
  const answer = query(g.claims, g.ask, ctx.parts, measured(ctx, g.stored));
  const notes = interpreted(ctx.parts, shownClaims(answer), g.ask, new Map(graded(shownClaims(answer), g.ask, ctx.parts).map((r) => [r.claim.id, r])));
  if (args.includes("--json")) return out(JSON.stringify(jsonOf(ctx, g, answer, notes), null, 2));
  printed(ctx, g, answer, notes);
}

const shownClaims = (answer) => answer.answers.flatMap((a) => [...a.prevails, ...a.rivals, ...a.conditional].map((r) => r.claim));

const contextText = (context) => whenOf(context).trim().replace(/^when /, "") || "everywhere";

function printed(ctx, g, answer, notes) {
  out(`KNOWLEDGE${g.ask.tokens.length ? `  for: ${g.ask.tokens.slice(0, 8).join(", ")}` : "  (no task — binding claims only)"}  in: ${contextText(g.ask.context)}`);
  if (!answer.answers.length) out(g.stored.length ? "  nothing recorded speaks to this — UNKNOWN, not permission to guess" : "  nothing is recorded about this project yet — `knowledge record` starts it");
  for (const a of answer.answers) for (const line of LINES[a.status](a)) out(line);
  footer(ctx, g, answer, notes);
}

const row = (r) => `  ${r.tier.toUpperCase().padEnd(11)} ${said(r.claim)}${r.measured === "fresh" || r.claim.layer !== "project" ? "" : ` [${r.measured}]`}`;

const concern = (a) => (a.role ? `${a.role.concern} · ${a.relation.id} is ${a.role.name}` : `${a.relation.id} has no role here — kept, derives nothing`);

const conditionalText = (a) => (a.conditional.length ? ` · also ${a.conditional.slice(0, 2).map((r) => `${r.claim.object}${whenOf(r.claim.context)}`).join("; ")}` : "");

const LINES = {
  known: (a) => [row(a.prevails[0]), `              ${concern(a)}${a.rivals.length ? ` · outranks ${a.rivals.map((r) => `${r.claim.object} (${r.tier})`).join(", ")}` : ""}${conditionalText(a)} — ${a.prevails[0].claim.id}`],
  many: (a) => [...a.prevails.slice(0, 3).map(row), `              ${concern(a)}${a.prevails.length > 3 ? ` · ${a.prevails.length - 3} more` : ""}${conditionalText(a)}`],
  unknown: (a) => [`  UNKNOWN     ${a.subject} ${a.relation.id} … — it depends on ${[...new Set(a.conditional.flatMap((r) => r.unmet))].join(", ")}: ${a.conditional.slice(0, 3).map((r) => `${r.claim.object}${whenOf(r.claim.context)}`).join("; ")}`],
  ambiguous: (a) => [`  AMBIGUOUS   ${a.subject} ${a.relation.id}: ${a.rivals.map((r) => `${r.claim.object} (${r.tier})`).join(" | ")} — nothing ranks them; a person decides`],
};

function footer(ctx, g, answer, notes) {
  hostBlock(g);
  const open = ctx.know.opportunities().filter((o) => OPEN.includes(o.state)).length;
  if (open) out(`  ${open} capability opportunit${open === 1 ? "y is" : "ies are"} open — \`knowledge opportunities\``);
  if (answer.uninterpreted.length) out(`  relations nothing here understands: ${answer.uninterpreted.slice(0, 6).join(", ")} — kept and shown, never guessed at`);
  for (const line of [...notes.notes, ...notes.problems, ...unknowns(ctx, g)].slice(0, 6)) out(`  ! ${line}`);
}

function hostBlock(g) {
  if (!g.recall.hints.length) return;
  out(`  host memory (unverified, this invocation only): ${g.recall.hints.length} note(s) relate${g.targets.subjects.length ? ` — they point at ${g.targets.subjects.join(", ")}` : ""}${g.targets.scopes.length ? `; confirm against ${g.targets.scopes.join(", ")}` : ""}`);
  for (const h of g.recall.hints.slice(0, 3)) out(`      · "${h.title || "untitled"}" (${h.provider})`);
}

const unknowns = (ctx, g) => [...(ctx.notes ?? []).map((n) => n.say), ...g.declared.refused.map((r) => `declared ${r.at}: ${r.why}`), ...g.recall.unknowns];

function jsonOf(ctx, g, answer, notes) {
  const hostMemory = { hints: g.recall.hints.map((h) => ({ id: h.id, provider: h.provider, title: h.title })), targets: g.targets, unknowns: g.recall.unknowns };
  return { version: 1, ask: { tokens: g.ask.tokens, subjects: g.ask.subjects, context: g.ask.context }, answers: answer.answers.map(answerJson), total: answer.total, hostMemory, opportunities: ctx.know.opportunities().filter((o) => OPEN.includes(o.state)).length, uninterpreted: answer.uninterpreted, notes: notes.notes, problems: notes.problems };
}

const rowJson = (r) => ({ id: r.claim.id, object: r.claim.object, context: r.claim.context, tier: r.tier, measured: r.measured, source: r.claim.source, strength: r.claim.strength, layer: r.claim.layer, confidence: r.claim.confidence });

const answerJson = (a) => ({ subject: a.subject, relation: a.relation.id, role: a.role?.name ?? null, concern: a.role?.concern ?? null, cardinality: a.relation.cardinality, status: a.status, prevails: a.prevails.map(rowJson), rivals: a.rivals.map(rowJson), conditional: a.conditional.map((r) => ({ ...rowJson(r), unmet: r.unmet })) });

export function why(ctx, args) {
  const [id] = words(args);
  const claim = ctx.know.find(id) ?? (ctx.declared?.().claims ?? []).find((c) => c.id === id);
  if (!claim) throw new Refused(`no claim "${id}" — \`knowledge claims\` lists them`);
  chain(ctx, claim, measured(ctx, [claim])[claim.id]);
}

function chain(ctx, claim, status) {
  const tier = authorityOf({ ...claim, measured: status });
  out(`CLAIM         ${said(claim)}`);
  out(`AUTHORITY     ${tier.tier} — ${tier.says}`);
  out(`FRESHNESS     ${status} now${claim.status && claim.status !== status ? ` (recorded ${claim.status})` : ""} — watches ${watched(claim).join(", ") || "nothing: it cannot go stale, and cannot be current either"}`);
  provenance(ctx, claim);
}

function provenance(ctx, claim) {
  out(`SOURCE        ${claim.source} · ${sourceRow(claim.source)?.verified ? "verified against source" : "NOT verified against source"} · ${claim.strength} · layer ${claim.layer}`);
  for (const e of claim.evidence ?? []) out(`EVIDENCE      ${e}${isReference(e) ? "  (a reference the engine stamped)" : ""}`);
  out(`SUPPORT       ${claim.support ? `${claim.support.sessions} independent session(s) · ${claim.support.against} against · confidence ${claim.confidence}` : `confidence ${claim.confidence} — not reconciled (${claim.layer})`}`);
  meaning(ctx, claim);
}

function meaning(ctx, claim) {
  const relation = relationOf(ctx.parts, claim.relation);
  out(`RELATION      ${relation.declared ? `${relation.role ?? "no role"} · cardinality ${relation.cardinality} · declared by ${relation.from}` : "declared by nobody — kept and shown, derives nothing"}${interpretersOf(ctx.parts, claim.relation).length ? ` · understood by ${interpretersOf(ctx.parts, claim.relation).join(", ")}` : ""}`);
  for (const r of rivalsOf(ctx.know.all(), claim, ctx.parts)) out(`RIVAL         ${said(r)} — ${r.id}`);
  out(`JOURNAL       ${ctx.know.journalLines().filter((l) => l.claimId === claim.id).length} observation(s) behind it`);
  notKnown(claim);
}

// Printed ALWAYS: a section that vanished when empty would teach a reader that
// its absence means "everything is known".
function notKnown(claim) {
  out("NOT KNOWN");
  if (!(claim.unknowns ?? []).length) return out("              nothing this claim could not settle was recorded");
  for (const u of claim.unknowns) out(`              ${u}`);
}
