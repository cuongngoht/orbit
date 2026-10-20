// cli/knowledge.mjs, spawned the way a host runs it: a sealed environment, a
// throwaway store, the fixture project -- and nothing may land in a repository.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COMMAND_NAMES, COMMANDS } from "../src/knowledge/index.mjs";
import { projectKnowledge } from "../src/knowledge/summary.mjs";
import { loadProject } from "../src/project/index.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "knowledge.mjs");
const UI_TESTS = join(ROOT, "test", "fixtures", "ui-tests");

const run = (args, env = {}, input = "") => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input, env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_TRACE: "off", ...env }), cwd: ROOT, timeout: 60000 });

const E = { evidence: ["test/fixtures/ui-tests/project.json"], source: "repository", strength: "observed" };
const lines = (...claims) => claims.map((c) => JSON.stringify({ ...E, ...c })).join("\n");
const CHAIN = lines({ subject: "invoice.issue", relation: "results-in", object: "ledger.entry" }, { subject: "ledger.entry", relation: "observed-through", object: "ledger.view" }, { subject: "ledger.view", relation: "requires-capability", object: "ledger.view.read" });

function tree(dir) {
  return readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))).filter((f) => statSync(f).isFile()).map((f) => `${f}:${statSync(f).mtimeMs}`).sort();
}

test("every command declares what it writes and what it needs bound", () => {
  for (const name of COMMAND_NAMES) {
    assert.ok(["nothing", "store"].includes(COMMANDS[name].writes), name);
    assert.ok(["store", "vocabulary", "resources"].includes(COMMANDS[name].needs), name);
  }
});

test("record → claims → verify → decide, end to end, with nothing written into the repository", () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-kcli-"));
  const before = tree(UI_TESTS);
  const recorded = run(["record"], { ORBIT_STORE_DIR: store }, CHAIN);
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.match(recorded.stdout, /3 claim\(s\) reconciled · 3 new/);
  const claims = run(["claims", "--for=issue the invoice.issue now", "--json"], { ORBIT_STORE_DIR: store });
  assert.equal(claims.status, 0, claims.stderr);
  assert.ok(JSON.parse(claims.stdout).answers.length >= 2);
  const verified = run(["verify", "--for=invoice.issue", "--purpose=verification", "--workflow=orbit-test-plan", "--json"], { ORBIT_STORE_DIR: store });
  assert.equal(verified.status, 0, `${verified.stderr} — a gap is never a failure`);
  const out = JSON.parse(verified.stdout);
  assert.deepEqual([out.results[0].capability, out.results[0].outcome, out.opportunities[0].surface.row], ["ledger.view.read", "gap", "DEMANDED"]);
  assert.equal(run(["decide", out.opportunities[0].id, "defer"], { ORBIT_STORE_DIR: store }).status, 2, "a decision without --human is refused");
  const decided = run(["decide", out.opportunities[0].id, "defer", "--human", "--reason=next sprint"], { ORBIT_STORE_DIR: store });
  assert.equal(decided.status, 0, decided.stderr);
  assert.match(run(["opportunities"], { ORBIT_STORE_DIR: store }).stdout, /deferred/);
  assert.deepEqual(tree(UI_TESTS), before, "nothing landed in the project it reads");
});

test("Orbit Control's summary reads what the CLI recorded -- the vocabulary's layers, the dimensions in use, the conflicts -- and never throws", async () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-kcli-"));
  run(["record"], { ORBIT_STORE_DIR: store }, lines({ subject: "doc.publish", relation: "implemented-by", object: "engine.one", context: { region: "north" } }, { subject: "doc.publish", relation: "implemented-by", object: "engine.two", context: { region: "north" } }, { subject: "doc.publish", relation: "house-rule", object: "review.first" }));
  const env = { ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store };
  const project = loadProject(env, ROOT);
  const s = await projectKnowledge({ project, env, pluginRoot: ROOT, storeBase: store });
  assert.equal(s.available, true, s.why);
  assert.deepEqual([s.claims.total, s.dimensions, s.relations.undeclared], [3, [{ name: "region", values: 1 }], ["house-rule"]]);
  assert.deepEqual(s.conflicts.map((c) => [c.subject, c.objects.map((o) => o.object).sort()]), [["doc.publish", ["engine.one", "engine.two"]]]);
  assert.ok(s.relations.declared.some((r) => r.id === "implemented-by" && r.layer === "orbit"));
  assert.deepEqual((await projectKnowledge({ project: null, env, pluginRoot: ROOT, storeBase: store })).available, false);
});

