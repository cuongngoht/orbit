// The benchmark's controller, carried end to end over a small repository of its own (a calculator and its test, a case
// that holds it to a sum) through a DOCKER DOUBLE: every container is run as a local process with its mounts mapped
// back to the paths the controller made, so the case's probe and the repository's own test run for real, and the
// runner and the inspection -- a coding host and Orbit's engineering loop, which no test here can be -- are played by
// functions this file names. What it proves is the controller: a pass completes and changes nothing, a planted fault
// fails as planted, a repair the verifier passes completes, a candidate that weakens a test or changes nothing does not,
// a round past its deadline is stopped, and a run interrupted mid-round is read back on resume, never sent again.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { carried } from "../benchmark/lib/source/flow.mjs";
import { resumedRun, withSpec } from "../benchmark/lib/core/context.mjs";
import { taskFound } from "../benchmark/images/runner/inspect.mjs";
import { reportOf } from "../benchmark/lib/source/report.mjs";
import { docRead } from "../benchmark/lib/core/room.mjs";
import { projectStoreRoot } from "../src/project/repository.mjs";
import { guardedIo } from "../src/store/guard.mjs";
import { realIo } from "../src/store/io.mjs";
import { apply } from "../src/task/ops.mjs";
import { createTasks } from "../src/task/store.mjs";
import { dockerDouble, harnessOf, inspectedAs, NEVER, ranAs, runOf, TASK, VIEW, worldOf } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");

// ---- a repository of its own, with one benchmark case ------------------------------------------------------------------

const CASE = { schema: 1, kind: "source", id: "CALC-001", version: "1.0.0", title: "add returns a sum", goal: "add(a, b) returns a + b", measures: { kind: "correctness", capability: "calc.add", repairable: ["ORBIT_SOURCE_DEFECT"] }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, prepare: { requires: ["node"] }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/calc.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "calc-suite", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 2, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: {}, "controlled-fault": { mutations: "variants/controlled-fault.json" }, drifted: { mutations: "variants/drifted.json" } }, controls: [] };

const SPEC = `export const GROUPS = { sums: "add returns the sum of its two numbers" };
export const cases = (seed, samples) => Array.from({ length: samples }, (_, i) => ({ id: "sums-" + (i + 1), group: "sums", input: { call: "add", a: i, b: (seed % 7) + i }, expect: { exactly: [String(i + (seed % 7) + i)] } }));
export const selfTest = () => [];
`;

const PROBE = `import { join } from "node:path";
import { pathToFileURL } from "node:url";
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d)).on("end", async () => {
  const inputs = JSON.parse(Buffer.concat(chunks).toString()).inputs;
  try { const m = await import(pathToFileURL(join(process.argv[2], "src/calc.mjs")).href); process.stdout.write(JSON.stringify({ answers: inputs.map((i) => ({ id: i.id, got: [String(m.add(i.a, i.b))] })) }) + "\\n"); }
  catch (e) { process.stdout.write(JSON.stringify({ error: { code: "IMPORT", message: String(e.message) } }) + "\\n"); }
});
`;

const FILES = {
  "package.json": '{ "name": "calc", "private": true, "type": "module" }\n',
  "src/calc.mjs": "export const add = (a, b) => a + b;\n",
  "test/calc.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds", () => {\n  assert.equal(add(1, 2), 3);\n});\n',
  "benchmark/suites/fixture/suite.json": JSON.stringify({ schema: 1, id: "fixture", version: "1.0.0", title: "a calculator", cases: ["CALC-001"] }),
  "benchmark/suites/fixture/calc-001/case.json": JSON.stringify(CASE, null, 2),
  "benchmark/suites/fixture/calc-001/request.md": "Make add return the sum of its two numbers.\n",
  "benchmark/suites/fixture/calc-001/verifier/spec.mjs": SPEC,
  "benchmark/suites/fixture/calc-001/verifier/probe.mjs": PROBE,
  "benchmark/suites/fixture/calc-001/variants/controlled-fault.json": JSON.stringify({ schema: 1, id: "controlled-fault", about: "a sum made a difference", mutations: [{ id: "sum-reversed", file: "src/calc.mjs", find: "a + b", replace: "a - b", count: 1 }] }),
  "benchmark/suites/fixture/calc-001/variants/drifted.json": JSON.stringify({ schema: 1, id: "drifted", about: "a fault written for a source that moved", mutations: [{ id: "product-reversed", file: "src/calc.mjs", find: "a * b", replace: "a / b", count: 1 }] }),
};

