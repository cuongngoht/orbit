// Coverage, the four state axes, risk selection, change impact and what the
// lessons are allowed to suggest.
//
// Everything here is a pure function over injected data: no browser, no
// database, no ledger on disk. What is being tested is arithmetic that a release
// gets signed off on, so each test is about a way the arithmetic could flatter
// itself.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { caseDigest } from "../src/dsl/digest.mjs";
import { loadCases } from "../src/dsl/load.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { capabilitiesOf } from "../src/qa/capability.mjs";
import { coverageModel, traceRows } from "../src/qa/coverage.mjs";
import { impactOf } from "../src/qa/impact.mjs";
import { findPlan } from "../src/qa/load.mjs";
import { ranked, scoreOf, select } from "../src/qa/risk.mjs";
import { buildOf, executionOf, freshnessOf } from "../src/qa/states.mjs";
import { suggestionsFrom } from "../src/qa/suggest.mjs";
import { coverageView } from "../src/report/coverage.mjs";
import { UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));
const cases = new Map(loadCases(join(UI_TESTS, "screens")).map((c) => [c.id, c]));
const PLANS = join(UI_TESTS, "screens");
const plan = () => findPlan(PLANS, "things");

// Each run carries the digest of the case it ran, as a 1.7.0 run does, so a
// test that means "a fresh PASS" is not quietly about a run too old to say.
const digestOf = (id) => (cases.has(id) ? caseDigest(cases.get(id)) : null);
const RUNS = [
  { case: "create-thing", status: "PASS", at: "2026-09-19T09:00:00.000Z", host: "laptop-c", fe_commit: "abc1234", env: "test", case_digest: digestOf("create-thing"), proved: { ui: 2, api: 1, sql: 1 }, evidence: "/e/create-thing" },
  { case: "resubmit-thing", status: "SKIP", at: "2026-09-19T09:10:00.000Z", host: "laptop-c", fe_commit: "abc1234", env: "test", case_digest: digestOf("resubmit-thing") },
  { case: "archive-thing", status: "BLOCKED", at: "2026-09-19T09:20:00.000Z", host: "laptop-c", fe_commit: "abc1234", env: "test", case_digest: digestOf("archive-thing") },
];

const world = (over = {}) => ({ cases, graph, caps: capabilitiesOf({ sql: { command: ["sqlcmd"] } }), runs: RUNS, head: "abc1234", env: "test", digestOf, validate: () => [], ...over });

const model = (over = {}, p = plan()) => coverageModel(p, world(over), world(over));
const stageOf = (m, id) => m.scenarios.find((s) => s.id === id).stage;

test("exactly one runner status raises verified coverage", () => {
  const m = model();
  assert.equal(stageOf(m, "S1"), "verified", "a fresh PASS is the only thing that does");
  assert.equal(stageOf(m, "S3"), "executed", "SKIP ran and verified nothing");
  assert.equal(stageOf(m, "S4"), "executed", "BLOCKED is not a defect and not a verification either");
  assert.equal(stageOf(m, "S2"), "blocked");
});

test("no runner outcome but PASS gets a scenario past `executed`", () => {
  for (const status of ["SKIP", "PARTIAL", "FAIL", "REFUSED", "BLOCKED", "INCONCLUSIVE"]) {
    const m = model({ runs: [{ ...RUNS[0], status }] });
    assert.equal(stageOf(m, "S1"), "executed", `${status} must not verify anything`);
  }
});

// The sentence a release turns on: this PASS was about something else.
test("evidence recorded against another revision, build or environment does not count", () => {
  const before = model({ runs: [{ ...RUNS[0], at: "2026-09-01T09:00:00.000Z" }] });
  assert.equal(stageOf(before, "S1"), "executed", "a PASS from before the plan revision is history");
  const otherBuild = model({ runs: [{ ...RUNS[0], fe_commit: "def5678" }], head: "abc1234" });
  assert.equal(stageOf(otherBuild, "S1"), "executed");
  const otherEnv = model({ runs: [{ ...RUNS[0], env: "acceptance" }] });
  assert.equal(stageOf(otherEnv, "S1"), "executed");
  assert.equal(before.unknown[0].state, "stale", "and it is listed, with which reference went stale");
});

test("what cannot be told is unknown, and unknown never reads as fresh", () => {
  const noRefs = freshnessOf({ case: "x", status: "PASS" }, { id: "p" }, {});
  assert.equal(noRefs.state, "unknown");
  assert.deepEqual(noRefs.refs.map((r) => r.state), ["unknown", "unknown", "unknown", "unknown"]);
  assert.equal(freshnessOf(null, plan(), world()).state, "unknown", "no run at all is unknown, not stale");
  const all = freshnessOf(RUNS[0], plan(), world());
  assert.equal(all.state, "fresh");
});

