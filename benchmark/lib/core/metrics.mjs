// THE METRICS a set of benchmark runs supports -- each read off what the runs themselves kept (their manifests, their
// endings, their reports), never off what a host said. Every metric is a numerator over a denominator with its scope in
// words; a metric with nothing to stand on is `unknown`, never 0 and never 100%. Runs are split by HOST BASIS -- none (a
// verification only), scripted (a control's scripted host: conformance of the controller and the engine) and
// coding-host (a model) -- so a scripted success is never counted as autonomous performance. A run that was blocked,
// invalid, inconclusive, held by a person or never finished is excluded from a rate and counted, by why. A cost is only
// ever one a host REPORTED; the budget's estimate is never a cost. Speed and cost never outrank correctness: they are
// measured over verified outcomes alone.
//
// 0.5.0 adds, from the same facts: each row's and each model's reliability (pass@1, pass@k, median cost and minutes --
// rates.mjs), the tool-call failures per suite and per model (tools.mjs), each Orbit arm's overhead over the `none` arm,
// each sessions case's MEMORY ARMS side by side and memory's effect (B3, ADR 0054: a sessions run's facts carry its arm
// and what its second session's work came to), and `by` -- revision, model, arm, memory -- each a breakdown of its own.
// A model is counted at the effort its host was asked to run at (`config.effort`, null for the host's own default): two
// efforts of one model are two hosts, as two models are.
//
//   runFacts({ manifest, ending, report }) -> facts
//   metricsOf(runs, o = { scope, controls, k, by: [revision|model|arm|memory|language] }) -> { runs, bases,
//                     reproducibility, verifier, reliability, tools, overhead, memory, history?, revisions?, byModel?,
//                     byArm?, byMemory?, byLanguage? }
//   METRICS -> rows { id, says, over(facts) -> { numerator, denominator, excluded } }      BY_NAMES · ACTIVATION_METRICS
//
// 0.5.0 (B22 M4) adds the activation rows (ACTIVATION_METRICS): activation precision and recall, strategy, skill and agent
// selection, unnecessary delegation and the router's own accuracy over the Orbit arms; the capability families a passing
// case covers; and the outcome runs that held -- each from the judge's own facts a run's report keeps.
import { groupBy, hostOfRun, memoryOf, overheadOf, ratesOf, revisionsOf } from "./rates.mjs";
import { toolsFoldOf } from "./tools.mjs";

const UNKNOWN = "unknown";

// Why a run is left out of a rate, by the word it ended on.
const EXCLUDED = { BLOCKED: "blocked", BENCHMARK_INVALID: "invalid", INCONCLUSIVE: "inconclusive", PAUSED: "held", CANCELLED: "held" };

// What counts as an autonomous outcome VERIFIED by the run's own independent verifier, by kind of case.
const VERIFIED = { source: ["REPAIRED_VERIFIED"], engineering: ["PASS"], qa: ["PASS"], sessions: ["PASS"], activation: ["PASS"] };

// The kinds a run of which is a QA investigation judged against a ground truth: a QA run's one session, and a sessions
// run's second (0.5.0, ADR 0054).
const JUDGED_KINDS = ["qa", "sessions"];

// Who carried a run, by the host its config names: an activation run (0.5.0) is always carried by a host, whatever names it.
const hostFamily = (host) => (String(host ?? "").startsWith("scripted:") ? "scripted" : String(host ?? "").startsWith("session:") ? "session" : "coding-host");

const basisOf = (m) => (JUDGED_KINDS.includes(m.benchmark?.kind) ? (m.config?.host && m.config.host !== "coding-host" ? "scripted" : "coding-host") : m.benchmark?.kind === "activation" ? hostFamily(m.config?.host) : !m.config?.repair ? "none" : hostFamily(m.config.host));

// A sessions run's second session, as its report says it (0.5.0): its memory arm, and what its work came to -- the
// numbers a memory arm is compared on. Null for any other run.
const sessionOf = (r) => (r?.memory?.measured ? { decisions: r.memory.measured.decisions ?? null, designsRefused: r.memory.measured.designsRefused ?? null, costUsd: r.memory.measured.costUsd ?? null, minutes: r.memory.measured.minutes ?? null } : null);

const durationOf = (m, e) => ((a, b) => (Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null))(Date.parse(m.at ?? ""), Date.parse(e?.at ?? ""));

const intervenedOf = (r, e) => (e?.class === "HUMAN_APPROVAL_REQUIRED" ? true : r?.interventions ? Object.values(r.interventions).some((n) => n > 0) : null);

// What a run's report says of its host (0.5.0): every round's host -- a source run's rounds, a QA run's one round.
const roundsSaid = (r) => [...(r?.rounds ?? []), ...(r?.round ? [r.round] : [])];

const hostsSaid = (r) => roundsSaid(r).map((x) => x.host).filter(Boolean);

const knownSum = (xs) => (xs.length && xs.every((x) => typeof x === "number") ? xs.reduce((a, b) => a + b, 0) : null);

