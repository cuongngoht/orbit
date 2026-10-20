import { unitId } from "./plan-ids.mjs";

const clip = (t) => String(t ?? "").slice(0, 120);
const hasChange = (analysis) => /implement|fix|change|build|add|refactor/i.test(`${analysis.objective ?? ""}`);
const hasTest = (analysis) => (analysis.acceptance ?? []).some((a) => /test|verify|pass/i.test(a.statement ?? ""));

export function buildPlanUnits(analysis, specDigest) {
  const units = [];
  pushUnits(units, analysis, specDigest.slice(0, 8));
  return finalizeUnits(units, analysis, specDigest.slice(0, 8));
}

function pushUnits(units, analysis, base) {
  maybeReqUnit(units, analysis, base);
  maybeEngUnit(units, analysis, base);
  maybeVerUnit(units, analysis, base);
}

function finalizeUnits(units, analysis, base, _ver) {
  const acs = analysis.acceptance ?? [];
  if (!units.length) units.push(oneUnit(base, analysis, acs));
  return units.map((u) => ({ ...u, state: (u.dependsOn ?? []).length ? "planned" : "ready" }));
}

function maybeReqUnit(units, analysis, base) {
  if ((analysis.requirements ?? []).length <= 3 && (analysis.acceptance ?? []).length <= 8) return;
  units.push({ id: unitId(`${base}:req`), title: clip("Analyze requirements and architecture"), workflow: "engineering", dependsOn: [], acceptanceRefs: [], requirementRefs: [] });
}

function maybeEngUnit(units, analysis, base) {
  if (!hasChange(analysis)) return;
  const acs = analysis.acceptance ?? [];
  const dep = units.length ? [units[0].id] : [];
  units.push({ id: unitId(`${base}:eng`), title: clip(analysis.objective), workflow: "engineering", dependsOn: dep, acceptanceRefs: acs.map((a) => a.id), requirementRefs: (analysis.requirements ?? []).map((r) => r.id) });
}

function maybeVerUnit(units, analysis, base) {
  const acs = analysis.acceptance ?? [];
  if (!hasTest(analysis) && !acs.length) return;
  const dep = units.length ? [units.at(-1).id] : [];
  units.push({ id: unitId(`${base}:ver`), title: clip("Verify acceptance criteria and regression"), workflow: "engineering", dependsOn: dep, acceptanceRefs: acs.map((a) => a.id), requirementRefs: [] });
}

function oneUnit(base, analysis, acs) {
  return { id: unitId(`${base}:one`), title: clip(analysis.objective ?? "Complete the goal"), workflow: "engineering", dependsOn: [], acceptanceRefs: acs.map((a) => a.id), requirementRefs: [] };
}
