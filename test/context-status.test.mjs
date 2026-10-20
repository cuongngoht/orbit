// How much project context there is, as one word read off evidence (1.8.9, src/context/status.mjs): never off a
// command having run, never off how many sections came back -- and the context command opens with it.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTEXT_STATES, CONTEXT_WORDS, blockedOf, statusOf } from "../src/context/status.mjs";
import { sectionOf } from "../src/context/sections.mjs";
import { sealed } from "./home.mjs";

const SIX = ["architecture", "technology", "engineering", "knowledge", "work", "working-set"];
const facts = (over = {}) => ({ bound: true, sections: SIX.map((id) => ({ id, known: true })), architecture: { total: 12, stale: 0 }, blocked: null, ...over });
const unknown = (...ids) => SIX.map((id) => ({ id, known: !ids.includes(id) }));

test("every word is reachable, in its order, and the last row always answers", () => {
  const reached = [
    statusOf(facts({ bound: false })).word,
    statusOf(facts({ blocked: "architecture could not answer here — locked" })).word,
    statusOf(facts({ architecture: { total: 0, stale: 0 } })).word,
    statusOf(facts({ architecture: { total: 12, stale: 3 } })).word,
    statusOf(facts({ sections: unknown("knowledge") })).word,
    statusOf(facts()).word,
  ];
  assert.deepEqual(reached, CONTEXT_WORDS);
  assert.deepEqual(CONTEXT_STATES.map((r) => r.word), CONTEXT_WORDS);
  assert.equal(CONTEXT_STATES.at(-1).when({}), true);
});

test("READY needs every section known AND no fact citing a moved scope; anything less is never READY", () => {
  for (const ids of [["working-set"], ["knowledge", "work"], SIX]) assert.notEqual(statusOf(facts({ sections: unknown(...ids) })).word, "READY", `unknown: ${ids}`);
  assert.notEqual(statusOf(facts({ architecture: { total: 12, stale: 1 } })).word, "READY");
  assert.notEqual(statusOf(facts({ architecture: { total: 0, stale: 0 } })).word, "READY", "sections that all answered about nothing learned are not understanding");
  assert.equal(statusOf(facts()).word, "READY");
});

test("BOOTSTRAPPED never claims understanding, and BLOCKED outranks everything but an unknown checkout", () => {
  assert.match(statusOf(facts({ architecture: { total: 0, stale: 0 } })).because, /nothing learned yet/);
  assert.equal(statusOf(facts({ blocked: "x", architecture: { total: 0, stale: 0 } })).word, "BLOCKED");
  assert.equal(statusOf(facts({ blocked: "x", bound: false })).word, "NOT_INITIALIZED");
});

test("the summary a receipt carries names how much is known and what is not", () => {
  const s = statusOf(facts({ sections: unknown("knowledge", "work", "working-set") }));
  assert.equal(s.summary, "PARTIAL: 3 of 6 known; unknown: knowledge, work, working-set");
  assert.deepEqual(s.unknown, ["knowledge", "work", "working-set"]);
  assert.deepEqual(s.known, ["architecture", "technology", "engineering"]);
});

test("a section whose command was BLOCKED is told apart from one with nothing to say", () => {
  const blocked = sectionOf({ id: "architecture", title: "ARCHITECTURE" }, { ok: false, status: 3, error: "the store is locked by another session" });
  const gap = sectionOf({ id: "knowledge", title: "KNOWLEDGE" }, { ok: false, status: 2, error: "refused" });
  assert.equal(blocked.blocked, true);
  assert.equal(gap.blocked, undefined);
  assert.equal(blockedOf([gap, blocked]), "architecture could not answer here — the store is locked by another session");
  assert.equal(blockedOf([gap]), null);
});

const engine = fileURLToPath(new URL("..", import.meta.url));
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-context-status-")));
after(() => rmSync(temp, { recursive: true, force: true }));
const env = Object.fromEntries(Object.entries(sealed({ ORBIT_STORE_DIR: join(temp, "store") })).filter(([k]) => k !== "CLAUDE_PROJECT_DIR"));
const run = (root, name, args) => spawnSync(process.execPath, [join(engine, "cli", `${name}.mjs`), ...args], { cwd: root, env, encoding: "utf8", timeout: 180000 });

test("the context command opens with its word: a repository read that held nothing is BOOTSTRAPPED and says so, and a gap is never READY", () => {
  const root = join(temp, "repo");
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "app.js"), "export const answer = 42;\n");
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "init"]);
  const first = run(root, "context", ["--for=fix the answer", "--json"]);
  assert.equal(first.status, 0, first.stderr);
  const status = JSON.parse(first.stdout).status;
  assert.equal(status.word, "BOOTSTRAPPED", "a one-file checkout with no manifest yields no architecture fact, and nothing pretends otherwise");
  assert.match(status.because, /the repository was read, and nothing in it is a fact to keep yet/);
  assert.ok(status.unknown.includes("working-set"), "no hook recorded a session here, and that stays UNKNOWN");
  assert.match(run(root, "context", ["--for=fix the answer"]).stdout, /^STATUS  BOOTSTRAPPED -- /);
  const help = JSON.parse(run(root, "help", ["--json"]).stdout);
  assert.notEqual(help.next, "architecture", "a repository already read is not sent to be read again");
});

test("outside every checkout the context command says NOT_INITIALIZED and asks nothing of a store", () => {
  const loose = join(temp, "not-a-checkout");
  mkdirSync(loose);
  const r = run(loose, "context", ["--for=fix the answer", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status.word, "NOT_INITIALIZED");
});