const tokenSum = (t) => ((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null))([t?.input, t?.output, t?.cacheRead, t?.cacheWrite].filter((x) => typeof x === "number"));

// The model a run's row is counted under: the one asked for, else the one its host named, else unknown; what it REPORTED
// spending -- cost, turns, tokens -- and whether a restart cut a round of it (nobody's miss, ADR 0049).
const reportedOf = (m, r) => ((hosts) => ({ modelSaid: m.config?.model ?? hosts.find((h) => h.model)?.model ?? "unknown", interrupted: roundsSaid(r).some((x) => x.interrupted === true), turns: knownSum(hosts.map((h) => h.turns)), tokens: knownSum(hosts.map((h) => tokenSum(h.tokens))), costUsd: typeof r?.totals?.costUsd === "number" ? r.totals.costUsd : knownSum(hosts.map((h) => h.costUsd)) }))(hostsSaid(r));

// One run, as the facts every metric reads.
export function runFacts({ manifest: m, ending: e, report: r }) {
  const outcome = e?.outcome ?? null;
  const kind = m.benchmark?.kind ?? "source";
  return { run: m.run, at: m.at ?? null, kind, case: m.benchmark?.case ?? null, suite: m.benchmark?.suite ?? null, caseDigest: m.benchmark?.digest ?? null, variant: m.benchmark?.variant ?? null, subject: m.subject?.digest ?? null, commit: m.source?.commit ?? null, model: m.config?.model ?? null, effort: m.config?.effort ?? null, host: m.config?.host ?? null, basis: r?.hostBasis ?? basisOf(m), outcome, excluded: !outcome ? "unfinished" : EXCLUDED[outcome] ?? null, verified: (VERIFIED[kind] ?? []).includes(outcome), autonomousAxis: r?.axes?.autonomous?.value ?? null, rounds: (r?.rounds ?? []).length, regressedRounds: (r?.rounds ?? []).filter((x) => (x.decided?.regressed ?? []).length > 0).length, evaluatedRounds: (r?.rounds ?? []).filter((x) => x.decided).length, durationMs: durationOf(m, e), intervened: intervenedOf(r, e), judged: r?.judged ?? null, task: JUDGED_KINDS.includes(kind) || kind === "activation" || m.config?.repair === true, arm: m.config?.arm ?? "release", memory: m.config?.memory ?? null, session: sessionOf(r), repeat: m.config?.repeat?.id ?? null, tools: r?.tools ?? null, language: m.activation?.language ?? null, activation: kind === "activation" ? r?.activation ?? null : null, ...reportedOf(m, r) };
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

const qa = (fs) => counted(fs).filter((f) => JUDGED_KINDS.includes(f.kind) && f.judged);

const planted = (fs) => counted(fs).filter((f) => f.kind === "source" && f.variant && f.variant !== "real");

// ---- the activation rows (0.5.0, B22 M4: the activation benchmark §8) -----------------------------------------------------
//
// Each over the activation runs that came to an ending a rate may count -- and the selection rows over the two Orbit arms
// alone (`applies`): with no plugin there is nothing to select. What each reads is the judge's own facts on the run, kept
// in its report (`activation`); a run judged before they were kept is counted nowhere.

const acts = (fs) => counted(fs).filter((f) => f.kind === "activation" && f.activation);

const orbitArms = (fs) => acts(fs).filter((f) => f.activation.applies === true);

const leftActs = (fs) => left(fs.filter((f) => f.kind === "activation"));

const actRate = (included, hit, fs) => rate(included, hit, leftActs(fs));

const families = (fs) => new Set(fs.map((f) => f.activation.capability).filter(Boolean));

const coverageOf = (fs) => ((all, passed) => ({ numerator: [...all].filter((c) => passed.has(c)).length, denominator: all.size, excluded: {} }))(families(acts(fs)), families(acts(fs).filter((f) => f.outcome === "PASS")));

export const ACTIVATION_METRICS = [
  { id: "activation_precision", says: "runs that activated Orbit where the truth says to / runs that activated it where the truth says either way (Orbit arms)", over: (fs) => actRate(orbitArms(fs).filter((f) => f.activation.activated && f.activation.activate !== null), (f) => f.activation.activate === true, fs) },
  { id: "activation_recall", says: "runs that activated Orbit where the truth says to / runs whose truth says to activate (Orbit arms)", over: (fs) => actRate(orbitArms(fs).filter((f) => f.activation.activate === true), (f) => f.activation.activated === true, fs) },
  { id: "strategy_accuracy", says: "runs whose observed strategy the truth accepts / runs whose truth names a strategy (Orbit arms)", over: (fs) => actRate(orbitArms(fs).filter((f) => f.activation.strategyNamed), (f) => f.activation.strategyRight === true, fs) },
  { id: "skill_selection_accuracy", says: "runs whose skills a selection profile accepts / runs whose truth has a skill profile (Orbit arms)", over: (fs) => actRate(orbitArms(fs).filter((f) => f.activation.skillProfile), (f) => f.activation.skillsRight === true, fs) },
  { id: "agent_selection_accuracy", says: "runs whose agents a selection profile accepts / runs whose truth has an agent profile (Orbit arms)", over: (fs) => actRate(orbitArms(fs).filter((f) => f.activation.agentProfile), (f) => f.activation.agentsRight === true, fs) },
  { id: "unnecessary_delegation", says: "runs that dispatched an agent no profile accepts, or more than its max / runs that dispatched any of Orbit's agents (Orbit arms)", over: (fs) => actRate(orbitArms(fs).filter((f) => f.activation.agentCalls > 0), (f) => f.activation.agentsRight !== true, fs) },
  { id: "router_accuracy", says: "turns whose router strategy and top selection the truth accepts / turns the router decided (release and baseline arms)", over: (fs) => actRate(orbitArms(fs).filter((f) => f.activation.router?.judged === true), (f) => f.activation.router.right === true, fs) },
  { id: "capability_coverage", says: "capability families with a passing case / the families the runs cover (model-carried; the deterministic coverage is the routing corpus's)", over: coverageOf },
  { id: "work_completion", says: "outcome runs whose hidden checks and records hold / outcome runs", over: (fs) => actRate(acts(fs).filter((f) => f.activation.outcome), (f) => f.activation.outcome.held === true && f.activation.recordsHeld !== false, fs) },
];

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
  ...ACTIVATION_METRICS,
];

