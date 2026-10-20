import { Refused } from "../errors.mjs";
import { digestOf } from "./spec.mjs";
import { buildPlanUnits } from "./plan-units.mjs";
import { hasCycle } from "./plan-cycle.mjs";

export { unitId, acId, reqId } from "./plan-ids.mjs";

// A plan is drawn from the analysis's structured intent and nothing else: an analysis without one is analyzed again.
export function planUnits(analysis, specDigest) {
  if (!analysis?.intent) throw Object.assign(new Refused("GOAL_INTENT_MISSING: the analysis has no structured intent — analyze the goal again with one"), { code: "GOAL_INTENT_MISSING" });
  return validateGraph(buildPlanUnits(analysis, specDigest));
}

export function validateGraph(units) {
  const ids = new Set(units.map((u) => u.id));
  for (const u of units) {
    for (const d of u.dependsOn ?? []) {
      if (!ids.has(d)) throw new Refused(`plan references unknown unit ${d}`);
    }
  }
  if (hasCycle(units)) throw new Refused("plan has a dependency cycle");
  return units;
}

export function planArtifact(units, n = 1) {
  const body = { n, units, at: new Date().toISOString() };
  const digest = digestOf(JSON.stringify(body));
  return { plan: `plan-${n}`, digest, units, body };
}

export function orphanAcceptance(units, acceptance) {
  const linked = new Set(units.flatMap((u) => u.acceptanceRefs ?? []));
  return (acceptance ?? []).filter((a) => !linked.has(a.id)).map((a) => a.id);
}
