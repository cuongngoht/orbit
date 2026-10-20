// Coverage as a CHAIN, not a number:
//
//   acceptance criterion -> scenario -> case or manual check -> run -> evidence
//
// Every ratio here carries its denominator and the scope it was taken over,
// because "92% covered" with neither is the sentence a release gets signed off
// on. Three rules hold it honest:
//
//   * only a run that VERIFIES raises verified coverage. SKIP, PARTIAL, REFUSED,
//     BLOCKED and INCONCLUSIVE are outcomes, not evidence -- vocab.mjs decides,
//     and exactly one row says yes.
//   * evidence has to be about THIS revision. A PASS recorded before the plan
//     changed is history; it stays visible and it stops counting.
//   * an empty or undefined scope is reported as unknown, never as 100%. A plan
//     with no criteria has not covered all of them.
//
// Nothing is inferred from a case NAME. What a scenario covers is what it says
// it covers, and what a case can prove is read off its steps through the verb
// table.
import { WITNESSES, commitments, gaps } from "./commit.mjs";
import { mutationsWhere } from "./vocab.mjs";
import { buildOf, designOf, executionOf, freshnessOf } from "./states.mjs";
import { at as label, checksOf, criteriaOf, scenariosOf } from "./rules/common.mjs";
import { LINK_STATE, counts as current, freshSays, runSays, verifies } from "./vocab.mjs";

const WRITES = mutationsWhere("writes");

// The stages a scenario passes through, furthest first. A scenario lands in
// exactly one, so the buckets add up to the scope and a reader can check that.
export const STAGES = [
  { name: "verified", say: "a run ruled on it, held, and the evidence is about this revision" },
  { name: "executed", say: "it ran, and did not verify — look at why before calling it covered" },
  { name: "implemented", say: "the case exists and validates; nobody has run it here" },
  { name: "designed", say: "the scenario is written; no case drives it yet" },
];

export const APART = [
  { name: "blocked", say: "something named in blockers stops it — automation, not the product" },
  { name: "excluded", say: "deliberately out of this round, with a reason" },
];

export function coverageModel(plan, world = {}, opts = {}) {
  const scenarios = scenariosOf(plan).map((s) => oneScenario(plan, s, world, opts));
  const criteria = criteriaOf(plan).map((c) => oneCriterion(plan, c, scenarios));
  const scope = scenarios.filter((s) => s.counts);
  return { plan: head(plan), scenarios, criteria, checks: checksOf(plan), scope: scope.length, stages: staged(scenarios), ratios: ratios(criteria, scope), gaps: gapsOf(scenarios), unknown: unknownOf(scenarios), excluded: exclusions(plan, scenarios) };
}

const head = (p) => ({ id: p.id, title: p.title ?? "", revision: p.revision ?? "", at: p.at ?? "", feature: p.feature ?? "", draft: Boolean(p._draft) });

function oneScenario(plan, s, world, opts) {
  const build = buildOf(s, world);
  const execution = executionOf(s, world);
  const runs = execution.cases.map((c) => withFreshness(c, plan, opts));
  return { ...facts(s), build, execution, runs, gaps: gaps(s), commitments: commitments(s), ...stageOf(plan, s, build, execution, runs) };
}

const facts = (s) => ({ id: s.id, name: s.name ?? "", priority: s.priority ?? "", technique: s.technique ?? "", covers: s.covers ?? [], checks: s.checks ?? [], design: designOf(s).name ?? s.readiness ?? "ready", blockers: s.blockers ?? [] });

const withFreshness = (c, plan, opts) => ({ ...c, fresh: freshnessOf(c.run, plan, opts), says: c.run ? runSays(c.run.status) : "no run recorded here" });

// The furthest stage this scenario has ACTUALLY reached. Verified needs all of
// it at once: every linked case verified, every one of those runs fresh (build,
// environment, revision AND the case as written), and none of the reasons in
// UNPROVEN standing.
function stageOf(plan, s, build, execution, runs) {
  const apart = APART.find((a) => a.name === stateApart(s));
  if (apart) return { stage: apart.name, counts: apart.name === "blocked", why: apart.say };
  const why = whyOf(plan, s, build, execution);
  return { stage: reached(build, execution, runs, why), counts: true, why };
}

const stateApart = (s) => (designOf(s).excluded ? "excluded" : (s.blockers ?? []).length ? "blocked" : null);

function reached(build, execution, runs, why) {
  if (!why && held(execution, runs)) return "verified";
  if (execution.ran) return "executed";
  return LINK_STATE.get(build.state)?.validated ? "implemented" : "designed";
}

const held = (execution, runs) => execution.verified && runs.length > 0 && runs.every((r) => current(r.fresh.state));

// Why runs that HELD still do not verify the scenario, first reason first:
//   a blind spot  a committed layer turned out to be a gap, or a write nothing
//                 below the screen witnessed
//   the case      a linked case no longer validates: a PASS of a case that would
//                 be refused today proves nothing about it
//   a person      a manual check the scenario names is not done yet
const UNPROVEN = [
  (plan, s) => blindSpot(s),
  (plan, s, build, execution) => (execution.ran && !LINK_STATE.get(build.state)?.validated ? `a linked case no longer validates (${build.state}) — a PASS of a case that would be refused today proves nothing about it` : ""),
  (plan, s) => owedWhy(owed(plan, s)),
];

const whyOf = (plan, s, build, execution) => UNPROVEN.map((f) => f(plan, s, build, execution)).find(Boolean) ?? "";

const owed = (plan, s) => checksOf(plan).filter((m) => (s.checks ?? []).includes(m.id) && m.state !== "done");

const owedWhy = (checks) => (checks.length ? `manual check ${checks.map((m) => `${m.id} is ${m.state ?? "todo"}`).join(", ")} — a person owes it before this counts` : "");

