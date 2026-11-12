// FILE-LEVEL RELATIONS followed on demand (0.6.0, U3; src/context/relations.mjs): one hop out and one hop in from the
// direct files, through the adapters a pack provides -- never a graph of the repository, never a guessed edge, and no
// language named in src/. Walked here over the login-app fixture (test/fixtures/relations/login-app/), round by round as
// a host would: it proposes the login page, then the client the page imports, then the handler the client's route
// literal points at -- and the package says, each time, what the files it was shown relate to.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DIRECT_LIMIT, GAP_TARGET, IMPORTER_READS, LITERAL_LIMIT, fixed, relatedOf, testsWith } from "../src/context/relations.mjs";
import { relevanceLines, relevanceOf, seedsOf } from "../src/context/relevance.mjs";
import { verifiedRefs } from "../src/context/refs.mjs";
import { RELATION_ADAPTERS } from "../skills/orbit-develop/relations/index.mjs";
import { loginApp, searchOf } from "./fakes/relations.mjs";

const PAGE = "web/src/pages/LoginPage.jsx";
const CLIENT = "web/src/api/sessionClient.js";
const HANDLER = "server/app/routes/session_routes.py";
const SESSION = "server/app/auth/session.py";
const DECOY = "web/src/legacy/login.js";

// One round of the package, as the composition root composes it: what the task and the host's references name, then
// the relations of the files something besides a name made direct.
function round(task, files, app = loginApp(), asked = []) {
  const refs = verifiedRefs(files.map((ref) => ({ kind: "file", ref })), app.tree).held;
  const input = { task, tree: app.tree, refs };
  const relations = relatedOf({ direct: seedsOf(relevanceOf(input)), tree: app.tree, adapters: RELATION_ADAPTERS, read: (p) => app.files[p] ?? null, search: searchOf(app.files, asked), maxFiles: 1000 });
  const listing = relevanceOf({ ...input, relations });
  return { relations, listing, at: Object.fromEntries(listing.items.map((i) => [i.ref, i])), asked };
}

const said = (item) => (item ? [item.class, [...new Set(item.evidence.map((e) => e.source))].sort(), item.by] : null);

test("round 1 -- the host proposes the login page: what it imports is a dependency, its test verification, and the client's route is not followed yet", () => {
  const r = round("fix the login bug", [PAGE]);
  assert.deepEqual(said(r.at[PAGE]), ["direct", ["tree"], "host-verified"]);
  assert.deepEqual(said(r.at[CLIENT]), ["dependency", ["imports"], "engine"], "page -> client");
  assert.deepEqual(said(r.at["web/src/components/Button.jsx"]), ["dependency", ["imports"], "engine"]);
  assert.deepEqual(said(r.at["web/src/pages/LoginPage.test.jsx"]), ["verification", ["imported-by", "test"], "engine"], "its test, by name and by the import it makes");
  assert.equal(r.at[HANDLER], undefined, "one hop: a literal in a file that is not direct is not read");
});

test("round 2 -- the host proposes the client: its route literal names the backend handler as a HYPOTHESIS, and the page that imports it is downstream", () => {
  const r = round("fix the login bug", [CLIENT]);
  assert.deepEqual(said(r.at[HANDLER]), ["unknown", ["route-literal"], "engine"], "client -> handler, in another language: a shared literal, never an edge");
  assert.deepEqual(r.at[HANDLER].evidence, [{ source: "route-literal", id: "/api/session" }]);
  assert.deepEqual(said(r.at[PAGE]), ["downstream", ["imported-by"], "engine"], "the page imports the client");
  assert.deepEqual(r.relations.hypotheses, [{ ref: HANDLER, literal: "/api/session", from: CLIENT }]);
});