const world = (t) => worldOf(t, FILES);

const FIXED = { "src/calc.mjs": "export const add = (a, b) => a + b;\n", "test/calc-regression.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds, again", () => {\n  assert.equal(add(2, 2), 4);\n});\n' };

// ---- what the controller does ---------------------------------------------------------------------------------------------

test("the source as it is passes: two verifications agree, the task completes, no host runs and nothing is changed", async (t) => {
  const w = world(t);
  const before = readFileSync(join(w.repo, "src/calc.mjs"), "utf8");
  const r = await runOf(w, dockerDouble(NEVER), {});
  assert.deepEqual([r.result.outcome, r.result.exit, r.view.lifecycle, r.view.task.provider], ["PASS", 0, "COMPLETED", "benchmark"]);
  assert.deepEqual(r.view.attempts.map((a) => [a.cause, a.outcome]), [["fresh", "succeeded"]]);
  assert.equal(readFileSync(join(w.repo, "src/calc.mjs"), "utf8"), before, "the measured checkout is never written");
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: w.repo, env: sealed(), encoding: "utf8" }).stdout, "");
});

test("a planted fault fails, says it was planted, and is never repaired when no repair was asked for", async (t) => {
  const r = await runOf(world(t), dockerDouble(NEVER), { variant: "controlled-fault" });
  assert.deepEqual([r.result.outcome, r.result.exit], ["FAIL", 1]);
  assert.match(r.result.summary, /planted by the controlled-fault variant, not a defect found in the source/);
});

test("a repair the verifier passes completes: the fault fixed, a regression test that fails before and passes after, inside the scope", async (t) => {
  const r = await runOf(world(t), dockerDouble({ runner: ranAs(FIXED), inspect: inspectedAs(VIEW("COMPLETED")) }), { variant: "controlled-fault", repair: true });
  assert.deepEqual([r.result.outcome, r.result.exit, r.view.lifecycle], ["REPAIRED_VERIFIED", 0, "COMPLETED"]);
  assert.deepEqual(r.view.attempts.map((a) => [a.cause, a.outcome]), [["fresh", "failed"], ["fix", "succeeded"]]);
  assert.ok(r.view.receipts.some((x) => x.key === `task:runner.${TASK}`), "the engineering task is a receipt, named so no viewer takes it for a task of this store");
  assert.deepEqual(r.view.changes.paths.map((p) => p.path).sort(), ["src/calc.mjs", "test/calc-regression.test.mjs"]);
  assert.match(readFileSync(r.ctx.room.at("rounds", "1", "candidate.patch"), "utf8"), /a - b[\s\S]*a \+ b/);
});

test("a candidate that weakens an existing test is refused by name, whatever the gates say", async (t) => {
  const weakened = { "test/calc.test.mjs": 'import { test } from "node:test";\ntest("adds", () => {});\n' };
  const r = await runOf(world(t), dockerDouble({ runner: ranAs(weakened), inspect: inspectedAs(VIEW("COMPLETED")) }), { variant: "controlled-fault", repair: true });
  assert.notEqual(r.result.outcome, "REPAIRED_VERIFIED");
  assert.match(JSON.stringify(JSON.parse(readFileSync(r.ctx.room.at("rounds", "1", "candidate.json"), "utf8")).scope), /TEST_WEAKENED/);
});

test("a round that changes nothing makes no progress, and the run stops there", async (t) => {
  const r = await runOf(world(t), dockerDouble({ runner: ranAs({}), inspect: inspectedAs(VIEW("EXECUTING")) }), { variant: "controlled-fault", repair: true });
  assert.deepEqual([r.result.outcome, r.view.stopReason], ["NO_PROGRESS", "NO_PROGRESS"]);
});

