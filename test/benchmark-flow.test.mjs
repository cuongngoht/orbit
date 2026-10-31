// The benchmark's controller, carried end to end over a small repository of its own (a calculator and its test, a case
// that holds it to a sum) through a DOCKER DOUBLE: every container is run as a local process with its mounts mapped
// back to the paths the controller made, so the case's probe and the repository's own test run for real, and the
// runner and the inspection -- a coding host and Orbit's engineering loop, which no test here can be -- are played by
// functions this file names. What it proves is the controller: a pass completes and changes nothing, a planted fault
// fails as planted, a repair the verifier passes completes, a candidate that weakens a test or changes nothing does not,
// a round past its deadline is stopped, and a run interrupted mid-round is read back on resume, never sent again.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { carried } from "../benchmark/lib/flow.mjs";
import { frozenRun, resumedRun, withSpec } from "../benchmark/lib/context.mjs";
import { compared, listed, taskFound } from "../benchmark/images/runner/inspect.mjs";
import { reportOf } from "../benchmark/lib/report.mjs";
import { docRead } from "../benchmark/lib/room.mjs";
import { projectStoreRoot } from "../src/project/repository.mjs";
import { guardedIo } from "../src/store/guard.mjs";
import { realIo } from "../src/store/io.mjs";
import { apply } from "../src/task/ops.mjs";
import { createTasks } from "../src/task/store.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");

// ---- a repository of its own, with one benchmark case ------------------------------------------------------------------

const CASE = { schema: 1, id: "CALC-001", version: "1.0.0", title: "add returns a sum", goal: "add(a, b) returns a + b", measures: { kind: "correctness", capability: "calc.add", repairable: ["ORBIT_SOURCE_DEFECT"] }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, prepare: { requires: ["node"] }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "hidden/spec.mjs", probe: "hidden/probe.mjs", samples: 6 }, scope: { allow: ["src/calc.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "calc-suite", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 2, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: {}, "controlled-fault": { faults: "faults/controlled-fault.json" }, drifted: { faults: "faults/drifted.json" } }, controls: [] };

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
  "benchmark/packs/fixture/pack.json": JSON.stringify({ schema: 1, id: "fixture", version: "1.0.0", title: "a calculator", cases: ["CALC-001"] }),
  "benchmark/packs/fixture/CALC-001/case.json": JSON.stringify(CASE, null, 2),
  "benchmark/packs/fixture/CALC-001/request.md": "Make add return the sum of its two numbers.\n",
  "benchmark/packs/fixture/CALC-001/hidden/spec.mjs": SPEC,
  "benchmark/packs/fixture/CALC-001/hidden/probe.mjs": PROBE,
  "benchmark/packs/fixture/CALC-001/faults/controlled-fault.json": JSON.stringify({ schema: 1, id: "controlled-fault", about: "a sum made a difference", mutations: [{ id: "sum-reversed", file: "src/calc.mjs", find: "a + b", replace: "a - b", count: 1 }] }),
  "benchmark/packs/fixture/CALC-001/faults/drifted.json": JSON.stringify({ schema: 1, id: "drifted", about: "a fault written for a source that moved", mutations: [{ id: "product-reversed", file: "src/calc.mjs", find: "a * b", replace: "a / b", count: 1 }] }),
};

const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@orbit.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@orbit.invalid" };

function world(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-bench-flow-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "calc");
  for (const [rel, text] of Object.entries(FILES)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "calc"]]) spawnSync("git", a, { cwd: repo, env: sealed(GIT_ENV) });
  const env = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(base, "store"), ANTHROPIC_API_KEY: "test-only-not-a-key" });
  const storeRoot = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "query.mjs"), "storage", "--json"], { cwd: repo, env, encoding: "utf8" }).stdout).storeRoot;
  return { base, repo, env, storeRoot };
}

// ---- the docker double ---------------------------------------------------------------------------------------------------

const VALUED = new Set(["--user", "--cpuset-cpus", "--log-driver", "--log-opt", "--name", "--network", "--network-alias", "--label", "--tmpfs", "--cap-drop", "--security-opt", "--mount", "--cpus", "--memory", "--pids-limit", "-e", "--env-file", "-w"]);

