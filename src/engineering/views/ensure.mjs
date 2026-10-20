// `engineering ensure [--for="…"] [--dry]`: decide, say why, and do only that
// much -- src/architecture/views/ensure.mjs's contract. The DECISION NAME is
// printed first, always: a tool that decides silently cannot be audited.
import { Blocked } from "../../errors.mjs";
import { decide } from "../ensure.mjs";
import { ensureFacts, restamped } from "../freshen.mjs";
import { out } from "../../query/format.mjs";
import { recall } from "../recall.mjs";

export function ensure(ctx, args = []) {
  const facts = ensureFacts(ctx, args);
  const decision = decide(facts, { dry: args.includes("--dry") });
  out(`ENGINEERING ${decision.name}\n`);
  out(`  ${decision.say}\n`);
  return carried(ctx, facts, decision);
}

function carried(ctx, facts, decision) {
  if (decision.stops) throw new Blocked(decision.say);
  for (const s of decision.skipped) out(`  not revalidated here: ${s} moved too`);
  known(facts);
  measured(facts, restamped(ctx, facts, decision), decision);
}

// What memory already says about the task, before anything else -- the answer
// in the common case. `engineering recall` is the full view.
function known(facts) {
  const rows = facts.asked.length ? recall(facts.facts, { asked: facts.asked, limit: 3 }) : [];
  if (!rows.length) return;
  out("relevant knowledge:");
  for (const r of rows) out(`  ${r.route.tier.padEnd(12)} ${r.fact.statement}`);
}

function measured(facts, done, decision) {
  out("status:");
  if (!facts.changes.length) return out("  every fact already carries the state its scopes measure to");
  for (const c of facts.changes) out(`  ${String(c.fact.status).padEnd(7)} → ${c.status.padEnd(7)} ${c.fact.id}`);
  out(decision.dry ? `\n--dry: ${facts.changes.length} would be restamped — nothing written` : `\n${done.length} fact(s) restamped — status only; nothing a person or an observer decided moved`);
}
