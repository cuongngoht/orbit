// THE METRICS a set of benchmark runs supports -- each read off what the runs themselves kept (their manifests, their
// endings, their reports), never off what a host said. Every metric is a numerator over a denominator with its scope in
// words; a metric with nothing to stand on is `unknown`, never 0 and never 100%. Runs are split by HOST BASIS -- none (a
// verification only), scripted (a control's scripted host: conformance of the controller and the engine) and
// coding-host (a model) -- so a scripted success is never counted as autonomous performance. A run that was blocked,
// invalid, inconclusive, held by a person or never finished is excluded from a rate and counted, by why. A cost is only
// ever one a host REPORTED; the budget's estimate is never a cost. Speed and cost never outrank correctness: they are
// measured over verified outcomes alone.
//
//   runFacts({ manifest, ending, report }) -> facts       metricsOf(runs, o) -> { runs, bases, verifier, history }
//   METRICS -> rows { id, says, over(facts) -> { numerator, denominator, excluded } }
const UNKNOWN = "unknown";

// Why a run is left out of a rate, by the word it ended on.
const EXCLUDED = { BLOCKED: "blocked", BENCHMARK_INVALID: "invalid", INCONCLUSIVE: "inconclusive", PAUSED: "held", CANCELLED: "held" };

// What counts as an autonomous outcome VERIFIED by the run's own independent verifier, by kind of case.
const VERIFIED = { source: ["REPAIRED_VERIFIED"], engineering: ["PASS"], qa: ["PASS"] };

const basisOf = (m) => (m.benchmark?.kind === "qa" ? (m.config?.host && m.config.host !== "coding-host" ? "scripted" : "coding-host") : !m.config?.repair ? "none" : String(m.config.host ?? "").startsWith("scripted:") ? "scripted" : String(m.config.host ?? "").startsWith("session:") ? "session" : "coding-host");

const durationOf = (m, e) => ((a, b) => (Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null))(Date.parse(m.at ?? ""), Date.parse(e?.at ?? ""));

const intervenedOf = (r, e) => (e?.class === "HUMAN_APPROVAL_REQUIRED" ? true : r?.interventions ? Object.values(r.interventions).some((n) => n > 0) : null);

// One run, as the facts every metric reads.
export function runFacts({ manifest: m, ending: e, report: r }) {
  const outcome = e?.outcome ?? null;
  const kind = m.benchmark?.kind ?? "source";
  return { run: m.run, at: m.at ?? null, kind, case: m.benchmark?.case ?? null, suite: m.benchmark?.suite ?? null, caseDigest: m.benchmark?.digest ?? null, variant: m.benchmark?.variant ?? null, subject: m.subject?.digest ?? null, commit: m.source?.commit ?? null, model: m.config?.model ?? null, host: m.config?.host ?? null, basis: r?.hostBasis ?? basisOf(m), outcome, excluded: !outcome ? "unfinished" : EXCLUDED[outcome] ?? null, verified: (VERIFIED[kind] ?? []).includes(outcome), autonomousAxis: r?.axes?.autonomous?.value ?? null, rounds: (r?.rounds ?? []).length, regressedRounds: (r?.rounds ?? []).filter((x) => (x.decided?.regressed ?? []).length > 0).length, evaluatedRounds: (r?.rounds ?? []).filter((x) => x.decided).length, durationMs: durationOf(m, e), costUsd: typeof r?.totals?.costUsd === "number" ? r.totals.costUsd : null, intervened: intervenedOf(r, e), judged: r?.judged ?? null, task: kind === "qa" || m.config?.repair === true };
}

// ---- the rows -------------------------------------------------------------------------------------------------------------

const countBy = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

const rate = (included, hit, excluded = []) => ({ numerator: included.filter(hit).length, denominator: included.length, excluded: countBy(excluded.map((f) => f.excluded)) });

// The runs a rate is over: those that carried a task (a repair, a goal, an investigation) -- and of them, the ones that
// came to an ending a rate may count.
const tasks = (fs) => fs.filter((f) => f.task);

const counted = (fs) => fs.filter((f) => !f.excluded);

const left = (fs) => fs.filter((f) => f.excluded);

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

const mean = (xs) => (xs.length ? { numerator: sum(xs), denominator: xs.length } : { numerator: 0, denominator: 0 });

const qa = (fs) => counted(fs).filter((f) => f.kind === "qa" && f.judged);

const planted = (fs) => counted(fs).filter((f) => f.kind === "source" && f.variant && f.variant !== "real");

