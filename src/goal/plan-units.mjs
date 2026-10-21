// A goal's WORK UNITS, from its structured intent alone (src/goal/intent.mjs, 0.0.4): one unit for each kind of work
// the analysis names, in the order of WORK_KINDS (src/goal/vocab.mjs), each waiting for the one before it. Nothing
// here reads a word of the objective or of a criterion -- the reading is the host model's, validated, and the decision
// is this table's -- so the same reading of a goal plans the same units in any language.
//
// A unit carries what its coordinated workflow is planned from: the routing intent of its kind, the capabilities the
// analysis names when its kind takes them, and whether it settles the goal's work item. A unit a missing prerequisite
// blocks is UNRESOLVED: planned, so a person sees it, and never started on a guess.
import { unitId } from "./plan-ids.mjs";
import { TITLE_LIMIT, WORK_KINDS, capabilitiesOfKind } from "./vocab.mjs";

const clip = (t) => String(t ?? "").slice(0, TITLE_LIMIT);

const kindsOf = (analysis) => WORK_KINDS.filter((k) => analysis.intent.workKinds.includes(k.id));

const blockingOf = (k, a) => a.intent.missing.filter((m) => m.blocks.includes(k.id));

// Why a unit of this kind may not start: the first row that holds, or nothing.
const UNRESOLVED = [
  { when: (k, a) => blockingOf(k, a).length > 0, because: (k, a) => `missing: ${blockingOf(k, a).map((m) => m.statement).join("; ")}` },
  { when: (k, a) => k.named && capabilitiesOfKind(k, a.intent.capabilities).length === 0, because: () => "a procedure names the capability it provides, and the analysis names none" },
];

const unresolvedOf = (k, a) => ((row) => (row ? clip(row.because(k, a)) : null))(UNRESOLVED.find((r) => r.when(k, a)));

// Who answers for the acceptance criteria: every kind that does, or -- when none of the named kinds does -- all of them,
// so a criterion is never left without a unit.
const accepting = (kinds) => (kinds.some((k) => k.accepts) ? kinds.filter((k) => k.accepts) : kinds);

const refsOf = (rows) => (rows ?? []).map((r) => r.id);

function unitOf(a, base, kinds) {
  const owners = accepting(kinds);
  return (k) => ({ id: unitId(`${base}:${k.id}`), title: clip(k.title(a) || a.objective), workflow: "automation", kind: k.id, intent: k.intent, takesRef: k.ref, capabilities: capabilitiesOfKind(k, a.intent.capabilities), dependsOn: [], acceptanceRefs: owners.includes(k) ? refsOf(a.acceptance) : [], requirementRefs: k.ref ? refsOf(a.requirements) : [], unresolved: unresolvedOf(k, a) });
}

// Each unit waits for the one before it; its state is where it starts from.
const chained = (u, i, units) => ((dependsOn) => ({ ...u, dependsOn, state: stateOf(u, dependsOn) }))(i ? [units[i - 1].id] : []);

const stateOf = (u, dependsOn) => (u.unresolved ? "unresolved" : dependsOn.length ? "planned" : "ready");

const settled = (u) => (u.unresolved ? { ...u, because: u.unresolved, unresolved: undefined } : { ...u, unresolved: undefined });

export function buildPlanUnits(analysis, specDigest) {
  const kinds = kindsOf(analysis);
  const units = kinds.map(unitOf(analysis, specDigest.slice(0, 8), kinds));
  return units.map(chained).map(settled).map((u) => JSON.parse(JSON.stringify(u)));
}
