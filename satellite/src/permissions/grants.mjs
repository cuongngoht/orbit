// What a run or an action is EFFECTIVELY granted: the intersection of every source that bounds it, each said by
// name, so a viewer can show which one withheld what. Nothing here widens anything: a role's requested profile, the
// mode its unit works in, Orbit's own automation limits (a person's), Satellite's policy, the mission's budget and a
// parent run's grants can each only take away.
import { MODES } from "../execution/modes.mjs";
import { OPERATION_NAMES } from "./operations.mjs";
import { kindsOf } from "./profiles.mjs";

const ALL = OPERATION_NAMES;

const without = (kinds, removed) => kinds.filter((k) => !removed.includes(k));

// c: { profile, mode, values (Orbit's effective automation values), spent, budget, parentGrants }
export const GRANT_SOURCES = Object.freeze([
  { by: "profile", kinds: (c) => kindsOf(c.profile) },
  { by: "mode", kinds: (c) => MODES[c.mode]?.kinds ?? [] },
  { by: "orbit-automation", kinds: (c) => (c.values?.skillFactory?.maxSkillsPerTask === 0 ? without(ALL, ["skill.draft"]) : ALL) },
  { by: "mission-budget", kinds: (c) => (c.budget?.actions !== undefined && c.spent?.actions >= c.budget.actions ? [] : ALL) },
  { by: "parent-run", kinds: (c) => c.parentGrants ?? ALL },
]);

export function effectiveGrants(c) {
  const sets = GRANT_SOURCES.map((s) => ({ by: s.by, kinds: s.kinds(c) }));
  const kinds = ALL.filter((k) => sets.every((s) => s.kinds.includes(k)));
  return { operationKinds: kinds, withheld: without(ALL, kinds).map((k) => ({ kind: k, by: sets.find((s) => !s.kinds.includes(k)).by })) };
}

export const whyWithheld = (grants, kind) => ((w) => (w ? `withheld by ${w.by}` : null))(grants.withheld.find((x) => x.kind === kind));
