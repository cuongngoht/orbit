// The SCRIPTED HOST a control runs in the runner in place of a coding host, run here over a real repository and Orbit's
// real CLIs -- no container, no model, no network. A REPAIR script drives a task started the way the runner starts one,
// one decided step at a time with the control's edits made in the task's own workspace, until the engine itself
// completes it with a commit in its own delivery. A GOAL script starts where a person would, at Orbit's goal entry, and
// drives the workflow the goal's step starts and the engineering task that workflow starts, to the same end; a BLOCKED
// one records the rule the goal leaves out and starts nothing; an INTERRUPT one kills its own check mid-run, and its next
// round reconciles the action the crash left open and goes on -- never sending it again. An idle script changes nothing;
// an edit that no longer matches is said and not made; a scripted host never needs a credential.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { test } from "node:test";
import { compared, listed } from "../benchmark/images/runner/inspect.mjs";
import { hostCommand, isScripted, isSession } from "../benchmark/images/runner/entry.mjs";
import { hostBasisOf } from "../benchmark/lib/source/flow.mjs";
import { edited, SCRIPTS, scopeOf, stateOf } from "../benchmark/images/runner/scripted.mjs";
import { fixtureEntries, variantEntries } from "../benchmark/lib/core/context.mjs";
import { candidateFile } from "../benchmark/lib/core/mutations.mjs";
import { caseOf } from "../benchmark/lib/core/suites.mjs";
import { shaBytes } from "../src/hash.mjs";
import { createProcess } from "../src/process/index.mjs";
import { GIT_ENV, ROOT } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";

const npmHere = () => createProcess({ timeoutMs: 30000 }).run("npm", ["--version"], { env: sealed() }).ok;

