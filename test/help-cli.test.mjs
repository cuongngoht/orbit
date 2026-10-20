import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI_TESTS = join(ROOT, "test", "fixtures", "ui-tests");
const temp = () => mkdtempSync(join(tmpdir(), "orbit-help-"));

// A machine whose settings document kept, from before autonomy was the default, a person's enabled false: schema 1.
function restricted(store) {
  mkdirSync(join(store, "control", "automation"), { recursive: true });
  writeFileSync(join(store, "control", "automation", "settings.json"), `${JSON.stringify({ schema: 1, enabled: false })}\n`);
}

const runHelp = (args = [], store = temp()) =>
  spawnSync(process.execPath, [join(ROOT, "cli", "help.mjs"), ...args], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store }) });

test("it recommends architecture ensure over an unscanned fixture project, and exits 0", () => {
  const r = runHelp();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PROJECT {7}fixture/);
  assert.match(r.stdout, /UNDERSTANDING/);
  assert.match(r.stdout, /NEXT {10}node <engine>\/cli\/architecture\.mjs ensure/);
  assert.match(r.stdout, /BECAUSE {7}nothing has scanned/);
});

test("UNKNOWN names the working set, honestly, not guessed", () => {
  const r = runHelp();
  assert.match(r.stdout, /UNKNOWN\n {2}working set — no hook has recorded/);
});

test("UNDERSTANDING reports engineering memory once a fact is recorded, and zero before that", () => {
  const store = temp();
  const before = runHelp([], store);
  assert.match(before.stdout, /engineering {4}0 fact\(s\) — 0 enforced · 0 adopted/);

  const claim = JSON.stringify({ kind: "invariant", key: "no-raw-sql", statement: "Queries never concatenate raw SQL", scope: ["test/fixtures"], evidence: ["test/fixtures/case.bad.json"], source: "test-suite", enforcedBy: ["test/fixtures/case.bad.json"], strength: "enforced" });
  const recorded = spawnSync(process.execPath, [join(ROOT, "cli", "engineering.mjs"), "record", "--human"], { encoding: "utf8", input: `${claim}\n`, env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store }) });
  assert.equal(recorded.status, 0, recorded.stderr);

  const after = runHelp([], store);
  assert.match(after.stdout, /engineering {4}1 fact\(s\) — 1 enforced · 0 adopted/);
});

test("a project with no sql.command is reported as a blocker on that layer", () => {
  const r = runHelp();
  assert.match(r.stdout, /BLOCKERS\n {2}sql — this project declares no sql\.command/);
});

test("--json prints the same gathered state as the printed form, and nothing else", () => {
  const r = runHelp(["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.project, "fixture");
  assert.equal(body.understanding.map.screens, 3);
  assert.equal(body.next, "architecture");
  assert.deepEqual(Object.keys(body), ["project", "status", "understanding", "unknown", "blockers", "capabilities", "next", "run", "because"]);
  assert.equal(body.understanding.status.word, body.status.word, "one word, the same in both");
  assert.ok(body.capabilities.some((c) => c.id === "orbit-help"), "what Orbit can do here, from its own catalog");
});

test("--for routes a task: a change to the code is coordinated by default, the developer's way under a kept restriction, and the task's text is kept nowhere", () => {
  const store = temp();
  runHelp([], store);
  spawnSync(process.execPath, [join(ROOT, "cli", "architecture.mjs"), "ensure"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store }) });
  const r = runHelp(["--for=implement the ZETA-9181 webhook handler in the backend"], store);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TASK {10}development \(high confidence\)/);
  assert.match(r.stdout, /NEXT {10}node <engine>\/cli\/automation\.mjs start/, "nothing to turn on");
  assert.equal(JSON.parse(runHelp(["--json", "--for=add an MCP server"], store).stdout).next, "control", "a question about resources is answered, not coordinated");
  restricted(store);
  const kept = runHelp(["--for=implement the ZETA-9181 webhook handler in the backend"], store);
  assert.equal(kept.status, 2);
  assert.match(kept.stderr, /schema|unsupported/i);
  assert.equal(r.stdout.includes("ZETA-9181"), false);
  for (const f of files(store)) assert.equal(readFileSync(f, "utf8").includes("ZETA-9181"), false, f);
});

test("it never writes into the project it reads", () => {
  const before = snapshot(UI_TESTS);
  runHelp();
  runHelp(["--json"]);
  assert.deepEqual(snapshot(UI_TESTS), before, "help.mjs modified the fixture project");
});

test("a store path inside the plugin repository is refused, not worked around", () => {
  const inside = spawnSync(process.execPath, [join(ROOT, "cli", "help.mjs")], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: join(ROOT, "scratch-store") }) });
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /inside the repository/);
});

function snapshot(dir, seen = {}) {
  for (const name of readdirSync(dir)) walk(join(dir, name), name, seen);
  return seen;
}

function walk(path, name, seen) {
  if ([".git", "node_modules"].includes(name)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) return void snapshot(path, seen);
  seen[path] = `${stat.size}:${stat.mtimeMs}`;
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

test("UNDERSTANDING counts the works kept and the ones resting on an incomplete requirement, and a task is carried on to them", () => {
  const store = temp();
  const env = sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store });
  assert.match(runHelp([], store).stdout, /work {11}0 kept — 0 resting on a requirement not yet complete · 0 blocked/);
  const where = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "work.mjs"), "where", "--json"], { encoding: "utf8", env }).stdout);
  const dir = join(where.work, "w-aaaaaaaaaaaa");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "journal.jsonl"), `${JSON.stringify({ at: "2026-09-30T10:00:00.000Z", kind: "created", id: "w-aaaaaaaaaaaa", objective: "Implement the refund limit", root: { provider: "p", organization: "o", project: null, id: "4312" } })}\n`);
  const pbi = JSON.parse(runHelp(["--json", "--for=Implement PBI 4312"], store).stdout);
  assert.equal(pbi.next, "automation", "a work item is coordinated by default");
  assert.match(pbi.because, /--ref=/, "and the coordinator is told to settle its requirement first");
  const body = JSON.parse(runHelp(["--json"], store).stdout);
  assert.deepEqual(body.understanding.work, { total: 1, open: 1, blocked: 0 });
  assert.equal(body.run, "orbit-requirements", "under a kept restriction, a work waiting on its requirement is carried on, whatever else the task was about");
  assert.match(body.because, /1 piece\(s\) of work rest on a requirement that is not complete yet/);
  assert.equal(JSON.parse(runHelp(["--json", "--for=Implement PBI 4312"], store).stdout).next, "automation");
});