function parsedCreate(args) {
  const c = { flags: {}, argv: [], mounts: [], labels: {}, envNames: [] };
  for (let i = 1; i < args.length; i++) i = argOf(c, args, i);
  return c;
}

function argOf(c, args, i) {
  const a = args[i];
  if (c.image) return (c.argv.push(a), i);
  if (!VALUED.has(a)) return a.startsWith("-") ? i : ((c.image = a), i);
  const v = args[i + 1];
  if (a === "--mount") c.mounts.push(Object.fromEntries(v.split(",").map((kv) => (kv === "readonly" ? ["readOnly", true] : kv.split("=")))));
  if (a === "--label") c.labels[v.split("=")[0]] = v.split("=").slice(1).join("=");
  if (a === "-e") c.envNames.push(v);
  return (c.flags[a] = [...(c.flags[a] ?? []), v], i + 1);
}

const rawOf = (c) => ({ Id: c.id, Name: `/${c.flags["--name"][0]}`, Image: c.image, Config: { User: c.flags["--user"][0], Labels: c.labels, Env: ["PATH=/usr/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", ...c.envNames, ...c.envValues] }, HostConfig: { ReadonlyRootfs: true, CapDrop: c.flags["--cap-drop"] ?? [], CapAdd: [], SecurityOpt: c.flags["--security-opt"] ?? [], NanoCpus: 1e9, Memory: 1, PidsLimit: 1, Privileged: false, Devices: [], NetworkMode: c.flags["--network"][0] }, Mounts: c.mounts.map((m) => ({ Type: "bind", Source: m.source, Destination: m.target, RW: !m.readOnly })), NetworkSettings: { Networks: { [c.flags["--network"][0]]: {} } }, State: { ExitCode: c.exit ?? 0, OOMKilled: false } });

const mapped = (c, p) => ((m) => (m ? join(m.source, p.slice(m.target.length)) : p))(c.mounts.filter((m) => p === m.target || p.startsWith(`${m.target}/`)).sort((a, b) => b.target.length - a.target.length)[0]);

// What a container's process is started with: nothing of this test runner's -- a NODE_TEST_CONTEXT inherited from it
// would make a gate's own `node --test` report to this runner instead of exiting with its result.
const containerEnv = () => Object.fromEntries(Object.entries(sealed({ HOME: tmpdir() })).filter(([k]) => k !== "NODE_TEST_CONTEXT"));

function localRun(c, opts) {
  const argv = c.argv.slice(1).map((a) => mapped(c, a));
  const r = spawnSync(process.execPath, argv, { cwd: c.flags["-w"] ? mapped(c, c.flags["-w"][0]) : tmpdir(), input: opts.input ?? "", env: containerEnv(), encoding: "utf8" });
  c.exit = r.status;
  opts.observe?.("out", Buffer.from(r.stdout ?? ""));
  return { ok: r.status === 0, status: r.status, out: r.stdout };
}

function dockerDouble(play) {
  const s = { containers: new Map(), networks: new Map(), calls: [], n: 0 };
  const verbs = {
    info: (a) => ({ ok: true, out: a.includes("{{.NCPU}}") ? "4" : "[]" }),
    image: (a) => ({ ok: true, out: JSON.stringify([{ Id: a.at(-1), Config: { Env: ["PATH=/usr/bin"], Labels: {} } }]) }),
    create: (a) => ((c) => ((c.id = `c${++s.n}`), (c.envValues = envValues(c)), s.containers.set(c.id, c), { ok: true, out: `${c.id}\n` }))(parsedCreate(a)),
    inspect: (a) => (s.containers.get(a[1]) ? { ok: true, out: JSON.stringify([rawOf(s.containers.get(a[1]))]) } : { ok: false, out: "[]" }),
    network: (a) => networkVerb(s, a),
    rm: (a) => (s.containers.delete(a.at(-1)), { ok: true, out: "" }),
    ps: (a) => ({ ok: true, out: [...s.containers.values()].filter((c) => labelled(c.labels, a)).map((c) => c.id).join("\n") }),
  };
  const process = { run: (file, a) => (s.calls.push(a), (verbs[a[0]] ?? (() => ({ ok: true, out: "" })))(a)), runObserved: async (file, a, opts) => (s.calls.push(a), attached(s.containers.get(a.at(-1)), opts, play)) };
  return { s, deps: () => ({ process, env: {}, scratch: { write: (text) => ((f) => (writeFileSync(f, text), f))(join(mkdtempSync(join(tmpdir(), "orbit-env-")), "x.env")), remove: () => null } }) };
}

