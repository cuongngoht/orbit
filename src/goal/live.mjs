import { acCoverage, lifecycleOf, unitProgress } from "./model.mjs";

export function goalProjection(model, currentTask = null) {
  const lifecycle = lifecycleOf(model);
  const units = unitProgress(model);
  const ac = acCoverage(model);
  const unit = [...model.units.values()].find((u) => u.state === "running") ?? null;
  return { kind: "goal", id: model.meta?.id, title: model.meta?.title, lifecycle, units, acceptance: ac, currentUnit: unit?.id ?? null, currentTask: currentTask ?? unit?.task ?? null, active: lifecycle === "running" };
}

export function goalActivityLine(p) {
  return `goal ${p.lifecycle} · ${p.units.verified}/${p.units.total} units · AC ${p.acceptance.verified}/${p.acceptance.total}${p.currentTask ? ` · ${p.currentTask}` : ""}`;
}
