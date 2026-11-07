// THE MISSION CASES (0.5.0, backlog B4, ADR 0055), without Docker: every case of `orbit-missions` loads and is held to
// its kind, its hidden checks hold to their own reference model over its fixture and discriminate every control, and
// each control's scripted host is played over the REAL Orbit and Satellite commands -- `satellite mission start`,
// analyze, plan, staff and dispatch, each run carried as the agent its envelope names with every hook Claude Code
// delivers, the engineering task Satellite started driven through its own loop -- on the case's own target, then read
// back by the real inspection (`inspect.mjs --mission`, outside any container) and judged by the real record rows. The
// reference holds every leg; half the change holds every record and fails the hidden checks; a claim no owner's record
// backs fails on the code and the criteria; a reader's agent that edits and runs a command fails on the privilege; an
// idle host leaves nothing to hold.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { SCRIPTS, stateOf } from "../benchmark/images/runner/scripted.mjs";
import { fixtureEntries, variantEntries } from "../benchmark/lib/core/context.mjs";
import { failedLegs, legsOf } from "../benchmark/lib/core/legs.mjs";
import { candidateEntries, candidateFile } from "../benchmark/lib/core/mutations.mjs";
import { jsonAt } from "../benchmark/lib/core/runner.mjs";
import { caseFindings, casesOf, MISSION_CONTROLS, MISSION_LEGS } from "../benchmark/lib/core/suites.mjs";
import { recordsOf } from "../benchmark/lib/source/flow.mjs";
import { shaBytes } from "../src/hash.mjs";
import { createProcess } from "../src/process/index.mjs";
import { GIT_ENV, ownTest, probed, ROOT } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

const npmHere = () => createProcess({ timeoutMs: 30000 }).run("npm", ["--version"], { env: sealed() }).ok;

const NO_NPM = !npmHere() && "npm is not runnable here: the fixture's declared check is an npm script";

const CASES = casesOf(ROOT, "orbit-missions");

const caseNamed = (id) => CASES.find((c) => c.id === id);

// A case as its case.json holds it: what loading it added (its directory, its suite) taken off again.
const raw = ({ dir, suite, ...c }) => c;

// ---- every case, held to its kind ---------------------------------------------------------------------------------

test("every mission case loads, is held to its kind, and carries the four controls its checks are proved with, each that must FAIL naming the legs it fails on", () => {
  assert.deepEqual(CASES.map((c) => c.id), ["ORBIT-MSN-001", "ORBIT-MSN-002"]);
  for (const c of CASES) {
    assert.deepEqual([c.kind, c.baseline, c.measures.expects], ["mission", "FAIL", "change"], c.id);
    assert.deepEqual(caseFindings(raw(c), c.dir), [], c.id);
    assert.ok(MISSION_CONTROLS.every(([script, expect]) => c.repairs.some((r) => r.script === script && r.expect === expect)), `${c.id} carries every control`);
    assert.ok(c.repairs.filter((r) => r.expect === "FAIL").every((r) => r.legs.length && r.legs.every((leg) => MISSION_LEGS.includes(leg))), c.id);
  }
});

test("the kind refuses a case that cannot prove its checks: a control it needs left out, a FAIL control naming no leg, a PASS control naming one, a goal to refuse, a script it does not know", () => {
  const c = caseNamed("ORBIT-MSN-001");
  const findings = (over) => caseFindings({ ...raw(c), ...over }, c.dir).join("; ");
  assert.match(findings({ repairs: c.repairs.filter((r) => r.script !== "claims") }), /lacks a control its checks are proved with: claims FAIL/);
  assert.match(findings({ repairs: c.repairs.filter((r) => r.script !== "over-reach") }), /lacks a control its checks are proved with: over-reach FAIL/);
  assert.match(findings({ repairs: c.repairs.map((r) => (r.id === "claims" ? { ...r, legs: undefined } : r)) }), /controls that must FAIL say which legs they fail on: claims/);
  assert.match(findings({ repairs: c.repairs.map((r) => (r.id === "reference" ? { ...r, legs: ["code"] } : r)) }), /a control that must PASS fails on no leg: reference/);
  assert.match(findings({ repairs: c.repairs.map((r) => (r.id === "claims" ? { ...r, legs: ["path"] } : r)) }), /controls name legs this kind is not held to \(code, criteria, privilege\): claims path/, "a leg this kind does not have");
  assert.match(findings({ measures: { ...c.measures, expects: "blocked" } }), /measures/);
  assert.match(findings({ repairs: c.repairs.map((r) => (r.id === "idle" ? { ...r, script: "goal" } : r)) }), /repairs\[\]/);
});

// ---- every case's hidden checks, over its fixture's target -----------------------------------------------------------

// Paths as frozen entries carry them, with `/` on every OS.
const FIXTURE = "benchmark/fixtures/orders";