const FILES = {
  "package.json": `${JSON.stringify({ name: "calc", version: "1.0.0", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
  "package-lock.json": `${JSON.stringify({ name: "calc", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "calc", version: "1.0.0" } } }, null, 2)}\n`,
  "src/calc.mjs": "export const add = (a, b) => a - b;\n",
  "test/calc.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds nothing to nothing", () => {\n  assert.equal(add(0, 0), 0);\n});\n',
};

const DEFINITION = { mutations: [{ id: "sum", file: "src/calc.mjs", find: "a - b", replace: "a + b", count: 1 }], files: [{ rel: "test/calc-sum.test.mjs", lines: ['import assert from "node:assert/strict";', 'import { test } from "node:test";', 'import { add } from "../src/calc.mjs";', 'test("sums", () => {', "  assert.equal(add(2, 3), 5);", "});"] }], deletes: [] };

function repository(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-bench-scripted-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  for (const [rel, text] of Object.entries(FILES)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  const env = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(base, "store") });
  for (const a of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "calc"]]) spawnSync("git", a, { cwd: repo, env });
  return { repo, env };
}

// The task as the runner's entry starts it, before any host runs: ONE task, through Orbit's own start.
const started = (at, objective) => JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "autonomous-engineering.mjs"), "start", objective, "--json"], { cwd: at.repo, env: at.env, encoding: "utf8" }).stdout).task;

const shown = (at, task) => JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "show", task, "--json"], { cwd: at.repo, env: at.env, encoding: "utf8" }).stdout);

const hostOn = (at, task, mode) => ({ task, repo: at.repo, plugin: ROOT, env: at.env, say: (e) => hostOn.said.push(e), revision: null, steps: [], script: { id: "reference", mode, intent: "make add return the sum of its two numbers", definition: DEFINITION } });

hostOn.said = [];

test("the scripted host drives Orbit's real engineering loop to a completed task with a commit, editing only the task's own workspace", { skip: !npmHere() && "npm is not runnable here: the declared check is an npm script" }, (t) => {
  const at = repository(t);
  const task = started(at, "make add return the sum of its two numbers");
  const s = hostOn(at, task, "apply");
  assert.deepEqual(SCRIPTS.apply(s), [], s.steps.map((x) => `${x.kind} ${x.status} ${x.why ?? ""}`).join("\n"));
  const view = shown(at, task);
  assert.deepEqual([view.lifecycle, view.task.provider], ["COMPLETED", "autonomous-engineering"]);
  assert.ok(view.receipts.some((r) => r.domain === "commit"), "the engine committed the verified change in its own delivery");
  assert.deepEqual(s.steps.map((x) => x.kind), ["gather-context", "check-environment", "prepare-workspace", "plan", "implement", "record-changes", "check", "commit", "review"]);
  assert.equal(readFileSync(join(at.repo, "src/calc.mjs"), "utf8"), FILES["src/calc.mjs"], "the checkout itself is never written");
  const tree = view.workspace ?? JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "autonomous-engineering.mjs"), "context", task, "--json"], { cwd: at.repo, env: at.env, encoding: "utf8" }).stdout).workspace.path;
  assert.deepEqual(compared(listed(at.repo), listed(typeof tree === "string" ? tree : tree.path)).map((c) => [c.rel, c.change]), [["src/calc.mjs", "modified"], ["test/calc-sum.test.mjs", "added"]], "what the inspection reads back is exactly the control's edits");
});

test("an idle script changes nothing and takes no step: the task stays where Orbit's start left it", { skip: !npmHere() && "npm is not runnable here" }, (t) => {
  const at = repository(t);
  const task = started(at, "make add return the sum of its two numbers");
  const s = hostOn(at, task, "idle");
  assert.deepEqual([SCRIPTS.idle(s), s.steps], [[], []]);
  assert.equal(shown(at, task).stage, "CONTEXT");
});

test("an edit that no longer matches the workspace is said, and not made; the plan's scope is every path the definition touches", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-edits-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/calc.mjs"), "export const add = (a, b) => a * b;\n");
  assert.match(edited(dir, { mutations: DEFINITION.mutations })[0], /sum: expected 1 occurrence\(s\) in src\/calc\.mjs, found 0/);
  assert.equal(readFileSync(join(dir, "src/calc.mjs"), "utf8"), "export const add = (a, b) => a * b;\n");
  assert.deepEqual(scopeOf({ ...DEFINITION, deletes: ["test/old.test.mjs"] }), ["src/calc.mjs", "test/calc-sum.test.mjs", "test/old.test.mjs"]);
});

test("the runner runs a control's scripted host in place of Claude Code, on the round's own task, and never a model for it", () => {
  assert.equal(isScripted({ host: "scripted:reference" }), true);
  assert.equal(isScripted({ host: null }), false);
  assert.deepEqual(hostCommand({ host: "scripted:reference" }, "tsk-0000000000a1"), [process.execPath, ["/bench/scripted.mjs", "tsk-0000000000a1"]]);
  assert.equal(hostCommand({ host: null, kind: "source" }, "tsk-0000000000a1")[0], "claude");
});

// ---- a GOAL through Orbit's goal entry, over an engineering case's own target -------------------------------------------

// Paths as frozen entries carry them, with `/` on every OS.
const FIXTURE = "benchmark/fixtures/orders";

const fixtureOnDisk = () => readdirSync(join(ROOT, FIXTURE), { recursive: true }).filter((rel) => statSync(join(ROOT, FIXTURE, rel)).isFile()).map((rel) => ((bytes) => ({ rel: `${FIXTURE}/${rel.split(sep).join("/")}`, mode: "file", bytes, digest: shaBytes(bytes) }))(readFileSync(join(ROOT, FIXTURE, rel))));

// The target a run of the case hands a goal: the fixture with the case's real variant in it, as a one-commit checkout.
function targetRepository(t, c) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-bench-goal-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  for (const e of variantEntries(c, "real", fixtureEntries(c, fixtureOnDisk())).entries) (mkdirSync(dirname(join(repo, e.rel)), { recursive: true }), writeFileSync(join(repo, e.rel), e.bytes));
  const env = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(base, "store") });
  for (const a of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "target"]]) spawnSync("git", a, { cwd: repo, env });
  return { repo, env };
}

const goalHost = (at, c, repairId, round = 1) => ((r) => ({ ...stateOf({ plugin: ROOT, goal: readFileSync(join(c.dir, c.request), "utf8"), round, script: { id: r.id, mode: r.script, intent: c.title, definition: candidateFile(c.dir, r.candidate) } }, "-"), repo: at.repo, env: at.env, say: () => {} }))(c.repairs.find((x) => x.id === repairId));

const tasksOf = (at) => JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "list", "--json"], { cwd: at.repo, env: at.env, encoding: "utf8" }).stdout).tasks;

const goalPlanOf = (at, goal) => ((store) => JSON.parse(readFileSync(join(store, readdirSync(store).find((d) => readdirSync(join(store, d)).includes("goals")), "goals", goal, "plan-1.json"), "utf8")))(at.env.ORBIT_STORE_DIR);

const stepsSaid = (s) => s.steps.map((x) => `${x.kind} ${x.status} ${x.why ?? ""}`).join("\n");

test("a goal script takes a goal through Orbit's goal entry: the goal planned, the workflow its step starts, and the engineering task that workflow starts -- completed with a commit, the checkout never written", { skip: !npmHere() && "npm is not runnable here: the declared check is an npm script" }, (t) => {
  const c = caseOf(ROOT, "ORBIT-E2E-001");
  const at = targetRepository(t, c);
  const before = readFileSync(join(at.repo, "src/money.mjs"), "utf8");
  const s = goalHost(at, c, "reference");
  assert.deepEqual(SCRIPTS.goal(s), [], stepsSaid(s));
  const tasks = tasksOf(at);
  const eng = tasks.find((x) => x.provider === "autonomous-engineering");
  const auto = tasks.find((x) => x.provider === "automation");
  assert.deepEqual([tasks.length, eng.lifecycle, auto.lifecycle, eng.parent], [2, "COMPLETED", "COMPLETED", auto.id], "one workflow, one engineering task it started, both completed");
  assert.equal(s.auto, auto.id, "the workflow is the one the goal's step started");
  assert.ok(shown(at, eng.id).receipts.some((r) => r.domain === "commit"), "the engine committed the verified change in its own delivery");
  assert.deepEqual(s.steps.slice(0, 4).map((x) => x.kind), ["orbit goal start", "orbit goal analyze", "orbit goal plan", "orbit goal step"]);
  assert.equal(readFileSync(join(at.repo, "src/money.mjs"), "utf8"), before, "the checkout itself is never written");
});

test("a blocked script records the rule the goal leaves out: the plan leaves the change unresolved, and no workflow or task is started", (t) => {
  const c = caseOf(ROOT, "ORBIT-E2E-008");
  const at = targetRepository(t, c);
  const s = goalHost(at, c, "blocked");
  assert.deepEqual(SCRIPTS.blocked(s), [], stepsSaid(s));
  assert.deepEqual(tasksOf(at), [], "nothing was started on a guess");
  assert.deepEqual(goalPlanOf(at, s.goalId).units.map((u) => [u.kind, u.state, /^missing:/.test(u.because ?? "")]), [["change", "unresolved", true]]);
});

test("an interrupt script kills its own check mid-run; the next round reconciles the action the crash left open, takes it again as a new action, and completes the same task", { skip: (process.platform === "win32" && "the kill takes the step's whole process group, which is POSIX: the scripted host runs only in the Linux runner") || (!npmHere() && "npm is not runnable here"), timeout: 300000 }, (t) => {
  const c = caseOf(ROOT, "ORBIT-E2E-007");
  const at = targetRepository(t, c);
  const first = goalHost(at, c, "interrupted", 1);
  assert.match(SCRIPTS.interrupt(first).join(" "), /killed mid-run, as this control intends/, stepsSaid(first));
  const cut = tasksOf(at).find((x) => x.provider === "autonomous-engineering");
  assert.notEqual(cut.lifecycle, "COMPLETED", "the first round left the task open");
  const second = goalHost(at, c, "interrupted", 2);
  assert.deepEqual(SCRIPTS.interrupt(second), [], stepsSaid(second));
  const tasks = tasksOf(at);
  const view = shown(at, cut.id);
  const interrupted = view.actions.filter((a) => /^interrupted/.test(a.reason ?? ""));
  assert.deepEqual([tasks.filter((x) => x.provider === "autonomous-engineering").length, view.lifecycle], [1, "COMPLETED"], "one engineering task, carried across both rounds");
  assert.equal(interrupted.length, 1, "the action the crash left open was closed as interrupted");
  assert.deepEqual(interrupted[0].receipts, [], "no outcome was taken from it");
  assert.ok(view.actions.some((a) => a.tool === interrupted[0].tool && a.state === "succeeded" && Number(a.id.slice(4)) > Number(interrupted[0].id.slice(4))), "and it was taken again as a new action that settled");
  assert.ok(view.actions.every((a) => a.state !== "running"), "nothing is left running");
});

test("a session host waits in the runner while the operator's own session drives the round from outside: no model, no network and no credential in the container, and its runs kept apart", () => {
  assert.equal(isSession({ host: "session:demo" }), true);
  assert.deepEqual(hostCommand({ host: "session:demo" }, "tsk-0000000000a1"), [process.execPath, ["/bench/session.mjs", "tsk-0000000000a1"]]);
  assert.deepEqual(["session:demo", "scripted:reference", null].map((host) => hostBasisOf({ repair: true, host })), ["session", "scripted", "coding-host"]);
  assert.equal(hostBasisOf({ repair: false, host: "session:demo" }), "none");
});
