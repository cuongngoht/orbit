// The SCRIPTED HOST a repair control runs in the runner in place of a coding host, run here over a real repository and
// Orbit's real engineering CLI -- no container, no model, no network: a task started the way the runner starts one,
// driven one decided step at a time with the control's edits made in the task's own workspace, until the engine itself
// completes it with a commit in its own delivery. What the round left is what the inspection reads back. An idle script
// changes nothing; an edit that no longer matches is said and not made; a scripted host never needs a credential.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { compared, listed } from "../benchmark/images/runner/inspect.mjs";
import { hostCommand, isScripted } from "../benchmark/images/runner/entry.mjs";
import { edited, SCRIPTS, scopeOf } from "../benchmark/images/runner/scripted.mjs";
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