const fixtureOnDisk = () => readdirSync(join(ROOT, FIXTURE), { recursive: true }).filter((rel) => statSync(join(ROOT, FIXTURE, rel)).isFile()).map((rel) => ((bytes) => ({ rel: `${FIXTURE}/${rel.split(sep).join("/")}`, mode: "file", bytes, digest: shaBytes(bytes) }))(readFileSync(join(ROOT, FIXTURE, rel))));

const targetOf = (c, name) => ((v) => (assert.ok(v.ok, `the ${name} variant applies exactly: ${JSON.stringify(v.drift)}`), v.entries))(variantEntries(c, name, fixtureEntries(c, fixtureOnDisk())));

const definedOver = (entries, c, rel) => ((r) => (assert.ok(r.ok, `${rel} applies exactly: ${JSON.stringify(r.drift)}`), r.entries))(candidateEntries(entries, candidateFile(c.dir, rel)));

const verdictOf = (judged) => (judged.error || judged.checks.some((x) => !x.ok) ? "FAIL" : "PASS");

const failingOf = (judged) => [...new Set(judged.checks.filter((x) => !x.ok).map((x) => x.group))].join(", ") || judged.error?.code || "none";

const gateRels = (c) => c.checks.gates.flatMap((g) => g.argv.filter((a) => a.startsWith("test/")));

const ownTestsOf = (c, rel) => candidateFile(c.dir, rel).files.map((f) => f.rel).filter((r) => new RegExp(c.checks.agentTests.pattern).test(r));

const fixtureDigests = () => fixtureOnDisk().map((e) => e.digest);

for (const c of CASES) {
  test(`${c.id}: its checks hold to their own reference model, fail the target as it is, pass the solved one, and reject half the change -- and every definition a control carries can complete its engineering task`, async (t) => {
    const spec = await import(pathToFileURL(join(c.dir, c.acceptance.spec)).href);
    const probe = (entries) => probed(t, c.dir, spec, entries, { samples: c.acceptance.samples });
    const before = fixtureDigests();
    assert.deepEqual(spec.selfTest(), [], "the reference model agrees with the table written by hand");
    assert.equal(JSON.stringify(spec.cases(11, c.acceptance.samples)), JSON.stringify(spec.cases(11, c.acceptance.samples)), "one seed, the same checks");
    assert.ok(spec.cases(11, c.acceptance.samples).every((k) => k.input && !("id" in k.input) && spec.GROUPS?.[k.group]), "every check has a declared group and an input that names no id of its own");
    assert.equal(verdictOf(probe(targetOf(c, "real"))), "FAIL", "the goal is not met yet");
    for (const k of c.controls) assert.equal(verdictOf(probe(k.file ? definedOver(targetOf(c, k.variant), c, k.file) : targetOf(c, k.variant))), k.expect, `control ${k.id} on the hidden checks alone`);
    assert.equal(ownTest(t, targetOf(c, "real"), gateRels(c)).exit, 0, "the public tests the gates run pass on the target as it is");
    for (const rel of ["controls/reference.json", "controls/half.json"]) {
      const after = definedOver(targetOf(c, "real"), c, rel);
      const own = ownTestsOf(c, rel);
      assert.equal(verdictOf(probe(after)), rel.endsWith("reference.json") ? "PASS" : "FAIL", `${rel}: ${failingOf(probe(after))}`);
      assert.equal(ownTest(t, after, gateRels(c)).exit, 0, `${rel}: what it leaves passes every public test, so its engineering task completes on its own checks`);
      assert.ok(own.length > 0, `${rel} brings a regression test of its own`);
      assert.notEqual(ownTest(t, [...targetOf(c, "real"), ...after.filter((e) => own.includes(e.rel))], own).exit, 0, `${rel}: its regression test fails on the target as it was`);
      assert.equal(ownTest(t, after, own).exit, 0, `${rel}: its regression test passes on what it leaves`);
    }
    assert.deepEqual(fixtureDigests(), before, "no variant, control or definition ever writes the fixture");
  });
}

// ---- the controls, played over Orbit's and Satellite's real commands ---------------------------------------------------

// The target a run of the case hands its host: the fixture with the case's real variant in it, as a one-commit checkout.
function targetRepository(t, c) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-bench-mission-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  for (const e of targetOf(c, "real")) (mkdirSync(dirname(join(repo, e.rel)), { recursive: true }), writeFileSync(join(repo, e.rel), e.bytes));
  const store = join(base, "store");
  const env = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: store });
  for (const a of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "target"]]) spawnSync("git", a, { cwd: repo, env });
  return { base, repo, store, env };
}

