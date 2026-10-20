// `engineering record`: candidate facts in, validated, then RECONCILED --
// src/architecture/views/record.mjs's shape, plus the step architecture does
// not need. Reads STDIN when no path is given: an observer agent has no Write,
// so it cannot leave a file anywhere, and a temp file inside the consuming
// repository would break the one rule this command is tested against.
//
// Nothing here saves a fact. Accepted candidates go to src/engineering/ingest.mjs,
// which stamps the session, the commit and the fingerprint and lets
// reconciliation decide what each one does to the store -- so recording the
// same subject twice confirms it rather than overwriting it, and an observer's
// candidate cannot demote a fact a person adopted.
//
// `--human` is the one flag architecture's own `record` does not need: it is
// what lets a candidate claim `adopted`, or `enforced` with a gate the engine
// can see (src/engineering/candidate.mjs), and what lets reconciliation move a
// strength at all.
import { Refused } from "../../errors.mjs";
import { ingest } from "../ingest.mjs";
import { judge, parseCandidates, trackedSet } from "../record.mjs";
import { out } from "../../query/format.mjs";
import { words } from "../../learn/args.mjs";

export function record(ctx, args) {
  const candidates = parseCandidates(ctx.read(words(args)[0]));
  if (!candidates.length) throw new Refused("nothing to record — one JSON fact per line, on stdin or in a file");
  const verdict = judge(candidates, world(ctx, args));
  reported(verdict);
  return decided(ctx, verdict, args);
}

// The gates are handed IN as data by the caller -- what the architecture facts
// say this project runs on itself -- so nothing under src/engineering/ reads
// the architecture store for them.
function world(ctx, args) {
  const files = ctx.source.files();
  if (files === null) throw new Refused("this project is not a readable git checkout, so nothing here can tell whether a fact cites a real file");
  return { tracked: trackedSet(files), gates: ctx.gates?.() ?? new Set(), trusted: args.includes("--human") };
}

function reported(verdict) {
  for (const r of verdict.rejected) out(`  ✖ line ${r.i + 1}\n      ${r.why}`);
  for (const n of verdict.notes) out(`  ! ${n}`);
}

// All or nothing, for the reason architecture's own `record` is: the
// candidates came from ONE investigation, so storing the readable half stores
// half an answer and says nothing about the rest.
function decided(ctx, verdict, args) {
  if (verdict.refused) throw new Refused(`${verdict.rejected.length} of ${verdict.rejected.length + verdict.accepted.length} candidate(s) were refused — nothing was recorded. Fix them and pipe the batch again.`);
  if (args.includes("--dry")) return out(`\n--dry: ${verdict.accepted.length} would be reconciled — nothing written`);
  saved(ingest(ctx, verdict.accepted, { human: args.includes("--human") }));
}

function saved(decisions) {
  for (const d of decisions) out(`  ${d.outcome.padEnd(10)} ${d.fact?.id ?? d.finding?.factId}  ${d.fact?.confidence ?? ""}  ${d.fact?.statement ?? ""}`);
  for (const d of decisions.filter((x) => x.finding)) out(`  ! ${d.finding.say}`);
  out(`\n${decisions.length} fact(s) recorded · ${tally(decisions)} · \`engineering why <id>\` for any of them`);
}

const tally = (decisions) => [...new Set(decisions.map((d) => d.outcome))].map((o) => `${decisions.filter((d) => d.outcome === o).length} ${o}`).join(" · ");
