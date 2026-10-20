// Plans on disk: `ui-tests/screens/<screen>/<id>.plan.json` (src/tests-tree.mjs),
// with `<id>.md` rendered beside it for people to read.
//
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { draftPlans } from "../draft/plans.mjs";
import { realIo } from "../store/io.mjs";
import { MD_EXT, PLAN_EXT, planFiles, screensDir } from "../tests-tree.mjs";

export { MD_EXT, PLAN_EXT };

// Plans share the screen folders with the cases: the tree's root, not a
// directory of their own.
export const plansDir = screensDir;

export function loadPlan(file) {
  const p = parsed(file);
  if (!isObject(p)) return { _file: file, _broken: "is not a JSON object" };
  p._file = file;
  return p;
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// A file that will not parse becomes a plan the validator can REPORT on, the way
// dsl/load.mjs does for a case: one bad file must not take the directory down.
function parsed(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { _broken: `is not valid JSON: ${e.message}` };
  }
}

export const loadPlans = (dir) => planFiles(dir).map(loadPlan);

// By id -- in whichever screen folder holds it -- or by a path to any .json, so
// a fixture outside the tree can be checked too.
export function findPlan(dir, ref) {
  const file = ref.endsWith(".json") ? resolve(ref) : planFiles(dir).find((f) => planIdOf(f) === ref);
  return file && existsSync(file) ? loadPlan(file) : null;
}

// By id: the checkout's plan, else the machine store's DRAFT of it -- a plan an
// agent wrote during an investigation. A draft carries `_draft`, so every view
// can say so and the placement rule leaves it alone. A machine with no store has
// no drafts, which is not an error for a view.
export const DRAFT_NOTE = "a DRAFT in the machine store: an agent wrote it, and it is not the team's plan until a person promotes and accepts it";

export function planFor(ctx, ref) {
  return findPlan(plansDir(ctx.project), ref) ?? draftPlanOf(ctx, ref);
}

function draftPlanOf(ctx, ref) {
  try { return draftPlans(ctx.store(false), realIo()).find(ref); }
  catch { return null; }
}

// Markdown with no JSON beside it: a plan from before this vocabulary. Reported,
// never converted behind somebody's back.

export const planIdOf = (file) => basename(file).replace(PLAN_EXT, "").replace(MD_EXT, "");
