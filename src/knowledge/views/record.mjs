// `knowledge record [<file>] [--human] [--dry]`: candidate claims in, one JSON
// object per line (stdin when no file), validated -- all or nothing -- then
// RECONCILED into the store. src/engineering/views/record.mjs's shape.
//
// `--human` is what lets a candidate claim `adopted`, or `enforced` with a gate
// the engine can see, and what lets reconciliation move a strength at all. It
// is a person's word said out loud: an agent relays it, it never supplies it.
//
// Two things are SAID after recording, never stored: a claim with no context
// holds EVERYWHERE (so a reader can tell a deliberate global from a forgotten
// context), and a claim that now has a rival -- another object for the same
// subject and relation, in the same context, for a relation whose cardinality
// is one -- is named beside it. Which one prevails is decided when claims are
// read, by authority and nesting, never here.
import { Refused } from "../../errors.mjs";
import { words } from "../../learn/args.mjs";
import { out } from "../../query/format.mjs";
import { ingest } from "../ingest.mjs";
import { said } from "../model.mjs";
import { rivalsOf } from "../query.mjs";
import { judge, parseCandidates } from "../record.mjs";

export function record(ctx, args) {
  const candidates = parseCandidates(ctx.read(words(args)[0]));
  if (!candidates.length) throw new Refused("nothing to record — one JSON claim per line, on stdin or in a file");
  const verdict = judge(candidates, worldOf(ctx, args));
  for (const r of verdict.rejected) out(`  ✖ line ${r.i + 1}\n      ${r.why}`);
  return decided(ctx, verdict, args);
}

// A claim cites tracked paths, so a directory that is not a readable checkout
// can tell nothing about what it cites -- refused, the way engineering's
// `record` refuses it.
function worldOf(ctx, args) {
  if (ctx.readable && !ctx.readable()) throw new Refused("this project is not a readable git checkout, so nothing here can tell whether a claim cites a real file");
  return { tracked: ctx.tracked(), gates: ctx.gates?.() ?? new Set(), trusted: args.includes("--human") };
}

function decided(ctx, verdict, args) {
  if (verdict.refused) throw new Refused(`${verdict.rejected.length} candidate(s) were refused — nothing was recorded. Fix them and pipe the batch again.`);
  if (args.includes("--dry")) return out(`\n--dry: ${verdict.accepted.length} would be reconciled — nothing written`);
  saved(ctx, ingest(ctx, verdict.accepted, { human: args.includes("--human") }));
}

function saved(ctx, decisions) {
  const all = ctx.know.all();
  for (const d of decisions) line(d, all, ctx.parts);
  out(`\n${decisions.length} claim(s) reconciled · ${tally(decisions)} · \`knowledge why <id>\` for any of them`);
}

function line(d, all, parts) {
  out(`  ${d.outcome.padEnd(10)} ${d.claim?.id ?? d.finding?.claimId ?? ""}  ${d.claim ? `${d.claim.confidence.padEnd(8)} ${said(d.claim)}` : ""}`);
  if (d.finding) out(`  ! ${d.finding.say}`);
  if (d.claim && !Object.keys(d.claim.context).length) out("             holds EVERYWHERE — record it with a context if it only holds somewhere");
  for (const r of d.claim ? rivalsOf(all, d.claim, parts) : []) out(`             rival: ${said(r)} (${r.id}) — which prevails is decided when read`);
}

const tally = (decisions) => [...new Set(decisions.map((d) => d.outcome))].map((o) => `${decisions.filter((d) => d.outcome === o).length} ${o}`).join(" · ");
