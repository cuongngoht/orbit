import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COMMANDS, COMMAND_NAMES } from "../src/engineering/index.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const temp = (tag) => mkdtempSync(join(tmpdir(), `orbit-${tag}-`));

// A COMMITTED temp checkout, not test/fixtures — src/architecture/'s own CLI
// test takes the same care, and for the same reason: this repository's own
// working tree is not a stable, known file listing to assert evidence checks
// against.
function project() {
  const dir = temp("eng-project");
  for (const [path, text] of Object.entries(FILES)) written(dir, path, text);
  git(dir, ["init", "-q", "."]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return dir;
}

const FILES = {
  "src/Application/IOrderRepository.cs": "// interface\n",
  "src/Infrastructure/OrderRepository.cs": "// impl\n",
  "test/OrderRepositoryTests.cs": "// asserts no raw sql\n",
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

const eng = (args, store, env = {}, input = undefined) =>
  spawnSync(process.execPath, [join(ROOT, "cli", "engineering.mjs"), ...args], { encoding: "utf8", input, cwd: PROJECT, env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store, ...env }) });

const ARGS = { facts: ["facts"], why: ["why", "nothing-by-that-id"], record: ["record"], where: ["where"], ensure: ["ensure"], recall: ["recall", "--for=repository"], journal: ["journal"], replay: ["replay"], observe: ["observe", "--all"], doctor: ["doctor"] };

test("every command has arguments here, so a new one cannot skip the tree check", () => {
  for (const name of COMMAND_NAMES) assert.ok(ARGS[name], `${name} is in the command table but not exercised below`);
  for (const name of COMMAND_NAMES) assert.ok(["nothing", "store"].includes(COMMANDS[name].writes), `${name} does not declare what it writes`);
});

test("no engineering command modifies the project it reads, or the plugin reading it", () => {
  const store = temp("store");
  const before = { project: snapshot(PROJECT), plugin: snapshot(ROOT), git: status(PROJECT) };

  for (const name of COMMAND_NAMES) eng(ARGS[name], store, {}, "");

  assert.equal(status(PROJECT), before.git, "the project's working tree moved");
  assert.deepEqual(snapshot(PROJECT), before.project, "a file changed inside the project");
  assert.deepEqual(snapshot(ROOT), before.plugin, "a file changed inside the plugin");
});

const status = (dir) => spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout;

test("reading an unrecorded project creates no store and says what to run", () => {
  const store = temp("store");
  for (const cmd of ["facts", "where"]) assert.equal(eng([cmd], store).status, 0, `${cmd} failed`);
  assert.deepEqual(readdirSync(store), [], "a read created a store");
  assert.match(eng(["facts"], store).stdout, /nothing has recorded this project's engineering yet/);
});

test("it never exits 1 — 0 done, 2 refused, 3 blocked", () => {
  const store = temp("store");
  assert.equal(eng(["facts"], store).status, 0);
  assert.equal(eng(["why", "eng-nothing-000000"], store, {}, "").status, 2, "an unknown id is bad usage");
  assert.match(eng(["why", "eng-nothing-000000"], store, {}, "").stderr, /no fact "eng-nothing-000000"/);
  assert.equal(eng(["record"], store, {}, "").status, 2, "nothing on stdin is bad usage");
  assert.equal(eng([], store).status, 0, "no command prints the help");
});

test("a store path inside a repository is refused outright, not worked around", () => {
  const inside = eng(["facts"], join(ROOT, "scratch-store"));
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /inside the repository/);
});

// The batch rule, through the real CLI and real stdin: an observer agent has
// no Write, so this is the only path its candidates can take.
test("candidate facts arrive on stdin, and one bad line refuses the batch", () => {
  const store = temp("store");
  const good = JSON.stringify({ kind: "pattern", key: "repository", statement: "Persistence access goes through repository abstractions", scope: ["src/Application"], evidence: ["src/Application/IOrderRepository.cs"], source: "repository", confidence: "certain", strength: "observed" });
  const bad = JSON.stringify({ kind: "pattern", key: "ghost", statement: "a pattern nobody has", scope: ["src/Application"], evidence: ["src/Application/Invented.cs"], source: "repository", confidence: "certain", strength: "observed" });

  const refused = eng(["record"], store, {}, `${good}\n${bad}\n`);
  assert.equal(refused.status, 2);
  assert.match(refused.stdout, /evidence "src\/Application\/Invented.cs" is not tracked here/);
  assert.match(refused.stderr, /nothing was recorded/);

  const ok = eng(["record"], store, {}, `${good}\n`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /1 fact\(s\) recorded/);
  assert.match(eng(["facts"], store).stdout, /repository abstractions/);
});

// The strength guard, end to end: an observer's own claim of `enforced` is
// refused, and only an explicit `--human` unlocks it.
test("a candidate claiming enforced without --human is refused; --human unlocks it", () => {
  const store = temp("store");
  const claim = JSON.stringify({ kind: "invariant", key: "no-raw-sql", statement: "Queries never concatenate raw SQL", scope: ["src/Infrastructure"], evidence: ["src/Infrastructure/OrderRepository.cs"], source: "repository", confidence: "certain", strength: "enforced" });

  const refused = eng(["record"], store, {}, `${claim}\n`);
  assert.equal(refused.status, 2);
  assert.match(refused.stdout, /may not be claimed by a candidate/);
  assert.match(eng(["facts"], store).stdout, /nothing has recorded/, "the refused claim must not have been stored");

  const unproven = eng(["record", "--human"], store, {}, `${claim}\n`);
  assert.equal(unproven.status, 2, "a person vouching is not a gate existing");
  assert.match(unproven.stdout, /needs enforcedBy/);

  const gated = JSON.stringify({ ...JSON.parse(claim), source: "test-suite", enforcedBy: ["test/OrderRepositoryTests.cs"] });
  const ok = eng(["record", "--human"], store, {}, `${gated}\n`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /1 fact\(s\) recorded/);
});

// Recording the same subject twice goes through reconciliation: the second is a
// confirmation, the SAME session does not count twice, and nothing claims
// certain off one sitting however it is phrased.
test("recording the same subject twice in one session confirms it and stays possible", () => {
  const store = temp("store");
  const good = JSON.stringify({ kind: "pattern", key: "repository", statement: "Persistence access goes through repository abstractions", scope: ["src/Application"], evidence: ["src/Application/IOrderRepository.cs"], source: "repository", confidence: "certain", strength: "observed" });
  const first = eng(["record"], store, {}, `${good}\n`);
  assert.match(first.stdout, /new\s+eng-pattern-\S+\s+possible/, first.stdout);
  const second = eng(["record"], store, {}, `${good}\n`);
  assert.match(second.stdout, /confirm\s+eng-pattern-\S+\s+possible/, second.stdout);
  assert.match(eng(["facts"], store).stdout, /fresh\s+possible/, "the scope was clean, so the fact is fresh; one session keeps it possible");
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
