// What a release ship asks of the benchmark (skills/orbit-release/ship.mjs drives it as a command, ADR 0049), proved
// through the Docker double over a small repository of its own: a run that measures ANOTHER checkout of the repository
// (`--tree`) while its cases, harness, store and task stay the engine checkout's; a room named before the run starts
// (`--run-id`); the task that started it (`--parent`); a control that no longer applies being its own DRIFTED row; a
// credential block that says its cause; and the host probe (`doctor --host`) that asks the runner image's Claude Code
// one question, BLOCKED by name when it cannot be asked or does not answer -- never a fallback.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COMMANDS } from "../benchmark/lib/commands.mjs";
import { samePath } from "../src/frontend/local-clones.mjs";
import { frozenRun, withSpec } from "../benchmark/lib/core/context.mjs";
import { PROBE_PROMPT } from "../benchmark/lib/core/probe.mjs";
import { docRead, roomOf } from "../benchmark/lib/core/room.mjs";
import { carried } from "../benchmark/lib/source/flow.mjs";
import { qaBasisOf } from "../benchmark/lib/qa/report.mjs";
import { hostCommand } from "../benchmark/images/runner/entry.mjs";
import { dockerDouble, GIT_ENV, harnessOf, IMAGES, NEVER, ROOT, worldOf } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

const CASE = { schema: 1, kind: "source", id: "CALC-001", version: "1.0.0", title: "add returns a sum", goal: "add(a, b) returns a + b", measures: { kind: "correctness", capability: "calc.add", repairable: ["ORBIT_SOURCE_DEFECT"] }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, prepare: { requires: ["node"] }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/calc.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "calc-suite", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 2, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: {}, "controlled-fault": { mutations: "variants/controlled-fault.json" }, drifted: { mutations: "variants/drifted.json" } }, controls: [{ id: "clean", variant: "real", expect: "PASS" }, { id: "planted", variant: "controlled-fault", expect: "FAIL" }, { id: "stale", variant: "drifted", expect: "FAIL" }] };

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

const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: sealed(GIT_ENV), encoding: "utf8" }).trim();

// Another checkout of the same repository -- a release ship's pristine checkout of its release commit -- whose source
// differs from the engine checkout's by one committed change.
function cloneWith(w, rel, text) {
  const dir = join(w.base, "release-tree");
  git(w.base, "clone", "-q", "--no-hardlinks", w.repo, dir);
  writeFileSync(join(dir, rel), text);
  git(dir, "commit", "-qam", "the release commit");
  return dir;
}

const runIn = async (h, o) => ((ctx) => ({ ctx, result: carried(ctx) }))(await withSpec(frozenRun(h, { caseId: "CALC-001", variant: "real", seed: 3, images: IMAGES, dockerVersion: "double", ...o })));

test("--tree: the run measures the named checkout's HEAD, while its case, task and room stay the engine checkout's", async (t) => {
  const w = worldOf(t, FILES);
  const tree = cloneWith(w, "src/calc.mjs", "export const add = (a, b) => a - b;\n");
  const h = { ...harnessOf(w, dockerDouble(NEVER)), tree };
  const { ctx, result } = await runIn(h, {});
  // One directory however it is spelled: git names the top directory long on Windows, where the temporary path is short.
  assert.deepEqual([(await result).outcome, samePath(ctx.manifest.source.repo, tree), ctx.manifest.source.commit], ["FAIL", true, git(tree, "rev-parse", "HEAD")]);
  assert.ok(ctx.room.dir.startsWith(w.storeRoot), "the room is in the engine checkout's store");
  assert.equal(readFileSync(join(w.repo, "src/calc.mjs"), "utf8"), FILES["src/calc.mjs"], "neither checkout is written");
  mkdirSync(join(tree, "src", "deeper"), { recursive: true });
  assert.throws(() => frozenRun({ ...h, tree: join(tree, "src") }, { caseId: "CALC-001", images: IMAGES }), /names a checkout's top directory/);
});

test("--run-id names the room before the run starts, once; --parent is the run task's parent", async (t) => {
  const w = worldOf(t, FILES);
  const h = harnessOf(w, dockerDouble(NEVER));
  const parent = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "create", "a release ship", "--provider=release", "--json"], { cwd: w.repo, env: w.env, encoding: "utf8" }).stdout).task;
  const { ctx, result } = await runIn(h, { runId: "bnr-0123456789ab", parent });
  assert.deepEqual([(await result).outcome, ctx.run.id, ctx.manifest.config.parent], ["PASS", "bnr-0123456789ab", parent]);
  assert.equal(ctx.rec.show(ctx.task).task.parent, parent, "Mission Control shows the run as part of the ship");
  assert.throws(() => frozenRun(h, { caseId: "CALC-001", images: IMAGES, runId: "bnr-0123456789ab" }), /already kept/);
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--run-id=not-a-run"]), /--run-id is bnr-/);
  await assert.rejects(async () => COMMANDS.run.run(h, ["--suite=fixture", "--run-id=bnr-0123456789ac"]), /--run-id names one run/);
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--parent=tsk-nope"]), /--parent is a task's id/);
});

