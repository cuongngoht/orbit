// The tables of AUTONOMOUS SELF-IMPROVEMENT (0.3.0, ADR 0045), each held on its own: what a run shows, when evidence is
// enough, what a cause is, what a candidate may never change, how two versions compare, what promotes, what a
// regression is, what a lesson says, what a metric divides by -- and the one write door and the store under them.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { effectiveOf } from "../src/automation/settings.mjs";
import { analyse, ELIGIBILITY_IDS } from "../src/improvement/detect.mjs";
import { DIAGNOSIS, diagnosisOf } from "../src/improvement/diagnose.mjs";
import { aggregateOf, metricsOf, UNKNOWN, verdictOf } from "../src/improvement/evaluation.mjs";
import { decisionOf, gatesOf, GATE_IDS } from "../src/improvement/gates.mjs";
import { findingOf } from "../src/improvement/learning.mjs";
import { METRIC_IDS, qualityOf } from "../src/improvement/metrics.mjs";
import { modelOf, PHASES, phaseOf } from "../src/improvement/model.mjs";
import { observationOf } from "../src/improvement/monitor.mjs";
import { record, start } from "../src/improvement/ops.mjs";
import { oracleOf, weakenings } from "../src/improvement/oracle.mjs";
import { safetyOf, suppressionKey } from "../src/improvement/safety.mjs";
import { groupsOf, independent, signalOf } from "../src/improvement/signals.mjs";
import { createImprovement } from "../src/improvement/store.mjs";
import { CAUSES, SIGNALS, STAGE_MODES, STAGE_OPERATIONS } from "../src/improvement/vocab.mjs";
import { MODE_NAMES } from "../satellite/src/execution/modes.mjs";
import { OPERATION_NAMES } from "../satellite/src/permissions/operations.mjs";
import { realIo } from "../src/store/io.mjs";

const PIN = "release-x:0.1.0:aaaaaaaa";
const values = (improvement = {}) => effectiveOf([{ by: "machine", content: { improvement } }]).values;

const step = (id, word, extra = {}) => ({ id, word, required: true, retries: 0, providers: ["managed:corp"], ...extra });
const run = (n, { day = 1, host = "laptop-a", session = null, word = "FAILED", steps = [step("evidence", "CONTRACT_MET"), step("notes", "VERIFY_FAILED")], pin = PIN } = {}) => ({ task: `tsk-${String(n).padStart(12, "0")}`, run: `srun-${n}`, pin, word, at: `2026-10-0${day}T10:0${n % 10}:00.000Z`, session, host, steps });