test("a ratio carries its denominator, and an empty scope is never 100%", () => {
  const m = model();
  const verified = m.ratios.find((r) => r.name === "criteria verified");
  assert.deepEqual([verified.n, verified.of, verified.pct], [1, 5, 20]);
  assert.ok(verified.scope.length > 10, "and says what it was taken over");
  const empty = coverageModel({ schema: 1, id: "e", title: "e", criteria: [], scenarios: [] }, world(), world());
  assert.deepEqual(empty.ratios.map((r) => r.pct), [null, null, null], "a plan with no criteria has not covered all of them");
  assert.equal(coverageView(empty).ratios[0].pct, "—", "and the page says so rather than rounding");
});

test("a blocked scenario stays in scope; an excluded one is shown, not netted off", () => {
  const m = model();
  assert.equal(m.scope, 4, "blocked counts — the work is still owed");
  assert.deepEqual(m.excluded.map((x) => x.id), ["X1"]);
  const deferred = { ...plan(), scenarios: plan().scenarios.map((s) => (s.id === "S4" ? { ...s, readiness: "deferred" } : s)) };
  const dm = coverageModel(deferred, world(), world());
  assert.equal(dm.scope, 3, "deferring takes it out of the denominator...");
  assert.ok(dm.excluded.some((x) => x.id === "S4"), "...and puts it on the list of what was dropped");
});

test("a capability gap is reported with its reason and keeps the scenario unverified", () => {
  const m = model();
  const layers = m.gaps.filter((g) => g.scenario === "S4").map((g) => g.layer).sort();
  assert.deepEqual(layers, ["api", "sql"]);
  assert.ok(m.gaps.every((g) => g.because.length > 10), "a gap with no reason shows as nothing");
  const passing = model({ runs: [{ ...RUNS[2], status: "PASS" }] });
  assert.equal(stageOf(passing, "S4"), "executed", "the case passed on the screen; nothing below it witnessed the change");
  assert.match(passing.scenarios.find((s) => s.id === "S4").why, /a screen can show a write that never happened/);
});

test("coverage is what a scenario DECLARES it covers, never guessed from a case name", () => {
  const m = model();
  const ac4 = m.criteria.find((c) => c.id === "AC4");
  assert.deepEqual(ac4.scenarios, ["S4"]);
  assert.deepEqual(m.criteria.find((c) => c.id === "AC5").checks, ["M1"], "a manual check covers a criterion too");
  assert.equal(m.criteria.find((c) => c.id === "AC1").state, "verified");
  assert.equal(ac4.state, "covered", "covered is not verified");
});

test("the chain runs criterion -> scenario -> case -> run -> evidence", () => {
  const rows = traceRows(model());
  const first = rows.find((r) => r.criterion === "AC1");
  assert.equal(first.scenario, "S1");
  assert.deepEqual(first.runs.map((r) => [r.case, r.status, r.fresh]), [["create-thing", "PASS", "fresh"]]);
  assert.equal(first.runs[0].evidence, "/e/create-thing");
  assert.equal(first.verified, true);
  assert.ok(rows.some((r) => r.criterion === "AC5" && r.stage === "manual"), "a criterion handed to a person is in the chain too");
});

// The build axis is a claim about a file, and the claim is checked.
test("build state is read off disk, never believed from the link", () => {
  const s = { id: "S", cases: [{ id: "create-thing", state: "validated" }] };
  assert.equal(buildOf(s, world()).state, "validated");
  assert.equal(buildOf(s, world({ validate: () => ["it does not validate"] })).state, "written", "a link cannot promote a case that has findings");
  assert.equal(buildOf({ id: "S", cases: [{ id: "nope", state: "dry-run" }] }, world()).state, "planned");
  assert.equal(buildOf({ id: "S" }, world()).state, "planned");
});

test("a scenario is only executed when every case it links ran, and verified when every one verified", () => {
  const two = { id: "S", cases: [{ id: "create-thing" }, { id: "resubmit-thing" }] };
  const e = executionOf(two, world());
  assert.equal(e.ran, true);
  assert.equal(e.verified, false, "one of them only SKIPped");
  assert.equal(e.status, "SKIP", "the least reassuring verdict is the one that counts");
});

test("a risk score says what it was NOT told", () => {
  const s = scoreOf({ impact: 5, likelihood: 4 });
  assert.deepEqual([s.total, s.of, s.band], [9, 10, "P1"]);
  assert.deepEqual(s.missing, ["usage", "blast", "history"], "a score that hid this would be precise about data nobody supplied");
  const none = scoreOf(undefined);
  assert.equal(none.band, null, "nothing scored is not a band");
  assert.equal(none.of, 0);
});

