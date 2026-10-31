// The benchmark's METRICS, folded from what run rooms kept: every metric a numerator over a denominator, `unknown`
// when nothing stands under it, runs split by host basis so a scripted success is never autonomy, the blocked and the
// invalid excluded and counted, a cost only ever one a host reported, instability found and said, history by revision.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COMMANDS } from "../benchmark/lib/commands.mjs";
import { metricsOf, METRICS, runFacts } from "../benchmark/lib/core/metrics.mjs";
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