test("a round past its deadline is stopped and its container removed, and what it left is still judged", async (t) => {
  const double = dockerDouble({ runner: ranAs(FIXED, { timedOut: true }), inspect: inspectedAs(VIEW("EXECUTING")) });
  const r = await runOf(world(t), double, { variant: "controlled-fault", repair: true });
  const verbs = double.s.calls.map((a) => a[0]);
  assert.ok(verbs.includes("stop"), "the controller stopped the runner itself");
  assert.equal(double.s.containers.size, 0, "every container it made is gone");
  assert.equal(r.result.outcome, "REPAIRED_VERIFIED", "a deadline ends a round; it does not void what the round left");
});

// The controller dies mid-round, then the run is resumed with a runner that refuses to be asked: what the round left is
// read back and judged, and the round is never sent again.
async function resumedAfter(t, dies, edits) {
  const w = world(t);
  await assert.rejects(runOf(w, dockerDouble({ runner: ranAs(edits, { dies }), inspect: NEVER.inspect }), { variant: "controlled-fault", repair: true }), /died here/);
  const runId = readdirSync(join(w.storeRoot, "benchmark")).find((n) => n.startsWith("bnr-"));
  const double = dockerDouble({ runner: () => assert.fail("a round that started is never sent again"), inspect: inspectedAs(VIEW("EXECUTING")) });
  const ctx = await withSpec(resumedRun(harnessOf(w, double), runId));
  const result = await carried(ctx);
  return { result, view: ctx.rec.show(ctx.task), ctx };
}

const interrupted = (view) => view.actions.some((a) => a.type === "benchmark.repair" && a.state === "error" && /never sent again/.test(a.reason ?? ""));

test("a run interrupted mid-round is carried on by resume: what the round left is read back and judged, never sent again", async (t) => {
  const r = await resumedAfter(t, "after-edits", FIXED);
  assert.ok(interrupted(r.view), "the interrupted round is closed as interrupted");
  assert.ok(r.view.actions.some((a) => a.type === "benchmark.inspect" && a.state === "succeeded"), "and read back");
  assert.deepEqual([r.result.outcome, r.view.lifecycle], ["REPAIRED_VERIFIED", "COMPLETED"], "the repair it left is the verifier's to judge, as if the round had ended");
  const repair = r.view.actions.find((a) => a.type === "benchmark.repair");
  const inspect = r.view.actions.find((a) => a.type === "benchmark.inspect");
  assert.deepEqual([repair.receipts, inspect.receipts], [[], [`task:runner.${TASK}`]], "the engineering task is linked as the inspection read it back, not as a round that ended");
  const report = reportOf(r.ctx.room, r.ctx.manifest, r.view, Object.fromEntries(r.view.actions.map((a) => [a.id, docRead(r.ctx.room, `steps/${a.id}.json`)]).filter(([, d]) => d)), docRead(r.ctx.room, "ending.json"));
  assert.deepEqual([report.json.rounds.length, report.json.rounds[0].interrupted, report.json.rounds[0].inspection.engineering.id, report.json.totals.costUsd], [1, true, TASK, null], "the round keeps its own read-back, and the cost nobody reported stays unknown");
  assert.match(report.md, /round 1 \(interrupted, read back\)/);
});

test("a round interrupted before its runner said which task it started: the inspection finds the one the store holds, or none -- never an extra one", async (t) => {
  const r = await resumedAfter(t, "before-start", FIXED);
  assert.ok(interrupted(r.view));
  assert.equal(JSON.parse(readFileSync(r.ctx.room.at("rounds", "1", "inspect", "inspect.json"), "utf8")).task, null, "no task was started, and none is made up");
  assert.deepEqual([r.result.outcome, r.view.stopReason], ["NO_PROGRESS", "NO_PROGRESS"], "the round changed nothing: it fails as the subject did");
  assert.equal(new Set(r.view.attempts.map((a) => a.failureSignature)).size, 1, "no EXTRA_TASK was counted against it");
});

