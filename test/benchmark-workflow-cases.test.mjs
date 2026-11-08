// THE WORKFLOW CASES (0.5.0, backlog B1, ADR 0053), without Docker: every case of `orbit-workflow` loads and is held to
// its kind, the kind refuses what the harness cannot hold yet, and each control's scripted host is played over Orbit's
// REAL commands -- `/orbit-help`, the coordinated workflow it starts, the engineering task that workflow starts -- on the
// case's own target, then read back by the real inspection (`inspect.mjs --workflow`, outside any container) and judged
// by the real record rows. The reference holds every leg: the change made by the workflow's own engineering task, its QA
// step SKIPPED with its reason, every step settled and the workflow completed. Code-only fails on the QA leg; bypass, on
// the path leg; idle leaves nothing to read back.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { test } from "node:test";
import { SCRIPTS, stateOf } from "../benchmark/images/runner/scripted.mjs";
import { fixtureEntries, variantEntries } from "../benchmark/lib/core/context.mjs";
import { candidateFile } from "../benchmark/lib/core/mutations.mjs";
import { jsonAt } from "../benchmark/lib/core/runner.mjs";
import { caseFindings, caseOf, casesOf, WORKFLOW_LEGS } from "../benchmark/lib/core/suites.mjs";
import { recordsOf } from "../benchmark/lib/source/flow.mjs";
import { failedLegs, legsOf } from "../benchmark/lib/workflow/judge.mjs";
import { shaBytes } from "../src/hash.mjs";
import { createProcess } from "../src/process/index.mjs";
import { GIT_ENV, ROOT } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

const npmHere = () => createProcess({ timeoutMs: 30000 }).run("npm", ["--version"], { env: sealed() }).ok;

const NO_NPM = !npmHere() && "npm is not runnable here: the fixture's declared check is an npm script";

// ---- every case, held to its kind ---------------------------------------------------------------------------------

// A case as its case.json holds it: what loading it added (its directory, its suite) taken off again.
const raw = ({ dir, suite, ...c }) => c;

test("every workflow case loads, is held to its kind, and carries a reference that must PASS beside controls naming the legs they fail on", () => {
  const cases = casesOf(ROOT, "orbit-workflow");
  assert.ok(cases.length >= 1);
  for (const c of cases) {
    assert.equal(c.kind, "workflow");
    assert.deepEqual(caseFindings(raw(c), c.dir), [], c.id);
    assert.ok(c.repairs.some((r) => r.script === "workflow" && r.expect === "PASS"), `${c.id} can be passed`);
    assert.ok(c.repairs.filter((r) => r.expect === "FAIL").every((r) => r.legs.every((leg) => WORKFLOW_LEGS.includes(leg))));
  }
});

test("the kind admits only what the harness holds today: a relayed QA leg, another route, a FAIL control naming no leg and a case nobody can pass are refused when loaded", () => {
  const c = caseOf(ROOT, "ORBIT-WF-004");
  const findings = (over) => caseFindings({ ...raw(c), ...over }, c.dir);
  assert.match(findings({ workflow: { route: "engineering", qa: "investigated" } }).join("; "), /workflow: qa/, "the relayed QA leg is not built: a case asking for it never runs on less than it claims");
  assert.match(findings({ workflow: { route: "investigation", qa: "skipped" } }).join("; "), /workflow: route/);
  assert.match(findings({ repairs: c.repairs.map((r) => (r.id === "bypass" ? { ...r, legs: undefined } : r)) }).join("; "), /say which legs they fail on: bypass/);
  assert.match(findings({ repairs: c.repairs.filter((r) => r.script !== "workflow") }).join("; "), /nobody can pass/);
  assert.match(findings({ repairs: c.repairs.map((r) => (r.id === "reference" ? { ...r, legs: ["qa"] } : r)) }).join("; "), /must PASS fails on no leg/);
});

// ---- the controls, played over Orbit's real commands ------------------------------------------------------------------

const FIXTURE = "benchmark/fixtures/orders";

const fixtureOnDisk = () => readdirSync(join(ROOT, FIXTURE), { recursive: true }).filter((rel) => statSync(join(ROOT, FIXTURE, rel)).isFile()).map((rel) => ((bytes) => ({ rel: `${FIXTURE}/${rel.split(sep).join("/")}`, mode: "file", bytes, digest: shaBytes(bytes) }))(readFileSync(join(ROOT, FIXTURE, rel))));

// The target a run of the case hands its host: the fixture with the case's real variant in it, as a one-commit checkout.
function targetRepository(t, c) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-bench-workflow-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  for (const e of variantEntries(c, "real", fixtureEntries(c, fixtureOnDisk())).entries) (mkdirSync(dirname(join(repo, e.rel)), { recursive: true }), writeFileSync(join(repo, e.rel), e.bytes));
  const store = join(base, "store");
  const env = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: store });
  for (const a of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "target"]]) spawnSync("git", a, { cwd: repo, env });
  return { base, repo, store, env };
}

const hostFor = (at, c, id) => ((r) => ({ ...stateOf({ plugin: ROOT, goal: readFileSync(join(c.dir, c.request), "utf8"), round: 1, script: { id: r.id, mode: r.script, intent: c.workflow.ask, definition: candidateFile(c.dir, r.candidate) } }, "-"), repo: at.repo, env: at.env, say: () => {} }))(c.repairs.find((x) => x.id === id));

const stepsSaid = (s) => s.steps.map((x) => `${x.kind} ${x.status} ${x.why ?? ""}`).join("\n");

