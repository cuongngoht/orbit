import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COMMANDS, COMMAND_NAMES } from "../src/architecture/index.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const temp = (tag) => mkdtempSync(join(tmpdir(), `orbit-${tag}-`));

// A COMMITTED temp checkout, not test/fixtures, and the reason is the whole
// point of the `dirty` rule: an uncommitted edit makes a scope `unknown`, so a
// test pointed at this repository's own fixtures would pass or fail depending
// on whether the developer running it happened to have edited one. That is a
// test that reports the state of somebody's afternoon.
//
// It is also the honest shape of the thing under test -- a consuming project is
// a separate checkout, and this is one.
function project() {
  const dir = temp("project");
  for (const [path, text] of Object.entries(FILES)) written(dir, path, text);
  git(dir, ["init", "-q", "."]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return dir;
}

const FILES = {
  "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" }, dependencies: { "some-http-client": "^1.0.0" } }),
  "README.md": "# demo\n\nConcrete external integrations belong in adapters/, never in src/.\n",
  "src/api/index.mjs": "// api\n",
  "src/api/handler.mjs": "import { u } from '../ui/index.mjs';\n",
  "src/api/util.mjs": "// util\n",
  "src/ui/index.mjs": "// ui\n",
  "src/ui/page.mjs": "// page\n",
  "src/ui/util.mjs": "// util\n",
  "ui-tests/project.json": JSON.stringify({ name: "demo", origin: "https://demo.test" }),
  "ui-tests/graph/meta.json": JSON.stringify({ schema: 2 }),
  "ui-tests/graph/screens.json": "[]",
  "ui-tests/graph/edges.json": "[]",
  "ui-tests/graph/effects.json": "[]",
};

function written(dir, path, text) {
  mkdirSync(join(dir, dirname(path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

const git = (dir, args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });

const PROJECT = project();
const UI_TESTS = join(PROJECT, "ui-tests");

// sealed() strips every ORBIT_* and repoints HOME at an empty directory, so the
// developer's own ~/.orbit is never touched by the suite and the
// home-default branch is exercised for real.
const arch = (args, store, env = {}, input = undefined) =>
  spawnSync(process.execPath, [join(ROOT, "cli", "architecture.mjs"), ...args], { encoding: "utf8", input, cwd: PROJECT, env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store, ...env }) });

// Arguments that give every command something real to do, so "it changed
// nothing" is not just "it printed usage and exited".
const ARGS = {
  ensure: ["ensure"],
  scan: ["scan"],
  facts: ["facts"],
  why: ["why", "nothing-by-that-id"],
  capabilities: ["capabilities"],
  diff: ["diff"],
  where: ["where"],
  record: ["record"],
  project: ["project"],
};

test("every command has arguments here, so a new one cannot skip the tree check", () => {
  for (const name of COMMAND_NAMES) assert.ok(ARGS[name], `${name} is in the command table but not exercised below`);
  for (const name of COMMAND_NAMES) assert.ok(["nothing", "store", "host-memory"].includes(COMMANDS[name].writes), `${name} does not declare what it writes`);
});

// The rule the whole feature is held to, over BOTH trees: the project being
// read, and the plugin doing the reading. Iterating the COMMAND TABLE rather
// than a list is what makes a command added next year covered by its own row.
//
// Each tree is snapshotted by size and mtime as well as read through git,
// because `git status` alone would miss a write into a gitignored directory --
// and "not into the repo, not even somewhere ignored" is exactly the rule.
test("no architecture command modifies the project it reads, or the plugin reading it", () => {
  const store = temp("store");
  const before = { project: snapshot(PROJECT), plugin: snapshot(ROOT), git: status(PROJECT) };

  for (const name of COMMAND_NAMES) arch(ARGS[name], store, {}, "");

  assert.equal(status(PROJECT), before.git, "the project's working tree moved");
  assert.deepEqual(snapshot(PROJECT), before.project, "a file changed inside the project");
  assert.deepEqual(snapshot(ROOT), before.plugin, "a file changed inside the plugin");
});

const status = (dir) => spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout;

// --dry has to be the same promise from the outside: it decides, it prints, and
// the store is exactly as it was.
test("a dry ensure writes nothing at all, not even a state file", () => {
  const store = temp("store");
  const dry = arch(["ensure", "--dry"], store);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /--dry: \d+ fact\(s\) would be recorded — nothing written/);
  assert.deepEqual(readdirSync(store), [], "the store was created anyway");

  assert.equal(arch(["facts"], store).status, 0);
  assert.match(arch(["facts"], store).stdout, /nothing has scanned this project yet/);
});

