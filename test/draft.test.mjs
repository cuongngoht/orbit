import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { UI_TESTS } from "./fakes/context.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli");

const temp = (tag) => mkdtempSync(join(tmpdir(), `orbit-${tag}-`));

const run = (script, args, env = {}, input = undefined) =>
  spawnSync(process.execPath, [join(CLI, script), ...args], { encoding: "utf8", input, env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ...env }) });

// `promote` writes a case into the project it is pointed at, so it is pointed
// at a COPY. Writing into the committed fixture and deleting it afterwards left
// a window in which the file existed, and the two tests that assert "no command
// changed this repository" caught it -- intermittently, from a different file,
// which is the worst way to learn about a race.
function copiedProject() {
  const dir = join(temp("project"), "ui-tests");
  cpSync(UI_TESTS, dir, { recursive: true });
  return dir;
}

test("a draft saved by one process is found by the next", () => {
  const store = temp("store");
  const c = { id: "c1", name: "C 1", steps: [] };
  const write = run("draft.mjs", ["write"], { ORBIT_STORE_DIR: store }, JSON.stringify(c));
  assert.equal(write.status, 0, write.stderr);
  
  const list = run("draft.mjs", ["list"], { ORBIT_STORE_DIR: store });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /c1: C 1/);
});

test("a promoted draft lands in its start screen's folder and leaves the drafts empty", () => {
  const store = temp("store");
  const project = copiedProject();
  const c = { id: "c2", name: "C 2", start: "home", identity: { as: "admin", roles: ["App.Admin"] }, steps: [{ do: "goto", screen: "home" }, { do: "report", js: "1", expect: "true" }], seen: "live", fe_commit: "abc1234" };
  run("draft.mjs", ["write"], { ORBIT_STORE_DIR: store, ORBIT_UI_TESTS: project }, JSON.stringify(c));

  const prom = run("draft.mjs", ["promote", "c2"], { ORBIT_STORE_DIR: store, ORBIT_UI_TESTS: project });
  assert.equal(prom.status, 0, prom.stderr);

  const list = run("draft.mjs", ["list"], { ORBIT_STORE_DIR: store, ORBIT_UI_TESTS: project });
  assert.doesNotMatch(list.stdout, /c2:/);

  assert.ok(existsSync(join(project, "screens", "home", "cases", "c2.json")));
  assert.ok(!existsSync(join(UI_TESTS, "screens", "home", "cases", "c2.json")), "and never into the committed fixture");
});

test("promoting an invalid draft is refused", () => {
  const store = temp("store");
  const c = { id: "bad", name: "Bad", steps: {} };
  run("draft.mjs", ["write"], { ORBIT_STORE_DIR: store }, JSON.stringify(c));
  
  const prom = run("draft.mjs", ["promote", "bad"], { ORBIT_STORE_DIR: store });
  assert.equal(prom.status, 2);
  assert.match(prom.stderr, /Invalid case bad:/);
});

test("discarding a draft removes it", () => {
  const store = temp("store");
  const c = { id: "c3", name: "C 3", steps: [] };
  run("draft.mjs", ["write"], { ORBIT_STORE_DIR: store }, JSON.stringify(c));
  
  const disc = run("draft.mjs", ["discard", "c3"], { ORBIT_STORE_DIR: store });
  assert.equal(disc.status, 0, disc.stderr);
  
  const list = run("draft.mjs", ["list"], { ORBIT_STORE_DIR: store });
  assert.doesNotMatch(list.stdout, /c3:/);
});

test("draft write reads from stdin", () => {
  const store = temp("store");
  const c = { id: "c4", name: "C 4", steps: [] };
  const write = run("draft.mjs", ["write"], { ORBIT_STORE_DIR: store }, JSON.stringify(c));
  assert.equal(write.status, 0, write.stderr);
  
  const show = run("draft.mjs", ["show", "c4"], { ORBIT_STORE_DIR: store });
  assert.match(show.stdout, /"id": "c4"/);
});

test("a draft case can be dry-run with run-case --draft", () => {
  const store = temp("store");
  const c = { id: "c5", name: "C 5", start: "home", identity: { as: "admin", roles: ["App.Admin"] }, steps: [{ do: "goto", screen: "home" }, { do: "report", js: "1", expect: "true" }], seen: "live", fe_commit: "abc1234" };
  run("draft.mjs", ["write"], { ORBIT_STORE_DIR: store }, JSON.stringify(c));
  
  const dry = run("run-case.mjs", ["c5", "--draft", "--dry"], { ORBIT_STORE_DIR: store });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /no browser touched/);
});

test("running a missing draft reports no draft case", () => {
  const store = temp("store");
  const missing = run("run-case.mjs", ["nonexistent", "--draft", "--dry"], { ORBIT_STORE_DIR: store });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no draft case nonexistent/);
});
