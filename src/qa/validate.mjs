// The plan validator: a composition of small rule families, one file each --
// the same shape dsl/validate.mjs has, with one difference that matters.
//
// A case finding is a violation. A plan finding may be a violation OR something
// a person has to look at, and mixing the two produces a checker that fails a
// build on a heuristic. So every finding carries a level, and plan-check maps
// only the errors to an exit code.
//
// `world` is what the plan is checked AGAINST: the cases on disk, the map, what
// this project can verify, and the current build. Everything in it is injected,
// so the whole validator is testable with no filesystem and no browser.
import { validate as validateCase } from "../dsl/validate.mjs";
import { FAMILIES } from "./rules/index.mjs";
import { shapeFindings } from "./rules/shape.mjs";

export function planFindings(plan, world = {}) {
  const wrong = shapeFindings(plan);
  if (wrong.length) return wrong;
  return Object.values(FAMILIES).flatMap((run) => run(plan, filled(world)));
}

// A world with the pieces a rule may ask for, so no family has to guard against
// a caller that passed half of one.
const filled = (world) => ({ cases: new Map(), graph: null, caps: {}, runs: [], head: null, validate: caseValidator(world), ...world });

const caseValidator = (world) => world.validate ?? ((c) => validateCase(c, world.graph ?? emptyGraph()));

const emptyGraph = () => ({ screens: new Map(), edges: [], effects: [], edgeOn: new Map(), effectOn: new Map(), rows: [] });
