// The benchmark's METRICS, folded from what run rooms kept: every metric a numerator over a denominator, `unknown`
// when nothing stands under it, runs split by host basis so a scripted success is never autonomy, the blocked and the
// invalid excluded and counted, a cost only ever one a host reported, instability found and said, history by revision.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COMMANDS } from "../benchmark/lib/commands.mjs";
import { BY_NAMES, metricsOf, METRICS, runFacts } from "../benchmark/lib/core/metrics.mjs";
import { reliabilityOf } from "../benchmark/lib/core/reliability.mjs";
import { docWritten, newRunId, roomOf } from "../benchmark/lib/core/room.mjs";

let n = 0;

// One run as its room keeps it: a manifest, an ending, a report.
const run = (o = {}) => {
  n += 1;
  const at = new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();
  return {
    manifest: { run: `bnr-${String(n).padStart(12, "0")}`, at, source: { commit: o.commit ?? "a".repeat(40) }, subject: { digest: o.subject ?? "s1" }, benchmark: { suite: o.suite ?? "orbit-source", case: o.case ?? "ORBIT-SRC-002", kind: o.kind ?? "source", variant: o.variant ?? "real", digest: "c1" }, config: { repair: o.repair ?? true, host: o.host ?? null, model: o.model ?? null } },
    ending: o.outcome === undefined ? null : { outcome: o.outcome, class: o.class ?? null, at: new Date(Date.parse(at) + (o.ms ?? 60000)).toISOString() },
    report: { hostBasis: o.basis, axes: { autonomous: { value: o.autonomous ?? null } }, rounds: o.rounds ?? [], totals: { costUsd: o.cost ?? null }, interventions: o.interventions ?? null, judged: o.judged ?? null },
  };
};

const round = (regressed = []) => ({ decided: { next: "CONTINUE", regressed, improved: [] } });

const ZERO = { paused: 0, resumed: 0, cancelled: 0, approvalsAsked: 0, approvalsGranted: 0 };

test("with nothing to stand on every metric is unknown -- never 0 and never 100%", () => {
  const m = metricsOf([]);
  for (const b of ["none", "scripted", "coding-host"]) for (const x of METRICS) assert.equal(m.bases[b][x.id].value, "unknown", `${b} ${x.id}`);
  assert.equal(m.reproducibility.value, "unknown");
  assert.equal(m.verifier.value, "unknown");
});

test("runs are kept apart by who carried them: a scripted host's verified repair counts for the scripted basis alone", () => {
  const m = metricsOf([run({ host: "scripted:reference", outcome: "REPAIRED_VERIFIED", rounds: [round()], interventions: ZERO }), run({ outcome: "REPAIR_REJECTED", autonomous: false, rounds: [round()], interventions: ZERO })]);
  assert.deepEqual(m.runs.byBasis, { scripted: 1, "coding-host": 1 });
  assert.deepEqual([m.bases.scripted.self_healing_success.value, m.bases["coding-host"].self_healing_success.value], [1, 0]);
  assert.equal(m.bases["coding-host"].autonomous_task_success.value, 0);
});

test("a blocked, invalid, inconclusive or held run is excluded from a rate and counted by why; an unfinished one too", () => {
  const m = metricsOf([run({ outcome: "BLOCKED", rounds: [round()] }), run({ outcome: "BENCHMARK_INVALID" }), run({ outcome: "INCONCLUSIVE" }), run({ outcome: "PAUSED" }), run({}), run({ outcome: "REPAIRED_VERIFIED", autonomous: true, rounds: [round()], interventions: ZERO })]);
  const s = m.bases["coding-host"].autonomous_task_success;
  assert.deepEqual([s.numerator, s.denominator, s.value], [1, 1, 1]);
  assert.deepEqual(s.excluded, { blocked: 1, invalid: 1, inconclusive: 1, held: 1, unfinished: 1 });
});

test("a cost is only ever what a host reported: a verified outcome with no reported cost is left out of the mean and counted", () => {
  const m = metricsOf([run({ outcome: "REPAIRED_VERIFIED", cost: 2, rounds: [round()] }), run({ outcome: "REPAIRED_VERIFIED", cost: null, rounds: [round()] }), run({ outcome: "REPAIR_REJECTED", cost: 9, rounds: [round()] })]);
  const c = m.bases["coding-host"].cost_per_verified_usd;
  assert.deepEqual([c.numerator, c.denominator, c.value, c.excluded["cost not reported"]], [2, 1, 2, 1], "a rejected repair's cost never makes a verified one cheaper");
});

