// `learn analyse` -- read what is new, decide what it means, write down only what
// earned it.
//
// The output is the interesting part. It reports what each family found AND what
// each family could not compute, because a reader told "3 sessions failed at step
// 2" will otherwise assume the tool knows why and chose not to say. It reports
// observations that were NOT written down, so a single failure is visible without
// pretending to be a lesson. And it reports demotions loudly: something the reader
// was told was reliable is not any more, and that is the one line they must not
// miss.
import { out } from "../../query/format.mjs";
import { Refused } from "../../errors.mjs";
import { SESSION_IS } from "../../memory/session.mjs";
import { flag, has } from "../args.mjs";
import { evidenceOf } from "../evidence.mjs";
import { FAMILY_NAMES, findingsOf } from "../families/index.mjs";
import { ORDER_IS, ranked, refused } from "../recommend.mjs";
import { promote } from "../promote.mjs";
import { judge } from "../outcome.mjs";

export function analyse(ctx, args) {
  const state = ctx.learn.auto();
  if (!state.on) throw new Refused(`auto-learning is off — ${state.why}. \`learn auto on\` turns it back on; recall and lessons work either way.`);
  const evidence = evidenceOf(ctx, { since: flag(args, "since") });
  told(ctx, evidence, derive(ctx, evidence, args), args);
}

function told(ctx, evidence, result, args) {
  report(ctx, evidence, result, args);
  copied(ctx, args);
}

// Deriving a lesson and leaving it where only this CLI can see it would be half a
// feature: the point of the projection is that the NEXT session knows, without
// anybody running anything. `ctx.reproject` is wired by cli/, which is the layer
// allowed to know how Claude Code lays out its memory.
function copied(ctx, args) {
  if (has(args, "dry") || !ctx.reproject) return;
  const done = ctx.reproject();
  if (!has(args, "quiet")) out(done.done ? `\n  copied into ${done.dir} — a new session will read the index from there` : `\n  not copied into Claude Code's memory — ${done.why}`);
}

function derive(ctx, evidence, args) {
  const found = findingsOf(evidence, { family: family(args) });
  const grown = promote(ctx.learn, found, { head: evidence.head, dry: has(args, "dry"), now: () => new Date(ctx.now?.() ?? Date.now()).toISOString() });
  return { found, ...grown };
}

function family(args) {
  const want = flag(args, "family");
  if (want && !FAMILY_NAMES.includes(want)) throw new Refused(`--family is one of ${FAMILY_NAMES.join(", ")}`);
  return want;
}

// The hook runs this too, and a wall of text from a background hook is noise
// nobody asked for. The work still happens; only the account of it is withheld.
function report(ctx, evidence, result, args) {
  if (has(args, "quiet")) return;
  heading(evidence);
  perFamily(result);
  written(result, args);
  suggestions(ctx, result, args);
}

function heading(evidence) {
  out(`${evidence.runs.length} run(s) in ${evidence.sessions.size} session(s), ${evidence.notes.length} note(s)${evidence.since ? ` since ${evidence.since}` : ""}`);
  out(`  ${SESSION_IS}\n`);
}

function perFamily(result) {
  for (const name of FAMILY_NAMES) out(`  ${name.padEnd(10)} ${tally(result.found, name)}`);
  const cannot = [...new Set(result.found.flatMap((f) => f.missing ?? []))];
  out(cannot.length ? `\n  could not be computed from the ledger:` : "");
  for (const c of cannot) out(`    ${c}`);
}

const tally = (found, name) => `${found.filter((f) => f.family === name).length} finding(s)`;

function written(result, args) {
  out(`\n  ${has(args, "dry") ? "would write" : "written"}   ${result.fresh} new, ${result.updated} updated in place, 0 duplicated`);
  for (const o of result.observations) out(`  observed   ${o.id}\n             ${o.why}`);
  for (const s of result.suppressed) out(`  forgotten  ${s.id}\n             ${s.why}`);
  for (const r of result.revived) out(`  revived    ${r.id}\n             ${r.why}`);
  demotions(result);
}

function demotions(result) {
  for (const d of result.demoted) out(`  DEMOTED    ${d.id}  ${d.from} -> ${d.to}\n             ${d.why}`);
}

function suggestions(ctx, result, args) {
  const all = ctx.learn.all();
  const recs = ranked(all);
  out(`\n  recommendations, in order (${ORDER_IS})`);
  for (const [i, r] of recs.entries()) out(`    ${i + 1}  ${r.where} — ${r.change}\n       verify: ${r.verify}`);
  closing(ctx, all, recs, args);
}

function closing(ctx, all, recs, args) {
  if (!recs.length) out("    nothing to suggest yet");
  for (const r of refused(all)) out(`    refused  "${r.change}"\n             ${r.refusedBy}`);
  outcomes(ctx, all);
}

// The half of the loop that is usually skipped. Every recommendation somebody
// marked as applied gets checked against what happened afterwards.
function outcomes(ctx, all) {
  const applied = all.flatMap((l) => (l.decisions ?? []).filter((d) => d.state === "applied").map((d) => ({ lesson: l, d })));
  if (!applied.length) return;
  out("\n  applied recommendations, judged on what happened after");
  for (const a of applied) judged(ctx, a);
}

function judged(ctx, a) {
  const verdict = judge(ctx.memory.runs(), { case: String(a.lesson.about).replace(/^case:/, ""), at: a.d.at }, { window: true });
  out(`    ${a.d.rec}\n      ${verdict.verdict} — ${verdict.says}`);
  for (const g of verdict.groups) out(`      ${g.host}: ${g.before.passed}/${g.before.runs} passing before, ${g.after.passed}/${g.after.runs} after`);
  for (const s of verdict.skipped) out(`      ${s.host}: not counted — ${s.why}`);
  for (const c of verdict.confounders) out(`      confounder: ${c}`);
}
