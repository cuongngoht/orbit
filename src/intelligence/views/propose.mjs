// `intelligence propose [--dry]`: hand engineering memory the CANDIDATES the
// facts support -- through engineering's own untrusted door, which the
// composition root binds as `ctx.propose`. Nothing here can write an
// engineering fact, and nothing proposed here can be more than observed.
import { Refused } from "../../errors.mjs";
import { out } from "../../query/format.mjs";
import { proposals } from "../bridge.mjs";

export function propose(ctx, args) {
  const found = proposals(ctx.intel.all());
  listed(found);
  if (args.includes("--dry") || !found.candidates.length) return void out(`\n${found.candidates.length ? "--dry: " : ""}nothing was handed to engineering memory`);
  handed(ctx, found.candidates);
}

function listed(found) {
  out(`INTELLIGENCE PROPOSE  ${found.candidates.length} engineering candidate(s)\n`);
  for (const c of found.candidates) out(`  ${c.strength.padEnd(9)} ${c.key.padEnd(34)} ${c.statement}`);
  for (const u of found.unknowns) out(`  ? ${u}`);
}

function handed(ctx, candidates) {
  if (!ctx.propose) throw new Refused("no engineering memory is bound here — run this through cli/intelligence.mjs, which hands candidates to `engineering`'s own door");
  const decisions = ctx.propose(candidates);
  for (const d of decisions) out(`  ${d.outcome.padEnd(10)} ${d.fact?.id ?? d.finding?.factId}  ${d.fact ? `${d.fact.confidence} · ${d.fact.strength}` : ""}`);
  out(`\n${decisions.length} of ${candidates.length} reconciled by engineering memory · refused ones are its findings · \`engineering why <id>\` for any of them`);
}