export const METRICS = [
  { id: "autonomous_task_success", says: "verified autonomous completions / task attempts that came to an ending a rate may count", over: (fs) => rate(counted(tasks(fs)), (f) => f.verified && f.autonomousAxis !== false && f.intervened !== true, left(tasks(fs))) },
  { id: "self_healing_success", says: "verified repairs / repairs that ran at least one round on a repairable source failure", over: (fs) => rate(counted(fs).filter((f) => f.kind === "source" && f.rounds > 0), (f) => f.verified, left(fs.filter((f) => f.kind === "source" && f.task))) },
  { id: "defect_detection", says: "planted defects found (a source case's controlled fault failing it, a QA case's planted shapes found) / planted defects established", over: (fs) => ((s, q) => ({ numerator: s.filter((f) => f.outcome === "FAIL").length + sum(q.map((f) => f.judged.found ?? 0)), denominator: s.length + sum(q.map((f) => f.judged.planted ?? 0)), excluded: countBy(left(fs).map((f) => f.excluded)) }))(planted(fs), qa(fs)) },
  { id: "false_positive", says: "false alarms / defect reports evaluated against the clean application (QA cases)", over: (fs) => ((q) => ({ numerator: sum(q.map((f) => f.judged.falseAlarms ?? 0)), denominator: sum(q.map((f) => (f.judged.found ?? 0) + (f.judged.falseAlarms ?? 0) + (f.judged.unconfirmed ?? 0))), excluded: {} }))(qa(fs)) },
  { id: "regression", says: "candidates that broke a hidden group or a gate that held before them / candidates evaluated", over: (fs) => ({ numerator: sum(fs.map((f) => f.regressedRounds)), denominator: sum(fs.map((f) => f.evaluatedRounds)), excluded: {} }) },
  { id: "human_intervention", says: "runs a person paused, resumed, cancelled or approved in, or that stopped to wait for a person / task runs whose interventions were read", over: (fs) => rate(tasks(fs).filter((f) => f.intervened !== null), (f) => f.intervened === true) },
  { id: "avg_repair_rounds", says: "repair rounds / repairs that ran at least one round", over: (fs) => ({ ...mean(fs.filter((f) => f.rounds > 0).map((f) => f.rounds)), excluded: {} }) },
  { id: "avg_time_to_verified_ms", says: "milliseconds from a run's freeze to its ending / verified outcomes", over: (fs) => ({ ...mean(fs.filter((f) => f.verified && f.durationMs !== null).map((f) => f.durationMs)), excluded: {} }) },
  { id: "cost_per_verified_usd", says: "REPORTED cost of verified outcomes / verified outcomes whose cost was reported (an estimate is never a cost)", over: (fs) => ((v) => ({ ...mean(v.filter((f) => f.costUsd !== null).map((f) => f.costUsd)), excluded: { "cost not reported": v.filter((f) => f.costUsd === null).length } }))(fs.filter((f) => f.verified)) },
];

const valued = (r) => ({ ...r, value: r.denominator > 0 ? Math.round((r.numerator / r.denominator) * 10000) / 10000 : UNKNOWN });

const basisMetrics = (fs) => Object.fromEntries(METRICS.map((m) => [m.id, { ...valued(m.over(fs)), says: m.says, runs: fs.length }]));

// ---- reproducibility, the verifier's own controls, and history by revision -------------------------------------------------

// Who carried a run is part of what it is: two scripted controls of one case are two hosts, as two models are.
const groupKey = (f) => [f.case, f.caseDigest, f.variant, f.subject, f.basis, f.host ?? "-", f.model ?? "-"].join("\u0000");

const groupsOf = (fs) => Object.values(counted(fs).reduce((m, f) => ({ ...m, [groupKey(f)]: [...(m[groupKey(f)] ?? []), f] }), {})).filter((g) => g.length > 1);

export function reproducibilityOf(fs) {
  const groups = groupsOf(fs);
  const stable = groups.filter((g) => new Set(g.map((f) => f.outcome)).size === 1);
  return { ...valued({ numerator: stable.length, denominator: groups.length }), says: "groups of runs on one case, digest, variant, subject, basis, host and model whose outcomes agree / groups with two valid runs or more", unstable: groups.filter((g) => !stable.includes(g)).map((g) => ({ case: g[0].case, variant: g[0].variant, basis: g[0].basis, outcomes: countBy(g.map((f) => f.outcome)), runs: g.map((f) => f.run) })) };
}

// The verifier's own controls, from every `controls` room: how many earned what they must.
export const verifierOf = (rows) => ({ ...valued({ numerator: rows.filter((r) => r.matched).length, denominator: rows.length }), says: "controls that earned what they must (verifier, candidate and scripted-host controls) / controls run", missed: rows.filter((r) => !r.matched).map((r) => `${r.case} ${r.id}: expected ${r.expect}, got ${r.got}`) });

// Each case's outcomes by source revision, oldest first: what a change to the source did to it.
export const historyOf = (fs) => Object.values(fs.reduce((m, f) => ((k) => ({ ...m, [k]: { case: f.case, variant: f.variant, basis: f.basis, commits: [...(m[k]?.commits ?? []), { commit: f.commit?.slice(0, 12) ?? null, at: f.at, outcome: f.outcome ?? "unfinished", run: f.run }] } }))(`${f.case}\u0000${f.variant}\u0000${f.basis}`), {})).map((h) => ({ ...h, commits: h.commits.sort((a, b) => String(a.at).localeCompare(String(b.at))) }));

const BASES = ["none", "scripted", "session", "coding-host"];

export function metricsOf(runs, o = {}) {
  const fs = runs.map(runFacts);
  const bases = Object.fromEntries(BASES.map((b) => [b, basisMetrics(fs.filter((f) => f.basis === b))]));
  return { scope: o.scope ?? "every run kept", runs: { total: fs.length, byBasis: countBy(fs.map((f) => f.basis)), byOutcome: countBy(fs.map((f) => f.outcome ?? "unfinished")) }, bases, reproducibility: reproducibilityOf(fs), verifier: verifierOf(o.controls ?? []), ...(o.byRevision ? { history: historyOf(fs) } : {}) };
}
