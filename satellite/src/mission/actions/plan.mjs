// PLAN and REPLAN: a work graph the host proposes, held to the unit contract and the graph rules, then published as
// one immutable revision before the lines that name it. The first is `plan`; every later one is `replan`, which names
// its cause and is bounded by Orbit's execution.maxReplans. SKIP and CANCEL-UNIT take one unit out of the graph,
// never a running one.
import { normalizedUnit, unitFindings } from "../../planning/unit.mjs";
import { graphFinding } from "../../planning/graph.mjs";
import { relativePlanFile, revisionOf, writeRevision } from "../../planning/plan.mjs";
import { TRIGGER_IDS } from "../../planning/replan.mjs";
import { instantiate } from "../../factories/workflow/workflow.mjs";
import { isSentence, list, quietly } from "../../store/text.mjs";
import { ENGINE, ORCHESTRATOR, finding, stateIn, unitIn } from "./common.mjs";

const PLAN_FIELDS = ["units", "cancel", "reset", "cause", "because", "proposal", "workflow", "params", "prefix"];

const depsOf = (m, ids, u) => list(u.dependsOn).map((d) => ids.get(d) ?? (m.units.has(d) ? d : m.keys.get(d) ?? null));

function normalizedAll(lw, raws) {
  const base = lw.m.counts["unit.created"] ?? 0;
  const ids = new Map(raws.map((u, i) => [u.key, `wu-${base + i + 1}`]));
  return raws.map((u, i) => normalizedUnit(u, `wu-${base + i + 1}`, depsOf(lw.m, ids, u), lw.m.meta.budget));
}

// The units a plan proposes: its own, or a workflow template's, instantiated for THIS mission -- every acceptance
// criterion the intent recorded served unless the template says otherwise.
function rawUnits(ports, lw, a) {
  if (!a.workflow) return { units: list(a.units), problems: [] };
  const record = quietly(() => ports.definitions.read(a.workflow));
  if (!record || record.kind !== "workflow" || ports.definitions.revoked(a.workflow)) return { units: [], problems: [`${a.workflow} is no workflow template this project can read back intact and unrevoked`] };
  return ((got) => ({ units: [...got.units, ...list(a.units)], problems: got.problems }))(instantiate(record.content, a.params ?? {}, { prefix: a.prefix ?? "", acceptance: list(lw.m.intent?.acceptanceCriteria).map((c) => c.id) }));
}

function planned(ports, lw, a) {
  const raws = rawUnits(ports, lw, a);
  const findings = [...raws.problems, ...raws.units.flatMap((u, i) => unitFindings(u, { m: lw.m, i }))];
  if (findings.length) return { findings, units: [], cancel: [], reset: [] };
  const units = normalizedAll(lw, raws.units);
  return { findings: [], units, cancel: list(a.cancel), reset: list(a.reset), graph: graphFinding({ m: lw.m, states: lw.states(), limits: lw.limits, spent: lw.spent(), units, cancel: list(a.cancel), reset: list(a.reset) }) };
}

const replanSpent = (lw) => lw.m.plans.length - 1 >= lw.limits.maxReplans;

const CONTRACT = [
  { when: (lw, a, p) => p.findings.length > 0, f: (lw, a, p) => finding("PLAN_INVALID", p.findings.join("; ")) },
  { when: (lw, a, p) => Boolean(p.graph), f: (lw, a, p) => finding(p.graph.rule, p.graph.say) },
  { when: (lw, a) => a.kind === "replan" && replanSpent(lw), f: (lw) => finding("REPLAN_BUDGET", `${lw.m.plans.length - 1} revision(s) after the first plan: the most Orbit's execution.maxReplans allows; finish the mission with a stop`) },
  { when: (lw, a) => a.kind === "replan" && !TRIGGER_IDS.includes(a.cause) && a.cause !== "HOST_REVISION", f: () => finding("REPLAN_CAUSE", `cause is one of ${[...TRIGGER_IDS, "HOST_REVISION"].join(", ")}`) },
  { when: (lw, a) => a.proposal !== undefined && !lw.m.handoffs.get(a.proposal)?.proposes, f: (lw, a) => finding("REPLAN_PROPOSAL", `${a.proposal} is no handoff of this mission that proposed a change`) },
  { when: (lw, a) => a.because !== undefined && !isSentence(a.because), f: () => finding("PLAN_BECAUSE", "because is one sentence") },
];

