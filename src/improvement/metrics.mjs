// The nine QUALITY METRICS of self-improvement, each a ratio with its REAL numerator and denominator -- or unknown,
// and said to be: never a rate over workloads that are not comparable, never how often something was used counted as
// how well it worked, and never a number nobody measured. Safety is a count expected to stay at zero, never averaged
// with anything.
//
//   qualityOf({ campaigns: [model], opportunities: [doc], reuse: { reused, eligible } | null }) -> [{ id, say, numerator, denominator, value, unit, because }]
import { phaseOf } from "./model.mjs";
import { WRITERS } from "./vocab.mjs";

const ratio = (id, say, numerator, denominator, because = null) => ({ id, say, numerator, denominator, value: denominator > 0 ? numerator / denominator : null, unit: "ratio", because: denominator > 0 ? because : "nothing to divide by yet" });

const aggregateVerdict = (m) => m.qualified?.verdict ?? (m.ended?.outcome === "no-measurable-improvement" ? "EQUIVALENT" : m.ended?.outcome === "candidate-rejected" && m.evaluations.some((e) => e.settled?.verdict === "WORSE") ? "WORSE" : null);

const comparable = (ms) => ms.filter((m) => ["BETTER", "EQUIVALENT", "WORSE"].includes(aggregateVerdict(m)));

const evaluatedCandidates = (ms) => ms.filter((m) => m.evaluations.some((e) => e.settled));

// A promoted candidate counts toward a rate only once monitoring decided something about it: held, or regressed.
const watched = (ms) => ms.filter((m) => m.promoted && (m.ended?.outcome === "improvement-verified" || Boolean(m.regression)));

const deltas = (ms) => ms.flatMap((m) => m.evaluations.map((e) => e.settled?.metrics?.delta).filter((d) => Number.isFinite(d?.calls)));

const opportunityRuns = (os) => os.filter((o) => o && !o.unreadable && o.attribution);

// A promotion is SAFE when it went through a door that may write, and either a person made it in Orbit Control or a
// gated line whose every row held came before it.
const gatedClean = (m) => Boolean(m.gates) && (m.gates.rows ?? []).every((r) => r.holds);

const safeFor = (m) => WRITERS.includes(m.promoted?.door) && (m.promoted.door === "control" || gatedClean(m));

const METRICS = [
  (x) => ratio("opportunity-detection", "eligible opportunities / evidence groups examined", x.os.filter((o) => o.eligible).length, x.os.length),
  (x) => ratio("candidate-qualification", "qualified candidates / candidates evaluated", evaluatedCandidates(x.ms).filter((m) => m.qualified).length, evaluatedCandidates(x.ms).length),
  (x) => ratio("verified-improvement", "candidates independently proven better / campaigns with a comparable evaluation", comparable(x.ms).filter((m) => aggregateVerdict(m) === "BETTER").length, comparable(x.ms).length),
  (x) => ratio("regression", "promoted candidates that regressed / promoted candidates monitoring decided about", watched(x.ms).filter((m) => m.regression).length, watched(x.ms).length),
  (x) => ratio("rollback", "promoted candidates rolled back / promoted candidates monitoring decided about", watched(x.ms).filter((m) => m.rolledBack).length, watched(x.ms).length),
  (x) => (x.reuse ? ratio("reuse", "runs of a promoted version / runs of its definition since it was chosen", x.reuse.reused, x.reuse.eligible) : { id: "reuse", say: "runs of a promoted version / runs of its definition since it was chosen", numerator: null, denominator: null, value: null, unit: "ratio", because: "no promoted version has run yet" }),
  (x) => ((d) => ({ id: "efficiency-change", say: "mean change in calls per evaluation, candidate minus baseline (negative is fewer)", numerator: d.reduce((n, v) => n + v.calls, 0), denominator: d.length, value: d.length ? d.reduce((n, v) => n + v.calls, 0) / d.length : null, unit: "delta", because: d.length ? "measured on comparable evaluations only; time and retries are in each evaluation" : "nothing to divide by yet" }))(deltas(x.ms)),
  (x) => ratio("attribution-coverage", "runs bound to their run by an engine / runs observed", opportunityRuns(x.os).reduce((n, o) => n + o.attribution.bound, 0), opportunityRuns(x.os).reduce((n, o) => n + o.attribution.of, 0)),
  (x) => ({ id: "promotion-safety", say: "promotions that passed no gate or went through no door that may write (expected to stay zero)", numerator: x.ms.filter((m) => m.promoted && !safeFor(m)).length, denominator: x.ms.filter((m) => m.promoted).length, value: x.ms.filter((m) => m.promoted && !safeFor(m)).length, unit: "count", because: null }),
];

export const METRIC_IDS = ["opportunity-detection", "candidate-qualification", "verified-improvement", "regression", "rollback", "reuse", "efficiency-change", "attribution-coverage", "promotion-safety"];

export const qualityOf = (x) => ((facts) => METRICS.map((f) => f(facts)))({ ms: (x.campaigns ?? []).filter((m) => m?.meta), os: (x.opportunities ?? []).filter(Boolean), reuse: x.reuse ?? null });

// How many campaigns stand in each phase: what an overview counts, never a progress percentage.
export const phasesOf = (models) => models.filter((m) => m?.meta).reduce((acc, m) => ({ ...acc, [phaseOf(m)]: (acc[phaseOf(m)] ?? 0) + 1 }), {});
