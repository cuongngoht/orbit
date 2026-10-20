// `engineering observe [--all | --scopes=a,b] [--dry]`: run the deterministic
// observer by hand, now, whatever the milestones would say.
//
// Over which scopes: the ones named, or the whole tree with `--all`, or by
// default the ones the most recent working set in this checkout touched (the
// whole tree when there is none). The candidates go through the same contract
// and the same reconciliation as the hooks' -- a shell has no host session, so
// they are recorded under this machine and this UTC day.
import { flag } from "../../learn/args.mjs";
import { out } from "../../query/format.mjs";
import { observed, proposed } from "../observe/index.mjs";

export function observe(ctx, args) {
  const summary = ctx.session?.() ?? { scopes: [], commands: [] };
  const input = { scopes: scopesOf(args, summary), commands: summary.commands ?? [], gates: ctx.gates?.() ?? new Set() };
  out(`ENGINEERING OBSERVE  over ${input.scopes.length ? input.scopes.join(", ") : "the whole tree"}\n`);
  if (args.includes("--dry")) return dry(proposed(ctx, input));
  reported(observed(ctx, input, { host: ctx.eng.host, at: ctx.now() }));
}

const scopesOf = (args, summary) => (args.includes("--all") ? [] : (flag(args, "scopes")?.split(",").map((s) => s.trim()).filter(Boolean) ?? summary.scopes ?? []));

function dry(found) {
  for (const c of found.candidates) out(`  would propose  ${c.kind.padEnd(10)} ${c.key.padEnd(24)} ${c.statement}`);
  unknowns(found);
  out(`\n--dry: ${found.candidates.length} candidate(s) — nothing written`);
}

function reported(done) {
  for (const d of done.decisions) out(`  ${d.outcome.padEnd(10)} ${d.fact?.confidence?.padEnd(8) ?? "".padEnd(8)} ${d.fact?.id ?? d.finding?.factId}  ${d.fact?.statement ?? ""}`);
  unknowns(done);
  out(`\n${done.decisions.length} candidate(s) reconciled · ${done.candidates.length - done.decisions.length} refused (see the findings) · \`engineering why <id>\` for any of them`);
}

function unknowns(found) {
  for (const u of found.unknowns) out(`  ? ${u}`);
}