test("round 3 -- the host read both ends and proposes the handler: it is host-verified, what it imports is a dependency, and its test verification", () => {
  const r = round("fix the login bug", [CLIENT, HANDLER]);
  assert.deepEqual(said(r.at[HANDLER]), ["direct", ["route-literal", "tree"], "host-verified"], "the hypothesis the host verified");
  assert.deepEqual(said(r.at[SESSION]), ["dependency", ["imports"], "engine"], "handler -> session module, resolved inside its package");
  assert.deepEqual(said(r.at["server/app/http.py"]), ["dependency", ["imports"], "engine"]);
  assert.deepEqual(said(r.at["server/tests/test_session_routes.py"]), ["verification", ["imported-by", "test"], "engine"]);
  assert.equal(r.at["server/tests/test_session.py"], undefined, "the session module's own test is a hop further: not listed");
});

test("a decoy named like the task is never a reason to follow what it imports, and is never promoted beyond its name", () => {
  const r = round("fix the login bug", []);
  assert.deepEqual(said(r.at[DECOY]), ["direct", ["name", "tree"], "engine"], "named by the task's word, and only by it");
  assert.equal(r.at["web/src/legacy/theme.js"], undefined, "what the decoy imports is not listed");
  assert.deepEqual(seedsOf(r.listing), [], "a name match seeds no relation");
  assert.deepEqual(r.asked, [], "and asks the index nothing");
  const proposed = round("fix the login bug", [PAGE]);
  assert.deepEqual(said(proposed.at[DECOY]), ["direct", ["name", "tree"], "engine"], "the page's relations never reach the decoy");
});

test("a direct file no adapter reads is a GAP naming the host's way to fill it -- never a guessed edge", () => {
  const r = round("fix the login bug", ["web/src/pages/LoginPage.css"]);
  assert.deepEqual(r.relations.gaps, [{ ref: "web/src/pages/LoginPage.css", why: "no relation adapter here reads *.css file — read it, and propose what it relates to", target: GAP_TARGET }]);
  assert.deepEqual(GAP_TARGET, { source: "host", target: "references", run: "context --with-refs" });
  assert.deepEqual(r.relations.items, []);
  const lines = relevanceLines([], { total: 0, byClass: {}, refused: [], gaps: r.relations.gaps }, 20);
  assert.ok(lines.some((l) => /gap\s+file web\/src\/pages\/LoginPage\.css -- no relation adapter .* -- context --with-refs/.test(l)), lines.join("\n"));
});

test("a read or a search that cannot run is a gap, never 'nothing relates to it'", () => {
  const app = loginApp();
  const base = { tree: app.tree, adapters: RELATION_ADAPTERS, maxFiles: 1000 };
  assert.match(relatedOf({ ...base, direct: [PAGE], read: () => null, search: searchOf(app.files) }).gaps[0].why, /could not be read/);
  assert.match(relatedOf({ ...base, direct: [PAGE], read: (p) => app.files[p], search: () => null }).gaps[0].why, /could not be searched/);
  assert.deepEqual(relatedOf({ ...base, direct: [], read: () => "", search: () => [] }), { items: [], gaps: [], hypotheses: [] });
  assert.deepEqual(relatedOf({ ...base, direct: [PAGE], tree: null }), { items: [], gaps: [], hypotheses: [] }, "no tree, nothing to verify a relation against");
});

test("the walk is bounded: each direct file read once, one search for its importers and one per literal, and at most maxFiles items", () => {
  const app = loginApp();
  const reads = [];
  const asked = [];
  const r = relatedOf({ direct: [PAGE, CLIENT], tree: app.tree, adapters: RELATION_ADAPTERS, read: (p) => (reads.push(p), app.files[p]), search: searchOf(app.files, asked), maxFiles: 1000 });
  assert.deepEqual(reads, [PAGE, CLIENT], "only the direct files are read, once each");
  assert.deepEqual(asked, [fixed("LoginPage"), fixed("sessionClient"), fixed("/api/session")]);
  assert.equal(relatedOf({ direct: [PAGE], tree: app.tree, adapters: RELATION_ADAPTERS, read: (p) => app.files[p], search: searchOf(app.files), maxFiles: 1 }).items.length, 1);
  const many = Array.from({ length: DIRECT_LIMIT + 4 }, (_, i) => `x${i}.css`);
  assert.equal(relatedOf({ direct: many, tree: app.tree, adapters: RELATION_ADAPTERS }).gaps.length, DIRECT_LIMIT);
  const literals = Array.from({ length: LITERAL_LIMIT + 2 }, (_, i) => `"/a/b${i}"`).join("\n");
  const q = [];
  relatedOf({ direct: ["a.js"], tree: { files: new Set(["a.js"]), dirs: new Set() }, adapters: RELATION_ADAPTERS, read: () => literals, search: searchOf({ "a.js": literals }, q) });
  assert.equal(q.length, 1 + LITERAL_LIMIT, "one importer search, and LITERAL_LIMIT literals");
});

