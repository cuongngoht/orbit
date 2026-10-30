// What ONE evaluation compares, and what it -- then every evaluation of a campaign together -- comes to. Pure: each run
// is what the evaluation's own owner records say (evaluators.mjs reads them back), never what a host or an agent
// reported. An evaluation runs the version a campaign would replace (the BASELINE) and the CANDIDATE on the same
// frozen inputs, run n of one beside run n of the other; correctness decides, and what a run cost is measured beside it
// but can never buy a verdict.
//
//   run line   { side: baseline|candidate, n, run, word, met, failing: [step], blocked, retries, calls, ms, attribution, evidence }
//   verdictOf(e) -> { verdict, because, regressions }        metricsOf(e) -> per side, deltas, ratios, what is unknown
//   aggregateOf(evaluations, values) -> { verdict, because, sessions, evaluations }
import { improvementOf } from "./policy.mjs";
import { independent } from "./signals.mjs";

const sideOf = (e, side) => (e.runs ?? []).filter((r) => r.side === side).sort((a, b) => a.n - b.n);

const metCount = (rows) => rows.filter((r) => r.met).length;

const pairsOf = (c) => c.baseline.map((b) => [b, c.candidate.find((x) => x.n === b.n)]).filter(([, x]) => x);

// A step the baseline MET on an input and the candidate does not, on the same input: the one thing that makes a
// candidate worse whatever else it improves.
const regressionsOf = (c) => [...new Set(pairsOf(c).flatMap(([b, x]) => (x.failing ?? []).filter((id) => !(b.failing ?? []).includes(id))))].sort();

const factsOf = (e) => ((c) => ({ ...c, regressions: regressionsOf(c) }))({ baseline: sideOf(e, "baseline"), candidate: sideOf(e, "candidate") });

const blockedRuns = (c) => [...c.baseline, ...c.candidate].filter((r) => r.blocked).length;

export const COMPARE = [
  { verdict: "BLOCKED", when: (c) => blockedRuns(c) > 0, because: (c) => `${blockedRuns(c)} run(s) were stopped by the environment or a person — nothing is compared` },
  { verdict: "INCONCLUSIVE", when: (c) => c.baseline.length === 0 || c.candidate.length !== c.baseline.length, because: (c) => `the two versions did not run the same inputs (${c.baseline.length} and ${c.candidate.length})` },
  { verdict: "WORSE", when: (c) => c.regressions.length > 0, because: (c) => `on the same input the candidate newly failed ${c.regressions.join(", ")}, which the baseline met — a critical regression` },
  { verdict: "INCONCLUSIVE", when: (c) => metCount(c.baseline) === c.baseline.length, because: () => "the baseline met every run: the failure did not reproduce here, so nothing was improved on" },
  { verdict: "BETTER", when: (c) => metCount(c.candidate) > metCount(c.baseline), because: (c) => `the candidate met ${metCount(c.candidate)} of ${c.candidate.length} run(s) where the baseline met ${metCount(c.baseline)}, with no step newly failing` },
  { verdict: "WORSE", when: (c) => metCount(c.candidate) < metCount(c.baseline), because: (c) => `the candidate met ${metCount(c.candidate)} of ${c.candidate.length} run(s), fewer than the baseline's ${metCount(c.baseline)}` },
  { verdict: "EQUIVALENT", when: () => true, because: (c) => `both met ${metCount(c.candidate)} of ${c.candidate.length} run(s): no measurable difference` },
];

export const verdictOf = (e) => ((c) => ((row) => ({ verdict: row.verdict, because: row.because(c), regressions: c.regressions }))(COMPARE.find((r) => r.when(c))))(factsOf(e));

// ---- what each side cost, measured beside the verdict -------------------------------------------------------------

const sum = (rows, k) => rows.reduce((n, r) => n + (Number.isFinite(r[k]) ? r[k] : 0), 0);

