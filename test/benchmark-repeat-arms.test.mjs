// REPEATED RUNS (0.5.0, B2) and the ARMS a case is compared on (B23), through the Docker double over a small repository
// of its own: `run --repeat=N` makes N runs -- each its own room and task -- named as one repeat group in every manifest,
// bounded by BOUNDS; and a case that declares arms runs each one with the plugin that arm hands the host: none at all
// (no --plugin-dir, no plugin mounted: no Orbit hooks, no trail), the plugin frozen from a named git revision (the
// previous release), or the run's own source -- everything else the same.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { compared, listed } from "../benchmark/images/runner/inspect.mjs";
import { hostCommand } from "../benchmark/images/runner/entry.mjs";
import { BOUNDS, COMMANDS, EFFORTS } from "../benchmark/lib/commands.mjs";
import { frozenRun } from "../benchmark/lib/core/context.mjs";
import { docRead, roomOf } from "../benchmark/lib/core/room.mjs";
import { caseFindings } from "../benchmark/lib/core/suites.mjs";
import { isVerified } from "../benchmark/lib/source/flow.mjs";
import { dockerDouble, GIT_ENV, harnessOf, IMAGES, inspectedAs, NEVER, ranAs, ROOT, streamOf, VIEW, worldOf } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

const CASE = { schema: 1, kind: "source", id: "CALC-001", version: "1.0.0", title: "add returns a sum", goal: "add(a, b) returns a + b", measures: { kind: "correctness", capability: "calc.add", repairable: ["ORBIT_SOURCE_DEFECT"] }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, prepare: { requires: ["node"] }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/calc.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "calc-suite", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 2, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: {} }, controls: [] };

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
};

const manifestOf = (w, run) => docRead(roomOf(w.storeRoot, run), "manifest.json");

// ---- repeats ------------------------------------------------------------------------------------------------------------

