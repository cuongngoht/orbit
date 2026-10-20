import { planArtifact, planUnits, validateGraph } from "./plan.mjs";

export function replan(ctx, row) {
  const units = planUnits(ctx.analysis, ctx.specDigest);
  const n = (ctx.planN ?? 1) + 1;
  const artifact = planArtifact(units, n);
  return { trigger: row.id, response: "replan", previous: ctx.planId, plan: artifact.plan, digest: artifact.digest, units: artifact.units, because: row.say(ctx) };
}

export function retryUnit(ctx, row) {
  const u = ctx.unit;
  const units = validateGraph([{ ...u, state: "planned", task: undefined }]);
  const n = (ctx.planN ?? 1) + 1;
  const artifact = planArtifact(units, n);
  return { trigger: row.id, response: "retry-unit", previous: ctx.planId, plan: artifact.plan, digest: artifact.digest, units: artifact.units, because: row.say(ctx) };
}