test("regressions, interventions, rounds and time are each over what they can be measured on", () => {
  const m = metricsOf([run({ outcome: "REPAIRED_VERIFIED", ms: 1000, rounds: [round(["gate:x"]), round()], interventions: { ...ZERO, paused: 1, resumed: 1 } }), run({ outcome: "REPAIR_REJECTED", rounds: [round()], interventions: null })]);
  const b = m.bases["coding-host"];
  assert.deepEqual([b.regression.numerator, b.regression.denominator], [1, 3]);
  assert.deepEqual([b.human_intervention.numerator, b.human_intervention.denominator], [1, 1], "a run whose interventions were never read is not counted as none");
  assert.deepEqual([b.avg_repair_rounds.value, b.avg_time_to_verified_ms.value], [1.5, 1000]);
  assert.equal(b.autonomous_task_success.numerator, 0, "a person paused and resumed it: it was not autonomous end to end");
});

test("detection counts a planted fault the checks caught and the planted shapes a QA found; false alarms are over defect reports", () => {
  const m = metricsOf([run({ variant: "controlled-fault", repair: false, outcome: "FAIL" }), run({ variant: "controlled-fault", repair: false, outcome: "PASS" }), run({ kind: "qa", case: "ORBIT-QA-001", host: "coding-host", repair: false, outcome: "FAIL", judged: { found: 1, planted: 2, falseAlarms: 1, unconfirmed: 0 } })]);
  assert.deepEqual([m.bases.none.defect_detection.numerator, m.bases.none.defect_detection.denominator], [1, 2]);
  const q = m.bases["coding-host"];
  assert.deepEqual([q.defect_detection.numerator, q.defect_detection.denominator, q.false_positive.numerator, q.false_positive.denominator], [1, 2, 1, 2]);
});

test("runs that should agree and do not are named as unstable, never averaged into a result", () => {
  const m = metricsOf([run({ outcome: "REPAIRED_VERIFIED", rounds: [round()] }), run({ outcome: "NO_PROGRESS", rounds: [round()] }), run({ case: "ORBIT-SRC-001", outcome: "PASS", repair: false }), run({ case: "ORBIT-SRC-001", outcome: "PASS", repair: false })]);
  assert.deepEqual([m.reproducibility.numerator, m.reproducibility.denominator], [1, 2]);
  assert.deepEqual(m.reproducibility.unstable.map((u) => [u.case, u.outcomes]), [["ORBIT-SRC-002", { REPAIRED_VERIFIED: 1, NO_PROGRESS: 1 }]]);
});

test("two scripted controls of one case are two hosts: an idle control's NO_PROGRESS never makes a reference control's PASS unstable", () => {
  const ctl = (host, outcome) => run({ case: "ORBIT-E2E-001", kind: "engineering", host, basis: "scripted", outcome, rounds: [round()] });
  const m = metricsOf([ctl("scripted:reference", "PASS"), ctl("scripted:reference", "PASS"), ctl("scripted:idle", "NO_PROGRESS"), ctl("scripted:idle", "NO_PROGRESS")]);
  assert.deepEqual([m.reproducibility.numerator, m.reproducibility.denominator, m.reproducibility.unstable], [2, 2, []]);
});

test("the facts of a run are its kept records: an older report with no host basis is read off its manifest", () => {
  assert.equal(runFacts(run({ host: "scripted:x", basis: undefined, outcome: "REPAIRED_VERIFIED" })).basis, "scripted");
  assert.equal(runFacts(run({ kind: "qa", host: "reference", repair: false, basis: undefined })).basis, "scripted", "a QA control's scripted host");
});