test("an inspection named no task takes the one the runner store holds, and guesses between none or two", () => {
  const list = (...ids) => ({ exit: 0, json: { tasks: ids.map((id) => ({ id })) } });
  assert.equal(taskFound("tsk-00000000000a", list("tsk-00000000000b")), "tsk-00000000000a", "a start file's word comes first");
  assert.equal(taskFound(null, list("tsk-00000000000b")), "tsk-00000000000b");
  assert.equal(taskFound(null, list()), null);
  assert.equal(taskFound(null, list("tsk-00000000000b", "tsk-00000000000c")), null);
  assert.equal(taskFound(null, list("../../etc")), null);
  assert.equal(taskFound(null, { exit: 1, json: null }), null);
});

// ---- a person holds the run --------------------------------------------------------------------------------------------

const benchTask = (w) => JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "list", "--json"], { cwd: w.repo, env: w.env, encoding: "utf8" }).stdout).tasks.find((x) => x.provider === "benchmark");

// A person pausing the run from a terminal while its round runs -- a terminal may stop work, never allow it.
function pausedDuring(w, round) {
  return async (c, at) => {
    const t = benchTask(w);
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "pause", t.id, "--human", `--expect=${t.revision}`], { cwd: w.repo, env: w.env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return round(c, at);
  };
}

// The same person resuming it where only a person can: Orbit Control's door.
function resumedInControl(w) {
  const t = benchTask(w);
  const root = projectStoreRoot(join(w.base, "store"), t.project);
  apply({ tasks: createTasks(root, guardedIo(root, realIo())), project: t.project, checkout: t.checkout, session: null, door: "control", now: () => new Date().toISOString() }, t.id, "resume", { human: true, expected: t.revision });
}

test("a person pauses the run mid-round: its next step is refused by the task's door, nothing of its own is left running, and once they resume it the round is read back, never sent again", async (t) => {
  const w = world(t);
  const double = dockerDouble({ runner: pausedDuring(w, ranAs(FIXED)), inspect: NEVER.inspect });
  const r = await runOf(w, double, { variant: "controlled-fault", repair: true });
  assert.deepEqual([r.result.outcome, r.view.lifecycle], ["PAUSED", "PAUSED"]);
  assert.match(r.result.summary, /a person paused this run/);
  assert.ok(!r.view.actions.some((a) => a.type === "benchmark.inspect"), "nothing new started once it was paused");
  assert.equal(r.view.actions.find((a) => a.type === "benchmark.repair").state, "succeeded", "what was running settled");
  assert.deepEqual([double.s.containers.size, double.s.networks.size], [0, 0], "nothing of the run is left running");
  resumedInControl(w);
  const again = dockerDouble({ runner: () => assert.fail("a round that ran is never sent again"), inspect: inspectedAs(VIEW("COMPLETED")) });
  const ctx = await withSpec(resumedRun(harnessOf(w, again), r.ctx.run.id));
  const after = await carried(ctx);
  assert.deepEqual([after.outcome, ctx.rec.show(ctx.task).lifecycle], ["REPAIRED_VERIFIED", "COMPLETED"]);
});

test("a fault that no longer matches the source refuses the run before anything is recorded: FIXTURE_DRIFT, never a run on a tree without it", async (t) => {
  const w = world(t);
  await assert.rejects(runOf(w, dockerDouble(NEVER), { variant: "drifted" }), (e) => e.code === "FIXTURE_DRIFT" && /expects 1 occurrence\(s\) in src\/calc\.mjs and finds 0/.test(e.message));
  assert.equal(existsSync(join(w.storeRoot, "benchmark")), false, "no run room");
  assert.equal(benchTask(w), undefined, "no task");
});

// ---- the rows a round may now end on, and what a verified repair leaves --------------------------------------------------

