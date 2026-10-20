import { Refused } from "../errors.mjs";
import { frontierOf, modelOf } from "./model.mjs";

export function readyUnit(model) {
  const f = frontierOf(model);
  return f[0] ?? null;
}

export function unitObjective(unit, analysis) {
  const title = unit.title ?? analysis.objective ?? "Work unit";
  return String(title).slice(0, 240);
}

export function bindAutomationStart(unit, analysis, opts = {}) {
  if (!unit) throw new Refused("no work unit is ready");
  return { objective: unitObjective(unit, analysis), ref: opts.ref ?? null, capabilities: opts.capabilities ?? [], unit: unit.id };
}

export function settleUnit(model, unitId, state, task, because) {
  const unit = model.units.get(unitId);
  if (!unit) throw new Refused(`no unit ${unitId} on this goal`);
  return { unit: unitId, state, task: task ?? unit.task, because: because ?? null };
}

export function linkTaskToUnit(model, unitId, taskId) {
  const unit = model.units.get(unitId);
  if (!unit) throw new Refused(`no unit ${unitId} on this goal`);
  return { unit: unitId, state: "running", task: taskId };
}

export function reconcileUnits(model, taskViews) {
  const byTask = new Map(taskViews.map((t) => [t.id, t]));
  const lines = [];
  for (const u of model.units.values()) {
    if (!u.task) continue;
    const t = byTask.get(u.task);
    if (!t) continue;
    if (t.lifecycle === "completed" && u.state !== "completed") lines.push(settleUnit(model, u.id, "completed", u.task, "child task completed"));
    if (["failed", "cancelled"].includes(t.lifecycle) && u.state === "running") lines.push(settleUnit(model, u.id, "failed", u.task, t.stopReason ?? t.lifecycle));
  }
  return lines;
}

export function viewOf(records) {
  return modelOf(records);
}
