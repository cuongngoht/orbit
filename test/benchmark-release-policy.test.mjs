// The release policy as shipped (skills/orbit-release/ship/policy.json, ADR 0049, 0051) held to the benchmark's own
// suites, both ways: the catalog it names case by case, the rows a cycle runs from it, and the rows it records.
//
// These tests read benchmark/suites/, so they live under the benchmark harness's own name (HARNESS in
// benchmark/lib/core/freeze.mjs strips `test/benchmark-*.mjs` with `benchmark/**`): a subject the benchmark freezes --
// `doctor --preflight`'s, a round's -- never carries a test about files it does not hold, and in this repository they
// run in full. What the policy says on its own (its host, its protected paths, its limits) and the release artifact are
// test/release-ship-policy.test.mjs, which needs no harness.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { catalogDrift, policyOf, rowsOf } from "../skills/orbit-release/ship/policy.mjs";

const ROOT = join(import.meta.dirname, "..");
const POLICY = policyOf(readFileSync(join(ROOT, "skills", "orbit-release", "ship", "policy.json"), "utf8"));
const SUITES = join(ROOT, "benchmark", "suites");

// The suites as `run.mjs list --json` says them, read from their own files here.
const listed = () => ({ suites: readdirSync(SUITES).map((s) => JSON.parse(readFileSync(join(SUITES, s, "suite.json"), "utf8"))).map((s) => ({ id: s.id, cases: s.cases.map((id) => ({ id, kind: JSON.parse(readFileSync(join(SUITES, s.id, id.toLowerCase(), "case.json"), "utf8")).kind })) })) });

test("the policy names every case of every suite, and nothing else -- the catalog cannot shrink unseen", () => {
  assert.deepEqual(catalogDrift(POLICY, listed()), []);
  assert.equal(Object.keys(POLICY.catalog).length, 12, "twelve suites");
  assert.equal(Object.values(POLICY.catalog).flat().length, 71, "every case they hold");
  const less = { suites: listed().suites.map((s) => ({ ...s, cases: s.cases.filter((c) => c.id !== "ORBIT-SRC-002") })) };
  assert.deepEqual(catalogDrift(POLICY, less), ["ORBIT-SRC-002 is in the release policy and no suite holds it"]);
  const more = { suites: [...listed().suites, { id: "orbit-new", cases: [{ id: "ORBIT-NEW-001", kind: "source" }] }] };
  assert.deepEqual(catalogDrift(POLICY, more), ["ORBIT-NEW-001 is in suite orbit-new and the release policy does not name it"]);
});

test("a cycle runs every verification, then every control, then 38 rows the real Claude Code carries", () => {
  const rows = rowsOf(POLICY, listed());
  const auto = rows.filter((r) => r.autonomous);
  assert.equal(rows.length, 34 * 2 + 7 * 2 + 8 * 2 + 3 * 2 + 18 * 2 + 1 * 2 + 1);
  assert.equal(auto.length, 38, "seven QA cases, eight engineering cases, three sessions cases, eighteen activation cases, one workflow case, and ORBIT-SRC-001's planted fault repaired");
  assert.deepEqual([...new Set(rows.map((r) => r.run))], ["verify", "controls", "autonomous"], "in that order, so no model is spent on a cycle that will be repaired");
  assert.deepEqual(auto.find((r) => r.case === "ORBIT-SRC-001"), { ...auto.find((r) => r.case === "ORBIT-SRC-001"), variant: "controlled-fault", repair: true, expect: ["REPAIRED_VERIFIED"] });
  assert.ok(rows.filter((r) => r.case === "ORBIT-SRC-002" || r.case === "ORBIT-ORC-006").some((r) => r.req === "real" && r.expect.includes("PASS")), "a known finding must PASS its real source: its baseline earns it nothing");
});