const contracted = (ports, lw, a, p) => ((row) => (row ? row.f(lw, a, p) : null))(CONTRACT.find((r) => r.when(lw, a, p)));

function revised(ports, lw, a, p) {
  const rev = revisionOf({ m: lw.m, units: p.units, cancel: p.cancel, reset: p.reset, cause: a.cause ?? "FIRST_PLAN", because: a.because, evidenceRefs: list(a.proposal ? [a.proposal] : []), workflow: a.workflow });
  writeRevision(ports.io, ports.rooms, lw.id, rev);
  lw.append("plan.revised", { rev: rev.n, digest: rev.digest, file: relativePlanFile(ports.rooms, lw.id, rev), replaces: rev.replaces, cause: rev.cause, affectedUnits: rev.affectedUnits, invalidatedResults: rev.invalidatedResults, evidenceRefs: rev.evidenceRefs, units: p.units.map((u) => u.id), cancelled: p.cancel, reset: p.reset, workflow: a.workflow, because: a.because, action: lw.action });
  unitLines(lw, p, rev.n);
  return { outcome: rev.n === 1 ? "planned" : "revised", level: "CONTRACT_MET", summary: `revision ${rev.n}: ${p.units.length} unit(s) added, ${p.cancel.length} cancelled, ${p.reset.length} reset`, refs: [`plan:${rev.digest}`], digests: [rev.digest] };
}

function unitLines(lw, p, n) {
  for (const u of p.units) lw.append("unit.created", { ...u, unitKind: u.kind, planRevision: n, action: lw.action });
  for (const id of p.cancel) lw.append("unit.cancelled", { id, because: "cancelled by a plan revision", action: lw.action });
  for (const id of p.reset) lw.append("unit.updated", { id, reset: true, because: "reset by a plan revision: its earlier results no longer count", action: lw.action });
}

const graphRow = (kind) => ({ fields: PLAN_FIELDS, required: kind === "replan" ? ["cause"] : [], plan: planned, mode: () => "PLANNING", operation: () => "plan.revise", provider: ENGINE, profile: ORCHESTRATOR, contract: contracted, run: revised });

export const plan = graphRow("plan");

export const replan = graphRow("replan");

const LEAVABLE = ["planned", "ready", "blocked", "failed", "unresolved"];

const leaveRow = (kind, line) => ({
  fields: ["unit", "because"],
  required: ["unit", "because"],
  mode: () => "PLANNING",
  operation: () => "plan.revise",
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a) => (!unitIn(lw, a.unit) ? finding("UNIT_UNKNOWN", `no unit ${a.unit} in this mission`) : !LEAVABLE.includes(stateIn(lw, a.unit)) ? finding("UNIT_STATE", `${a.unit} is ${stateIn(lw, a.unit)}; only a unit that is ${LEAVABLE.join(", ")} can be ${kind === "skip" ? "skipped" : "cancelled"}`) : !isSentence(a.because) ? finding("UNIT_BECAUSE", "because is one sentence") : null),
  run: (ports, lw, a) => (lw.append(line, { id: a.unit, because: a.because, action: lw.action }), { outcome: kind === "skip" ? "skipped" : "cancelled", level: "CONTRACT_MET", summary: `${a.unit} ${kind === "skip" ? "skipped" : "cancelled"}: ${a.because}` }),
});

export const skip = leaveRow("skip", "unit.skipped");

export const cancelUnit = leaveRow("cancel-unit", "unit.cancelled");
