import { basename, dirname } from "node:path";
import { loadPlans, planIdOf, plansDir } from "../load.mjs";
import { errors } from "../finding.mjs";
import { out } from "../format.mjs";
import { planFindings } from "../validate.mjs";
import { planWorld } from "../world.mjs";
import { scenariosOf } from "../rules/common.mjs";

export function plans(ctx) {
  const dir = plansDir(ctx.project);
  const found = loadPlans(dir);
  if (!found.length) out(`no plans yet — add ${dir}/<screen>/<id>.plan.json, or scaffold one: qa-plan new <id> --screen=<screen>`);
  listed(ctx, found);
}

function listed(ctx, found) {
  const world = found.length ? planWorld(ctx) : null;
  for (const p of found) out(line(p, errors(planFindings(p, world)).length));
}

const line = (p, n) => `${String(p.id ?? planIdOf(p._file)).padEnd(24)} ${String(p.title ?? "").padEnd(40)} ${scenariosOf(p).length} scenario(s)  ${n ? `${n} error(s)` : "clean"}`;