test("selection fills a budget in a stated order and reports what it leaves", () => {
  const ss = plan().scenarios;
  assert.deepEqual(ranked(ss).map((s) => s.id), ["S1", "S3", "S2", "S4"], "must, then priority, then score, then id");
  const picked = select(ss, { profile: "smoke", minutes: 10 });
  assert.deepEqual(picked.chosen.map((s) => s.id), ["S1", "S3"]);
  assert.deepEqual(picked.residual.left.map((s) => s.id), ["S2", "S4"], "what a profile leaves out is risk too");
  assert.match(picked.residual.left[0].why, /not in this profile/);
});

test("a budget too small for its musts is a shortfall, never a quiet demotion", () => {
  const picked = select(plan().scenarios, { profile: "smoke", minutes: 6 });
  assert.deepEqual(picked.shortfall.map((s) => s.id), ["S1", "S3"]);
  assert.deepEqual(picked.chosen.map((s) => s.id), ["S1", "S3"], "they stay chosen — the decision is a person's");
  assert.equal(picked.spent, 9);
});

test("a scenario with no estimate is offered, never assumed free", () => {
  const picked = select([{ id: "S1", priority: "P1" }, { id: "S2", priority: "P1", estimate: { minutes: 3 } }], { minutes: 5 });
  assert.deepEqual(picked.chosen.map((s) => s.id), ["S2"]);
  assert.deepEqual(picked.unknown.map((s) => s.id), ["S1"]);
  assert.match(picked.residual.left.find((s) => s.id === "S1").why, /no estimate/);
});

// A commit moving is not evidence that a scenario is wrong.
test("change impact separates what it can demonstrate from what it suspects", () => {
  const found = impactOf(plan(), world(), { ...world(), revisions: { REQ1: "4" }, changed: ["dlg-thing/Save"] });
  const req = found.sources.find((s) => s.id === "REQ1");
  assert.equal(req.confidence, "certain");
  assert.equal(req.changed, true);
  assert.equal(found.sources.find((s) => s.id === "SRC1").confidence, "unknown", "nothing was supplied to compare it against");
  assert.equal(found.map.confidence, "possible");
  assert.deepEqual(found.touched.map((t) => t.id).sort(), ["S1", "S3"]);
  assert.ok(found.touched.every((t) => t.confidence === "possible"));
});

test("impact names the runs that no longer cover this revision, and the ones it cannot date", () => {
  const aged = world({ runs: [{ ...RUNS[0], at: "2026-01-01T00:00:00.000Z" }] });
  const found = impactOf(plan(), aged, aged);
  const one = found.rerun.find((r) => r.case === "create-thing");
  assert.equal(one.state, "stale");
  assert.equal(one.confidence, "certain");
  assert.ok(found.rerun.some((r) => r.case === "archive-thing" && r.confidence === "unknown"), "a case with no run is unknown, not stale");
});

const LESSONS = [
  { id: "saw--failures--case-create-thing--step-2", family: "failures", about: "case:create-thing", state: "validated", sessions: 3, statement: "create-thing stops at step 2", because: "3 independent sessions on 2 machines" },
  { id: "saw--drift--home-add", family: "drift", about: "home/Add", state: "candidate", sessions: 2, statement: "home/Add moved", because: "2 sessions" },
  { id: "gone", family: "failures", about: "case:create-thing", state: "rejected", sessions: 9, statement: "x", because: "y" },
];

test("a lesson suggests, with its provenance, and never rewrites a requirement", () => {
  const found = suggestionsFrom(LESSONS, plan());
  assert.deepEqual(found.map((s) => s.kind), ["regression scenario", "re-read the map"]);
  assert.equal(found[0].source, "saw--failures--case-create-thing--step-2");
  assert.equal(found[0].confidence, "validated");
  assert.equal(found[0].sessions, 3);
  assert.deepEqual(found[0].scenarios, ["S1"], "matched through the same key vocabulary the notes use");
  assert.ok(!found.some((s) => /criteri|acceptance/i.test(s.says)), "no recipe can propose a change to what the feature must do");
  assert.ok(!found.some((s) => s.source === "gone"), "a rejected lesson suggests nothing");
});

test("the forbidden changes cannot come out of a suggestion", () => {
  const sneaky = [{ id: "x", family: "failures", about: "case:create-thing", state: "validated", sessions: 2, statement: "s", because: "b" }];
  const found = suggestionsFrom(sneaky, plan());
  for (const s of found) assert.ok(!/raise the timeout|add a retry|remove the assert/i.test(s.says));
  assert.equal(found.length, 1);
});