// (0.6.0, P3b) What a turn's edits owe, with no declared check, is the tests that go with the edited files: ONE
// definition, the adapters' `testsOf` -- so for every file of the fixture, what `testsWith` names is exactly the walk's
// own `test` relation, and it reads no file and searches nothing.
test("which tests go with a file has one definition: testsWith names exactly the walk's test relation, for every file of the fixture", () => {
  const app = loginApp();
  const walked = (path) => relatedOf({ direct: [path], tree: app.tree, adapters: RELATION_ADAPTERS, read: (p) => app.files[p] ?? null, search: searchOf(app.files), maxFiles: 1000 }).items.filter((i) => i.evidence.some((e) => e.source === "test")).map((i) => i.ref).sort();
  const touched = [];
  const linked = (path) => testsWith({ direct: [path], tree: app.tree, adapters: RELATION_ADAPTERS, read: (p) => (touched.push(p), null), search: (q) => (touched.push(q), null) }).sort();
  const files = [...app.tree.files];
  for (const path of files) assert.deepEqual(linked(path), walked(path), path);
  assert.ok(files.some((path) => linked(path).length > 0), "the fixture links a test to at least one file");
  assert.deepEqual(touched, [], "no file read, nothing searched: the tracked listing alone");
});

test("what a checkout declares for its test runner is read through the walk's own read port, so the walk and testsWith agree on it", () => {
  const files = { "setup.cfg": "[tool:pytest]\npython_files = *test_*.py\n", "pylint/checkers/variables.py": "import os\n", "tests/checkers/unittest_variables.py": "from pylint.checkers import variables\n" };
  const tree = { files: new Set(Object.keys(files)), dirs: new Set() };
  const reads = [];
  const read = (p) => (reads.push(p), files[p] ?? null);
  const direct = ["pylint/checkers/variables.py"];
  assert.deepEqual(testsWith({ direct, tree, adapters: RELATION_ADAPTERS, read }), ["tests/checkers/unittest_variables.py"]);
  assert.deepEqual(reads, ["setup.cfg"], "only the declared config, through the port handed in");
  const walk = relatedOf({ direct, tree, adapters: RELATION_ADAPTERS, read, search: searchOf(files), maxFiles: 1000 });
  assert.deepEqual(walk.items.map((i) => [i.ref, i.class]), [["tests/checkers/unittest_variables.py", "verification"]]);
  assert.deepEqual(testsWith({ direct, tree, adapters: RELATION_ADAPTERS }), [], "no read port: nothing declared is known, and the default names no unittest_ file");
});

test("testsWith is bounded and never guesses: a file no adapter reads names none, no tree names none, at most maxFiles", () => {
  const tree = { files: new Set(["pkg/a.py", "pkg/b.py", "tests/test_a.py", "pkg/a_test.py", "tests/test_b.py", "web/x.js", "web/x.test.js", "notes.txt"]), dirs: new Set() };
  const base = { tree, adapters: RELATION_ADAPTERS };
  assert.deepEqual(testsWith({ ...base, direct: ["pkg/a.py", "web/x.js"] }), ["tests/test_a.py", "pkg/a_test.py", "web/x.test.js"]);
  assert.deepEqual(testsWith({ ...base, direct: ["pkg/a.py", "pkg/b.py"], maxFiles: 2 }), ["tests/test_a.py", "pkg/a_test.py"]);
  assert.deepEqual(testsWith({ ...base, direct: ["notes.txt"] }), [], "no adapter reads it: no guess");
  assert.deepEqual(testsWith({ ...base, direct: ["pkg/a.py"], tree: null }), []);
  assert.deepEqual(testsWith({ ...base, direct: ["pkg/a.py"], adapters: [{ id: "half", detects: () => true }] }), [], "an adapter missing part of its contract is never called");
  const many = Array.from({ length: DIRECT_LIMIT + 2 }, (_, i) => `m${i}.py`);
  const wide = { files: new Set([...many, ...many.map((m) => `test_${m}`)]), dirs: new Set() };
  assert.equal(testsWith({ ...base, tree: wide, direct: many }).length, DIRECT_LIMIT, "at most DIRECT_LIMIT edited files are asked about");
});

