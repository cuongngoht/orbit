// `/orbit-help` in a repository Orbit has never seen (1.8.9): no ui-tests/, no init, no setup. It seats the project
// in the machine store, says how much it knows and what it can do, routes a goal to the workflow that fits it -- a
// change to engineering, a hunt for bugs to an investigation, never UI testing for a project with no UI -- and the
// checkout's `git status` is exactly what it was before, every time.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../src/project/index.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { sealed } from "./home.mjs";

const engine = fileURLToPath(new URL("..", import.meta.url));
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-help-fresh-")));
after(() => rmSync(temp, { recursive: true, force: true }));
const store = join(temp, "store");
const env = Object.fromEntries(Object.entries(sealed({ ORBIT_STORE_DIR: store })).filter(([k]) => k !== "CLAUDE_PROJECT_DIR"));

// A small backend service: no frontend, no UI, nothing Orbit-shaped about it.
function service() {
  const root = join(temp, "payments-api");
  mkdirSync(join(root, "src", "auth"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "payments-api", version: "1.0.0", scripts: { test: "node --test" } }, null, 2)}\n`);
  writeFileSync(join(root, "src", "auth", "token.js"), "export const expiresIn = 30;\n");
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "init"]);
  return root;
}

const root = service();
const help = (args = [], extra = {}) => spawnSync(process.execPath, [join(engine, "cli", "help.mjs"), ...args], { cwd: root, env: { ...env, ...extra }, encoding: "utf8" });
const porcelain = () => execFileSync("git", ["-C", root, "status", "--porcelain", "--ignored"], { encoding: "utf8" });
const BEFORE = porcelain();

test("no goal: it seats the project, says it is BOOTSTRAPPED and what it can do, and the checkout is untouched", () => {
  const r = help();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^PROJECT\s+payments-api\nSTATUS\s+BOOTSTRAPPED — /);
  assert.match(r.stdout, /\nCAPABILITIES\n {2}orbit-architecture /);
  assert.match(r.stdout, /\nNEXT\s+\S/);
  assert.equal(porcelain(), BEFORE, "git status before == git status after");
  const p = loadProject(env, root);
  assert.equal(p.dataHome, "store");
  assert.ok(existsSync(join(p.dataRoot, "project.json")), "the seat is in the store");
  assert.ok(existsSync(p.bindingFile), "and the machine knows the checkout now");
});

test("a development goal goes to the coordinated engineering workflow, never to UI testing", () => {
  const r = help(["--for=Fix API authentication timeout", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.next, "automation");
  assert.match(body.because, /\(engineering\)/);
  assert.equal(porcelain(), BEFORE);
});

test("an investigation goal goes to an investigation, and under a kept restriction to orbit-qa itself", () => {
  const r = JSON.parse(help(["--for=find bugs in the payments flow", "--json"]).stdout);
  assert.equal(r.next, "automation");
  assert.match(r.because, /\(investigation\)/);
  const settings = join(stateRooms(store).automation, "settings.json");
  mkdirSync(join(settings, ".."), { recursive: true });
  writeFileSync(settings, `${JSON.stringify({ schema: 1, enabled: false })}\n`);
  try {
    assert.equal(help(["--for=find bugs in the payments flow", "--json"]).status, 2);
    assert.equal(help(["--for=refactor the backend token service", "--json"]).status, 2);
  } finally {
    rmSync(settings);
  }
});

test("asked again, nothing is written again, nothing is invented, and the checkout is still untouched", () => {
  const p = loadProject(env, root);
  const seat = ["project.json", join("schema", "case.schema.json")].map((f) => statSync(join(p.dataRoot, f)).mtimeMs);
  const binding = statSync(p.bindingFile).mtimeMs;
  for (let i = 0; i < 3; i += 1) assert.equal(help().status, 0);
  assert.deepEqual(["project.json", join("schema", "case.schema.json")].map((f) => statSync(join(p.dataRoot, f)).mtimeMs), seat);
  assert.equal(statSync(p.bindingFile).mtimeMs, binding);
  for (const room of ["drafts", "reports", "evidence", "memory", "runs", "tasks", "work"]) assert.ok(!existsSync(join(p.storeRoot, room)), `no ${room}/: nothing was asked for`);
  assert.deepEqual(readdirSync(p.dataRoot).sort(), ["project.json", "project.schema.json", "schema"], "no screen, no case, no graph");
  assert.equal(porcelain(), BEFORE);
});