// The inspection as a round's runs it, outside any container: the real inspect.mjs, the workflows read back too.
function inspected(at) {
  const out = join(at.base, "inspect");
  mkdirSync(out, { recursive: true });
  const r = spawnSync(process.execPath, [join(ROOT, "benchmark", "images", "runner", "inspect.mjs"), "-", "--plugin=/work/orbit", "--workflow"], { cwd: at.repo, env: { ...at.env, ORBIT_BENCH_REPO: at.repo, ORBIT_BENCH_STORE: at.store, ORBIT_BENCH_OUT: out, ORBIT_BENCH_PLUGIN: ROOT }, encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(["inspect", "task", "tasks", "goals", "workflows"].map((n) => [n, jsonAt(join(out, `${n}.json`))]));
}

// What a round of the case judges from it: the real record rows, and the legs they leave held -- with the verifier held
// (a scripted control's tree is the reference's, which the case's own tests prove apart).
const judged = (c, ins) => ((records) => ((r) => ({ records, legs: legsOf(c, r), failed: failedLegs(legsOf(c, r)) }))({ v: { complete: true, failures: [] }, cand: { scope: [] }, extraTasks: 0, records }))(recordsOf({ case: c, arm: "release", spec: {} }, 1, null, ins));

const tasksOf = (at) => JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "list", "--json"], { cwd: at.repo, env: at.env, encoding: "utf8" }).stdout).tasks;

test("the reference takes the request through /orbit-help: one workflow routed as a change, its engineering task completed, its QA step SKIPPED with its reason, every step settled -- every leg held, the checkout never written", { skip: NO_NPM, timeout: 600000 }, (t) => {
  const c = caseOf(ROOT, "ORBIT-WF-004");
  const at = targetRepository(t, c);
  const before = readFileSync(join(at.repo, "src/money.mjs"), "utf8");
  const s = hostFor(at, c, "reference");
  assert.deepEqual(SCRIPTS.workflow(s), [], stepsSaid(s));
  assert.deepEqual(s.steps.slice(0, 2).map((x) => x.kind), ["orbit-help navigator", "automation start"], "where a person starts: /orbit-help, then the workflow it names");
  const tasks = tasksOf(at);
  const eng = tasks.find((x) => x.provider === "autonomous-engineering");
  const auto = tasks.find((x) => x.provider === "automation");
  assert.deepEqual([tasks.length, eng.lifecycle, auto.lifecycle, eng.parent], [2, "COMPLETED", "COMPLETED", auto.id]);
  const ins = inspected(at);
  const wf = ins.workflows.json.workflows[0];
  assert.deepEqual([wf.route, wf.child, ins.inspect.found], ["engineering", eng.id, "coordinator"]);
  const qa = wf.steps.find((x) => x.kind === "qa");
  assert.equal(qa.state, "skipped");
  assert.match(qa.summary, /nothing this checkout declares can be started/);
  const j = judged(c, ins);
  assert.deepEqual(j.records.filter((x) => !x.ok), [], "every record row holds");
  assert.deepEqual([j.legs, j.failed], [{ code: true, qa: true, path: true }, []]);
  assert.ok(ins.inspect.changes.some((x) => x.rel === "src/money.mjs"), "the change is read out of the workflow's own engineering task's workspace");
  assert.equal(readFileSync(join(at.repo, "src/money.mjs"), "utf8"), before, "the checkout itself is never written");
});

test("code-only stops once the change is made: its QA step never settles, and it fails on the QA leg (and the path); bypass makes the change with no workflow, and fails on the path leg", { skip: NO_NPM, timeout: 900000 }, (t) => {
  const c = caseOf(ROOT, "ORBIT-WF-004");
  const only = targetRepository(t, c);
  const s = hostFor(only, c, "code-only");
  assert.deepEqual(SCRIPTS["code-only"](s), [], stepsSaid(s));
  const oj = judged(c, inspected(only));
  assert.equal(oj.records.find((x) => x.id === "engineering-completed").ok, true, "the change itself was made and completed");
  assert.deepEqual(oj.failed, ["qa", "path"]);
  assert.ok(c.repairs.find((r) => r.id === "code-only").legs.every((leg) => oj.failed.includes(leg)), "it fails on every leg its control names");
  const by = targetRepository(t, c);
  const b = hostFor(by, c, "bypass");
  assert.deepEqual(SCRIPTS.bypass(b), [], stepsSaid(b));
  assert.deepEqual(tasksOf(by).map((x) => x.provider), ["autonomous-engineering"], "no workflow was ever started");
  const bi = inspected(by);
  const bj = judged(c, bi);
  assert.equal(bi.inspect.found, "only-task");
  assert.equal(bj.records.find((x) => x.id === "engineering-completed").ok, true);
  assert.deepEqual(bj.records.filter((x) => x.leg === "path" && x.ok).map((x) => x.id), [], "no path row holds without a workflow");
  assert.ok(c.repairs.find((r) => r.id === "bypass").legs.every((leg) => bj.failed.includes(leg)));
});

test("an idle host leaves nothing a record row can hold: no workflow, no engineering task", (t) => {
  const c = caseOf(ROOT, "ORBIT-WF-004");
  const at = targetRepository(t, c);
  assert.deepEqual(SCRIPTS.idle(hostFor(at, c, "idle")), []);
  const j = judged(c, inspected(at));
  assert.deepEqual(j.records.filter((x) => x.ok).map((x) => x.id), []);
  assert.deepEqual(j.failed, ["code", "qa", "path"]);
});