const valued = (r) => ({ ...r, value: r.denominator > 0 ? Math.round((r.numerator / r.denominator) * 10000) / 10000 : UNKNOWN });

const basisMetrics = (fs) => Object.fromEntries(METRICS.map((m) => [m.id, { ...valued(m.over(fs)), says: m.says, runs: fs.length }]));

// ---- reproducibility, the verifier's own controls, and history by revision -------------------------------------------------

// Who carried a run is part of what it is: two scripted controls of one case are two hosts, as two models are -- and two
// efforts of one model.
const groupKey = (f) => [f.case, f.caseDigest, f.variant, f.subject, f.basis, f.host ?? "-", f.model ?? "-", f.effort ?? "-"].join("\u0000");

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

const basesOf = (fs) => Object.fromEntries(BASES.map((b) => [b, basisMetrics(fs.filter((f) => f.basis === b))]));

// Every metric again, one set per value of a dimension -- per model at its effort, per arm -- the bases still apart
// within each, each set named by what it is (`namedOf`).
const splitOf = (fs, keyOf, namedOf) => groupBy(fs, keyOf).sort((a, b) => String(keyOf(a[0])).localeCompare(String(keyOf(b[0])))).map((g) => ({ ...namedOf(g[0]), runs: g.length, bases: basesOf(g) }));

// What `--by` may break the runs down by (0.5.0 adds model, arm and memory): each a part of the answer of its own. A run
// with no memory arm -- one of a kind with no second session -- is counted under `none`.
const BY = {
  revision: (fs, o) => ({ history: historyOf(fs), revisions: revisionsOf(fs, o) }),
  model: (fs) => ({ byModel: splitOf(fs, hostOfRun, (f) => ({ model: f.modelSaid, effort: f.effort ?? null })) }),
  arm: (fs) => ({ byArm: splitOf(fs, (f) => f.arm, (f) => ({ arm: f.arm })) }),
  memory: (fs) => ({ byMemory: splitOf(fs, (f) => f.memory ?? "none", (f) => ({ memory: f.memory ?? "none" })) }),
  // 0.5.0 (B22 M4): an activation case's prompt is English or Vietnamese, and each is read on its own.
  language: (fs) => ({ byLanguage: splitOf(fs, (f) => f.language ?? "-", (f) => ({ language: f.language ?? null })) }),
};

export const BY_NAMES = Object.keys(BY);

const byOf = (fs, o) => Object.assign({}, ...(o.by ?? (o.byRevision ? ["revision"] : [])).map((k) => BY[k](fs, o)));

// 0.5.0: the reliability of each row and model (pass@1, pass@k, medians -- rates.mjs), the tool-call failures of B9
// (tools.mjs), and each Orbit arm's overhead over the `none` arm, beside the metrics every release had.
export function metricsOf(runs, o = {}) {
  const fs = runs.map(runFacts);
  return { scope: o.scope ?? "every run kept", runs: { total: fs.length, byBasis: countBy(fs.map((f) => f.basis)), byOutcome: countBy(fs.map((f) => f.outcome ?? "unfinished")), byArm: countBy(fs.map((f) => f.arm)), byMemory: countBy(fs.filter((f) => f.memory).map((f) => f.memory)) }, bases: basesOf(fs), reproducibility: reproducibilityOf(fs), verifier: verifierOf(o.controls ?? []), reliability: ratesOf(fs, o), tools: toolsFoldOf(fs), overhead: overheadOf(fs), memory: memoryOf(fs, o), ...byOf(fs, o) };
}
