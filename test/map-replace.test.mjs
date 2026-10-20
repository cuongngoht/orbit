import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadGraph } from "../src/graph/index.mjs";
import { replaceEdges, judgeReplacements } from "../src/graph/record-edge.mjs";
import { UI_TESTS } from "./fakes/context.mjs";
import { sealed } from "./home.mjs";

// Correcting a record was the one write the map took with no tool: an append
// refused the key it already had, saying "correct it with a new record", and
// then refused that record too. So a drifted selector was hand-edited -- no
// validation, no re-check, no rollback, and no trace of what it used to say.
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");
const GRAPH = join(UI_TESTS, "graph");
const graph = loadGraph(GRAPH);

const judged = (...lines) => judgeReplacements(graph, lines);
const why = (...lines) => judged(...lines).rejected[0]?.why ?? "";
const only = (...lines) => judged(...lines).accepted[0];

function tempGraph() {
  const dir = mkdtempSync(join(tmpdir(), "orbit-fix-"));
  cpSync(GRAPH, dir, { recursive: true });
  return dir;
}

const edges = (dir) => JSON.parse(readFileSync(join(dir, "edges.json"), "utf8"));

test("a key the map does not have is refused — a correction is not an append", () => {
  assert.match(why({ from: "home", via: "Nope", selector: "x" }), /is not in the graph — append it without --replace/);
  assert.match(why({ from: "home" }), /missing from, via/);
  assert.match(why({ t: "screen", from: "home", via: "Add" }), /only corrects edges/);
});

// The whole difference between a correction and a re-recording: the note
// somebody wrote at 2am, the destructive flag and the kind all survive.
test("only the fields the line carries are touched", () => {
  const a = only({ from: "home", via: "Delete", selector: "getByRole('button',{name:'Delete'})", seen: "live", fe_commit: "def5678" });
  assert.deepEqual(a.changed, ["selector", "seen", "fe_commit"]);
  assert.equal(a.now.kind, "button", "kind was not in the line and must not be lost");
  assert.equal(a.now.destructive, true, "a destructive flag survives a correction or the guard is gone");
  assert.equal(a.now.opens, "none");
  assert.equal(a.was.selector, "UNKNOWN", "the before is kept, because it is the evidence of what changed");
});

test("a correction that changes nothing is refused rather than written", () => {
  assert.match(why({ from: "home", via: "Add", selector: "getByRole('button',{name:'Add'})" }), /already says that/);
});

// `live` is a claim about a specific build. Inheriting the record's old commit
// would pin a fresh observation to a build nobody looked at.
test("a correction claiming live must bring its own fe_commit", () => {
  assert.match(why({ from: "home", via: "Delete", seen: "live" }), /must bring its own fe_commit/);
  const ok = only({ from: "home", via: "Delete", selector: "getByRole('button',{name:'Delete'})", seen: "live", fe_commit: "def5678" });
  assert.equal(ok.now.fe_commit, "def5678", "with its own commit, and a selector, it is accepted");
});

// home/Delete carries selector "UNKNOWN" -- never captured. Promoting it to
// `live` while it still cannot be driven would be a record that claims to have
// been watched and that no step can use.
test("a record that still cannot be driven cannot be marked observed", () => {
  assert.match(why({ from: "home", via: "Delete", seen: "live", fe_commit: "def5678" }), /empty or UNKNOWN/);
});

// One writer per record, enforced where it is cheapest to enforce.
test("the same key twice in one input is refused", () => {
  const { accepted, rejected } = judged(
    { from: "home", via: "Add", selector: "a" },
    { from: "home", via: "Add", selector: "b" });
  assert.equal(accepted.length, 1);
  assert.match(rejected[0].why, /corrected twice in this input — one record, one correction/);
});

test("a correction that would break the map is judged before anything is written", () => {
  assert.match(why({ from: "home", via: "Add", to: "no-such-screen" }), /neither null nor a known screen/);
  assert.match(why({ from: "home", via: "Add", selector: "UNKNOWN" }), /empty or UNKNOWN/);
  assert.match(why({ from: "home", via: "Add", opens: "sideways" }), /is not one of/);
});

// Updated in place, never deleted and re-added: a record's position is how a
// diff stays readable, and a wrong record is evidence of what changed.
test("the file keeps its length and every record keeps its place", () => {
  const dir = tempGraph();
  const before = edges(dir);
  const findings = replaceEdges(dir, judged({ from: "home", via: "Add", selector: "getByRole('button',{name:'New thing'})" }).accepted, () => []);
  const after = edges(dir);
  assert.deepEqual(findings, []);
  assert.deepEqual(after.map((r) => `${r.from}/${r.via}`), before.map((r) => `${r.from}/${r.via}`));
  assert.equal(after[0].selector, "getByRole('button',{name:'New thing'})");
});

test("a check finding after the write rolls the file back byte for byte", () => {
  const dir = tempGraph();
  const before = readFileSync(join(dir, "edges.json"), "utf8");
  const findings = replaceEdges(dir, judged({ from: "home", via: "Add", selector: "changed" }).accepted, () => ["a finding somebody has to fix"]);
  assert.deepEqual(findings, ["a finding somebody has to fix"]);
  assert.equal(readFileSync(join(dir, "edges.json"), "utf8"), before, "the graph must be exactly what it was");
});

// --dry proves the judgement and nothing else. An agent is told to run it, so
// what it promises has to be true: not one byte.
test("--replace --dry judges every line and writes nothing", () => {
  const project = mkdtempSync(join(tmpdir(), "orbit-fixcli-"));
  cpSync(UI_TESTS, join(project, "ui-tests"), { recursive: true });
  const patch = join(project, "patch.jsonl");
  writeFileSync(patch, JSON.stringify({ from: "home", via: "Add", selector: "getByRole('button',{name:'New thing'})" }) + "\n");
  const before = readFileSync(join(project, "ui-tests", "graph", "edges.json"), "utf8");
  const r = spawnSync(process.execPath, [join(CLI, "record-edge.mjs"), patch, "--replace", "--dry"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: join(project, "ui-tests") }) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 would be replaced, 0 rejected — nothing written/);
  assert.match(r.stdout, /was {2}selector="getByRole\('button',\{name:'Add'\}\)"/, "a replacement must show what it replaces");
  assert.equal(readFileSync(join(project, "ui-tests", "graph", "edges.json"), "utf8"), before);
});

// An append and a correction are one table with three different values, so the
// older half has to keep working exactly as it did.
test("without --replace the tool still refuses a key the map already has", () => {
  const project = mkdtempSync(join(tmpdir(), "orbit-appcli-"));
  cpSync(UI_TESTS, join(project, "ui-tests"), { recursive: true });
  const patch = join(project, "patch.jsonl");
  writeFileSync(patch, JSON.stringify({ from: "home", via: "Add", kind: "button", selector: "x", opens: "none", to: null, seen: "src" }) + "\n");
  const r = spawnSync(process.execPath, [join(CLI, "record-edge.mjs"), patch, "--dry"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: join(project, "ui-tests") }) });
  assert.match(r.stdout, /is already in the graph/);
  assert.match(r.stdout, /nothing to append/);
  assert.equal(r.status, 1);
});
