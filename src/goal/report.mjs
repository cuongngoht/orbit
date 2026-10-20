import { acCoverage, lifecycleOf, unitProgress } from "./model.mjs";
import { completionGate } from "./verification.mjs";

export function reportOf(model) {
  const lifecycle = lifecycleOf(model);
  const units = unitProgress(model);
  const ac = acCoverage(model);
  const gate = completionGate(model);
  return { id: model.meta?.id, title: model.meta?.title, lifecycle, units, acceptance: ac, completion: gate, objective: model.analyzed?.objective ?? model.meta?.title, plan: model.plan?.plan ?? null, revision: model.revision };
}

export function sayReport(r) {
  return [`GOAL       ${r.id} — ${r.title}`, `STATE      ${r.lifecycle}`, `UNITS      ${r.units.verified}/${r.units.total} done`, `AC         ${r.acceptance.verified}/${r.acceptance.total} verified`, `COMPLETION ${r.completion.outcome} — ${r.completion.because}`, `REVISION   ${r.revision}`].join("\n");
}
