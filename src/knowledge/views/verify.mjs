// `knowledge verify`, `knowledge opportunities` and `knowledge decide` -- from
// what a change touches to what would prove it, who here can, and what nobody
// can yet.
//
//   verify [--for="…" | --subject=a,b] [--context=k=v] [--changed]
//          [--purpose=development|verification] [--workflow=<slug>] [--dry] [--json]
//
// It DERIVES proof needs (src/knowledge/derive.mjs), asks the EXISTING resolver
// who provides each (src/knowledge/verify.mjs), turns what nobody provides into
// OPPORTUNITIES (src/knowledge/opportunities.mjs) and decides, row by row, which
// are worth asking a person about now (src/knowledge/surface.mjs). It provisions
// nothing, calls nothing and blocks nothing: a gap never changes the exit code,
// and development continues.
//
// The one write is the opportunities -- remembered, so a later verification
// finds them -- and none of it is the task's text.
import { Refused } from "../../errors.mjs";
import { flag, words } from "../../learn/args.mjs";
import { out } from "../../query/format.mjs";
import { derive } from "../derive.mjs";
import { askOf, gathered } from "../gather.mjs";
import { whenOf } from "../model.mjs";
import { askedIn, decided, discovered, settle } from "../opportunities.mjs";
import { measured } from "../query.mjs";
import { surfaced } from "../surface.mjs";
import { resolved } from "../verify.mjs";
import { PURPOSE_NAMES } from "../vocab.mjs";

const WORKFLOW = /^[a-z0-9][a-z0-9:._-]{0,63}$/;
const OPEN = ["candidate", "offered", "deferred", "accepted"];

function runOf(ctx, args, ask) {
  const purpose = flag(args, "purpose") ?? "development";
  const workflow = flag(args, "workflow") ?? "cli";
  if (!PURPOSE_NAMES.includes(purpose)) throw new Refused(`--purpose must be ${PURPOSE_NAMES.join(" or ")}, not "${purpose}"`);
  if (!WORKFLOW.test(workflow)) throw new Refused(`--workflow must be a slug, not "${workflow}"`);
  return { purpose, workflow, at: ctx.now(), seenBy: { host: ctx.know.host, at: ctx.now() }, context: ask.context };
}

export function verify(ctx, args) {
  const g = gathered(ctx, askOf(ctx, args));
  const run = runOf(ctx, args, g.ask);
  const found = derive(g.claims, g.ask, ctx.parts, measured(ctx, g.stored));
  const resolution = resolved(found.needs, ctx.effective());
  return ctx.know.transact(() => reported(ctx, planned(ctx, { ...run, subjects: found.subjects }, found, resolution), args));
}

// Every opportunity this run touched, then the verdict on each one it derived a
// need for -- and the ones worth asking, marked as asked in this session.
function planned(ctx, run, found, resolution) {
  const changed = discovered(ctx.know.opportunities(), resolution.results, run);
  const world = { purpose: run.purpose, workflow: run.workflow, seenBy: run.seenBy, derived: derivedMap(found.needs), demanded: ctx.demanded?.() ?? new Map() };
  const latest = latestDocs(ctx.know.opportunities(), changed);
  const judged = latest.filter((d) => world.derived.has(d.capability)).map((doc) => ({ doc, verdict: surfaced(doc, world) }));
  return { run, found, resolution, changed, judged, asked: judged.filter((j) => j.verdict.asks).map((j) => askedIn(j.doc, run)) };
}

const derivedMap = (needs) => needs.reduce((m, n) => m.set(n.capability, [...(m.get(n.capability) ?? []), n]), new Map());

const latestDocs = (docs, changed) => [...new Map([...docs, ...changed].map((d) => [d.id, d])).values()];

function reported(ctx, plan, args) {
  const writes = latestDocs(plan.changed, plan.asked);
  const kept = args.includes("--dry") ? { written: [], refused: [] } : settle(ctx, writes);
  if (!args.includes("--dry")) for (const doc of plan.asked) ctx.emit?.("knowledge.opportunity.offered", { opportunity: doc.id, capability: doc.capability, workflow: plan.run.workflow, purpose: plan.run.purpose, surface: plan.judged.find((j) => j.doc.id === doc.id)?.verdict.row });
  if (args.includes("--json")) return out(JSON.stringify(jsonOf(plan, kept), null, 2));
  printed(plan, kept, args.includes("--dry"));
}

function printed(plan, kept, dry) {
  out(`VERIFICATION  purpose ${plan.run.purpose} · workflow ${plan.run.workflow} · in ${whenOf(plan.run.context).trim().replace(/^when /, "") || "everywhere"}`);
  out(plan.found.subjects.length ? `  starting from ${plan.found.subjects.join(", ")}` : "  nothing the task names or the working set changed is known here — UNKNOWN, record what the change touches first");
  for (const r of plan.resolution.results) resultLines(r);
  questions(plan);
  closing(plan, kept, dry);
}

const LABEL = { gap: "GAP", provided: "PROVIDED", impaired: "IMPAIRED", decision: "BLOCKED", "cannot-tell": "CANNOT-TELL" };