test("the metrics command folds the store's run rooms in scope, with the verifier's own controls and each case's history by revision", (t) => {
  const store = mkdtempSync(join(tmpdir(), "orbit-bench-metrics-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const keep = (r) => ((room) => (docWritten(room, "manifest.json", { ...r.manifest, run: room.id }), r.ending && docWritten(room, "ending.json", r.ending), docWritten(room, "report.json", r.report)))(roomOf(store, newRunId(r.manifest.run)));
  keep(run({ commit: "1".repeat(40), outcome: "FAIL", repair: false }));
  keep(run({ commit: "2".repeat(40), outcome: "PASS", repair: false }));
  keep(run({ suite: "orbit-qa", case: "ORBIT-QA-001", kind: "qa", host: "coding-host", repair: false, outcome: "PASS", judged: { found: 1, planted: 1, falseAlarms: 0, unconfirmed: 0 } }));
  const controls = roomOf(store, newRunId("controls"));
  docWritten(controls, "manifest.json", { kind: "controls", run: controls.id, at: new Date().toISOString(), benchmark: { suite: "orbit-source", case: "ORBIT-SRC-002" } });
  docWritten(controls, "controls.json", { case: "ORBIT-SRC-002", rows: [{ id: "known-good", expect: "PASS", got: "PASS", matched: true }, { id: "allow-all", expect: "FAIL", got: "PASS", matched: false }] });
  const r = COMMANDS.metrics.run({ storeRoot: store }, ["--suite=orbit-source", "--by=revision"]);
  assert.equal(r.runs.total, 2, "only the suite in scope");
  assert.deepEqual([r.verifier.numerator, r.verifier.denominator, r.verifier.missed], [1, 2, ["ORBIT-SRC-002 allow-all: expected FAIL, got PASS"]]);
  assert.deepEqual(r.history[0].commits.map((c) => [c.commit, c.outcome]), [["111111111111", "FAIL"], ["222222222222", "PASS"]]);
  assert.match(COMMANDS.metrics.say(r), /HISTORY BY REVISION/);
});

test("metrics --suite counts a control set kept before its manifest named a suite: the catalog places its case -- and another suite's case stays out", (t) => {
  const store = mkdtempSync(join(tmpdir(), "orbit-bench-sets-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const root = join(store, "checkout");
  mkdirSync(join(root, "benchmark", "suites", "orbit-source"), { recursive: true });
  writeFileSync(join(root, "benchmark", "suites", "orbit-source", "suite.json"), JSON.stringify({ schema: 1, id: "orbit-source", version: "1.0.0", title: "the source", cases: ["ORBIT-SRC-002"] }));
  const set = (benchmark) => ((room) => (docWritten(room, "manifest.json", { kind: "controls", run: room.id, at: new Date().toISOString(), benchmark }), docWritten(room, "controls.json", { case: benchmark.case, rows: [{ id: "known-good", expect: "PASS", got: "PASS", matched: true }] })))(roomOf(store, newRunId(benchmark.case)));
  set({ suite: "orbit-source", case: "ORBIT-SRC-002" });
  set({ case: "ORBIT-SRC-002" });
  set({ case: "ORBIT-QA-001" });
  assert.deepEqual(((r) => [r.verifier.numerator, r.verifier.denominator])(COMMANDS.metrics.run({ storeRoot: store, root }, ["--suite=orbit-source"])), [2, 2], "the set that names its suite, and the older one the catalog places");
  assert.equal(COMMANDS.metrics.run({ storeRoot: store }, ["--suite=orbit-source"]).verifier.denominator, 1, "with no catalog to read, only the set that names its suite");
});

// ---- 0.5.0: reliability (B2), tool-call failures (B9), arms (B23) ------------------------------------------------------

// A model-carried run: a goal on an arm, with what its host reported and the tool facts its report kept.
const goalRun = (o = {}) => ((r) => ({ ...r, manifest: { ...r.manifest, config: { ...r.manifest.config, arm: o.arm ?? "release", repeat: o.group ? { id: o.group, index: 1, of: 5 } : null, ...(o.effort ? { effort: o.effort } : {}) } }, report: { ...r.report, round: o.round ?? null, rounds: o.hostRounds ?? [], tools: o.tools ?? null } }))(run({ case: o.case ?? "ORBIT-E2E-001", suite: o.suite ?? "orbit-engineering", kind: "engineering", repair: true, model: o.model === undefined ? "claude-opus-5-5" : o.model, cost: o.cost ?? null, ms: o.ms, outcome: o.outcome, commit: o.commit, rounds: o.hostRounds }));

const hostRound = (o = {}) => ({ interrupted: o.interrupted === true, host: { model: o.model ?? null, turns: o.turns ?? null, costUsd: o.cost ?? null, tokens: { input: o.tokens ?? null, output: null, cacheRead: null, cacheWrite: null } } });

test("pass@1, pass@k and the medians of each row: its runs that came to an ending, never a restart's or a block's", () => {
  const outcomes = ["PASS", "PASS", "FAIL", "PASS", "FAIL"];
  const runs = [...outcomes.map((outcome, i) => goalRun({ outcome, cost: i + 1, ms: (i + 1) * 60000, group: "rpt-000000000001" })), goalRun({ outcome: "BLOCKED" }), goalRun({ outcome: "PASS", hostRounds: [hostRound({ interrupted: true })] })];
  const row = metricsOf(runs, { k: 3 }).reliability.rows[0];
  assert.deepEqual([row.case, row.arm, row.basis, row.model, row.runs, row.passed, row.excluded], ["ORBIT-E2E-001", "release", "coding-host", "claude-opus-5-5", 5, 3, { blocked: 1, interrupted: 1 }]);
  assert.deepEqual([row.pass1, row.passK], [0.6, { k: 3, value: 1 }], "1 - C(2,3)/C(5,3): any three of these five hold a pass");
  assert.deepEqual([row.medianCostUsd, row.costReported, row.costPerVerifiedUsd, row.medianMinutes], [3, 5, 2.3333, 3]);
  assert.deepEqual(metricsOf(runs, { k: 6 }).reliability.rows[0].passK, { k: 6, value: "unknown" }, "five runs say nothing about six");
});

test("each model is its own row, and its rate pools its rows; a model nobody named or reported is unknown, never another's", () => {
  const runs = [goalRun({ outcome: "PASS" }), goalRun({ outcome: "FAIL", model: "claude-sonnet-5" }), goalRun({ outcome: "PASS", model: null, round: hostRound({ model: "claude-haiku-5" }) }), goalRun({ outcome: "PASS", model: null })];
  const models = metricsOf(runs).reliability.models.map((m) => [m.model, m.runs, m.pass1]);
  assert.deepEqual(models, [["claude-haiku-5", 1, 1], ["claude-opus-5-5", 1, 1], ["claude-sonnet-5", 1, 0], ["unknown", 1, 1]], "the model asked for, else the one the host named");
});

test("--by=model and --by=arm break every metric down, the bases still apart; --by=revision gives the rates of each revision", () => {
  const runs = [goalRun({ outcome: "PASS", commit: "1".repeat(40) }), goalRun({ outcome: "FAIL", arm: "none", commit: "1".repeat(40) }), goalRun({ outcome: "PASS", model: "claude-sonnet-5", commit: "2".repeat(40) })];
  const m = metricsOf(runs, { by: ["model", "arm", "revision"] });
  assert.deepEqual(m.byModel.map((g) => [g.model, g.runs]), [["claude-opus-5-5", 2], ["claude-sonnet-5", 1]]);
  assert.deepEqual(m.byArm.map((g) => [g.arm, g.runs, g.bases["coding-host"].autonomous_task_success.denominator]), [["none", 1, 1], ["release", 2, 2]]);
  assert.deepEqual(m.revisions.map((x) => [x.commit, x.rows.length]), [["111111111111", 2], ["222222222222", 1]]);
  assert.deepEqual([m.runs.byArm, BY_NAMES], [{ release: 2, none: 1 }, ["revision", "model", "arm"]]);
});

// 0.5.0: the owner's decision runs model-carried rows at an effort (`--effort`); a model at two efforts is two hosts.
test("a model at two efforts is two hosts: its rows, its model row, its tool calls, its arms, its overhead and its groups are kept apart", () => {
  const sonnet = (effort, outcome, o = {}) => goalRun({ outcome, model: "claude-sonnet-5-5", effort, tools: TOOLS(), ...o });
  const runs = [sonnet("medium", "PASS"), sonnet("medium", "FAIL"), sonnet("high", "PASS"), sonnet(undefined, "PASS"), sonnet("medium", "PASS", { arm: "none" })];
  const m = metricsOf(runs, { by: ["model"] });
  const releaseRows = m.reliability.rows.filter((r) => r.arm === "release");
  assert.deepEqual(releaseRows.map((r) => [r.model, r.effort, r.runs, r.pass1]), [["claude-sonnet-5-5", null, 1, 1], ["claude-sonnet-5-5", "high", 1, 1], ["claude-sonnet-5-5", "medium", 2, 0.5]], "never one rate over two efforts");
  assert.deepEqual(m.reliability.models.map((x) => [x.model, x.effort, x.runs]), [["claude-sonnet-5-5", null, 1], ["claude-sonnet-5-5", "high", 1], ["claude-sonnet-5-5", "medium", 3]]);
  assert.deepEqual(m.byModel.map((g) => [g.model, g.effort, g.runs]), [["claude-sonnet-5-5", null, 1], ["claude-sonnet-5-5", "high", 1], ["claude-sonnet-5-5", "medium", 3]]);
  assert.deepEqual(Object.keys(m.tools["coding-host"].models), ["claude-sonnet-5-5", "claude-sonnet-5-5@high", "claude-sonnet-5-5@medium"]);
  assert.deepEqual(m.overhead.map((o) => [o.arm, o.effort]), [["release", "medium"]], "the none arm beside the release arm at the same effort only");
  assert.match(COMMANDS.metrics.say({ ...m, store: "-" }), /claude-sonnet-5-5@medium \(3 run\(s\)\)/);
  const groups = metricsOf([sonnet("medium", "PASS", { case: "ORBIT-E2E-002" }), sonnet("high", "FAIL", { case: "ORBIT-E2E-002" })]).reproducibility;
  assert.deepEqual([groups.denominator, groups.unstable], [0, []], "two efforts are never one group whose outcomes disagree");
});

test("the reliability document keeps each row's and each model's effort, and compares arms only at one effort", () => {
  const sonnet = (arm, effort, outcome) => goalRun({ arm, outcome, model: "claude-sonnet-5-5", effort, hostRounds: [hostRound({ cost: 1 })], cost: 1 });
  const r = COMMANDS.reliability.say(reliabilityOf([sonnet("none", "medium", "PASS"), sonnet("release", "medium", "PASS"), sonnet("release", "high", "FAIL")]));
  const doc = reliabilityOf([sonnet("none", "medium", "PASS"), sonnet("release", "medium", "PASS"), sonnet("release", "high", "FAIL")]);
  assert.deepEqual(doc.arms.rows.map((x) => [x.effort, Object.keys(x.arms).sort()]), [["medium", ["none", "release"]]]);
  assert.deepEqual(doc.rates.rows.map((x) => x.effort).sort(), ["high", "medium", "medium"]);
  assert.match(r, /\(coding-host, claude-sonnet-5-5@medium\): none pass@1 1\/1/);
});

test("orbit_overhead: an Orbit arm's median REPORTED cost, turns and tokens minus the none arm's on the same case -- unknown where a side reported none", () => {
  const armed = (arm, cost, turns, tokens) => goalRun({ arm, outcome: "PASS", hostRounds: [hostRound({ cost, turns, tokens })], cost });
  const o = metricsOf([armed("none", 1, 10, 1000), armed("none", 3, 30, 3000), armed("release", 4, 40, 9000), armed("baseline", null, 20, 2000)]).overhead;
  const release = o.find((x) => x.arm === "release");
  assert.deepEqual([release.case, release.noneSide.runs, release.overhead], ["ORBIT-E2E-001", 2, { costUsd: 2, turns: 20, tokens: 7000 }]);
  assert.deepEqual(o.find((x) => x.arm === "baseline").overhead, { costUsd: "unknown", turns: 0, tokens: 0 });
  assert.deepEqual(metricsOf([armed("release", 1, 1, 1)]).overhead, [], "no none arm, nothing to compare");
});

const TOOLS = (o = {}) => ({ schema: 1, basis: "HOST_OBSERVED", calls: { calls: 10, failed: o.failed ?? 2, unanswered: 0, byTool: { Bash: { calls: 6, failed: o.failed ?? 2, unanswered: 0 }, Read: { calls: 4, failed: 0, unanswered: 0 } } }, recovery: { failed: o.failed ?? 2, episodes: 1, recovered: 1, turns: 3, tokens: 30, costUsd: 0.1, costBasis: "APPORTIONED" }, relay: o.relay ?? null, sandbox: { by: "host", steps: { "sandbox-prepare": { by: "host", attempts: 2, failures: 1, unsettled: 0, classes: { RESTORE_FAILED: 1 }, calls: { counted: 1, total: 4, unknown: 0 }, gotPast: 1, stopped: 0, endedBlocked: 0 } }, failures: [] }, unknown: o.unknown ?? {} });

test("tool-call failures fold per host basis, per suite and per model: per tool, per relay subcommand, per PASS, and per sandbox step", () => {
  const relay = { context: { requests: 3, refused: { HELP: 1 }, nonZero: 0, errors: 0 } };
  const runs = [goalRun({ outcome: "PASS", tools: TOOLS() }), goalRun({ outcome: "FAIL", tools: TOOLS({ failed: 4, relay }) }), goalRun({ outcome: "PASS" })];
  const f = metricsOf(runs).tools["coding-host"];
  const s = f.suites["orbit-engineering"];
  assert.deepEqual([f.runs, f.unread, s.unread], [2, 1, 1], "a report from before 0.5.0 is unread, never zero");
  assert.deepEqual([s.calls.calls, s.calls.failed, s.calls.rate, s.calls.byTool.Bash], [20, 6, 0.3, { calls: 12, failed: 6, rate: 0.5 }]);
  assert.deepEqual(s.failedPerPass, { numerator: 2, denominator: 1, value: 2 }, "the failed calls of the runs that passed, per PASS");
  assert.deepEqual([s.recovery.episodes, s.recovery.turnsPerEpisode.value, s.recovery.runsRecovered.value], [2, 3, 0.5]);
  assert.deepEqual(s.relay.context, { requests: 3, refused: { HELP: 1 }, nonZero: 0, errors: 0 });
  assert.deepEqual(((p) => [p.attempts, p.failures, p.rate, p.classes, p.callsAfter.value])(s.sandbox.steps["sandbox-prepare"]), [4, 2, 0.5, { RESTORE_FAILED: 2 }, 4]);
  assert.deepEqual(Object.keys(f.models), ["claude-opus-5-5"]);
});

test("runs that hit a failed call and still passed are over the runs a rate may count: a blocked, unfinished or interrupted run is neither a recovery nor a miss", () => {
  const runs = [goalRun({ outcome: "PASS", tools: TOOLS() }), goalRun({ outcome: "BLOCKED", tools: TOOLS() }), goalRun({ tools: TOOLS() }), goalRun({ outcome: "FAIL", tools: TOOLS(), hostRounds: [hostRound({ interrupted: true })] })];
  const r = metricsOf(runs).tools["coding-host"].suites["orbit-engineering"].recovery;
  assert.deepEqual(r.runsRecovered, { numerator: 1, denominator: 1, value: 1 }, "the one run that came to an ending, and passed");
  assert.equal(r.episodes, 4, "the calls themselves still count, whoever's run they were in");
});

test("the reliability command folds the kept rooms of one revision into one document -- rates, tool calls, arms -- and writes nothing", (t) => {
  const store = mkdtempSync(join(tmpdir(), "orbit-bench-reliability-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const keep = (r) => ((room) => (docWritten(room, "manifest.json", { ...r.manifest, run: room.id }), r.ending && docWritten(room, "ending.json", r.ending), docWritten(room, "report.json", r.report)))(roomOf(store, newRunId(r.manifest.run)));
  for (const r of [goalRun({ outcome: "PASS", commit: "c".repeat(40), arm: "none", hostRounds: [hostRound({ cost: 1 })], cost: 1 }), goalRun({ outcome: "PASS", commit: "c".repeat(40), hostRounds: [hostRound({ cost: 2 })], cost: 2, tools: TOOLS() }), goalRun({ outcome: "FAIL", commit: "d".repeat(40) })]) keep(r);
  const before = readdirSync(store, { recursive: true }).length;
  const r = COMMANDS.reliability.run({ storeRoot: store }, ["--revision=cccc", "--k=2"]);
  assert.deepEqual([r.kind, r.schema, r.runs.total, r.runs.byArm, r.scope.revision, r.scope.k], ["orbit.benchmark.reliability/v1", 1, 2, { none: 1, release: 1 }, "cccc", 2]);
  assert.deepEqual(r.arms.rows[0].arms.release.pass1, 1);
  assert.deepEqual(r.arms.overhead[0].overhead.costUsd, 1);
  assert.equal(r.tools["coding-host"].suites["orbit-engineering"].calls.failed, 2);
  assert.match(COMMANDS.reliability.say(r), /pass@1 1 over 1/);
  assert.equal(readdirSync(store, { recursive: true }).length, before, "it writes nothing");
  assert.throws(() => COMMANDS.reliability.run({ storeRoot: store }, ["--revision=HEAD~1"]), /--revision is a commit id/);
  assert.throws(() => COMMANDS.metrics.run({ storeRoot: store }, ["--by=colour"]), /--by is any of revision, model, arm/);
  assert.throws(() => COMMANDS.metrics.run({ storeRoot: store }, ["--k=0"]), /--k is 1\.\.10/);
});
