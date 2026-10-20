// The 1.7.0 baseline audit of plan coverage, one test per row of
// docs/audit/1.7.0-baseline.md. Written first and run against the unmodified
// model; the recorded failures are in that document.
//
// The runs here carry the digest of the case they ran -- the sha of the case as
// written, which is what a 1.7.0 run records -- so each test isolates ONE rule
// rather than passing because some other reference happened to be unknown.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { asWritten, caseDigest } from "../src/dsl/digest.mjs";
import { loadCases } from "../src/dsl/load.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { sha } from "../src/hash.mjs";
import { capabilitiesOf } from "../src/qa/capability.mjs";
import { coverageModel, traceRows } from "../src/qa/coverage.mjs";
import { findPlan } from "../src/qa/load.mjs";
import { coverageView } from "../src/report/coverage.mjs";
import { UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));
const cases = new Map(loadCases(join(UI_TESTS, "screens")).map((c) => [c.id, c]));
const plan = () => findPlan(join(UI_TESTS, "screens"), "things");

// The case as written: every key the loader did not add. Phase 0 wrote this
// mirror of the contract before src/dsl/digest.mjs existed; the test below
// holds the engine's digest to it.
const digestOf = (c) => sha(JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => !k.startsWith("_")))));

const ran = (id, status, more = {}) => ({ case: id, status, at: "2026-09-19T09:00:00.000Z", host: "laptop-c", fe_commit: "abc1234", env: "test", case_digest: digestOf(cases.get(id)), ...more });
const RUNS = [ran("create-thing", "PASS"), ran("resubmit-thing", "SKIP"), ran("archive-thing", "BLOCKED")];

const world = (over = {}) => ({ cases, graph, caps: capabilitiesOf({ sql: { command: ["sqlcmd"] } }), runs: RUNS, head: "abc1234", env: "test", digestOf: (id) => (cases.has(id) ? caseDigest(cases.get(id)) : null), validate: () => [], ...over });
const model = (over = {}, p = plan()) => coverageModel(p, world(over), world(over));
const stageOf = (m, id) => m.scenarios.find((s) => s.id === id).stage;


// ---------------------------------------------------------------------- A04
test("A04: a trace row is verified exactly when its scenario is — a fresh PASS beside a fresh FAIL is neither", () => {
  const p = plan();
  p.scenarios.find((s) => s.id === "S1").cases = [{ id: "create-thing", state: "validated" }, { id: "resubmit-thing", state: "validated" }];
  const runs = [ran("create-thing", "PASS"), ran("resubmit-thing", "FAIL")];
  const m = model({ runs }, p);
  assert.equal(stageOf(m, "S1"), "executed");
  for (const r of traceRows(m)) assert.equal(r.verified, m.scenarios.find((s) => s.id === r.scenario)?.stage === "verified", `${r.criterion}/${r.scenario || r.name}`);
  assert.ok(coverageView(m).trace.filter((r) => r.scenario === "S1").every((r) => r.rowClass === "broke"), "and the page does not paint it green");
});

// ---------------------------------------------------------------------- A05
test("A05: a PASS stops verifying the moment the case it ran no longer validates", () => {
  const m = model({ validate: (c) => (c.id === "create-thing" ? ["create-thing: no longer parses"] : []) });
  assert.notEqual(stageOf(m, "S1"), "verified");
});

test("A05: a PASS of an earlier version of the case is not evidence for this one", () => {
  const runs = [ran("create-thing", "PASS", { case_digest: "0".repeat(64) }), ...RUNS.slice(1)];
  const m = model({ runs });
  assert.notEqual(stageOf(m, "S1"), "verified");
  assert.ok(m.unknown.some((u) => u.case === "create-thing" && u.state === "stale"), "and it is listed with the reference that went stale");
});

// ---------------------------------------------------------------------- C06
test("C06: a scenario whose own manual check is still todo is not verified", () => {
  const p = plan();
  p.scenarios.find((s) => s.id === "S1").checks = ["M1"];
  assert.notEqual(stageOf(model({}, p), "S1"), "verified");
});

test("C06: a criterion that a todo manual check covers is not verified", () => {
  const p = plan();
  p.manual[0].covers = ["AC1"];
  assert.notEqual(model({}, p).criteria.find((c) => c.id === "AC1").state, "verified");
});

test("C06 control: a done manual check does not stop a scenario verifying", () => {
  const p = plan();
  p.scenarios.find((s) => s.id === "S1").checks = ["M1"];
  p.manual[0].state = "done";
  assert.equal(stageOf(model({}, p), "S1"), "verified");
});

// ------------------------------------------------------------ the digest itself
test("the engine's case digest is the sha of the case as written, and ignores where it was found", () => {
  const c = cases.get("create-thing");
  assert.equal(caseDigest(c), digestOf(c));
  assert.equal(caseDigest({ ...c, _file: "/elsewhere/create-thing.json" }), caseDigest(c), "a case moved to another folder is the same case");
  assert.notEqual(caseDigest({ ...c, name: `${c.name}!` }), caseDigest(c), "one edited is not");
  assert.deepEqual(Object.keys(asWritten(c)).filter((k) => k.startsWith("_")), []);
});

test("a PASS recorded before runs carried a digest reads unknown, never fresh — it counts again once the case runs again", () => {
  const { case_digest: _, ...legacy } = ran("create-thing", "PASS");
  const m = model({ runs: [legacy, ...RUNS.slice(1)] });
  assert.notEqual(stageOf(m, "S1"), "verified");
  assert.ok(m.unknown.some((u) => u.case === "create-thing" && u.state === "unknown" && u.refs.some((r) => r.name === "case")));
});
