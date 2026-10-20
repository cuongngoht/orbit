// `qa-plan new <id> --screen=<screen>` — a plan file to fill in, and the Markdown
// beside it, in the folder of the screen it is about (src/tests-tree.mjs).
// `--no-screen --feature=<feature>` is a plan about no screen: a requirement
// behind an API, a PBI with no UI yet. It goes to screens/_no-screen/.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { MD_EXT, plansDir } from "../load.mjs";
import { out } from "../format.mjs";
import { planMarkdown } from "../markdown.mjs";
import { skeletonPlan } from "../skeleton.mjs";
import { PLAN_FIELDS } from "../fields.mjs";
import { planFile } from "../../tests-tree.mjs";
import { Refused } from "../../errors.mjs";
import { checkedId } from "../../store/id.mjs";
import { dataPath, editData } from "../../store/edit.mjs";

const USAGE = "usage: qa-plan new <plan-id> (--screen=<screen-id> | --no-screen --feature=<feature>) [\"Title\"]";

export function scaffold(ctx, [id, ...rest]) {
  if (!id) return out(USAGE);
  const owner = ownerOf(ctx, rest);
  const file = dataPath(ctx.project, planFile(plansDir(ctx.project), { id: checkedId(id, PLAN_FIELDS.id), ...owner }));
  if (existsSync(file)) return out(`${file} already exists — nothing written`);
  return editData(ctx.project, [{ file, before: null }], (io) => written(ctx, { id, ...owner, file, rest }, io));
}

// What the plan is about: a screen in the map, or -- said out loud -- no screen
// and the feature it is about instead.
const ownerOf = (ctx, rest) => (rest.includes("--no-screen") ? { feature: featureOf(rest) } : { screen: screenOf(ctx, rest) });

function featureOf(rest) {
  const feature = rest.find((a) => a.startsWith("--feature="))?.slice(10);
  if (!feature) throw new Refused(`${USAGE}\n  --no-screen needs --feature: the feature a plan about no screen is about`);
  return feature;
}

// The folder IS the screen, so a plan with no screen has nowhere to go -- and a
// screen the map does not have is a folder nobody will ever look in.
function screenOf(ctx, rest) {
  const screen = rest.find((a) => a.startsWith("--screen="))?.slice(9);
  if (!screen) throw new Refused(`${USAGE}\n  --screen names the screen (an id in graph/screens.json) whose folder holds the plan`);
  if (ctx.graph?.screens && !ctx.graph.screens.has(screen)) throw new Refused(`screen ${screen} is not in the map — record it first, or pick one of graph/screens.json`);
  return checkedId(screen, PLAN_FIELDS.screen);
}

function written(ctx, { id, screen, feature, file, rest }, io) {
  const plan = skeletonPlan(id, { screen, feature, title: rest.filter((a) => !a.startsWith("--")).join(" ") || id });
  io.write(file, JSON.stringify(plan, null, 2) + "\n");
  io.write(join(dirname(file), `${id}${MD_EXT}`), planMarkdown(plan));

  out(`wrote ${file}\n  fill in the criteria and the scenarios, then: plan-check ${id}\n  the .md beside it is GENERATED — re-render it with: qa-plan render ${id} --write`);
}
