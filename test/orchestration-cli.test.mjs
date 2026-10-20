// The CLI over a REAL repository, the way a host drives it: start, one decided step at a time on
// stdin, the change made in the task's workspace, the declared build and test run there, a review,
// COMPLETED -- the developer's checkout untouched, and a task Mission Control reads like any other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createProcess } from "../src/process/index.mjs";
import { COMMANDS } from "../src/orchestration/index.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "autonomous-engineering.mjs");
const TASK_CLI = join(ROOT, "cli", "task.mjs");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const FILES = {
  "package.json": `${JSON.stringify({ name: "refunds", version: "1.0.0", scripts: { build: "node build.js", test: "node test.js" } }, null, 2)}\n`,
  "package-lock.json": `${JSON.stringify({ name: "refunds", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "refunds", version: "1.0.0" } } }, null, 2)}\n`,
  "build.js": 'require("./validator.js");\nconsole.log("built");\n',
  "validator.js": "exports.valid = (amount, paid) => amount > 0;\n",
  "test.js": 'const { valid } = require("./validator.js");\nif (valid(150, 100) !== false) { console.log("FAIL rejects amount over paid"); process.exit(1); }\nconsole.log("ok");\n',
};

const npmHere = () => createProcess({ timeoutMs: 30000 }).run("npm", ["--version"], { env: sealed() }).ok;

function repository(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-ae-cli-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  mkdirSync(repo);
  for (const [path, text] of Object.entries(FILES)) writeFileSync(join(repo, path), text);
  for (const args of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "init"]]) spawnSync("git", args, { cwd: repo, env: sealed(IDENTITY) });
  return { base, repo, store: join(base, "store") };
}

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

const run = (at, cwd = at.repo) => (script, args, input) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, input, env: sealed({ ORBIT_STORE_DIR: at.store, ...IDENTITY }), encoding: "utf8", timeout: 180000 });
  return { status: r.status, out: r.stdout, err: r.stderr, json: parsed(r.stdout) };
};

// Each step's answer carries the revision the next decision is made on, as a host would read it --
// so the context is asked for only where a host needs what it says (a process each is what costs).
function driver(at) {
  const seen = { revision: null };
  const ae = (...args) => run(at)(CLI, [...args, "--json"]);
  const step = (id, action) => {
    const r = run(at)(CLI, ["step", id, "--json"], JSON.stringify({ schemaVersion: 1, expectedRevision: seen.revision, action, observed: "the context allows this step", hypothesis: "it moves the change toward verified" }));
    seen.revision = r.json?.revision ?? seen.revision;
    return r;
  };
  return { ae, step, seen };
}

const ok = (r) => {
  assert.equal(r.status, 0, `${r.err}${r.out}`);
  return r.json;
};

function picture(dir) {
  const walk = (d) => readdirSync(d).filter((n) => n !== ".git").flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  return walk(dir).map((p) => [relative(dir, p), readFileSync(p, "utf8")]);
}

test("the usage header documents every command, and nothing that runs a command line or speaks for a person", () => {
  const header = run({ store: tmpdir(), repo: ROOT })(CLI, []).out;
  for (const name of Object.keys(COMMANDS)) assert.match(header, new RegExp(`autonomous-engineering\\.mjs ${name}\\b`), name);
  assert.doesNotMatch(header, /--(cmd|shell|exec|human)\b/);
});

test("a task is named before anything is looked at", () => {
  const inert = new Proxy({}, { get: () => { throw new Error("touched the ports"); } });
  for (const name of ["context", "step", "reconcile", "finish", "cleanup", "remove-workspace", "log"]) assert.throws(() => COMMANDS[name].run(inert, []), /name the task/, name);
  assert.throws(() => COMMANDS.start.run(inert, []), /start --ref=/);
});

test("end to end through the CLI: start → context → environment → workspace → plan → the change in the workspace → build → test → review → COMPLETED, the developer's checkout untouched", { skip: !npmHere() && "npm is not runnable here: the declared checks are npm scripts" }, (t) => {
  const at = repository(t);
  const { ae, step, seen } = driver(at);
  const before = picture(at.repo);
  const started = ok(ae("start", "Refund amount must not exceed the paid amount"));
  const id = started.task;
  seen.revision = started.context.revision;
  assert.equal(started.context.stage, "CONTEXT");
  for (const action of [{ kind: "gather-context" }, { kind: "check-environment" }, { kind: "prepare-workspace" }]) assert.equal(ok(step(id, action)).outcome, "succeeded", action.kind);
  const c = ok(ae("context", id));
  assert.equal(c.stage, "PLANNING");
  const [build, testCheck] = ["build", "test"].map((p) => c.checks.find((x) => x.purpose === p).id);
  ok(step(id, { kind: "plan", intent: "hold a refund to what was paid; a ; in text is only text", scope: ["validator.js"] }));
  ok(step(id, { kind: "implement" }));
  writeFileSync(join(c.workspace.path, "validator.js"), "exports.valid = (amount, paid) => amount > 0 && amount <= paid;\n");
  assert.equal(ok(step(id, { kind: "record-changes" })).stage, "BUILDING");
  assert.equal(ok(step(id, { kind: "check", command: build })).stage, "TESTING");
  assert.equal(ok(step(id, { kind: "check", command: testCheck })).stage, "REVIEWING");
  assert.equal(ok(step(id, { kind: "review" })).lifecycle, "COMPLETED");
  assert.deepEqual(picture(at.repo), before, "the developer's checkout is exactly what it was");
  const shown = run(at)(TASK_CLI, ["show", id, "--json"]).json;
  assert.deepEqual([shown.lifecycle, shown.changes.files, shown.attempts.length], ["COMPLETED", 1, 1]);
  const learned = shown.receipts.find((r) => r.domain === "learning");
  assert.equal(learned?.outcome, "OBSERVED", "the step that completed the task handed it to engineering memory (1.8.9)");
  assert.match(run(at)(join(ROOT, "cli", "engineering.mjs"), ["facts"]).out, /observed\s+fresh\s+possible\s+workflow\s+a change here is verified by node:\.'s declared test/, "the declared test that passed after the change is an observed fact");
  const journal = readFileSync(join(dirname(dirname(c.workspace.path)), "..", "tasks", id, "journal.jsonl"), "utf8");
  for (const leak of ["npm", "node test.js", at.base, at.repo, "FAIL rejects"]) assert.ok(!journal.includes(leak), `the journal holds ${leak}`);
  const fromInside = run(at, c.workspace.path)(CLI, ["context", id]);
  assert.equal(fromInside.status, 2);
  assert.match(fromInside.err + fromInside.out, /this is a task's workspace/);
  const forged = run(at)(CLI, ["step", id], JSON.stringify({ schemaVersion: 1, expectedRevision: shown.revision, action: { kind: "review" }, observed: "x", hypothesis: "y", outcome: "succeeded" }));
  assert.equal(forged.status, 2);
  assert.match(forged.err + forged.out, /FORBIDDEN/);
});