test("claims answers on an empty store and exits 0, so project context never reads it as UNKNOWN", () => {
  const r = run(["claims", "--for=anything at all"], { ORBIT_STORE_DIR: mkdtempSync(join(tmpdir(), "orbit-kcli-")) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /nothing is recorded about this project yet/);
});

test("a refused batch writes nothing, and says why line by line", () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-kcli-"));
  const r = run(["record"], { ORBIT_STORE_DIR: store }, lines({ subject: "a.b", relation: "results-in", object: "c.d" }, { subject: "a.b", relation: "results-in", object: "c.e", evidence: ["nowhere.txt"] }));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /not tracked here/);
  assert.match(run(["claims", "--for=a.b"], { ORBIT_STORE_DIR: store }).stdout, /nothing is recorded/);
});

test("the vocabulary names Orbit's generic rows and where they came from", () => {
  const r = run(["vocabulary"], { ORBIT_STORE_DIR: mkdtempSync(join(tmpdir(), "orbit-kcli-")) });
  assert.equal(r.status, 0, r.stderr);
  for (const id of ["results-in", "implemented-by", "observed-through", "requires-capability"]) assert.match(r.stdout, new RegExp(`.*orbit`));
});

test("locate --hook is silent, keeps only a LOCATION, and never the transcript path or the raw session id", () => {
  const tmp = mkdtempSync(join(tmpdir(), "orbit-kloc-"));
  const home = mkdtempSync(join(tmpdir(), "orbit-khome-"));
  const input = JSON.stringify({ hook_event_name: "SessionStart", session_id: "raw-session-9f2", transcript_path: join(home, ".claude", "projects", "-demo", "raw-session-9f2.jsonl"), cwd: ROOT });
  const env = { ORBIT_STORE_DIR: mkdtempSync(join(tmpdir(), "orbit-kcli-")), TMPDIR: tmp, TMP: tmp, TEMP: tmp, HOME: home, USERPROFILE: home };
  const before = uiTestsOf(ROOT);
  const r = run(["locate", "--hook"], env, input);
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
  const kept = readdirSync(env.ORBIT_STORE_DIR, { recursive: true }).map(String).find((f) => f.endsWith("host-memory.json"));
  const text = readFileSync(join(env.ORBIT_STORE_DIR, kept), "utf8");
  assert.match(text, /projects.+-demo.+memory/);
  assert.doesNotMatch(text, /raw-session-9f2/);
  const off = mkdtempSync(join(tmpdir(), "orbit-kloc-"));
  run(["locate", "--hook"], { ...env, TMPDIR: off, TMP: off, TEMP: off, ORBIT_HOST_MEMORY: "off" }, input);
  assert.deepEqual(readdirSync(off), [], "switched off, it records nothing");
  assert.deepEqual(uiTestsOf(ROOT), before, "the hook never creates or changes ui-tests/ in the checkout");
});

// What ui-tests/ under a root holds, file by file: a checkout may track one (this repository does, since 7a4fc6e),
// so the hook is held to leaving it exactly as it found it rather than to its absence.
function uiTestsOf(root) {
  const dir = join(root, "ui-tests");
  if (!existsSync(dir)) return null;
  return readdirSync(dir, { recursive: true }).map(String).sort().map((f) => [f, statSync(join(dir, f)).isFile() ? readFileSync(join(dir, f), "utf8") : null]);
}

test("an unknown command prints the usage and exits 0; a bad --context is refused", () => {
  const help = run(["nonsense"]);
  assert.deepEqual([help.status, /knowledge\.mjs claims/.test(help.stdout)], [0, true]);
  assert.equal(run(["claims", "--context=NOT A SLUG"], { ORBIT_STORE_DIR: mkdtempSync(join(tmpdir(), "orbit-kcli-")) }).status, 2);
});
