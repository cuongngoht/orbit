// The plan a project starts from. Deliberately thin: everything in it is a
// placeholder somebody replaces, and nothing in it is an acceptance criterion
// this tool invented.
//
// It is clean under plan-check by construction -- one draft scenario with no
// commitments and no case, which is exactly where a plan is before anybody has
// designed it. A scaffold that arrives with errors teaches people to ignore the
// checker on day one.
import { SCHEMA_VERSION } from "./fields.mjs";
import { PLAN_SCHEMA, SCHEMA_DIR } from "../tests-tree.mjs";

// screens/<screen>/<id>.plan.json -> two folders up to the tree's schema/.
export const PLAN_SCHEMA_REF = `../../${SCHEMA_DIR}/${PLAN_SCHEMA}`;

export function skeletonPlan(id, opts = {}) {
  return {
    $schema: PLAN_SCHEMA_REF,
    schema: SCHEMA_VERSION,
    id,
    ...(opts.screen ? { screen: opts.screen } : {}),
    title: opts.title ?? id,
    feature: opts.feature ?? "",
    revision: "1",
    at: opts.at ?? new Date().toISOString().slice(0, 10),
    author: opts.author ?? "",
    scope: { in: [], out: [] },
    sources: [{ id: "REQ1", kind: "requirement", ref: "", revision: "", says: "what the person who owns this feature said it must do" }],
    map: {},
    environments: [],
    budget: {},
    done: ["every acceptance criterion is covered or has a disposition", "what no browser can see is a manual check with an owner"],
    criteria: [{ id: "AC1", says: "replace this with their words — never with what the application currently does", source: "REQ1" }],
    assumptions: [],
    questions: [],
    exclusions: [],
    scenarios: [skeletonScenario()],
    manual: [],
  };
}

const skeletonScenario = () => ({
  id: "S1",
  name: "replace this",
  covers: ["AC1"],
  technique: "crud",
  why: "why this is worth the time",
  priority: "P1",
  readiness: "draft",
  actor: {},
  preconditions: [],
  intent: [],
  expect: {},
  cases: [],
});