// Read-only commands stay read-only even when there is nothing to read.
test("reading an unscanned project creates no store and says what to run", () => {
  const store = temp("store");
  for (const cmd of ["facts", "capabilities", "diff", "where"]) assert.equal(arch([cmd], store).status, 0, `${cmd} failed`);
  assert.deepEqual(readdirSync(store), [], "a read created a store");
});

// Exit codes are a published contract, and this command's is narrow on purpose:
// it asks the product nothing, so it can never find the product wrong.
test("it never exits 1 — 0 done, 2 refused, 3 blocked", () => {
  const store = temp("store");
  assert.equal(arch(["facts"], store).status, 0);
  assert.equal(arch(["why", "arch-nothing-000000"], store, {}, "").status, 2, "an unknown id is bad usage");
  assert.match(arch(["why", "arch-nothing-000000"], store, {}, "").stderr, /no fact "arch-nothing-000000"/);
  assert.equal(arch(["record"], store, {}, "").status, 2, "nothing on stdin is bad usage");
  assert.equal(arch([], store).status, 0, "no command prints the help");
});

// A typed path that does not work is bad usage with an obvious fix. Writing
// somewhere else and letting somebody find an empty store next week is not.
test("a store path inside a repository is refused outright, not worked around", () => {
  const inside = arch(["facts"], join(ROOT, "scratch-store"));
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /inside the repository/);
  assert.match(inside.stderr, /not even somewhere gitignored/);
});

// The batch rule, through the real CLI and real stdin: the scanner agent has no
// Write, so this is the only path its candidates can take.
test("candidate facts arrive on stdin, and one bad line refuses the batch", () => {
  const store = temp("store");
  const good = JSON.stringify({ kind: "module", key: "graph", statement: "ui-tests/graph holds the map", scope: ["ui-tests/graph"], evidence: ["ui-tests/graph/meta.json"], source: "repository", confidence: "certain" });
  const bad = JSON.stringify({ kind: "module", key: "ghost", statement: "a module nobody has", scope: ["ui-tests/graph"], evidence: ["ui-tests/graph/invented.json"], source: "repository", confidence: "certain" });

  const refused = arch(["record"], store, {}, `${good}\n${bad}\n`);
  assert.equal(refused.status, 2);
  assert.match(refused.stdout, /evidence "ui-tests\/graph\/invented.json" is not tracked here/);
  assert.match(refused.stderr, /nothing was recorded/);

  const ok = arch(["record"], store, {}, `${good}\n`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /1 fact\(s\) recorded/);
  assert.match(arch(["facts"], store).stdout, /graph holds the map/);
});

// The whole promise, end to end and through the real thing: learn once, reuse
// after that. The second call must not read the repository at all.
test("a second ensure reuses the snapshot instead of scanning again", () => {
  const store = temp("store");
  const first = arch(["ensure"], store);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /ARCHITECTURE BOOTSTRAP/);

  const second = arch(["ensure", "--for=create a thing"], store);
  assert.match(second.stdout, /ARCHITECTURE CURRENT/);
  assert.match(second.stdout, /scan:\n {2}skipped/);

  const asked = arch(["ensure", "--for=check it through Acme Vault"], store);
  assert.match(asked.stdout, /ARCHITECTURE TARGETED/);
  assert.match(asked.stdout, /nothing recorded here speaks to acme, vault/);
  assert.match(arch(["ensure", "--for=check it through Acme Vault"], store).stdout, /ARCHITECTURE CURRENT/, "the same question must not be investigated twice");
});

// Absence has to be falsifiable: "missing" beside the places that were searched.
test("a capability nobody provides is reported as missing, with where it looked", () => {
  const store = temp("store");
  arch(["ensure"], store);
  const asked = arch(["ensure", "--for=through Acme Vault"], store);
  assert.match(asked.stdout, /unknown {2}nothing here provides acme — searched/);
  assert.match(asked.stdout, /tracked path\(s\)/);
  assert.match(arch(["capabilities"], store).stdout, /MISSING/);
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