test("an adapter missing part of its contract is never called", () => {
  const app = loginApp();
  const half = { id: "half", detects: () => true };
  assert.deepEqual(relatedOf({ direct: [PAGE], tree: app.tree, adapters: [half], read: (p) => app.files[p], search: searchOf(app.files) }).gaps.map((g) => g.ref), [PAGE]);
});

// An importer whose own hit line names nothing -- the specifier sits below `import(` -- is read whole: the page imports
// the client that way in the fixture, and the handler's test imports it inside a parenthesised list.
test("an importer whose statement breaks across lines is read whole, once, and only when its line names nothing", () => {
  const app = loginApp();
  const reads = [];
  const r = relatedOf({ direct: [CLIENT], tree: app.tree, adapters: RELATION_ADAPTERS, read: (p) => (reads.push(p), app.files[p]), search: searchOf(app.files), maxFiles: 1000 });
  assert.deepEqual(r.items.find((i) => i.ref === PAGE), { ref: PAGE, class: "downstream", evidence: [{ source: "imported-by", id: `${PAGE} -> ${CLIENT}` }] });
  assert.deepEqual(reads, [CLIENT, PAGE], "the direct file, then the one hit file whose line named nothing");
  const handler = relatedOf({ direct: [HANDLER], tree: app.tree, adapters: RELATION_ADAPTERS, read: (p) => app.files[p], search: searchOf(app.files), maxFiles: 1000 });
  assert.equal(handler.items.find((i) => i.ref === "server/tests/test_session_routes.py")?.class, "verification");
  assert.deepEqual(handler.items.filter((i) => i.class === "dependency").map((i) => i.ref).sort(), ["server/app/auth/session.py", "server/app/http.py"], "a parenthesised list and a backslash continuation");
  const many = Object.fromEntries(Array.from({ length: IMPORTER_READS + 5 }, (_, i) => [`u${i}.js`, 'const x = require(\n  "./target.js"\n);\n']));
  const files = { ...many, "target.js": "export const t = 1;\n" };
  const counted = [];
  const out = relatedOf({ direct: ["target.js"], tree: { files: new Set(Object.keys(files)), dirs: new Set() }, adapters: RELATION_ADAPTERS, read: (p) => (counted.push(p), files[p]), search: searchOf(files), maxFiles: 1000 });
  assert.equal(counted.length, 1 + IMPORTER_READS, "at most IMPORTER_READS hit files read whole per direct file");
  assert.equal(out.items.length, IMPORTER_READS);
});

// src/ names no language, framework or stack: what a file imports is a pack's to know.
const code = (text) => text.replace(/^\s*\/\/.*$/gm, "");

test("src/context names no language, framework or stack", () => {
  const dir = new URL("../src/context/", import.meta.url);
  const words = /\b(javascript|typescript|python|ruby|golang|java|kotlin|csharp|dotnet|php|rust|react|vue|angular|flask|django|express|fastapi|spring|rails|node_modules|__init__)\b|\.(py|js|ts|jsx|tsx|rb|go|cs|java|kt|php|rs)\b/i;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) assert.doesNotMatch(code(readFileSync(new URL(file, dir), "utf8")), words, `src/context/${file}`);
  assert.doesNotMatch(readFileSync(new URL("relations.mjs", dir), "utf8"), words, "relations.mjs names none, in its comments either");
});