const envValues = (c) => (c.flags["--env-file"] ? readFileSync(c.flags["--env-file"][0], "utf8").split("\n").filter(Boolean).map((l) => l.split("=")[0]) : []);

const networkVerb = (s, a) => ({ inspect: () => (s.networks.has(a[2]) ? { ok: true, out: JSON.stringify([{ Id: a[2], Internal: true, Labels: s.networks.get(a[2]), Containers: {} }]) } : { ok: false, out: "[]" }), create: () => (s.networks.set(a.at(-1), Object.fromEntries(a.filter((x, i) => a[i - 1] === "--label").map((l) => l.split("=")))), { ok: true, out: "n1" }), rm: () => (s.networks.delete(a.at(-1)), { ok: true, out: "" }), ls: () => ({ ok: true, out: [...s.networks].filter(([, labels]) => labelled(labels, a)).map(([name]) => name).join("\n") }), connect: () => ({ ok: true, out: "" }) })[a[1]]?.() ?? { ok: true, out: "" };

// What `--filter label=<key>=<value>` keeps: what carries that label with that value.
const labelled = (labels, a) => ((f) => !f || labels?.[f.slice(6).split("=")[0]] === f.slice(6).split("=").slice(1).join("="))(a.find((x, i) => a[i - 1] === "--filter" && x.startsWith("label=")));

async function attached(c, opts, play) {
  if (c.argv[1] === "/bench/entry.mjs") return played(c, await play.runner(c, (p) => mapped(c, p)));
  if (c.argv[1] === "/bench/inspect.mjs") return played(c, play.inspect(c, (p) => mapped(c, p)));
  if (c.argv[1] === "/bench/egress.mjs") return { ok: true, out: "" };
  return localRun(c, opts);
}

const played = (c, r) => ((c.exit = r?.exit ?? 0), r?.timedOut ? { ok: false, out: "", timedOut: true } : { ok: true, out: "", status: c.exit });

// ---- the runner and the inspection, played -------------------------------------------------------------------------------

const TASK = "tsk-0000000000a1";

const workspaceOf = (at) => join(at("/work/store"), "repo-calc", "workspaces", TASK, "tree");

// A round as a runner plays it: the task started and said (start.json), the workspace made and edited, the host's
// stream written. `o.dies` is the controller dying mid-round -- after what `o.dies` names, nothing more is written.
function ranAs(edits, o = {}) {
  return async (c, at) => {
    const out = at("/work/out");
    if (o.dies === "before-start") throw new Error("the controller died here");
    writeFileSync(join(out, "start.json"), JSON.stringify({ task: TASK, started: true, egress: { holds: true } }));
    const tree = workspaceOf(at);
    if (!existsSync(tree)) cpSync(at("/work/repo"), tree, { recursive: true, filter: (p) => !p.includes(".git") });
    for (const [rel, text] of Object.entries(edits)) writeFileSync(join(tree, rel), text);
    if (o.dies === "after-edits") throw new Error("the controller died here");
    writeFileSync(join(out, "runner.json"), JSON.stringify({ task: TASK, exit: 0, egress: { holds: true } }));
    writeFileSync(join(out, "host.jsonl"), [{ type: "system", subtype: "init", model: "test-double" }, { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } }, { type: "result", subtype: "success", is_error: false, num_turns: 2, total_cost_usd: 0.5 }].map((e) => JSON.stringify(e)).join("\n"));
    return o.timedOut ? { timedOut: true } : { exit: 0 };
  };
}

