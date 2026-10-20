import { Refused } from "../errors.mjs";
import { bindAutomationStart, linkTaskToUnit, readyUnit, viewOf } from "./execute.mjs";
import { loadGoal } from "./resume.mjs";
export function stepGoal(ports, id, opts = {}) {
  const loaded = loadGoal(ports.goals, ports.io, id);
  if (!loaded?.model.plan) throw new Refused("plan the goal before stepping");
  const unit = readyUnit(loaded.model);
  if (!unit) throw new Refused("no work unit is ready — verify, reconcile, or finish");
  return dryOrStart(ports, id, loaded, unit, opts);
}

function dryOrStart(ports, id, loaded, unit, opts) {
  const spec = bindAutomationStart(unit, loaded.model.analyzed, { ref: loaded.model.meta.sourceRef, capabilities: opts.capabilities });
  if (opts.dry) return { id, dry: true, unit: unit.id, automation: spec };
  const started = ports.automation.start(spec);
  return ports.goals.transact(id, () => recordUnit(ports, id, unit.id, started.task));
}

function recordUnit(ports, id, unitId, task) {
  ports.goals.append(id, "unit", linkTaskToUnit(viewOf(ports.goals.read(id)), unitId, task));
  return { id, unit: unitId, task, automation: { task } };
}
