// Which scenarios to run with the time there is -- and what that leaves
// unproven, said out loud.
import { planFor } from "../load.mjs";
import { bullet, noPlan, out } from "../format.mjs";
import { ORDER_IS, scoreOf, select as choose } from "../risk.mjs";
import { scenariosOf } from "../rules/common.mjs";

export function select(ctx, args) {
  const ref = args.find((a) => !a.startsWith("--"));
  const p = ref ? planFor(ctx, ref) : null;
  return p ? body(p, args) : noPlan(ref ?? "");
}

const flag = (args, name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function body(p, args) {
  const minutes = Number(flag(args, "budget") ?? p.budget?.minutes);
  const picked = choose(scenariosOf(p), { profile: flag(args, "profile") ?? p.budget?.profile, minutes: Number.isInteger(minutes) ? minutes : null });
  head(picked);
  chosen(picked);
  left(picked);
}

function head(picked) {
  out(`\n${picked.chosen.length} scenario(s)${picked.budget ? `, ${picked.spent} of ${picked.budget} min` : ""}${picked.profile ? ` · profile ${picked.profile}` : ""}`);
  out(`  ${ORDER_IS}`);
}

function chosen(picked) {
  for (const s of picked.chosen) out(`  ${s.id.padEnd(6)} ${String(s.priority ?? "").padEnd(3)} ${s.must ? "MUST " : "     "}${String(s.estimate?.minutes ?? "?").padStart(3)} min  ${s.name ?? ""}`);
}

// The half a selection exists to produce. A budget that cannot hold its musts is
// a decision for a person, so it is printed as a shortfall and never as a
// quietly shorter list.
function left(picked) {
  shortfall(picked);
  if (picked.residual.left.length) out(`\nnot running ${picked.residual.left.length} scenario(s) — the risk left on the table:`);
  for (const r of picked.residual.left) out(bullet(`${r.id} [${r.priority || "no priority"}] ${r.name}${r.why ? ` — ${r.why}` : ""}${r.score.given.length ? ` (risk ${r.score.total}/${r.score.of})` : " (not scored)"}`));
  if (picked.unknown.length) out(`\n${picked.unknown.length} of those have no estimate, so nothing here could budget them: ${picked.unknown.map((s) => s.id).join(", ")}`);
}

function shortfall(picked) {
  if (!picked.shortfall.length) return;
  out(`\nSHORTFALL: the must-run scenarios need ${picked.shortfall.reduce((n, s) => n + (s.estimate?.minutes ?? 0), 0)} min and the budget is ${picked.budget}.`);
  out("  Nothing was demoted to make this fit — widen the budget, or decide which must stops being one.");
}
