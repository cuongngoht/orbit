// Reading what has been learned: cheaply, in scope, or in full.
//
// Three commands rather than one, because they answer three different questions
// and merging them would collapse the selective-recall design that the whole
// store depends on. `lessons` is an index and must stay small enough to paste
// anywhere; `recall` is a slice for the thing in hand; `why` is the full chain and
// is allowed to be long.
import { out } from "../../query/format.mjs";
import { Refused } from "../../errors.mjs";
import { flag, words } from "../args.mjs";
import { indexLines, recall as recallFor } from "../recall.mjs";
import { ORDER_IS, recommendationsFor } from "../recommend.mjs";
import { SESSION_IS } from "../../memory/session.mjs";

export function lessons(ctx, args) {
  const all = filtered(ctx.learn.all(), args);
  if (!all.length) return out("nothing learned yet — run `learn analyse` after a few sessions have recorded runs.");
  out(`${all.length} lesson(s) — \`learn why <id>\` for the evidence behind one\n`);
  for (const line of indexLines(all, Number(flag(args, "max") ?? 12))) out(`  ${line}`);
  rest(all);
}

function filtered(all, args) {
  const state = flag(args, "state");
  const about = flag(args, "about");
  const byState = state ? all.filter((l) => l.state === state) : all;
  return about ? recallFor(byState, about).lessons : byState;
}

function rest(all) {
  const quiet = all.filter((l) => l.state !== "validated");
  if (!quiet.length) return;
  out(`\n  ${quiet.length} not shown: ${count(quiet, "candidate")}${count(quiet, "stale")}${count(quiet, "rejected")}${count(quiet, "superseded")}`.replace(/, $/, ""));
}

const count = (all, state) => (all.filter((l) => l.state === state).length ? `${all.filter((l) => l.state === state).length} ${state}, ` : "");

export function recall(ctx, args) {
  const [about] = words(args);
  const found = recallFor(ctx.learn.all(), about, { head: ctx.frontend.commit(), host: ctx.learn.host });
  out(`${found.lessons.length} lesson(s) apply to ${about ?? "this project"} on ${ctx.learn.host} at ${ctx.frontend.commit() ?? "an unknown build"}:\n`);
  for (const l of found.lessons) applies(l);
  held(found.held);
}

function applies(l) {
  out(`  ${l.mark || l.state}  ${l.kind === "said" ? "SAID" : "saw "}  ${l.statement}`);
  if (l.applies?.length) out(`         only when: ${l.applies.join(" · ")}`);
  if (l.notWhen?.length) out(`         not when:  ${l.notWhen.join(" · ")}`);
}

// Always printed. Quietly filtering is how a memory system stops being trusted.
function held(back) {
  if (!back.length) return;
  out(`\n  ${back.length} held back`);
  for (const h of back) out(`    ${h.id}  ${h.why}`);
}

export function why(ctx, args) {
  const [id] = words(args);
  const lesson = ctx.learn.find(id);
  if (!lesson) throw new Refused(`no lesson "${id}" — \`learn lessons\` lists them`);
  chain(lesson);
  suggested(lesson);
}

function chain(l) {
  out(`${l.id}\n\n  ${l.statement}\n`);
  out(`  state      ${l.state} — ${l.because}`);
  out(`  kind       ${l.kind === "said" ? "said — a person told us. An instruction, not an inference." : "saw — inferred from the ledger. Nobody said this."}`);
  out(`  seen       first ${day(l.firstSeen)}   last confirmed ${day(l.confirmed)}   frontend ${l.fe_commit ?? "unknown"}`);
  scopes(l);
}

function scopes(l) {
  out(`\n  applies when\n    ${(l.applies ?? ["anything"]).join(" · ")}`);
  out(`  does NOT apply when\n    ${(l.notWhen ?? ["nothing recorded"]).join(" · ")}`);
  out(`\n  evidence — ${l.counters?.for ?? l.sessions} session(s), ${l.counters?.runs ?? 0} run(s)`);
  for (const r of l.evidence?.runs ?? []) out(`    ${String(r.session).padEnd(20)} ${String(r.at).slice(0, 16)}  ${r.status}   ${r.fe_commit ?? ""}`);
  unknown(l);
}

function unknown(l) {
  for (const n of l.evidence?.notes ?? []) out(`    note  ${n}`);
  out("\n  not known");
  for (const m of [...(l.evidence?.missing ?? []), SESSION_IS]) out(`    ${m}`);
}

function suggested(lesson) {
  const recs = recommendationsFor(lesson);
  if (!recs.length) return out("\n  no recommendation — a lesson a person dictated is an instruction, not evidence for a change.");
  out(`\n  recommendation 1 of ${recs.length}   (${ORDER_IS})`);
  for (const r of recs) printed(r);
}

function printed(r) {
  const rows = [["change", r.change], ["where", r.where], ["only when", (r.onlyWhen ?? []).join(" · ")], ["expect", r.expect], ["basis", r.basis], ["risk", r.risk], ["effort", r.effort], ["verify", r.verify], ["rollback", r.rollback]];
  for (const [k, v] of rows) out(`    ${k.padEnd(10)} ${v}`);
  if (r.state === "refused") out(`    REFUSED    ${r.refusedBy} — ${r.refusedWhy}`);
  out(`    id         ${r.id}`);
}

const day = (at) => String(at ?? "").slice(0, 10) || "unknown";