function resultLines(r) {
  out(`  ${LABEL[r.outcome].padEnd(12)} ${r.capability} — ${r.why}`);
  for (const n of r.needs.slice(0, 2)) out(`               proves ${[n.proves.consequence, n.proves.observation].filter(Boolean).join(" → ") || "it directly"} for ${n.proves.subject}${n.conditional ? whenOf(n.context) : ""} · ${n.tier}${n.session ? " · from host memory, not kept" : ""}${n.by !== "vocabulary" ? ` · by ${n.by}` : ""}`);
}

function questions(plan) {
  for (const j of plan.judged.filter((x) => x.verdict.asks)) out(`  ASK   ${j.doc.capability} (${j.doc.id}) — ${j.verdict.say}\n        a person decides: knowledge decide ${j.doc.id} accept|defer|ignore --human`);
  for (const j of plan.judged.filter((x) => !x.verdict.asks)) out(`  not asked  ${j.doc.capability} — ${j.verdict.say}`);
}

function closing(plan, kept, dry) {
  for (const u of plan.found.unobservable.slice(0, 4)) out(`  unobservable: ${u.consequence} (from ${u.subject}) — nothing says how it could be observed`);
  if (plan.found.uninterpreted.length) out(`  uninterpreted: ${plan.found.uninterpreted.slice(0, 6).join(", ")} — kept, derives nothing`);
  for (const p of [...plan.found.problems, ...plan.found.notes, ...(plan.found.truncated ? ["the walk hit its bound — narrow the task with --subject"] : []), ...kept.refused.map((id) => `${id} not kept: the opportunity bound is reached`)].slice(0, 6)) out(`  ! ${p}`);
  out(`\n${plan.found.needs.length} need(s) · ${count(plan, "provided")} provided · ${count(plan, "gap")} gap(s) — opportunities, never failures; development continues${dry ? " · --dry: nothing written" : ""}`);
}

const count = (plan, outcome) => plan.resolution.results.filter((r) => r.outcome === outcome).length;

const jsonOf = (plan, kept) => ({ version: 1, purpose: plan.run.purpose, workflow: plan.run.workflow, context: plan.run.context, subjects: plan.found.subjects, needs: plan.found.needs, results: plan.resolution.results.map((r) => ({ capability: r.capability, outcome: r.outcome, remedy: r.remedy, status: r.status, provider: r.provider, why: r.why, needs: r.needs.length })), opportunities: plan.judged.map((j) => ({ id: j.doc.id, capability: j.doc.capability, state: j.doc.state, surface: j.verdict })), unobservable: plan.found.unobservable, uninterpreted: plan.found.uninterpreted, unresolvable: plan.found.unresolvable, cycles: plan.found.cycles, truncated: plan.found.truncated, problems: plan.found.problems, notes: plan.found.notes, written: kept.written });

export function opportunities(ctx, args) {
  const all = ctx.know.opportunities().filter((o) => args.includes("--all") || OPEN.includes(o.state));
  const world = { purpose: "development", workflow: "cli", seenBy: { host: ctx.know.host, at: ctx.now() }, derived: new Map(), demanded: ctx.demanded?.() ?? new Map() };
  if (args.includes("--json")) return out(JSON.stringify(all.map((o) => ({ ...o, surface: surfaced(o, world) })), null, 2));
  if (!all.length) return out(args.includes("--all") ? "no capability opportunity has been recorded here" : "no open capability opportunity — `--all` shows resolved, ignored and stale ones too");
  for (const o of all) out(`  ${o.state.padEnd(9)} ${o.id}  ${o.capability} (${o.remedy}) — ${new Set((o.needs ?? []).map((n) => n.subject)).size} subject(s), last ${String(o.last).slice(0, 10)}\n             ${surfaced(o, world).say}`);
}

export function decide(ctx, args) {
  return ctx.know.transact(() => decideLocked(ctx, args));
}

function decideLocked(ctx, args) {
  const [id, action] = words(args);
  if (!args.includes("--human")) throw new Refused("a decision is a person's — say so with --human. An agent relays a person's choice; it never makes one");
  const doc = ctx.know.opportunity(id);
  if (!doc) throw new Refused(`no opportunity "${id}" — \`knowledge opportunities --all\` lists them`);
  finish(ctx, decided(doc, action, { at: ctx.now(), workflow: workflowOf(args), reason: flag(args, "reason") }));
}

const workflowOf = (args) => (WORKFLOW.test(flag(args, "workflow") ?? "cli") ? flag(args, "workflow") ?? "cli" : "cli");

function finish(ctx, doc) {
  settle(ctx, [doc]);
  ctx.emit?.("knowledge.opportunity.decided", { opportunity: doc.id, capability: doc.capability, action: doc.decided.action, workflow: doc.history.at(-1)?.workflow });
  out(`${doc.id}  ${doc.capability} is now ${doc.state} — ${doc.decided.action} by a person, on ${String(doc.decided.at).slice(0, 10)}`);
}
