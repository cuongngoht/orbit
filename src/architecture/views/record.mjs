// `architecture record`: candidate facts in, validated or refused.
//
// Reads STDIN when no path is given, and that is not a convenience. The scanner
// agent has no Write, deliberately, so it cannot leave a file anywhere -- and a
// temp file inside the consuming repository would break the one rule every
// architecture command is tested against: it modifies nothing in the tree.
import { Refused } from "../../errors.mjs";
import { judge, parseCandidates, trackedSet } from "../record.mjs";
import { out } from "../../query/format.mjs";
import { words } from "../../learn/args.mjs";

export function record(ctx, args) {
  const candidates = parseCandidates(ctx.read(words(args)[0]));
  if (!candidates.length) throw new Refused("nothing to record — one JSON fact per line, on stdin or in a file");
  const verdict = judge(candidates, world(ctx));
  reported(verdict);
  return decided(ctx, verdict, args);
}

function world(ctx) {
  const files = ctx.source.files();
  if (files === null) throw new Refused("this project is not a readable git checkout, so nothing here can tell whether a fact cites a real file");
  return { tracked: trackedSet(files), stamps: { commit: ctx.source.commit() } };
}

function reported(verdict) {
  for (const r of verdict.rejected) out(`  ✖ line ${r.i + 1}\n      ${r.why}`);
  for (const f of verdict.accepted) out(`  + ${f.id}  ${f.statement}`);
}

// All or nothing. The candidates came from ONE investigation, so storing the
// readable half stores half an answer and says nothing about the rest.
function decided(ctx, verdict, args) {
  if (verdict.refused) throw new Refused(`${verdict.rejected.length} of ${verdict.rejected.length + verdict.accepted.length} candidate(s) were refused — nothing was recorded. Fix them and pipe the batch again.`);
  if (args.includes("--dry")) return out(`\n--dry: ${verdict.accepted.length} would be recorded — nothing written`);
  saved(ctx, verdict.accepted);
}

function saved(ctx, accepted) {
  for (const f of accepted) ctx.arch.save(f);
  out(`\n${accepted.length} fact(s) recorded · \`architecture why <id>\` for any of them`);
}