test("a control that no longer applies is its own DRIFTED row: the others still run, and the command exits 2", async (t) => {
  const w = worldOf(t, FILES);
  const r = await COMMANDS.controls.run(harnessOf(w, dockerDouble(NEVER)), ["CALC-001"]);
  assert.deepEqual(r.rows.map((x) => [x.id, x.got, x.matched]), [["clean", "PASS", true], ["planted", "FAIL", true], ["stale", "DRIFTED", false]]);
  assert.match(r.rows[2].summary, /FIXTURE_DRIFT: control stale does not apply/);
  assert.equal(r.exit, 2);
  assert.equal((await COMMANDS.controls.run(harnessOf(w, dockerDouble(NEVER)), ["CALC-001", "--only=planted"])).exit, 0);
});

test("a repair with no credential ends BLOCKED and says its cause and class -- a release reads them, never the sentence", async (t) => {
  const w = worldOf(t, FILES);
  const env = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(w.base, "store") });
  const { ctx, result } = await runIn({ ...harnessOf({ ...w, env }, dockerDouble(NEVER)) }, { variant: "controlled-fault", repair: true });
  assert.equal((await result).outcome, "BLOCKED");
  assert.deepEqual([docRead(ctx.room, "ending.json").cause, docRead(ctx.room, "ending.json").class], ["CREDENTIALS", "ENVIRONMENT_BLOCKED"]);
});

test("a QA run says who carried it, in the words every report uses", () => {
  assert.deepEqual([qaBasisOf({ host: "coding-host" }), qaBasisOf({}), qaBasisOf({ host: "session:me" }), qaBasisOf({ host: "reference" })], ["coding-host", "coding-host", "session", "scripted"]);
});

// ---- the host probe ------------------------------------------------------------------------------------------------------

const RUNNER = `sha256:${"c".repeat(64)}`;

// The double, with the runner image carrying the Claude Code version its Dockerfile pins (or none).
function labelled(double, version) {
  const deps = double.deps();
  const run = (file, a, o) => (a[0] === "inspect" && a[1] === RUNNER ? { ok: true, out: JSON.stringify([{ Id: RUNNER, Config: { Labels: version ? { "orbit.benchmark.claude-code": version } : {} } }]) } : deps.process.run(file, a, o));
  return { ...double, deps: () => ({ ...deps, process: { ...deps.process, run } }) };
}

const events = (o) => [{ type: "system", subtype: "init", model: "claude-test", claude_code_version: o.version ?? "2.1.314", session_id: "s-1" }, { type: "result", subtype: o.error ? "error_during_execution" : "success", is_error: Boolean(o.error), result: o.error ?? "READY", num_turns: 1, total_cost_usd: 0.01 }];

// The runner as a probe round plays it: what entry.mjs writes, from the brief it is handed.
const probing = (seen, o = {}) => ({ ...NEVER, runner: async (c, at) => {
  seen.push({ brief: JSON.parse(readFileSync(at("/run/brief/brief.json"), "utf8")), env: c.envNames, mounts: c.mounts.map((m) => m.target), network: c.flags["--network"][0] });
  writeFileSync(join(at("/work/out"), "start.json"), JSON.stringify({ task: null, started: false, probe: true, egress: { holds: o.egress !== false } }));
  writeFileSync(join(at("/work/out"), "runner.json"), JSON.stringify({ exit: o.started === false ? 1 : 0, egress: { holds: o.egress !== false } }));
  writeFileSync(join(at("/work/out"), "host.jsonl"), o.started === false ? "" : events(o).map((e) => JSON.stringify(e)).join("\n"));
  return { exit: 0 };
} });