// Why a run that HELD still does not verify the scenario. Two shapes, and both
// end the same way -- the question the scenario asked is still open:
//   a layer it committed to turned out to be a capability gap, so nothing asked;
//   it changes data and nothing below the screen witnessed it, and a screen can
//   show a write that never happened.
function blindSpot(s) {
  const onCommitted = gaps(s).find((g) => commitments(s).some((c) => c.layer === g.layer));
  if (onCommitted) return `it committed to ${onCommitted.layer} and that layer turned out to be a gap: ${onCommitted.because}`;
  return unwitnessed(s);
}

function unwitnessed(s) {
  if (!WRITES.has(s.mutation?.kind)) return "";
  const below = commitments(s).some((c) => WITNESSES.includes(c.layer));
  return below ? "" : `it changes data and rules on ${WITNESSES.join("/")} nowhere — a screen can show a write that never happened`;
}

// A criterion is covered by what DECLARES it covers -- scenarios and manual
// checks both -- and is verified only when every scenario that claims it is.
function oneCriterion(plan, c, scenarios) {
  const mine = scenarios.filter((s) => (s.covers ?? []).includes(c.id));
  const checks = checksOf(plan).filter((m) => (m.covers ?? []).includes(c.id));
  return { id: c.id, says: c.says ?? "", risk: c.risk ?? null, scenarios: mine.map((s) => s.id), checks: checks.map((m) => m.id), state: criterionState(c, mine, checks), disposition: c.disposition ?? null };
}

// Verified needs every scenario that claims it verified AND every manual check
// that covers it done: a person's part is part of the proof, not a footnote.
function criterionState(c, mine, checks) {
  if (!mine.length && !checks.length) return c.disposition ? c.disposition.state : "open";
  if (mine.length && mine.every((s) => s.stage === "verified")) return checks.every((m) => m.state === "done") ? "verified" : "covered";
  return mine.some((s) => s.stage === "blocked") ? "blocked" : "covered";
}

function staged(scenarios) {
  const rows = [...STAGES, ...APART];
  return rows.map((r) => ({ name: r.name, say: r.say, n: scenarios.filter((s) => s.stage === r.name).length }));
}

// Two ratios, each with its own denominator spelled out. A scope of nothing
// yields `null` rather than 1: a plan with no scenarios has verified nothing,
// and rounding that to 100% is how an empty plan reports a finished feature.
function ratios(criteria, scope) {
  const decided = criteria.filter((c) => c.state !== "open");
  return [
    ratio("criteria decided", decided.length, criteria.length, "acceptance criteria in this plan — covered, handed over, excluded or deferred"),
    ratio("criteria verified", criteria.filter((c) => c.state === "verified").length, criteria.length, "acceptance criteria in this plan"),
    ratio("scenarios verified", scope.filter((s) => s.stage === "verified").length, scope.length, "scenarios in scope (excluded ones are not counted, and are listed below)"),
  ];
}

const ratio = (name, n, of, scope) => ({ name, n, of, scope, pct: of > 0 ? Math.round((n / of) * 100) : null });

// Every layer somebody said could not be checked, with the reason -- shown, not
// netted off. A gap that disappears from the report is a requirement quietly
// lowered until the case went green.
const gapsOf = (scenarios) => scenarios.flatMap((s) => s.gaps.map((g) => ({ scenario: s.id, name: s.name, layer: g.layer, because: g.because, from: g.from })));

// Where the tool does not know. Reported as its own list because an unknown
// counted as a pass is the whole failure mode, and an unknown counted as a
// failure sends somebody to debug a product that is fine.
function unknownOf(scenarios) {
  const runs = scenarios.flatMap((s) => s.runs.map((r) => ({ scenario: s.id, case: r.id, ...r })));
  const cloudy = runs.filter((r) => r.run && !current(r.fresh.state));
  return cloudy.map((r) => ({ scenario: r.scenario, case: r.case, state: r.fresh.state, says: freshSays(r.fresh.state), refs: r.fresh.refs.filter((x) => x.state !== "fresh") }));
}

const exclusions = (plan, scenarios) => [
  ...(plan.exclusions ?? []).map((x) => ({ id: x.id, says: x.says, because: x.because })),
  ...scenarios.filter((s) => s.stage === "excluded").map((s) => ({ id: s.id, says: s.name, because: `deferred: ${s.design}` })),
];

// The chain itself, one row per hop, for a reader who wants to follow one
// criterion all the way to a file on disk.
export function traceRows(model) {
  const byId = new Map(model.scenarios.map((s) => [s.id, s]));
  return model.criteria.flatMap((c) => c.scenarios.map((id) => row(c, byId.get(id))).concat(checkRows(c)));
}

// A row is verified exactly when its scenario is -- ONE definition, the
// scenario's. `held` is the arithmetic beside it, for a reader who wants to see
// that one case of two held: it never paints a row green on its own.
function row(c, s) {
  const runs = (s?.runs ?? []).map((r) => ({ case: r.id, status: r.run?.status ?? "—", at: r.run?.at ?? "", evidence: r.run?.evidence ?? "", fresh: r.fresh.state, says: r.says }));
  return { criterion: c.id, says: c.says, scenario: s?.id ?? "", name: s?.name ?? "", stage: s?.stage ?? "", priority: s?.priority ?? "", runs, verified: s?.stage === "verified", held: `${runs.filter((r) => verifies(r.status) && current(r.fresh)).length} of ${runs.length}` };
}

const checkRows = (c) => c.checks.map((id) => ({ criterion: c.id, says: c.says, scenario: "", name: `manual check ${id}`, stage: "manual", priority: "", runs: [], verified: false, held: "—" }));