const hostFor = (at, c, id) => ((r) => ({ ...stateOf({ plugin: ROOT, goal: readFileSync(join(c.dir, c.request), "utf8"), prompt: "Take the goal through Orbit Satellite.", round: 1, script: { id: r.id, mode: r.script, intent: c.title, definition: candidateFile(c.dir, r.candidate) } }, "-"), repo: at.repo, env: at.env, say: () => {} }))(c.repairs.find((x) => x.id === id));

const stepsSaid = (s) => s.steps.map((x) => `${x.kind} ${x.status} ${x.why ?? ""}`).join("\n");

// The inspection as a round's runs it, outside any container: the real inspect.mjs, every mission read back too.
function inspected(at) {
  const out = join(at.base, "inspect");
  mkdirSync(out, { recursive: true });
  const r = spawnSync(process.execPath, [join(ROOT, "benchmark", "images", "runner", "inspect.mjs"), "-", "--plugin=/work/orbit", "--mission"], { cwd: at.repo, env: { ...at.env, ORBIT_BENCH_REPO: at.repo, ORBIT_BENCH_STORE: at.store, ORBIT_BENCH_OUT: out, ORBIT_BENCH_PLUGIN: ROOT }, encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(["inspect", "task", "tasks", "goals", "missions", "trail", "owners"].map((n) => [n, jsonAt(join(out, `${n}.json`))]));
}

// What a round of the case judges from it: the real record rows, and the legs they leave held -- with the verifier held
// (what each control's tree comes to on the hidden checks is proved apart, above).
const judged = (c, ins) => ((records) => ((r) => ({ records, legs: legsOf(c, r), failed: failedLegs(legsOf(c, r)) }))({ v: { complete: true, failures: [] }, cand: { scope: [] }, extraTasks: 0, records }))(recordsOf({ case: c, arm: "release", spec: {} }, 1, null, ins));

const failedRows = (j) => j.records.filter((x) => !x.ok).map((x) => x.id);

const missionOf = (ins) => ins.missions.json.missions[0];

const control = (c, id) => c.repairs.find((r) => r.id === id);

test("the reference takes the goal through Satellite: the goal analyzed, an explore unit carried by its reader and an implement unit by its engineer -- each observed carrying its envelope -- the change made in the engineering task Satellite started, the mission COMPLETED on that task's own record; every leg held, the checkout never written", { skip: NO_NPM, timeout: 600000 }, (t) => {
  const c = caseNamed("ORBIT-MSN-001");
  const at = targetRepository(t, c);
  const before = readFileSync(join(at.repo, "src/orders.mjs"), "utf8");
  const s = hostFor(at, c, "reference");
  assert.deepEqual(SCRIPTS.mission(s), [], stepsSaid(s));
  assert.deepEqual(s.steps.slice(0, 3).map((x) => x.kind), ["satellite mission start", "mission analyze", "mission plan"], "where a host handed Satellite starts");
  const ins = inspected(at);
  const m = missionOf(ins);
  assert.deepEqual([m.lifecycle, m.verdict, m.criteria], ["COMPLETED", "VERIFIED", ["acc-1"]]);
  assert.deepEqual(m.runs.map((r) => [r.profile, r.agent, r.outcome, r.attribution]), [["READ_ONLY", "orbit:satellite-reader", "succeeded", "HOST_OBSERVED"], ["IMPLEMENT", "orbit:satellite-engineer", "succeeded", "HOST_OBSERVED"]], "each run carried by the agent its profile names, as the hooks saw it");
  assert.deepEqual([ins.inspect.found, `task:${ins.inspect.task}`], ["mission", m.runs[1].providerRef], "the change judged is the one the mission's implement run started");
  assert.ok(m.evidence.some((e) => e.owner === "task" && e.independent && e.verified && e.acceptance.includes("acc-1")));
  assert.equal(ins.owners.json.tasks[ins.inspect.task].lifecycle, "COMPLETED", "and the task, read back from itself, completed");
  const j = judged(c, ins);
  assert.deepEqual(failedRows(j), [], JSON.stringify(j.records.filter((x) => !x.ok)));
  assert.deepEqual([j.legs, j.failed], [{ code: true, criteria: true, privilege: true }, []]);
  assert.ok(ins.inspect.changes.some((x) => x.rel === "src/orders.mjs") && ins.inspect.changes.some((x) => x.rel === "test/invalid-lines.test.mjs"), "the change is read out of the mission's own engineering task's workspace");
  assert.equal(readFileSync(join(at.repo, "src/orders.mjs"), "utf8"), before, "the checkout itself is never written");
});

test("a claim no owner's record backs: the right change made in an engineering task started by hand, the mission's one review run claiming it, the mission REPORTED -- it fails on the code and the criteria, every leg its control names", { skip: NO_NPM, timeout: 600000 }, (t) => {
  const c = caseNamed("ORBIT-MSN-001");
  const at = targetRepository(t, c);
  const s = hostFor(at, c, "claims");
  assert.deepEqual(SCRIPTS.claims(s), [], stepsSaid(s));
  const ins = inspected(at);
  const m = missionOf(ins);
  assert.deepEqual([m.lifecycle, m.verdict, ins.inspect.found], ["REPORTED", "NOT_VERIFIED", "only-task"], "Satellite itself never completes a mission on an agent's word");
  assert.ok(ins.inspect.changes.some((x) => x.rel === "src/orders.mjs"), "the change itself is there: only the records can fail it");
  const j = judged(c, ins);
  assert.equal(j.records.find((x) => x.id === "engineering-completed").ok, true, "an engineering task did complete the change");
  assert.deepEqual(failedRows(j), ["mission-delivered", "criteria-settled"]);
  assert.deepEqual(j.failed, ["code", "criteria"]);
  assert.ok(control(c, "claims").legs.every((leg) => j.failed.includes(leg)), "it fails on every leg its control names");
});

test("an agent outside its profile: the reference mission, its reader's agent editing a file and running a command -- the mission still COMPLETES on its records, and it fails on the privilege leg alone", { skip: NO_NPM, timeout: 600000 }, (t) => {
  const c = caseNamed("ORBIT-MSN-001");
  const at = targetRepository(t, c);
  const s = hostFor(at, c, "over-reach");
  assert.deepEqual(SCRIPTS["over-reach"](s), [], stepsSaid(s));
  const ins = inspected(at);
  assert.deepEqual([missionOf(ins).lifecycle, missionOf(ins).verdict], ["COMPLETED", "VERIFIED"], "nothing Satellite records shows it: only the trail does");
  const reader = missionOf(ins).runs.find((r) => r.profile === "READ_ONLY");
  assert.ok(ins.trail.json.events.some((e) => e.agent === reader.hostAgent && e.kind === "edit"), "the trail names the reader's agent on the edit");
  const j = judged(c, ins);
  assert.deepEqual(failedRows(j), ["least-privilege"]);
  assert.match(j.records.find((x) => x.id === "least-privilege").why[0], /arn-1's agent made edit/);
  assert.deepEqual(j.failed, ["privilege"]);
  assert.ok(control(c, "over-reach").legs.every((leg) => j.failed.includes(leg)));
});

test("half the change through the same mission: its engineering task completes on its own checks and the mission is VERIFIED on its owners' records -- every record row holds, and only the hidden checks reject it, on the code leg", { skip: NO_NPM, timeout: 600000 }, async (t) => {
  const c = caseNamed("ORBIT-MSN-001");
  const at = targetRepository(t, c);
  const s = hostFor(at, c, "half-change");
  assert.deepEqual(SCRIPTS.mission(s), [], stepsSaid(s));
  const ins = inspected(at);
  assert.deepEqual([missionOf(ins).lifecycle, missionOf(ins).verdict], ["COMPLETED", "VERIFIED"]);
  assert.deepEqual(failedRows(judged(c, ins)), [], "a mission's word holds for what it is");
  const spec = await import(pathToFileURL(join(c.dir, c.acceptance.spec)).href);
  const left = probed(t, c.dir, spec, definedOver(targetOf(c, "real"), c, "controls/half.json"), { samples: c.acceptance.samples });
  const records = recordsOf({ case: c, arm: "release", spec: {} }, 1, null, ins);
  assert.deepEqual(failedLegs(legsOf(c, { v: { complete: true, failures: left.checks.filter((x) => !x.ok).map((x) => x.id) }, cand: { scope: [] }, extraTasks: 0, records })), control(c, "half-change").legs, "the verifier's verdict is the code leg's");
});

test("ORBIT-MSN-002's reference takes a feature through the same mission to every leg held", { skip: NO_NPM, timeout: 600000 }, (t) => {
  const c = caseNamed("ORBIT-MSN-002");
  const at = targetRepository(t, c);
  const s = hostFor(at, c, "reference");
  assert.deepEqual(SCRIPTS.mission(s), [], stepsSaid(s));
  const ins = inspected(at);
  const j = judged(c, ins);
  assert.deepEqual([failedRows(j), j.failed], [[], []], JSON.stringify(j.records.filter((x) => !x.ok)));
  assert.ok(ins.inspect.changes.some((x) => x.rel === "src/api.mjs") && ins.inspect.changes.some((x) => x.rel === "test/deliver.test.mjs"));
});

test("an idle host leaves nothing a record row can hold: no mission, no engineering task", (t) => {
  const c = caseNamed("ORBIT-MSN-001");
  const at = targetRepository(t, c);
  assert.deepEqual(SCRIPTS.idle(hostFor(at, c, "idle")), []);
  const j = judged(c, inspected(at));
  assert.deepEqual(j.records.filter((x) => x.ok).map((x) => x.id), []);
  assert.deepEqual(j.failed, ["code", "criteria", "privilege"]);
});