// 0.5.0 (backlog B3, ADR 0054; B22 M4; B1, ADR 0053): the sessions, the activation and the workflow suites' model-carried
// rows start recorded, as every new suite's do; their controls are required from the day they land, as every suite's are.
test("the shipped policy records the sessions, the activation and the workflow suites' model-carried rows and nothing else: every other row of the 71 cases is required (ADR 0051, 0053, 0054)", () => {
  const rows = rowsOf(POLICY, listed());
  const NEW = ["orbit-sessions", "orbit-activation", "orbit-workflow"];
  assert.deepEqual([POLICY.recorded.suites, POLICY.recorded.cases], [NEW, []]);
  assert.deepEqual(rows.filter((r) => r.recorded).map((r) => r.id), [...POLICY.catalog["orbit-sessions"], ...POLICY.catalog["orbit-activation"], ...POLICY.catalog["orbit-workflow"]].map((c) => `${c}:autonomous`), "a new suite's model-carried rows start recorded");
  assert.ok(rows.filter((r) => NEW.includes(r.suite) && r.run === "controls").every((r) => r.recorded === false), "their controls are required");
  assert.ok(rows.filter((r) => !NEW.includes(r.suite)).every((r) => r.recorded === false), "every other row says it is required");
  assert.ok(rows.filter((r) => r.suite === "orbit-sessions" && r.autonomous).every((r) => r.variant === null && r.kind === "sessions" && r.expect.join() === "PASS"), "a sessions case plants its own variant, and its second session must PASS to be recorded held");
});

test("the memory-first source cases are required like every source case: their real source must PASS and their controls hold", () => {
  const rows = rowsOf(POLICY, listed()).filter((r) => ["ORBIT-MEM-007", "ORBIT-MEM-008", "ORBIT-MEM-009"].includes(r.case));
  assert.deepEqual(rows.map((r) => `${r.id}:${r.recorded}`).sort(), ["ORBIT-MEM-007:controls:false", "ORBIT-MEM-007:real:false", "ORBIT-MEM-008:controls:false", "ORBIT-MEM-008:real:false", "ORBIT-MEM-009:controls:false", "ORBIT-MEM-009:real:false"]);
});

test("an activation case must hold its controls, and its model-carried row PASS on its real target, on the release arm", () => {
  const rows = rowsOf(POLICY, listed()).filter((r) => r.kind === "activation");
  assert.equal(rows.length, 36);
  assert.deepEqual([...new Set(rows.map((r) => `${r.req}:${r.run}:${r.variant}:${JSON.stringify(r.expect)}`))].sort(), ['autonomous:autonomous:real:["PASS"]', "controls:controls:null:null"]);
});

// 0.5.0 (B1, ADR 0053): a workflow case is required to hold its controls -- the reference through /orbit-help, and the
// code-only, bypass and idle hosts it must refuse -- and its coding host's row, recorded, must PASS on its real target.
test("a workflow case must hold its controls, and its model-carried row PASS on its real target, recorded", () => {
  const rows = rowsOf(POLICY, listed()).filter((r) => r.kind === "workflow");
  assert.equal(rows.length, POLICY.catalog["orbit-workflow"].length * 2);
  assert.deepEqual([...new Set(rows.map((r) => `${r.req}:${r.run}:${r.variant}:${JSON.stringify(r.expect)}:${r.recorded}`))].sort(), ['autonomous:autonomous:real:["PASS"]:true', "controls:controls:null:null:false"]);
});

test("`recorded` marks a suite's or a case's model-carried rows, never its controls; a name the catalog does not hold is refused", () => {
  const rows = rowsOf(policyOf(JSON.stringify({ ...POLICY, recorded: { suites: ["orbit-qa"], cases: ["ORBIT-E2E-001", "ORBIT-SRC-001"] } })), listed());
  const recorded = rows.filter((r) => r.recorded).map((r) => r.id).sort();
  assert.deepEqual(recorded, [...POLICY.catalog["orbit-qa"].map((c) => `${c}:autonomous`), "ORBIT-E2E-001:autonomous", "ORBIT-SRC-001:self-healing"].sort(), "a suite's model-carried rows, a case's, an extra row's");
  assert.ok(rows.filter((r) => ["ORBIT-QA-001", "ORBIT-E2E-001", "ORBIT-SRC-001"].includes(r.case) && r.run !== "autonomous").every((r) => !r.recorded), "its controls and verifications stay required");
  assert.equal(rows.length, rowsOf(POLICY, listed()).length, "recording a row runs it all the same");
  assert.throws(() => policyOf(JSON.stringify({ ...POLICY, recorded: { suites: ["orbit-nope"], cases: [] } })), /recorded rows naming only suites and cases the catalog holds/);
  assert.throws(() => policyOf(JSON.stringify({ ...POLICY, recorded: { suites: [], cases: ["ORBIT-NOPE-001"] } })), /recorded rows naming only/);
});
