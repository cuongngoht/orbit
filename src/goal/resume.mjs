import { reconcileUnits, viewOf } from "./execute.mjs";
import { frontierOf, lifecycleOf } from "./model.mjs";
import { readSpec } from "./spec.mjs";
import { completionGate } from "./verification.mjs";

export function resumeView(records, taskViews = []) {
  const model = viewOf(records);
  const pending = reconcileUnits(model, taskViews);
  return { model, lifecycle: lifecycleOf(model), frontier: frontierOf(model), pending, revision: model.revision };
}

export function loadGoal(goals, io, id) {
  const records = goals.read(id);
  if (!records?.length) return null;
  const spec = readSpec(io, goals.dirOf(id));
  return { records, spec, model: viewOf(records) };
}

export function resumeSay(view) {
  const u = view.frontier[0];
  const prog = view.model.units.size;
  const done = [...view.model.units.values()].filter((x) => x.state === "completed").length;
  return [`GOAL       ${view.model.meta.id} — ${view.model.meta.title}`, `STATE      ${view.lifecycle}`, `PROGRESS   ${done}/${prog} work units`, u ? `NEXT       ${u.id} — ${u.title}` : "NEXT       verify or report"].join("\n");
}

export function verifyOnResume(model) {
  return completionGate(model);
}
