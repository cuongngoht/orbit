// The coordinator through its real CLI, in a real Git checkout with its own store: on by default with no settings
// document at all (a fresh install), and refused only while a person keeps a restriction from before; a workflow
// is planned, its engine steps run here, its engineering step starts a REAL engineering task through autonomous
// engineering's own CLI -- one that names the workflow as its parent -- a settle is refused while that task runs
// and when it asserts an outcome, and the checkout is never written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stateRooms } from "../src/store/control.mjs";
import { sealed } from "./home.mjs";

const CLI = resolve("cli/automation.mjs");

const TASK_CLI = resolve("cli/task.mjs");

function checkout(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-auto-cli-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  const env = sealed({ ORBIT_STORE_DIR: join(base, "store"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
  spawnSync("git", ["init", "-q", repo], { env });
  spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo, env });
  return { repo, env, store: join(base, "store") };
}

const run = (c, args, input) => spawnSync(process.execPath, [CLI, ...args], { cwd: c.repo, env: c.env, input, encoding: "utf8" });

const json = (r) => JSON.parse(r.stdout);

const decision = (step, revision, id) => JSON.stringify({ schemaVersion: 1, decisionId: id, expectedRevision: revision, action: { kind: "run", step }, observed: "the step is ready", hypothesis: "running it moves the workflow on" });

const revisionOf = (c, task) => json(run(c, ["context", task, "--json"])).revision;

// A machine whose settings document was written before autonomy was the default, by hand: schema 1.
function legacyMachine(c, content) {
  const file = join(stateRooms(c.store).automation, "settings.json");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...content, schema: 1 })}\n`);
  return file;
}

test("a fresh install is autonomous-first: no settings document, nothing to turn on, nothing written by a look", (t) => {
  const c = checkout(t);
  const status = json(run(c, ["status", "--json"]));
  assert.equal("enabled" in status.effective.values, false);
  assert.equal("mode" in status.effective.values, false);
  assert.equal("mode" in status.effective.values.skillFactory, false);
  assert.equal("restrictions" in status.effective, false);
  assert.equal(existsSync(join(stateRooms(c.store).automation, "settings.json")), false, "reading the settings creates no document");
  assert.match(run(c, ["doctor"]).stdout, /on by default/);
});

test("a restriction a person kept from before is honoured: start is refused, and nothing is written", (t) => {
  const c = checkout(t);
  legacyMachine(c, { enabled: false });
  assert.equal(run(c, ["status", "--json"]).status, 2);
  const r = run(c, ["start", "--for=Implement the refund validation rule"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr + r.stdout, /unsupported Orbit state/);
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: c.repo, encoding: "utf8" }).stdout, "");
});

test("on with no settings at all: planned, engine steps run here, the engineering step starts a real engineering task that names its parent, and nothing settles on the host's word", (t) => {
  const c = checkout(t);
  const started = json(run(c, ["start", "--for=Implement the refund validation rule", "--json"]));
  assert.deepEqual(started.plan.steps.map((s) => s.id), ["context", "runtime", "engineering", "regression", "review"]);
  const task = started.task;
  assert.equal(json(run(c, ["step", task, "--json"], decision("context", revisionOf(c, task), "d-1"))).stepState, "reported");
  assert.equal(json(run(c, ["step", task, "--json"], decision("runtime", revisionOf(c, task), "d-2"))).stepState, "succeeded");
  const eng = json(run(c, ["step", task, "--json"], decision("engineering", revisionOf(c, task), "d-3")));
  assert.equal(eng.how.provider.id, "orbit-engineering-agent");
  const child = /resume (tsk-[a-f0-9]{12})/.exec(eng.how.invoke)?.[1];
  assert.ok(child, "the host is told which engineering task to drive");
  const shown = JSON.parse(spawnSync(process.execPath, [TASK_CLI, "show", child, "--json"], { cwd: c.repo, env: c.env, encoding: "utf8" }).stdout);
  assert.equal(shown.task.parent, task, "the child engineering task names the workflow that started it");
  const settle = (extra) => run(c, ["settle", task], JSON.stringify({ schemaVersion: 1, decisionId: "d-3", expectedRevision: eng.revision, stepId: "engineering", executionState: "succeeded", evidenceRefs: [`task:${child}`], ...extra }));
  assert.match(settle({}).stderr, /STILL_RUNNING/);
  assert.match(settle({ outcome: "succeeded" }).stderr, /FORBIDDEN/);
  assert.equal(json(run(c, ["context", task, "--json"])).plan.steps.find((s) => s.id === "engineering").state, "running");
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: c.repo, encoding: "utf8" }).stdout, "", "the developer's checkout is untouched");
});