function room(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-improvement-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- signals and independence ------------------------------------------------------------------------------------

test("a run's signal is its owner's word: a contract the definition declares is the definition's, a provider, a person or the environment never is", () => {
  assert.equal(signalOf(run(1)).signal, "contract-violation");
  assert.deepEqual(signalOf(run(1)).steps, ["notes"]);
  assert.equal(signalOf(run(2, { steps: [step("evidence", "FAILED")] })).signal, "provider-failure");
  assert.equal(signalOf(run(3, { word: "BLOCKED", steps: [step("evidence", "BLOCKED", { block: "TIMEOUT" })] })).signal, "environment-blocked");
  assert.equal(signalOf(run(4, { word: "BLOCKED", steps: [step("evidence", "BLOCKED", { block: "APPROVAL_REQUIRED" })] })).signal, "approval-wait");
  assert.equal(signalOf(run(5, { word: "BLOCKED", steps: [step("evidence", "BLOCKED", { block: "INPUT_MISSING" })] })).signal, "input-missing");
  assert.equal(signalOf(run(6, { word: "REPORTED", steps: [step("evidence", "CONTRACT_MET")] })).signal, "answered");
  assert.equal(signalOf(run(7, { word: "VERIFIED", steps: [step("evidence", "VERIFIED", { retries: 2 })] })).signal, "excessive-retries");
  assert.equal(signalOf(run(8, { word: "RUNNING", steps: [step("evidence", "RUNNING")] })).signal, null, "a run still open says nothing yet");
  assert.equal(signalOf({ kind: "satellite", outcome: "insufficient", rolePin: "rol-x:1.0.0:aaaaaaaa", signature: "abc" }).signal, "unverified-outcome");
  assert.equal(signalOf({ kind: "satellite", outcome: "violated", rolePin: "rol-x:1.0.0:aaaaaaaa" }).signal, "environment-blocked");
  assert.ok(SIGNALS.every((s) => s.healthy || s.category), "every problem signal has a category");
});

test("independence: retries in one session are one session; two host sessions are two; a run with no host session is its machine's UTC day", () => {
  assert.equal(independent([run(1), run(2), run(3)]), 1, "three runs one sitting");
  assert.equal(independent([run(1), run(2, { day: 2 })]), 2);
  assert.equal(independent([run(1, { session: "a" }), run(2, { session: "b" })]), 2);
  assert.equal(independent([run(1, { session: "a" }), run(2)]), 1, "a real session and the synthetic one of its machine and day are the same sitting");
  assert.equal(independent([run(1, { host: "laptop-a" }), run(2, { host: "laptop-b" })]), 2);
});

// ---- detection --------------------------------------------------------------------------------------------------

const detected = (records, v = values(), extra = {}) => analyse({ groups: groupsOf(records), kept: [], campaigns: [], values: v, now: "2026-10-09T00:00:00.000Z", ...extra });

test("one failure is never a recurring problem, and retries in one session never make one", () => {
  assert.equal(detected([run(1)]).opportunities[0].check, "TOO_FEW_RUNS");
  assert.equal(detected([run(1), run(2), run(3)]).opportunities[0].check, "TOO_FEW_SESSIONS");
  const ok = detected([run(1), run(2), run(3, { day: 2 })]);
  assert.deepEqual([ok.opportunities.length, ok.eligible.length, ok.opportunities[0].check], [1, 1, "ELIGIBLE"]);
});

test("the same problem is ONE opportunity by its fingerprint, updated in place and rewritten only when its evidence moved", () => {
  const first = detected([run(1), run(2), run(3, { day: 2 })]);
  const again = analyse({ groups: groupsOf([run(1), run(2), run(3, { day: 2 })]), kept: first.opportunities, campaigns: [], values: values(), now: "2026-10-10T00:00:00.000Z" });
  assert.equal(again.opportunities[0].id, first.opportunities[0].id);
  assert.deepEqual(again.changed, [], "nothing moved: nothing is rewritten");
  const more = analyse({ groups: groupsOf([run(1), run(2), run(3, { day: 2 }), run(4, { day: 3 })]), kept: first.opportunities, campaigns: [], values: values(), now: "2026-10-10T00:00:00.000Z" });
  assert.equal(more.changed.length, 1);
  assert.equal(more.changed[0].firstSeen, first.opportunities[0].firstSeen, "first seen is carried, never reset");
});

test("an environment, a provider or a person's approval is recorded and never starts a campaign; a contradicted problem never does either", () => {
  const env = (n, day) => run(n, { day, word: "BLOCKED", steps: [step("evidence", "BLOCKED", { block: "TIMEOUT" })] });
  const o = detected([env(1, 1), env(2, 1), env(3, 2)]).opportunities[0];
  assert.deepEqual([o.category, o.eligible, o.check, o.cause], ["environment", false, "NOT_A_DEFINITION_DEFECT", "environment"]);
  const healthy = (n, day) => run(n, { day, word: "REPORTED", steps: [step("evidence", "CONTRACT_MET"), step("notes", "CONTRACT_MET")] });
  const mixed = detected([run(1), run(2), run(3, { day: 2 }), healthy(4, 3), healthy(5, 4)]).opportunities[0];
  assert.deepEqual([mixed.against, mixed.check], [2, "CONTRADICTED"]);
  assert.equal(diagnosisOf({ ...mixed, subject: mixed.subject }, values()).cause, "flaky", "conflicting evidence lowers confidence");
});

test("a person's switch, an open campaign, a cooldown and a subject's budget each hold an opportunity back", () => {
  const records = [run(1), run(2), run(3, { day: 2 })];
  assert.equal(detected(records, values({ detect: false })).opportunities[0].check, "DETECTION_OFF");
  const campaigns = [{ id: "imp-aaaaaaaaaaaa", subjectKind: "skill", subjectId: "release-x", terminal: false }];
  assert.equal(detected(records, values(), { campaigns }).opportunities[0].check, "CAMPAIGN_OPEN");
  const ended = [{ id: "imp-aaaaaaaaaaaa", subjectKind: "skill", subjectId: "release-x", terminal: true, endedAt: "2026-10-08T23:00:00.000Z", startedAt: "2026-10-08T00:00:00.000Z", generated: 0 }];
  assert.equal(detected(records, values(), { campaigns: ended }).opportunities[0].check, "COOLING_DOWN");
  const spent = [1, 2].map((n) => ({ id: `imp-${String(n).repeat(12)}`, subjectKind: "skill", subjectId: "release-x", terminal: true, endedAt: "2026-09-01T00:00:00.000Z", startedAt: "2026-10-01T00:00:00.000Z", generated: 1 }));
  assert.equal(detected(records, values(), { campaigns: spent }).opportunities[0].check, "SUBJECT_CAP");
  assert.equal(ELIGIBILITY_IDS.length, 8);
});

// ---- diagnosis ---------------------------------------------------------------------------------------------------

test("a cause is a table over what the evidence shows; only the definition's own declaration, with high confidence, gets a candidate", () => {
  const o = { subject: { kind: "skill", id: "release-x" }, pin: PIN, signal: "contract-violation", category: "definition", signature: ["notes"], providers: ["managed:corp"], runs: 4, sessions: 2, against: 0, evidence: [] };
  const d = diagnosisOf(o, values());
  assert.deepEqual([d.cause, d.confidence, d.candidate], ["definition", "high", true]);
  assert.match(d.hypothesis, /declares an output contract on notes/);
  assert.equal(diagnosisOf({ ...o, providers: ["managed:a", "managed:b"] }, values()).candidate, false, "two providers: the answer's shape may be theirs");
  assert.equal(diagnosisOf({ ...o, category: "provider", signal: "provider-failure" }, values()).cause, "provider");
  assert.ok(d.unknowns.some((u) => /tokens/.test(u)), "cost stays unknown, and says so");
  assert.equal(DIAGNOSIS.at(-1).when({}), true);
  assert.deepEqual(CAUSES.filter((c) => c.candidate).map((c) => c.id), ["definition"]);
});

// ---- the oracle and the candidate's safety -------------------------------------------------------------------------

const wf = (notes = {}) => ({ steps: [{ id: "evidence", required: true, outputs: { count: { type: "number", path: "count" } }, success: [{ output: "count", op: "gte", value: 1 }] }, { id: "notes", required: true, evidence: "owner-record", approval: "owner", outputs: { hits: { type: "count", path: "hits" } }, success: [{ output: "hits", op: "gte", value: 1 }], ...notes }] });

test("a candidate may change where a step reads an answer, never what counts as a pass", () => {
  const p = oracleOf("workflow", wf());
  assert.deepEqual(weakenings(p, oracleOf("workflow", wf({ outputs: { hits: { type: "count", path: "elsewhere" } } }))), [], "a path is not an acceptance rule");
  const ids = (n) => weakenings(p, oracleOf("workflow", wf(n))).map((x) => x.id);
  assert.deepEqual(ids({ success: [{ output: "hits", op: "gte", value: 0 }] }), ["RULE_LOOSENED"]);
  assert.deepEqual(ids({ success: [{ output: "hits", op: "gte", value: 2 }] }), [], "a stricter rule is no weakening");
  assert.deepEqual(ids({ success: [] }), ["RULE_REMOVED"]);
  assert.deepEqual(ids({ required: false }), ["REQUIRED_DROPPED"]);
  assert.deepEqual(ids({ evidence: "report" }), ["EVIDENCE_WEAKENED"]);
  assert.deepEqual(ids({ approval: "none" }), ["APPROVAL_DROPPED"]);
  assert.deepEqual(ids({ outputs: { hits: { type: "number", path: "hits" } } }), ["OUTPUT_RETYPED"]);
  assert.deepEqual(weakenings(p, oracleOf("workflow", { steps: [wf().steps[1]] })).map((x) => x.id), ["REQUIRED_DROPPED"], "a required step gone");
});

const facts = (over = {}) => ({ pin: PIN, digest: "d0", intact: true, provides: ["a.b"], tools: ["Read"], files: ["SKILL.md", "manifest.json"], successorOf: null, oracle: oracleOf("workflow", wf()), ...over });

test("a candidate is untrusted until every rule holds: digest, change, parent, provides, tools, files, oracle, suppression, its owner's contract", () => {
  const c = (cand, extra = {}) => safetyOf({ parent: facts(), candidate: facts({ digest: "d1", successorOf: PIN, ...cand }), ownerFindings: [], suppressed: [], ...extra }).map((f) => f.id);
  assert.deepEqual(c({}), []);
  assert.deepEqual(c({ intact: false }), ["CAND_DIGEST"]);
  assert.deepEqual(c({ digest: "d0" }), ["CAND_UNCHANGED"]);
  assert.deepEqual(c({ successorOf: "other:0.1.0:bbbbbbbb" }), ["CAND_PARENT"]);
  assert.deepEqual(c({ provides: ["a.c"] }), ["CAND_PROVIDES"]);
  assert.deepEqual(c({ tools: ["Read", "Bash"] }), ["CAND_TOOLS_WIDENED"], "a candidate never grants itself authority");
  assert.deepEqual(c({ files: ["SKILL.md", "run.sh"] }), ["CAND_EXECUTABLE"]);
  assert.deepEqual(c({ oracle: oracleOf("workflow", wf({ success: [] })) }), ["CAND_ORACLE_WEAKENED"]);
  assert.deepEqual(c({}, { suppressed: [suppressionKey(PIN, "d1")] }), ["CAND_SUPPRESSED"]);
  assert.deepEqual(c({}, { ownerFindings: ["SF_INJECTION"] }), ["CAND_OWNER_REFUSED"], "prompt injection is the owner's to refuse, and refused it stays");
});

// ---- comparing two versions --------------------------------------------------------------------------------------

const row = (side, n, met, extra = {}) => ({ side, n, met, failing: met ? [] : ["notes"], blocked: false, retries: 0, calls: 2, ms: 10, attribution: "RUNTIME_BOUND", evidence: met ? "CONTRACT_MET" : "NONE", ...extra });
const ev = (rows, extra = {}) => ({ evaluation: "ev1", runs: rows, session: "s1", host: "h", at: "2026-10-09T00:00:00.000Z", ...extra });

test("one evaluation: blocked compares nothing, a newly failed step is WORSE whatever else improved, a failure that did not reproduce is INCONCLUSIVE", () => {
  assert.equal(verdictOf(ev([row("baseline", 1, false), row("candidate", 1, true)])).verdict, "BETTER");
  assert.equal(verdictOf(ev([row("baseline", 1, false, { blocked: true }), row("candidate", 1, true)])).verdict, "BLOCKED");
  assert.equal(verdictOf(ev([row("baseline", 1, true), row("candidate", 1, false, { failing: ["evidence"] })])).verdict, "WORSE");
  assert.deepEqual(verdictOf(ev([row("baseline", 1, false), row("candidate", 1, false, { failing: ["notes", "evidence"] })])).regressions, ["evidence"]);
  assert.equal(verdictOf(ev([row("baseline", 1, true), row("candidate", 1, true, { calls: 1 })])).verdict, "INCONCLUSIVE", "speed never buys a verdict on a failure that did not reproduce");
  assert.equal(verdictOf(ev([row("baseline", 1, false), row("candidate", 1, false)])).verdict, "EQUIVALENT");
  assert.equal(verdictOf(ev([])).verdict, "INCONCLUSIVE", "missing verification is inconclusive, never a pass");
});

test("every ratio carries its numerator and denominator, and what is not observable stays unknown", () => {
  const m = metricsOf(ev([row("baseline", 1, false), row("candidate", 1, true, { calls: 1, ms: null })]));
  assert.deepEqual([m.baseline.met, m.candidate.met, m.delta.calls], [0, 1, -1]);
  assert.equal(m.candidate.ms, null, "a run with no time makes the side's time unknown, never a guess");
  assert.equal(m.delta.ms, null);
  assert.ok(m.ratios.every((r) => "numerator" in r && "denominator" in r));
  assert.deepEqual(m.unknown.map((u) => u.id), UNKNOWN.map((u) => u.id));
  assert.ok(m.unknown.some((u) => u.id === "tokens"));
});

test("together: one WORSE rejects, BETTER needs independent sessions with none saying otherwise", () => {
  const settled = (verdict, session) => ({ ...ev([], { session }), settled: { verdict } });
  assert.equal(aggregateOf([settled("BETTER", "a")], values()).verdict, "INCONCLUSIVE");
  assert.equal(aggregateOf([settled("BETTER", "a"), settled("BETTER", "a")], values()).verdict, "INCONCLUSIVE", "twice in one session is once");
  assert.equal(aggregateOf([settled("BETTER", "a"), settled("BETTER", "b")], values()).verdict, "BETTER");
  assert.equal(aggregateOf([settled("BETTER", "a"), settled("BETTER", "b"), settled("WORSE", "c")], values()).verdict, "WORSE");
  assert.equal(aggregateOf([settled("BETTER", "a"), settled("EQUIVALENT", "b")], values()).verdict, "INCONCLUSIVE", "mixed evidence decides nothing");
  assert.equal(aggregateOf([settled("BETTER", "a"), settled("BETTER", "b")], values({ minSessions: 3 })).verdict, "INCONCLUSIVE");
});

// ---- the promotion gates ----------------------------------------------------------------------------------------

const gateFacts = (over = {}) => ({ m: { meta: { pin: PIN, subjectId: "release-x" }, candidate: { digest: "d1" } }, aggregate: { verdict: "BETTER", sessions: 2 }, open: false, candidate: { intact: true, digest: "d1" }, validation: { ok: true, findings: [] }, current: { pin: PIN, status: "active" }, weakened: [], widened: [], runs: [row("candidate", 1, true)], regressions: [], values: values(), door: "improvement", revisionOk: true, ...over });

test("every gate is asked, in order, and the first that fails decides what happens instead", () => {
  assert.deepEqual(decisionOf(gatesOf(gateFacts())).decision, "promote");
  const d = (over) => decisionOf(gatesOf(gateFacts(over)));
  assert.deepEqual([d({ candidate: { intact: false } }).gate, d({ candidate: { intact: false } }).decision], ["CANDIDATE_INTACT", "reject"]);
  assert.equal(d({ current: { pin: "release-x:0.1.2:cccccccc", status: "active" } }).decision, "supersede", "a moved baseline makes the comparison stale");
  assert.equal(d({ runs: [row("candidate", 1, true, { attribution: "REPORTED" })] }).gate, "EVIDENCE_INDEPENDENT", "a run only reported never promotes anything");
  assert.equal(d({ widened: ["Bash"] }).gate, "NO_NEW_PERMISSIONS");
  assert.equal(d({ current: { pin: PIN, status: "disabled" } }).decision, "block");
  assert.equal(d({ values: values({ promote: false }) }).decision, "await");
  assert.equal(d({ values: values({ promote: false }), door: "control" }).decision, "promote", "a person in Control promotes what qualified");
  assert.equal(GATE_IDS.length, 12);
});

// ---- monitoring --------------------------------------------------------------------------------------------------

test("after promotion: the definition's own failure in independent sessions is a regression; an environment is a confounder; a few runs are nothing", () => {
  const ok = (n, day) => run(n, { day, word: "REPORTED", steps: [step("notes", "CONTRACT_MET")] });
  const env = (n, day) => run(n, { day, word: "BLOCKED", steps: [step("notes", "BLOCKED", { block: "TIMEOUT" })] });
  assert.equal(observationOf({ records: [run(1), run(2, { day: 2 })], values: values() }).word, "REGRESSED");
  assert.equal(observationOf({ records: [run(1), run(2)], values: values() }).word, "INSUFFICIENT", "one session's failure is no regression");
  assert.equal(observationOf({ records: [env(1, 1), env(2, 2), env(3, 3), ok(4, 3)], values: values() }).word, "CONFOUNDED");
  assert.equal(observationOf({ records: [ok(1, 1), ok(2, 2), ok(3, 2)], values: values() }).word, "STABLE");
});

// ---- the fold, the door, the store --------------------------------------------------------------------------------

const opp = { id: "opp-0123456789abcdef", fingerprint: "f".repeat(64), subject: { kind: "skill", id: "release-x" }, pin: PIN, signal: "contract-violation", category: "definition", signature: ["notes"], runs: 4, sessions: 2, against: 0, evidence: ["skillrun:tsk-000000000001/srun-1"], tasks: ["tsk-000000000001"], attribution: { bound: 4, of: 4, words: ["RUNTIME_BOUND"] } };

const ctxOf = (store, door = "improvement") => ({ store, door, session: "s", host: "laptop-a", pid: 1, now: () => "2026-10-09T00:00:00.000Z" });

test("the one write door: a terminal writes nothing, a line out of phase is refused, a replayed event is written once, a person's stale read is refused", (t) => {
  const store = createImprovement(room(t), realIo());
  assert.throws(() => start(ctxOf(store, null), opp), (e) => e.code === "IMP_DOOR");
  const { campaign } = start(ctxOf(store), opp);
  assert.equal(start(ctxOf(store), opp).created, false, "one open campaign per subject");
  assert.throws(() => record(ctxOf(store, "terminal"), campaign, "diagnosed", { cause: "definition" }), (e) => e.code === "IMP_DOOR");
  assert.throws(() => record(ctxOf(store), campaign, "promoted", { from: PIN, to: PIN }), (e) => e.code === "IMP_PHASE", "a promotion that skipped every step is refused");
  const line = { evaluation: "ev1", eid: "x:1" };
  assert.throws(() => record(ctxOf(store), campaign, "evaluation-run", line), (e) => e.code === "IMP_PHASE");
  record(ctxOf(store), campaign, "diagnosed", { cause: "definition", confidence: "high" });
  const revision = modelOf(store.read(campaign)).position;
  record(ctxOf(store), campaign, "proposed", { strategy: "successor" });
  assert.throws(() => record(ctxOf(store, "control"), campaign, "blocked", { stop: "PROMOTION_WITHHELD" }, { expected: revision }), (e) => e.code === "STALE_REVISION");
  assert.throws(() => record(ctxOf(store), campaign, "ended", { outcome: "insufficient-evidence", because: "x".repeat(241) }), (e) => e.code === "IMP_TEXT", "refused, never cut");
  record(ctxOf(store), campaign, "ended", { outcome: "insufficient-evidence", because: "nothing to say" });
  assert.throws(() => record(ctxOf(store), campaign, "diagnosed", { cause: "definition" }), (e) => e.code === "IMP_ENDED");
  record(ctxOf(store), campaign, "learned", { kept: false, because: "one session" });
  assert.throws(() => record(ctxOf(store), campaign, "learned", { kept: false }), (e) => e.code === "IMP_PHASE", "taught once");
});

test("a replayed event is folded once, whatever moved since", (t) => {
  const store = createImprovement(room(t), realIo());
  const { campaign } = start(ctxOf(store), opp);
  for (const [k, f] of [["diagnosed", {}], ["proposed", {}], ["generating", {}], ["generated", { pin: "release-x:0.1.1:bbbbbbbb", digest: "d1" }], ["validated", {}], ["evaluation-started", { evaluation: "ev1", eid: "e:start" }]]) record(ctxOf(store), campaign, k, f);
  const a = record(ctxOf(store), campaign, "evaluation-run", { evaluation: "ev1", side: "baseline", n: 1, met: false, eid: "e:b1" });
  const b = record(ctxOf(store), campaign, "evaluation-run", { evaluation: "ev1", side: "baseline", n: 1, met: false, eid: "e:b1" });
  assert.deepEqual([a.duplicate, b.duplicate], [false, true]);
  assert.equal(modelOf(store.read(campaign)).evaluations[0].runs.length, 1);
});

test("the store: reads create nothing, another project's campaign is unknown, a damaged line is counted and never rewritten, an unreadable opportunity is kept byte for byte, a secret never reaches the disk", (t) => {
  const a = room(t);
  const b = room(t);
  const store = createImprovement(a, realIo());
  assert.deepEqual([store.list(), store.opportunities(), store.analysed()], [[], [], null]);
  assert.deepEqual(readdirSync(a), [], "a read creates no directory");
  const { campaign } = start(ctxOf(store), opp);
  assert.equal(createImprovement(b, realIo()).read(campaign), null, "another project's store has no such campaign");
  const secret = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123";
  record(ctxOf(store), campaign, "blocked", { stop: "SUBJECT_WITHHELD", needs: "person", because: `it answered Bearer ${secret} once` });
  const file = store.journalFile(campaign);
  assert.equal(readFileSync(file, "utf8").includes(secret), false, "masked by shape on the way to the disk");
  writeFileSync(file, `${readFileSync(file, "utf8")}{not json\n`);
  assert.equal(store.damaged(campaign), 1);
  assert.equal(modelOf(store.read(campaign)).position, 2, "the damaged line is dropped on read");
  store.saveOpportunity(opp);
  const oppFile = join(store.paths.opportunities, `${opp.id}.json`);
  writeFileSync(oppFile, "{ corrupt");
  assert.deepEqual(store.opportunities(), [{ id: opp.id, unreadable: "corrupt" }]);
  assert.throws(() => store.saveOpportunity(opp), (e) => e.code === "IMP_INVALID");
  assert.equal(readFileSync(oppFile, "utf8"), "{ corrupt", "kept exactly as it was");
});

// ---- phases, lessons, metrics -----------------------------------------------------------------------------------

test("every phase is reachable in order and the last always answers; an ended campaign reads as its outcome's phase", () => {
  assert.equal(PHASES.at(-1).when({}), true);
  assert.equal(phaseOf(modelOf([{ kind: "started", subjectId: "x" }])), "DETECTED");
  assert.equal(phaseOf(modelOf([{ kind: "started" }, { kind: "ended", outcome: "regression-detected" }])), "ROLLED_BACK");
  assert.equal(phaseOf(modelOf([{ kind: "started" }, { kind: "ended", outcome: "improvement-verified" }])), "COMPLETED");
  assert.equal(phaseOf(modelOf([{ kind: "started" }, { kind: "diagnosed" }, { kind: "blocked", stop: "SUBJECT_WITHHELD" }])), "BLOCKED");
});

test("a lesson rests on independent sessions: an improvement supported in two and contradicted in two is never validated", () => {
  const lines = [{ kind: "started", subjectKind: "skill", subjectId: "release-x", pin: PIN, signal: "contract-violation", signature: ["notes"], sessions: 2, runs: 4, against: 0, at: "2026-10-01T00:00:00.000Z" }, { kind: "generated", pin: "release-x:0.1.1:bbbbbbbb", digest: "d1" }, { kind: "evaluation-started", evaluation: "ev1", session: "a", at: "2026-10-02T00:00:00.000Z" }, { kind: "evaluation-settled", evaluation: "ev1", verdict: "BETTER" }, { kind: "evaluation-started", evaluation: "ev2", session: "b", at: "2026-10-03T00:00:00.000Z" }, { kind: "evaluation-settled", evaluation: "ev2", verdict: "BETTER" }, { kind: "regression", sessions: 2 }, { kind: "ended", outcome: "regression-detected", at: "2026-10-05T00:00:00.000Z" }];
  const f = findingOf(modelOf(lines));
  assert.deepEqual([f.kind, f.family, f.about, f.key, f.for, f.against], ["saw", "improvement", "release-x", "release-x:0.1.1:bbbbbbbb", 2, 2]);
  assert.equal(findingOf(modelOf(lines.slice(0, 6))), null, "a campaign that has not ended teaches nothing");
});

test("nine metrics, real denominators: nothing to divide is unknown, and promotion safety counts what passed no gate", () => {
  const q = qualityOf({ campaigns: [], opportunities: [] });
  assert.deepEqual(q.map((m) => m.id), METRIC_IDS);
  assert.ok(q.filter((m) => m.unit === "ratio").every((m) => m.value === null));
  const unsafe = modelOf([{ kind: "started", subjectId: "x" }, { kind: "promoted", door: "improvement", from: "a", to: "b" }]);
  assert.equal(qualityOf({ campaigns: [unsafe], opportunities: [] }).find((m) => m.id === "promotion-safety").value, 1, "a promotion no gate held is counted, never hidden");
});

test("each stage names a Satellite mode and an operation kind that exist", () => {
  assert.deepEqual(Object.values(STAGE_MODES).filter((m) => !MODE_NAMES.includes(m)), []);
  assert.deepEqual(Object.values(STAGE_OPERATIONS).filter((o) => !OPERATION_NAMES.includes(o)), []);
});