test("a repair the verifier passes leaves verified.json: what was repaired, on which source, by whom, and how to apply it -- never applied", async (t) => {
  const w = world(t);
  const r = await runOf(w, dockerDouble({ runner: ranAs(FIXED), inspect: inspectedAs(VIEW("COMPLETED")) }), { variant: "controlled-fault", repair: true });
  const v = docRead(r.ctx.room, "verified.json");
  assert.deepEqual([v.case.id, v.variant, v.engineering.task, v.host.basis, v.candidate.round], ["CALC-001", "controlled-fault", TASK, "coding-host", 1]);
  assert.match(v.candidate.patchDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(v.baseline.failingGroups, ["sums"]);
  assert.ok(v.reproduce.some((l) => l.includes("git -C") && l.includes("apply")), "a person applies it, themselves");
  assert.equal(readFileSync(join(w.repo, "src/calc.mjs"), "utf8"), FILES["src/calc.mjs"], "the developer's checkout is never written");
  assert.deepEqual(docRead(r.ctx.room, "rounds/1/outcome.json").improved, ["sums", "gate:calc-suite"]);
});

test("an engineering task that waits for a person's approval stops the run on the person: a benchmark never approves anything", async (t) => {
  const r = await runOf(world(t), dockerDouble({ runner: ranAs({}), inspect: inspectedAs(VIEW("EXECUTING", { approvals: [{ id: "apr-1", open: true }] })) }), { variant: "controlled-fault", repair: true });
  assert.deepEqual([r.result.outcome, r.view.lifecycle], ["BLOCKED", "BLOCKED"]);
  const ending = docRead(r.ctx.room, "ending.json");
  assert.deepEqual([ending.next, ending.class, ending.needs], ["WAITING_FOR_PERSON", "HUMAN_APPROVAL_REQUIRED", "person"]);
});

test("a round stopped at its deadline before it changed anything is not a round that failed the same way: the next round goes on with the same task", async (t) => {
  const plays = [ranAs({}, { timedOut: true }), ranAs(FIXED)];
  let n = 0;
  const r = await runOf(world(t), dockerDouble({ runner: (c, at) => plays[n++](c, at), inspect: inspectedAs(VIEW("EXECUTING")) }), { variant: "controlled-fault", repair: true });
  assert.deepEqual([r.result.outcome, n], ["REPAIRED_VERIFIED", 2]);
  assert.equal(docRead(r.ctx.room, "rounds/1/outcome.json").next, "CUT_SHORT");
});

test("a round that leaves exactly the candidate an earlier one left, failing the same way, ends the run as no progress -- even with another round between", async (t) => {
  const wrong = { "src/calc.mjs": "export const add = (a, b) => a * b;\n" };
  const plays = [ranAs(wrong), ranAs({ ...wrong, "test/calc.test.mjs": null }), ranAs({ ...wrong, "test/calc.test.mjs": FILES["test/calc.test.mjs"] })];
  let n = 0;
  const r = await runOf(world(t), dockerDouble({ runner: (c, at) => plays[n++](c, at), inspect: inspectedAs(VIEW("EXECUTING")) }), { variant: "controlled-fault", repair: true, rounds: 3 });
  assert.deepEqual([r.result.outcome, n], ["NO_PROGRESS", 3]);
  assert.equal(docRead(r.ctx.room, "ending.json").next, "REPEATED_CANDIDATE");
  assert.equal(docRead(r.ctx.room, "rounds/3/outcome.json").patchDigest, docRead(r.ctx.room, "rounds/1/outcome.json").patchDigest);
});

test("a scripted host's round runs with no network and no credential: no egress, no internal network, nothing handed by name -- and no credential is needed to run it", async (t) => {
  const w = world(t);
  delete w.env.ANTHROPIC_API_KEY;
  const double = dockerDouble({ runner: ranAs(FIXED), inspect: inspectedAs(VIEW("COMPLETED")) });
  const r = await runOf(w, double, { variant: "controlled-fault", repair: true, host: "scripted:reference" });
  const runner = double.s.calls.find((a) => a[0] === "create" && a.includes("/bench/entry.mjs"));
  assert.equal(r.result.outcome, "REPAIRED_VERIFIED");
  assert.equal(runner[runner.indexOf("--network") + 1], "none");
  assert.ok(!runner.includes("-e"), "no credential is handed by name");
  assert.ok(!double.s.calls.some((a) => a[0] === "create" && a.includes("/bench/egress.mjs")), "no egress proxy is started");
  assert.ok(!double.s.calls.some((a) => a[0] === "network" && a[1] === "create"), "no network is made");
  assert.equal(r.ctx.manifest.config.host, "scripted:reference");
});
