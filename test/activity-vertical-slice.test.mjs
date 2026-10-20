// THE VERTICAL SLICE of 1.8.5, through the real CLI on a real repository: a check the checkout DECLARED (its own
// `npm test`, a Node test runner printing TAP) runs in the task's workspace, and a Live feed -- the one Orbit Control
// streams and a terminal paints -- delivers a CASE the runner reported BEFORE the check's child has exited.
//
// No sleep decides it. The fixture's second test waits for a gate file, and only this test writes the gate, and only
// once its own feed has delivered the first case: if a case reached a viewer only when the child exited, the child
// could never exit in time and the check would fail. Then the official word -- the step's answer, the check's
// receipt -- comes from the exit, as it always did, and a replay of the finished task tells the same story.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QA_SOURCE } from "../src/investigation/live.mjs";
import { zeroCursor } from "../src/live/cursor.mjs";
import { collectFeed, openFeed } from "../src/live/feed.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { ACTIVITY_SOURCE } from "../src/orchestration/activity/source.mjs";
import { createProcess } from "../src/process/index.mjs";
import { realIo } from "../src/store/io.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { createTasks } from "../src/task/store.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "autonomous-engineering.mjs");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const npmHere = () => createProcess({ timeoutMs: 30000 }).run("npm", ["--version"], { env: sealed() }).ok;

// The project's own test command asks its runner for TAP: the project's choice, in its own manifest -- Orbit adds nothing.
const files = (gate) => ({
  "package.json": `${JSON.stringify({ name: "refunds", version: "1.0.0", scripts: { test: "node --test --test-reporter=tap" } }, null, 2)}\n`,
  "package-lock.json": `${JSON.stringify({ name: "refunds", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "refunds", version: "1.0.0" } } }, null, 2)}\n`,
  "validator.js": "exports.valid = (amount, paid) => amount > 0 && amount <= paid;\n",
  "refund.test.js": `const { test } = require("node:test");\nconst assert = require("node:assert");\nconst { existsSync } = require("node:fs");\nconst { valid } = require("./validator.js");\ntest("a refund over what was paid is refused", () => assert.equal(valid(150, 100), false));\ntest("the viewer has seen the first case", async () => {\n  const until = Date.now() + 60000;\n  while (!existsSync(${JSON.stringify(gate)}) && Date.now() < until) await new Promise((r) => setTimeout(r, 25));\n  assert.ok(existsSync(${JSON.stringify(gate)}), "no viewer saw the first case before this one ended");\n});\n`,
});

function repository(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-slice-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  mkdirSync(repo);
  for (const [path, text] of Object.entries(files(join(base, "gate")))) writeFileSync(join(repo, path), text);
  for (const args of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "init"]]) spawnSync("git", args, { cwd: repo, env: sealed(IDENTITY) });
  return { base, repo, gate: join(base, "gate"), env: sealed({ ORBIT_STORE_DIR: join(base, "store"), ORBIT_TRACE: "off", ...IDENTITY }) };
}

const ae = (at, args, input) => ((r) => ({ status: r.status, json: JSON.parse(r.stdout || "null"), err: r.stderr }))(spawnSync(process.execPath, [CLI, ...args, "--json"], { cwd: at.repo, input, env: at.env, encoding: "utf8", timeout: 180000 }));

const decision = (revision, action) => JSON.stringify({ schemaVersion: 1, expectedRevision: revision, action, observed: "the context allows this step", hypothesis: "it moves the change toward verified" });

function stepAsync(at, id, revision, action) {
  const child = spawn(process.execPath, [CLI, "step", id, "--json"], { cwd: at.repo, env: at.env, stdio: ["pipe", "pipe", "pipe"] });
  const out = [];
  child.stdout.on("data", (b) => out.push(b));
  child.stdin.end(decision(revision, action));
  return { child, done: new Promise((resolve) => child.on("close", (status) => resolve({ status, json: JSON.parse(Buffer.concat(out).toString("utf8") || "null") }))) };
}

// The feed Orbit Control streams and a terminal paints, over the task's own store.
function feedOf(storeRoot, id) {
  const io = realIo();
  const deps = { io, followers: createFollowers({ pollMs: 100 }), task: TASK_SOURCE, qa: QA_SOURCE, activity: ACTIVITY_SOURCE };
  const opened = { taskCtx: { tasks: createTasks(storeRoot, io), checkoutSummary: null, now: () => new Date().toISOString() }, task: id, createdAt: null, qa: QA_SOURCE.open(storeRoot, io), activity: ACTIVITY_SOURCE.open(storeRoot) };
  return { deps, opened };
}

test("a case the runner reported reaches a Live viewer before the check's child exits; the receipt still comes from the exit", { skip: !npmHere() && "npm is not runnable here: the declared check is an npm script" }, async (t) => {
  const at = repository(t);
  const started = ae(at, ["start", "Refund amount must not exceed the paid amount"]);
  assert.equal(started.status, 0, started.err);
  const id = started.json.task;
  let revision = started.json.context.revision;
  for (const action of [{ kind: "gather-context" }, { kind: "check-environment" }, { kind: "prepare-workspace" }]) revision = ae(at, ["step", id], decision(revision, action)).json.revision;
  const ctx = ae(at, ["context", id]).json;
  revision = ae(at, ["step", id], decision(ctx.revision, { kind: "plan", intent: "hold a refund to what was paid", scope: ["validator.js"] })).json.revision;
  const storeRoot = join(dirname(dirname(ctx.workspace.path)), "..");
  const testCheck = ctx.checks.find((c) => c.purpose === "test").id;

  const frames = [];
  const { deps, opened } = feedOf(storeRoot, id);
  const feed = openFeed(deps, opened, zeroCursor());
  t.after(() => feed.close());
  const step = stepAsync(at, id, revision, { kind: "check", command: testCheck });
  const state = { exited: false, gateBeforeExit: null };
  step.done.then(() => { state.exited = true; });
  feed.start({ closed: false, end: () => {}, send: (f) => {
    frames.push(f);
    const passed = f.event === "activity-view" && f.data.view.counts.passed >= 1;
    if (passed && !existsSync(at.gate)) {
      writeFileSync(at.gate, "seen");
      state.gateBeforeExit = !state.exited;
    }
    return true;
  } });
  const answer = await step.done;

  assert.equal(answer.status, 0);
  assert.equal(state.gateBeforeExit, true, "the first case was delivered to the viewer while the check was still running");
  assert.equal(answer.json.outcome, "succeeded", "the second test passed: it saw the gate the viewer opened");
  assert.match(answer.json.receipts.join(), /^check:chk-\d+$/);
  const live = frames.filter((f) => f.event === "activity-view").map((f) => f.data.view);
  assert.ok(live.some((v) => v.state === "running" && v.counts.passed === 1 && v.recent.some((r) => r.name === "a refund over what was paid is refused")), "a view while running: one case reported, its name, never invented");
  assert.equal(live.find((v) => v.state === "running")?.total, null, "no total while the runner has not said one");

  const replay = collectFeed({ ...deps, followers: createFollowers() }, opened, zeroCursor());
  const view = replay.activity[answer.json.action];
  assert.deepEqual([view.state, view.counts.passed, view.counts.failed, view.total, view.complete, view.adapter.id], ["completed", 2, 0, 2, true, "tap"]);
  assert.match(view.why, /^baseline: /, "run before the code changed: a baseline, said in the journal's terms");
  assert.equal(replay.view.actions.find((a) => a.id === answer.json.action).state, "succeeded", "the task's own word, from the receipt");
});