const timed = (rows) => (rows.length > 0 && rows.every((r) => Number.isFinite(r.ms)) ? sum(rows, "ms") : null);

const sideMetrics = (rows) => ({ runs: rows.length, met: metCount(rows), verified: rows.filter((r) => r.evidence === "VERIFIED").length, failing: rows.filter((r) => (r.failing ?? []).length > 0).length, blocked: rows.filter((r) => r.blocked).length, retries: sum(rows, "retries"), calls: sum(rows, "calls"), ms: timed(rows) });

const ratio = (id, numerator, denominator) => ({ id, numerator, denominator, value: denominator > 0 ? numerator / denominator : null });

const ratiosOf = (b, c, regressions) => [ratio("baseline-met", b.met, b.runs), ratio("candidate-met", c.met, c.runs), ratio("candidate-verified", c.verified, c.runs), ratio("candidate-failing", c.failing, c.runs), ratio("critical-regressions", regressions.length, b.met)];

// What a declared playbook's calls are never seen to cost: unknown, and said to be -- never estimated.
export const UNKNOWN = [{ id: "tokens", because: "owner gates keep digests of a call, never the tokens a model spent" }, { id: "cost", because: "no owner records what a call cost" }, { id: "handoffs", because: "a declared playbook hands nothing between agents" }];

const delta = (b, c, k) => (b[k] === null || c[k] === null ? null : c[k] - b[k]);

export function metricsOf(e) {
  const c = factsOf(e);
  const base = sideMetrics(c.baseline);
  const cand = sideMetrics(c.candidate);
  return { baseline: base, candidate: cand, delta: { calls: delta(base, cand, "calls"), retries: delta(base, cand, "retries"), ms: delta(base, cand, "ms") }, ratios: ratiosOf(base, cand, c.regressions), unknown: UNKNOWN };
}

// ---- every evaluation together --------------------------------------------------------------------------------

const sessionsOf = (evals) => independent(evals.map((e) => ({ session: e.session ?? null, host: e.host ?? null, at: e.at })));

const aggregateFacts = (evaluations, values) => ((all) => ({ all, min: improvementOf(values).minSessions, of: (v) => all.filter((e) => e.settled.verdict === v), sessions: (v) => sessionsOf(all.filter((e) => e.settled.verdict === v)) }))((evaluations ?? []).filter((e) => e.settled));

// One evaluation is never enough, and one evaluation saying WORSE is: a candidate is better only when independent
// sessions say so and none says otherwise.
export const AGGREGATE = [
  { verdict: "WORSE", when: (a) => a.of("WORSE").length > 0, because: (a) => `${a.of("WORSE").length} evaluation(s) found the candidate worse — one is enough to reject it` },
  { verdict: "BETTER", when: (a) => a.sessions("BETTER") >= a.min && a.of("EQUIVALENT").length === 0, because: (a) => `better in ${a.sessions("BETTER")} independent session(s), and no evaluation said otherwise` },
  { verdict: "EQUIVALENT", when: (a) => a.sessions("EQUIVALENT") >= a.min && a.of("BETTER").length === 0, because: (a) => `no measurable difference in ${a.sessions("EQUIVALENT")} independent session(s)` },
  { verdict: "BLOCKED", when: (a) => a.all.length > 0 && a.all.every((e) => e.settled.verdict === "BLOCKED"), because: () => "every evaluation was stopped by the environment or a person" },
  { verdict: "INCONCLUSIVE", when: () => true, because: (a) => `${a.sessions("BETTER")} independent session(s) found it better and ${a.min} are needed, with none saying otherwise — another session's evaluation decides` },
];

export const aggregateOf = (evaluations, values) => ((a) => ((row) => ({ verdict: row.verdict, because: row.because(a), sessions: a.sessions(row.verdict === "INCONCLUSIVE" ? "BETTER" : row.verdict), evaluations: a.all.length }))(AGGREGATE.find((r) => r.when(a))))(aggregateFacts(evaluations, values));