// The inspection as inspect.mjs makes it: the task it was named, else the one task the runner store holds (here: the
// one whose workspace a runner made), else none -- and the workspace compared with the subject.
function inspectedAs(view) {
  return (c, at) => {
    const out = at("/work/out");
    const tree = workspaceOf(at);
    const held = existsSync(tree) ? [{ id: TASK }] : [];
    const task = c.argv[2] !== "-" ? c.argv[2] : (held[0]?.id ?? null);
    const changes = task && existsSync(tree) ? compared(listed(at("/work/repo"), [".claude-plugin/types"]), listed(tree)) : [];
    for (const ch of changes.filter((x) => x.change !== "deleted")) (mkdirSync(dirname(join(out, "files", ch.rel)), { recursive: true }), cpSync(join(tree, ch.rel), join(out, "files", ch.rel)));
    writeFileSync(join(out, "inspect.json"), JSON.stringify({ task, found: c.argv[2] !== "-" ? "start" : task ? "only-task" : null, workspace: Boolean(task) && existsSync(tree), changes: changes.map((ch) => ({ ...ch, copied: ch.change !== "deleted" })) }));
    for (const [name, v] of [["task.json", task ? { exit: 0, json: view } : { exit: null, json: null, why: "no task was started" }], ["tasks.json", { exit: 0, json: { tasks: held } }], ["trace.json", { exit: 0, json: {} }]]) writeFileSync(join(out, name), JSON.stringify(v));
    return { exit: 0 };
  };
}

const VIEW = (lifecycle) => ({ task: { id: TASK, provider: "autonomous-engineering" }, lifecycle, terminal: ["COMPLETED", "FAILED"].includes(lifecycle), stopReason: null, stage: "REVIEWING", attempts: [{ id: "att-1" }], receipts: [], changes: { files: 1 } });

const FIXED = { "src/calc.mjs": "export const add = (a, b) => a + b;\n", "test/calc-regression.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds, again", () => {\n  assert.equal(add(2, 2), 4);\n});\n' };

const NEVER = { runner: () => assert.fail("no runner was asked for"), inspect: () => assert.fail("no inspection was asked for") };

async function runOf(w, double, o) {
  const h = { root: w.repo, engine: ROOT, env: w.env, taskEnv: w.env, credential: null, caFile: null, storeRoot: w.storeRoot, storeBase: dirname(w.storeRoot), dockerDeps: double.deps };
  const ctx = await withSpec(frozenRun(h, { caseId: "CALC-001", variant: o.variant ?? "real", repair: o.repair === true, seed: 3, images: { verifier: `sha256:${"a".repeat(64)}`, runner: `sha256:${"b".repeat(64)}`, claudeCode: "double" }, dockerVersion: "double" }));
  return { h, ctx, result: await carried(ctx), view: ctx.rec.show(ctx.task) };
}

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
  const ctx = await withSpec(resumedRun({ root: w.repo, engine: ROOT, env: w.env, taskEnv: w.env, credential: null, caFile: null, storeRoot: w.storeRoot, storeBase: dirname(w.storeRoot), dockerDeps: double.deps }, runId));
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
  const ctx = await withSpec(resumedRun({ root: w.repo, engine: ROOT, env: w.env, taskEnv: w.env, credential: null, caFile: null, storeRoot: w.storeRoot, storeBase: dirname(w.storeRoot), dockerDeps: again.deps }, r.ctx.run.id));
  const after = await carried(ctx);
  assert.deepEqual([after.outcome, ctx.rec.show(ctx.task).lifecycle], ["REPAIRED_VERIFIED", "COMPLETED"]);
});

test("a fault that no longer matches the source refuses the run before anything is recorded: FIXTURE_DRIFT, never a run on a tree without it", async (t) => {
  const w = world(t);
  await assert.rejects(runOf(w, dockerDouble(NEVER), { variant: "drifted" }), (e) => e.code === "FIXTURE_DRIFT" && /expects 1 occurrence\(s\) in src\/calc\.mjs and finds 0/.test(e.message));
  assert.equal(existsSync(join(w.storeRoot, "benchmark")), false, "no run room");
  assert.equal(benchTask(w), undefined, "no task");
});