const doctorHost = (w, double, env = w.env) => COMMANDS.doctor.run({ ...harnessOf(w, double), env, taskEnv: env }, ["--host"]);

test("doctor --host: the runner image's Claude Code answers one question through the egress proxy, with the credential by name", async (t) => {
  const w = worldOf(t, FILES);
  const seen = [];
  const r = (await doctorHost(w, labelled(dockerDouble(probing(seen)), "2.1.314"))).host;
  assert.deepEqual([r.ok, r.code, r.image, r.reported, r.model, r.costUsd], [true, "OK", "2.1.314", "2.1.314", "claude-test", 0.01]);
  assert.deepEqual([seen[0].brief.kind, seen[0].brief.prompt, seen[0].brief.usd], ["probe", PROBE_PROMPT, 0.05]);
  assert.ok(seen[0].env.includes("ANTHROPIC_API_KEY") && seen[0].network.startsWith("orbit-bench-"), "the credential by name, on the run's own network");
  assert.ok(!seen[0].mounts.includes("/work/store") && !seen[0].mounts.includes("/work/orbit"), "no store and no plugin");
  assert.equal(docRead(roomOf(w.storeRoot, r.evidence.split(/[\\/]/).at(-1)), "manifest.json").kind, "probe");
});

test("doctor --host hands the probe's containers a Docker client bound to the probe's own scratch room", async (t) => {
  const w = worldOf(t, FILES);
  const rooms = [];
  const d = labelled(dockerDouble(probing([])), "2.1.314");
  const r = (await doctorHost(w, { ...d, deps: (room) => (rooms.push(room ?? null), d.deps(room)) })).host;
  assert.equal(r.code, "OK");
  assert.ok(rooms.some((room) => room?.dir?.startsWith(w.storeRoot)), "the environment file each container is handed needs a room to be written in -- with none, the real client throws and the ship reads CLI_UNAVAILABLE");
});

test("doctor --host says why when no real host can answer, and starts nothing it cannot use", async (t) => {
  const w = worldOf(t, FILES);
  const ask = async (double, env) => (await doctorHost(w, double, env)).host;
  const none = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(w.base, "store") });
  const seen = [];
  assert.equal((await ask(labelled(dockerDouble(probing(seen)), null))).code, "CLI_UNAVAILABLE", "no version pinned in the image");
  assert.equal((await ask(labelled(dockerDouble(probing(seen)), "2.1.314"), none)).code, "AUTH_MISSING");
  assert.equal(seen.length, 0, "nothing was started for either");
  assert.equal((await ask(labelled(dockerDouble(probing(seen, { error: "Invalid API key · Please run /login" })), "2.1.314"))).code, "AUTH_REFUSED");
  assert.equal((await ask(labelled(dockerDouble(probing(seen, { version: "2.1.300" })), "2.1.314"))).code, "CLI_MISMATCH");
  assert.equal((await ask(labelled(dockerDouble(probing(seen, { started: false })), "2.1.314"))).code, "PROVIDER");
  assert.equal((await ask(labelled(dockerDouble(probing(seen, { egress: false })), "2.1.314"))).code, "EGRESS");
});

test("a probe round runs Claude Code with no plugin, no tool it may use, and a budget of cents", () => {
  const [program, argv] = hostCommand({ kind: "probe", usd: 0.05, model: "claude-x" });
  assert.equal(program, "claude");
  assert.ok(!argv.includes("--plugin-dir") && !argv.includes("--allowedTools") && !argv.includes("--add-dir"));
  assert.deepEqual(argv.slice(argv.indexOf("--max-budget-usd"), argv.indexOf("--max-budget-usd") + 2), ["--max-budget-usd", "0.05"]);
  assert.match(argv[argv.indexOf("--disallowedTools") + 1], /Bash.*Edit.*Write/);
  assert.equal(argv[argv.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(existsSync(join(ROOT, "benchmark", "images", "runner", "entry.mjs")));
});