test("--repeat=N runs a case N times, each its own room and task, named as one repeat group in every manifest", async (t) => {
  const w = worldOf(t, FILES);
  const r = await COMMANDS.run.run(harnessOf(w, dockerDouble(NEVER)), ["CALC-001", "--repeat=3", "--seed=3"]);
  const manifests = r.runs.map((x) => manifestOf(w, x.run));
  assert.match(r.repeat.group, /^rpt-[a-f0-9]{12}$/);
  assert.deepEqual([r.runs.length, new Set(r.runs.map((x) => x.run)).size, new Set(manifests.map((m) => m.task)).size], [3, 3, 3], "three rooms, three tasks");
  assert.deepEqual(manifests.map((m) => [m.config.repeat.id, m.config.repeat.index, m.config.repeat.of]), [1, 2, 3].map((i) => [r.repeat.group, i, 3]));
  assert.deepEqual([r.runs.map((x) => x.outcome), r.exit, COMMANDS.run.exit(r)], [["PASS", "PASS", "PASS"], 0, 0]);
  assert.match(COMMANDS.run.say(r), /\(repeat 2\/3, rpt-/);
});

test("--repeat is bounded as data, never names a single run, and a run with none is the one run it always was", async (t) => {
  const w = worldOf(t, FILES);
  const h = harnessOf(w, dockerDouble(NEVER));
  assert.deepEqual(BOUNDS.find(([k]) => k === "repeat"), ["repeat", 1, 10]);
  for (const bad of ["--repeat=0", "--repeat=11", "--repeat=two"]) await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", bad]), /out of bounds: --repeat is 1\.\.10/, bad);
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--repeat=2", "--run-id=bnr-0123456789ab"]), /--run-id names one run, and --repeat starts one run per repeat/);
  const one = await COMMANDS.run.run(h, ["CALC-001", "--seed=3"]);
  assert.deepEqual([one.outcome, one.runs, one.repeat, manifestOf(w, one.run).config.repeat], ["PASS", undefined, undefined, null], "no group, and the same answer as before");
});

// ---- the effort a host is asked to run at (0.5.0) ---------------------------------------------------------------------

test("--effort is one of a bounded set of levels, as data; the manifest keeps it, status says it, and --like runs at it again", async (t) => {
  const w = worldOf(t, FILES);
  const h = harnessOf(w, dockerDouble(NEVER));
  assert.deepEqual(EFFORTS, ["low", "medium", "high", "xhigh", "max"]);
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--effort=turbo"]), /--effort is one of low, medium, high, xhigh, max, not turbo/);
  const one = await COMMANDS.run.run(h, ["CALC-001", "--seed=3", "--model=claude-sonnet-5-5", "--effort=medium"]);
  assert.deepEqual([manifestOf(w, one.run).config.model, manifestOf(w, one.run).config.effort], ["claude-sonnet-5-5", "medium"]);
  assert.match(COMMANDS.status.say(COMMANDS.status.run(h, [one.run])), /model claude-sonnet-5-5, effort medium/);
  const again = await COMMANDS.run.run(h, [`--like=${one.run}`]);
  assert.equal(manifestOf(w, again.run).config.effort, "medium", "the same effort, again");
  const plain = await COMMANDS.run.run(h, ["CALC-001", "--seed=3"]);
  assert.equal(manifestOf(w, plain.run).config.effort, null, "none asked: the host's own default");
});

test("--repeat with --suite repeats every case as a group of its own, and --like repeats an earlier run", async (t) => {
  const w = worldOf(t, FILES);
  const h = harnessOf(w, dockerDouble(NEVER));
  const s = await COMMANDS.run.run(h, ["--suite=fixture", "--repeat=2", "--seed=3"]);
  assert.deepEqual([s.runs.length, new Set(s.runs.map((x) => x.repeat.id)).size, s.exit], [2, 1, 0]);
  const again = await COMMANDS.run.run(h, [`--like=${s.runs[0].run}`, "--repeat=2"]);
  assert.deepEqual([again.runs.length, again.runs.every((x) => manifestOf(w, x.run).config.seed === 3)], [2, true], "the same case, seed and limits, again and again");
  assert.notEqual(again.repeat.group, s.runs[0].repeat.id, "a new group");
});

// ---- arms ---------------------------------------------------------------------------------------------------------------

// An engineering case on a fixture of the world's own: add() gives a difference, and the goal is a sum -- on three arms.
const GOAL = { schema: 1, kind: "engineering", id: "CALC-E2E-001", version: "1.0.0", baseline: "FAIL", fixture: "calc", title: "add returns a sum", goal: "add(a, b) returns a + b", measures: { kind: "engineering", capability: "engineering.goal.bugfix", expects: "change" }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/*.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "public-tests", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 1, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: { mutations: "variants/real.json" } }, controls: [], repairs: [], arms: ["none", "baseline", "release"], baselinePlugin: "v-base" };

const ARMED = {
  ...FILES,
  "MARKER.md": "the plugin as it is now\n",
  "benchmark/fixtures/calc/fixture.json": JSON.stringify({ schema: 1, id: "calc", about: "a calculator", tests: { from: "checks/", to: "test/", suffix: ".test.mjs" } }),
  "benchmark/fixtures/calc/package.json": '{ "name": "calc", "private": true, "type": "module" }\n',
  "benchmark/fixtures/calc/src/calc.mjs": "export const add = (a, b) => a + b;\n",
  "benchmark/fixtures/calc/checks/calc.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds nothing to nothing", () => {\n  assert.equal(add(0, 0), 0);\n});\n',
  "benchmark/suites/goals/suite.json": JSON.stringify({ schema: 1, id: "goals", version: "1.0.0", title: "a goal", cases: ["CALC-E2E-001"] }),
  "benchmark/suites/goals/calc-e2e-001/case.json": JSON.stringify(GOAL, null, 2),
  "benchmark/suites/goals/calc-e2e-001/request.md": "add(a, b) should return the sum of its two numbers.\n",
  "benchmark/suites/goals/calc-e2e-001/verifier/spec.mjs": SPEC,
  "benchmark/suites/goals/calc-e2e-001/verifier/probe.mjs": PROBE,
  "benchmark/suites/goals/calc-e2e-001/variants/real.json": JSON.stringify({ schema: 1, id: "real", about: "a sum made a difference", mutations: [{ id: "difference", file: "src/calc.mjs", find: "a + b", replace: "a - b", count: 1 }], files: [], deletes: [] }),
};

const gitIn = (cwd, ...a) => execFileSync("git", a, { cwd, env: sealed(GIT_ENV), encoding: "utf8" }).trim();

// The world with a revision a baseline names: the plugin as it was (`v-base`), then one commit after it.
function armedWorld(t) {
  const w = worldOf(t, { ...ARMED, "MARKER.md": "the plugin as it was\n" });
  gitIn(w.repo, "tag", "v-base");
  writeFileSync(join(w.repo, "MARKER.md"), ARMED["MARKER.md"]);
  gitIn(w.repo, "commit", "-qam", "the plugin moved on");
  return w;
}

const FIX = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("sums", () => {\n  assert.equal(add(2, 3), 5);\n});\n';

// A host with no Orbit, as the runner plays it: no task, no workspace -- its edits land in the writable /work/repo.
const plainHost = (seen) => async (c, at) => {
  seen.push({ brief: JSON.parse(readFileSync(at("/run/brief/brief.json"), "utf8")), mounts: c.mounts.map((m) => `${m.target}${m.readOnly ? ":ro" : ":rw"}`), tmpfs: c.flags["--tmpfs"] ?? [] });
  writeFileSync(join(at("/work/repo"), "src", "calc.mjs"), "export const add = (a, b) => a + b;\n");
  writeFileSync(join(at("/work/repo"), "test", "calc-sum.test.mjs"), FIX);
  writeFileSync(join(at("/work/out"), "runner.json"), JSON.stringify({ exit: 0, egress: { holds: true } }));
  return { exit: 0, stdout: streamOf() };
};

// The inspection of such a round: the subject compared with the worktree it was handed, as inspect.mjs --tree does.
const worktreeInspection = (c, at) => {
  const out = at("/work/out");
  const changes = compared(listed(at("/work/repo"), [".claude-plugin/types"]), listed(at("/work/worktree")));
  for (const ch of changes) (mkdirSync(dirname(join(out, "files", ch.rel)), { recursive: true }), cpSync(join(at("/work/worktree"), ch.rel), join(out, "files", ch.rel)));
  writeFileSync(join(out, "inspect.json"), JSON.stringify({ task: null, found: null, workspace: false, changes: changes.map((ch) => ({ ...ch, copied: true })) }));
  for (const name of ["task.json", "tasks.json", "trace.json"]) writeFileSync(join(out, name), JSON.stringify({ exit: 0, json: name === "tasks.json" ? { tasks: [] } : null }));
  return { exit: 0 };
};

const runGoal = (w, double, arm) => COMMANDS.run.run(harnessOf(w, double), ["CALC-E2E-001", "--seed=3", ...(arm ? [`--arm=${arm}`] : [])]);

test("the none arm hands its host no Orbit: no plugin mounted, no --plugin-dir, a prompt that names none -- its edits in a writable copy of the target, judged by the verifier alone", async (t) => {
  const w = armedWorld(t);
  const seen = [];
  const double = dockerDouble({ runner: plainHost(seen), inspect: worktreeInspection });
  const r = await runGoal(w, double, "none");
  const m = manifestOf(w, r.run);
  assert.deepEqual([r.outcome, r.arm, m.config.arm, m.plugin.arm, m.plugin.handed, m.plugin.revision], ["PASS", "none", "none", "none", false, null]);
  assert.ok(!seen[0].mounts.some((x) => x.startsWith("/work/orbit")), "no plugin where the host runs");
  assert.ok(seen[0].mounts.includes("/work/repo:rw") && !seen[0].tmpfs.some((x) => x.includes(".claude-plugin")), "a writable target, and no mount point for a plugin's editor types");
  assert.deepEqual([seen[0].brief.arm, seen[0].brief.plugin], ["none", null]);
  assert.doesNotMatch(seen[0].brief.prompt, /orbit/i);
  assert.ok(!hostCommand(seen[0].brief)[1].includes("--plugin-dir"), "Claude Code loads no plugin: no Orbit hook can fire, and no trail is written");
  assert.equal(readFileSync(join(w.repo, "benchmark/fixtures/calc/src/calc.mjs"), "utf8"), ARMED["benchmark/fixtures/calc/src/calc.mjs"], "the developer's checkout is never written");
  const inspect = double.s.calls.find((a) => a[0] === "create" && a.includes("/bench/inspect.mjs"));
  assert.ok(inspect.includes("--tree=/work/worktree"), "the inspection reads the worktree the host changed");
});

test("the baseline arm hands its host the plugin frozen from the named revision, the harness taken out as for any source -- and the manifest names it", async (t) => {
  const w = armedWorld(t);
  const h = harnessOf(w, dockerDouble(NEVER));
  const ctx = frozenRun(h, { caseId: "CALC-E2E-001", arm: "baseline", seed: 3, images: IMAGES, dockerVersion: "double" });
  assert.deepEqual([ctx.manifest.config.arm, ctx.manifest.plugin.revision.named, ctx.manifest.plugin.revision.commit], ["baseline", "v-base", gitIn(w.repo, "rev-parse", "v-base^{commit}")]);
  assert.equal(readFileSync(join(ctx.pluginDir, "MARKER.md"), "utf8"), "the plugin as it was\n");
  assert.ok(!existsSync(join(ctx.pluginDir, "benchmark")), "never the harness");
  const release = frozenRun(h, { caseId: "CALC-E2E-001", seed: 3, images: IMAGES, dockerVersion: "double" });
  assert.deepEqual([release.manifest.config.arm, release.manifest.plugin.revision.commit, readFileSync(join(release.pluginDir, "MARKER.md"), "utf8")], ["release", gitIn(w.repo, "rev-parse", "HEAD"), ARMED["MARKER.md"]], "release is the run's own source, as every run was before arms");
});

test("an arm is one the case declares; a baseline no revision holds is refused, never silently another", async (t) => {
  const w = armedWorld(t);
  const h = harnessOf(w, dockerDouble(NEVER));
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--arm=none"]), /CALC-001 declares no none arm: it runs on release/);
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-E2E-001", "--arm=nothing"]), /--arm is one of none, baseline, release, all/);
  await assert.rejects(async () => COMMANDS.run.run(harnessOf(w, dockerDouble(NEVER)), ["CALC-E2E-001", "--arm=all", "--run-id=bnr-0123456789ab"]), /--run-id names one run, and --arm=all starts one run per arm/, "refused before any arm runs");
  assert.equal(existsSync(roomOf(w.storeRoot, "bnr-0123456789ab").dir), false, "no room was made under the id");
  gitIn(w.repo, "tag", "-d", "v-base");
  assert.throws(() => frozenRun(h, { caseId: "CALC-E2E-001", arm: "baseline", images: IMAGES }), /names v-base, and .* holds no such revision/);
  const listedCase = COMMANDS.list.run({ root: w.repo }).suites.find((s) => s.id === "goals").cases[0];
  assert.deepEqual([listedCase.arms, listedCase.baselinePlugin], [["none", "baseline", "release"], "v-base"]);
});

test("a case's arms are held to the vocabulary: an unknown arm or one named twice is refused when the case loads", () => {
  const dir = join(ROOT, "benchmark", "suites", "orbit-engineering", "orbit-e2e-001");
  const c = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
  assert.deepEqual(caseFindings({ ...c, arms: ["none", "release"] }, dir), []);
  assert.match(caseFindings({ ...c, arms: ["none", "nothing"] }, dir).join("; "), /an arm is one of none, baseline, release, never nothing/);
  assert.match(caseFindings({ ...c, arms: ["none", "none"] }, dir).join("; "), /arms named twice: none/);
  assert.match(caseFindings({ ...c, baselinePlugin: "--upload-pack=x" }, dir).join("; "), /baselinePlugin/);
});

test("--arm=all runs every arm the case declares, one after another, the same seed and limits for each", async (t) => {
  const w = armedWorld(t);
  const runner = (c, at) => (c.mounts.some((m) => m.target === "/work/orbit") ? ranAs({})(c, at) : plainHost([])(c, at));
  const inspect = (c, at) => (c.argv.includes("--tree=/work/worktree") ? worktreeInspection(c, at) : inspectedAs(VIEW("EXECUTING"))(c, at));
  const r = await runGoal(w, dockerDouble({ runner, inspect }), "all");
  assert.deepEqual(r.runs.map((x) => x.arm), ["none", "baseline", "release"]);
  assert.deepEqual(r.runs.map((x) => manifestOf(w, x.run).config.seed), [3, 3, 3]);
  assert.equal(r.runs[0].outcome, "PASS", "the none arm's host fixed it alone");
});

// A goal that leaves out its rule must be refused on every arm. With Orbit, "nothing delivered" is an engineering task
// that did not complete a change; with no Orbit there is no task to hold a change back -- whatever the host left in its
// writable target is what it delivered, so the none arm is held to having left nothing, never to the hidden checks alone.
test("a goal that must be refused is never verified on the none arm when its host changed the target anyway", () => {
  const round = (arm, changes, engineering = null) => ({ expects: "blocked", arm, cand: { changes, scope: [] }, v: { complete: true, failures: [] }, extraTasks: 0, records: [], engineering });
  const invented = [{ rel: "src/rule.mjs", change: "added" }];
  assert.equal(isVerified(round("none", invented)), false, "a rule the host invented is a change delivered, whatever the hidden checks say");
  assert.equal(isVerified(round("none", [])), true, "said what is missing and stopped: refused as it must be");
  assert.equal(isVerified(round("release", invented, { lifecycle: "EXECUTING" })), true, "with Orbit, an engineering task that never completed delivered nothing (unchanged)");
  assert.equal(isVerified(round("release", invented, { lifecycle: "COMPLETED" })), false, "with Orbit, a completed task's change was delivered (unchanged)");
});

// ---- memory arms (0.5.0, backlog B3, ADR 0054) ------------------------------------------------------------------------

test("--memory is one of the memory arms, refused for a case with no second session, and never with one run id when it starts several", async (t) => {
  const w = worldOf(t, FILES);
  const h = harnessOf(w, dockerDouble(NEVER));
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--memory=sometimes"]), /--memory is one of on, off, all, not sometimes/);
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--memory=off"]), /CALC-001 has no second session: --memory=off names none of them/);
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--memory=all", "--run-id=bnr-0123456789ab"]), /--run-id names one run, and --memory=all starts one run per memory arm/, "refused before any arm runs");
  assert.equal(existsSync(roomOf(w.storeRoot, "bnr-0123456789ab").dir), false, "no room was made under the id");
  const one = await COMMANDS.run.run(h, ["CALC-001", "--seed=3"]);
  assert.equal(manifestOf(w, one.run).config.memory, null, "a case with no second session runs on no memory arm");
});

test("a sessions case lists the memory arms it is compared on", () => {
  const listing = COMMANDS.list.run({ root: ROOT });
  const sessions = listing.suites.find((s) => s.id === "orbit-sessions").cases;
  assert.deepEqual(sessions.map((c) => [c.id, c.kind, (c.memory ?? []).join()]), [["ORBIT-SES-001", "sessions", "on,off"], ["ORBIT-SES-002", "sessions", "on,off"], ["ORBIT-SES-003", "sessions", "on"]]);
  assert.match(COMMANDS.list.say(listing), /ORBIT-SES-001 1\.0\.0 {2}sessions .* {2}memory on, off/);
});
