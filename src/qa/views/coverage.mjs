// Coverage, printed -- and written as a page with --out.
//
// The printed form leads with what is NOT proved, because that is the half a
// reader needs and the half a percentage hides.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { coverageModel } from "../coverage.mjs";
import { DRAFT_NOTE, planFor } from "../load.mjs";
import { noPlan, out, ratioLine } from "../format.mjs";
import { writeCoverage } from "../../report/coverage.mjs";
import { planWorld } from "../world.mjs";
import { REPORT_ROOMS } from "../../tests-tree.mjs";

export function coverage(ctx, args) {
  const ref = args.find((a) => !a.startsWith("--"));
  const p = ref ? planFor(ctx, ref) : null;
  return p ? body(ctx, p, args) : noPlan(ref ?? "");
}

function body(ctx, p, args) {
  const world = planWorld(ctx, { drafts: Boolean(p._draft) });
  const model = coverageModel(p, world, world);
  printed(model);
  written(ctx, p, world, args);
}

function printed(model) {
  out(`\n${model.plan.title || model.plan.id}${model.plan.revision ? `  rev ${model.plan.revision}` : ""}${model.plan.draft ? `  — ${DRAFT_NOTE}` : ""}`);
  for (const r of model.ratios) out(ratioLine(r));
  stages(model);
  gaps(model);
}

function stages(model) {
  out("");
  for (const s of model.stages) out(`  ${String(s.n).padStart(3)}  ${s.name.padEnd(12)} ${s.say}`);
}

function gaps(model) {
  for (const g of model.gaps) out(`\n  gap     ${g.scenario} ${g.layer}: ${g.because}`);
  for (const u of model.unknown) out(`\n  ${u.state} ${u.scenario} ${u.case}: ${u.refs.map((r) => `${r.say} is ${r.state}`).join(", ")} — it stays in the history and does not count here`);
  for (const x of model.excluded) out(`\n  excluded ${x.id}: ${x.says} — ${x.because}`);
}

function written(ctx, p, world, args) {
  const flag = args.find((a) => a.startsWith("--out="));
  if (!flag && !args.includes("--write")) return;
  const file = flag ? flag.slice(6) : join(ctx.config.reports, REPORT_ROOMS.plans, `coverage-${p.id}.html`);
  mkdirSync(dirname(file), { recursive: true });
  out(`\ncoverage page: ${writeCoverage(file, p, world, options(ctx, world))}`);
}

const options = (ctx, world) => ({ ...world, project: ctx.config.name, generated: new Date(ctx.now()).toISOString().slice(0, 16).replace("T", " ") });
