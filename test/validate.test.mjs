import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { findCase, loadCase, loadCases } from "../src/dsl/load.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { loadGraph, graphFindings } from "../src/graph/index.mjs";
import { FIXTURES, UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));

test("the fixture map and cases are clean", () => {
  assert.deepEqual(graphFindings(graph), []);
  for (const c of loadCases(join(UI_TESTS, "screens"))) assert.deepEqual(validate(c, graph), [], c.id);
});

test("the bad fixture trips every rule family", () => {
  const bad = findCase(join(UI_TESTS, "screens"), join(FIXTURES, "case.bad.json"));
  const f = validate(bad, graph);
  const has = (re) => assert.ok(f.some((x) => re.test(x)), `expected a finding matching ${re}\n${f.join("\n")}`);
  has(/id does not match its file name/);
  has(/seen must be live or src/);
  has(/starts on unknown screen nowhere/);
  has(/unknown field "waits"/);
  has(/must not name a profile/);
  has(/states nothing verifiable/);
  has(/creates something but has no skip-if guard/);
  has(/step 2 \(click\): click with no wait after it/);
  has(/names unknown control home\/Nope/);
  has(/no usable selector \(home\/Delete\)/);
  has(/uses undeclared param \$\{UNDECLARED\}/);
  has(/"expect" belongs on a report or sql or call step/);
  has(/press without key/);
  has(/api match is not a valid regex/);
  has(/step 7 \(api\): status must be at least 100/);
  has(/step 7 \(api\): method must be GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS/);
  has(/step 13 \(assert\): times must be at least 1/);
  has(/step 13 \(assert\): tries must be at least 1/);
  has(/param 1: n does not look like/);
  has(/param 1: unknown field "bogus"/);
  has(/sql must be a read-only SELECT/);
  has(/step 10 \(hover\): unknown verb/);
  has(/"query" belongs on a sql step/);
  has(/screenshot without file/);
  has(/does not end with a report step/);
});

// Every rule family below rules/shape.mjs walks a container. Handed the wrong
// kind they used to throw a raw TypeError out of the validator, which
// cli/run-case.mjs re-threw as exit 1 -- a malformed FILE reported as a
// misbehaving PRODUCT, with a stack trace instead of a sentence.
test("a container of the wrong kind is a finding, never a TypeError", () => {
  const base = { id: "x", _file: "/x.json", name: "x", seen: "src" };
  const ok = [{ do: "report", js: "1", expect: "true" }];
  const findings = (c) => validate(c, graph);
  assert.deepEqual(findings({ ...base, steps: { do: "goto" } }), ["x: steps must be an array, not an object"]);
  assert.deepEqual(findings({ ...base, steps: [null] }), ["x: steps[1] must be an object, not null"]);
  assert.deepEqual(findings({ ...base, steps: ["goto"] }), ["x: steps[1] must be an object, not a string"]);
  assert.deepEqual(findings({ ...base, steps: ok, params: { n: "A" } }), ["x: params must be an array, not an object"]);
  assert.deepEqual(findings({ ...base, steps: ok, resolve: { as: "A" } }), ["x: resolve must be an array, not an object"]);
  assert.deepEqual(findings({ ...base, steps: ok, identities: [] }), ["x: identities must be an object, not an array"]);
  assert.deepEqual(findings(null), ["case: must be a JSON object, not null"]);
  assert.deepEqual(findings("nope"), ["case: must be a JSON object, not a string"]);
});

// fields.mjs has always DECLARED these (the shipped cases/schema.json says
// minimum: 1), and nothing enforced them at run time -- which is how times: 0
// reached the runner and skipped a step's body without failing it.
test("the constraint table in fields.mjs is enforced at validate time, not only in the editor", () => {
  const of = (step) => validate({ id: "x", _file: "/x.json", name: "x", seen: "src", steps: [{ ...step }, { do: "report", js: "1", expect: "true" }] }, graph);
  const has = (step, re) => assert.ok(of(step).some((f) => re.test(f)), `${JSON.stringify(step)} -> ${of(step).join(" | ")}`);
  has({ do: "assert", js: "t", times: 0 }, /times must be at least 1/);
  has({ do: "assert", js: "t", times: -1 }, /times must be at least 1/);
  has({ do: "assert", js: "t", times: "2" }, /times must be a whole number/);
  has({ do: "assert", js: "t", times: 1.5 }, /times must be a whole number/);
  has({ do: "assert", js: "t", tries: 0 }, /tries must be at least 1/);
  has({ do: "assert", js: "t", timeout: "soon" }, /timeout must be a whole number/);
  has({ do: "api", match: "x", status: "201" }, /status must be a whole number/);
  has({ do: "api", match: "x", method: "post" }, /method must be GET, POST/);
  has({ do: "click", selector: 42 }, /selector must be a string/);
  assert.deepEqual(of({ do: "assert", js: "t", times: 3, tries: 40, timeout: 90 }), []);
});

// A role claim list holding a number asserts nothing -- IDENTITY_FIELDS says
// items are strings, so the table catches it now that items is a keyword.
test("an identity is held to the same table", () => {
  const of = (identity) => validate({ id: "x", _file: "/x.json", name: "x", seen: "src", identity, steps: [{ do: "report", js: "1", expect: "true" }] }, graph);
  assert.ok(of({ as: "a", roles: "App.Admin" }).some((f) => /roles must be an array/.test(f)));
  assert.ok(of({ as: "a", roles: ["ok", 1] }).some((f) => /every entry of roles must be a string/.test(f)));
  assert.ok(of({ as: 1, roles: ["r"] }).some((f) => /as must be a string/.test(f)));
  assert.deepEqual(of({ as: "a", roles: ["App.Admin"], notRoles: ["Other"] }), []);
});

// loadCases maps over every case file in the tree, so one torn file threw a SyntaxError
// that named nothing and took `query check` down for the whole directory.
test("a case file that is not readable JSON is a finding that names the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-cases-"));
  const wrote = (name, body) => { writeFileSync(join(dir, name), body); return loadCase(join(dir, name)); };
  // The tail of that sentence is V8's, not ours: Node 22 started appending
  // "(line 1 column 17)" to it, so pinning the whole string failed the suite on
  // every runner but the one it was written on. What this rule owes the reader
  // is the FILE NAME and one finding, and that is what is asserted.
  const torn = validate(wrote("torn.json", '{ "id": "torn", '), graph);
  assert.equal(torn.length, 1, "a file that cannot be parsed is one finding, not a cascade");
  assert.match(torn[0], /^torn\.json: is not valid JSON: Expected double-quoted property name in JSON/);
  assert.deepEqual(validate(wrote("notobj.json", "[1,2]"), graph), ["notobj.json: is not a JSON object"]);
  assert.equal(loadCases(dir).length, 2, "both are still loaded, so check can report both");
});

test("a case with no verdict is refused even if every step is well-formed", () => {
  const c = { id: "x", _file: "/x.json", name: "x", seen: "src", start: "home", steps: [{ do: "goto", screen: "home" }, { do: "report", js: "1" }] };
  assert.ok(validate(c, graph).some((f) => /no assert and no expect/.test(f)));
});

test("identities must be picked with `as` before the first act", () => {
  const c = { id: "x", _file: "/x.json", name: "x", seen: "src", identities: { a: { roles: ["r"] }, b: { notRoles: ["r"] } },
    steps: [{ do: "goto", screen: "home" }, { do: "as", identity: "zzz" }, { do: "report", js: "1", expect: "true" }] };
  const f = validate(c, graph);
  assert.ok(f.some((x) => /does not pick one with \{"do":"as"\} before step 1/.test(x)));
  assert.ok(f.some((x) => /"zzz" is not one of a, b/.test(x)));
});

// Single assignment, only forward, and somebody reads it. That is the whole of
// what keeps `into` from turning the DSL into a program with variables.
test("into binds a name once, only forward, and only if a later step uses it", () => {
  const of = (steps, extra = {}) => validate({ id: "x", _file: "/x.json", name: "x", seen: "src", ...extra, steps }, graph);
  const report = (more) => ({ do: "report", js: "1", expect: "true", ...more });

  const forward = of([report({ js: "'${ID}'" }), report({ into: "ID" })]);
  assert.ok(forward.some((f) => /uses \${ID}, which a LATER step binds/.test(f)), forward.join(" | "));

  const twice = of([report({ into: "ID" }), report({ into: "ID" }), report({ js: "'${ID}'" })]);
  assert.ok(twice.some((f) => /into "ID" is already a param, a resolve target or an earlier binding/.test(f)), twice.join(" | "));

  const shadow = of([report({ into: "NAME" }), report({ js: "'${NAME}'" })], { params: [{ n: "NAME" }] });
  assert.ok(shadow.some((f) => /into "NAME" is already a param/.test(f)), shadow.join(" | "));

  const unread = of([report({ into: "ID" })]);
  assert.ok(unread.some((f) => /binds \${ID} but no later step uses it/.test(f)), unread.join(" | "));

  const lower = of([report({ into: "id" }), report({ js: "1" })]);
  assert.ok(lower.some((f) => /into does not look like/.test(f)), lower.join(" | "));

  assert.deepEqual(of([report({ into: "ID" }), report({ js: "'${ID}'" })]), [], "the good shape stays clean");
});

// resolve rows run in order and feed each other, so a forward reference used to
// validate clean and then ask the database about the literal text ${LATER}.
test("a resolve row may only use what a param or an EARLIER row provides", () => {
  const of = (resolve, params) => validate({ id: "x", _file: "/x.json", name: "x", seen: "src", params, resolve, steps: [{ do: "report", js: "1", expect: "true" }] }, graph);
  const forward = of([{ as: "A", sql: "SELECT 1 WHERE x='${B}'" }, { as: "B", sql: "SELECT 2" }]);
  assert.ok(forward.some((f) => /uses \${B}, which no param and no EARLIER resolve provides/.test(f)), forward.join(" | "));
  assert.deepEqual(of([{ as: "B", sql: "SELECT 2" }, { as: "A", sql: "SELECT 1 WHERE x='${B}'" }]), [], "in order it is fine");
  assert.deepEqual(of([{ as: "A", sql: "SELECT 1 WHERE x='${N}'" }], [{ n: "N" }]), [], "a param is available to every row");
});

// ANY skip-if used to satisfy this, including one at the very end -- which asks
// "did I just do that twice?" after the duplicate has already been created.
test("a skip-if after the first mutating step is not a guard", () => {
  const of = (steps) => validate({ id: "x", _file: "/x.json", name: "x", seen: "src", start: "home", creates: "one thing", steps }, graph);
  const report = { do: "report", js: "1", expect: "true" };
  const late = of([{ do: "click", on: "home/Add", wait: "1" }, { do: "skip-if", js: "1", why: "too late" }, report]);
  assert.ok(late.some((f) => /creates something but has no skip-if guard before its first mutating step/.test(f)), late.join(" | "));

  const none = of([{ do: "click", on: "home/Add", wait: "1" }, report]);
  assert.ok(none.some((f) => /no skip-if guard/.test(f)), none.join(" | "));

  const witnesses = [{ do: "api", match: "api/things", method: "POST", status: 201 }, { do: "sql", query: "SELECT 1 AS n", expect: "it.length === 1" }];
  const early = of([{ do: "goto", screen: "home", wait: "1" }, { do: "skip-if", js: "1", why: "already there" }, { do: "click", on: "home/Add", wait: "1" }, ...witnesses, report]);
  assert.deepEqual(early, [], "a goto before the guard is fine — it changes nothing");
});

// A screen can show a write that never happened: an optimistic render, a list
// served from cache, a row the API accepted and the database rejected. So a case
// that DECLARED it creates something has to ask a layer below the screen.
//
// Three places already said so in prose -- the case-writer agent, the skill's
// §3, the README's best practices -- and the agent even reports back
// "verdicts: UI yes · API no · SQL no". Nothing enforced it, so that line was
// information for whoever read it, and `check` exited 0 either way.
test("a case that creates something has to rule below the screen, not only on it", () => {
  const of = (verdicts) => validate({
    id: "x", _file: "/x.json", name: "x", seen: "src", creates: "a thing",
    steps: [{ do: "skip-if", js: "false", why: "already there" }, ...verdicts, { do: "report", js: "1", expect: "true" }],
  }, graph);
  const said = (fs) => fs.filter((f) => /creates something but rules/.test(f));
  const api = { do: "api", match: "api/things", method: "POST", status: 201 };
  const sql = { do: "sql", query: "SELECT 1 AS n", expect: "it.length === 1" };

  assert.match(said(of([]))[0] ?? "", /rules on api and sql nowhere/, "neither witness");
  assert.match(said(of([api]))[0] ?? "", /rules on sql nowhere/, "the row is still unasked");
  assert.match(said(of([sql]))[0] ?? "", /rules on api nowhere/, "the call is still unasked");
  assert.deepEqual(said(of([api, sql])), [], "both witnesses present");
});

// A case that only READS is not held to it. There is no write for a row to
// witness, and a rule that complained about every navigation case is a rule
// somebody switches off -- which costs more than it ever caught.
test("a case that declares no creates is asked for no witness", () => {
  const c = { id: "x", _file: "/x.json", name: "x", seen: "src", steps: [{ do: "assert", js: "true" }, { do: "report", js: "1", expect: "true" }] };
  assert.deepEqual(validate(c, graph).filter((f) => /rules on/.test(f)), []);
});

// graph/effects.json already says dlg-thing/Save calls POST api/things and writes
// Things. A case that types that again can type it WRONG, and the drift is
// silent: the wrong endpoint is usually also a real request the page made, so
// the assert passes and the case quietly stops being about what it claims.
test("the map is held against the case: the call and the table it says a control touches", () => {
  const drive = (verdicts) => validate({
    id: "x", _file: "/x.json", name: "x", seen: "src", start: "home",
    steps: [
      { do: "goto", screen: "home", wait: "1" },
      { do: "click", on: "home/Add", wait: "1" },
      { do: "fill", on: "dlg-thing/Name", value: "v" },
      { do: "click", on: "dlg-thing/Save", wait: "1" },
      ...verdicts,
      { do: "report", js: "1", expect: "true" },
    ],
  }, graph);
  const said = (fs) => fs.filter((f) => /effects\.json/.test(f));
  const api = (over) => ({ do: "api", match: "api/things", method: "POST", status: 201, ...over });
  const sql = (over) => ({ do: "sql", query: "SELECT COUNT(*) AS n FROM Things", expect: "it.length === 1", ...over });

  assert.deepEqual(said(drive([api(), sql()])), [], "what the map says, asserted");
  assert.match(said(drive([api({ method: "GET" })]))[0] ?? "", /asserts GET but the map says dlg-thing\/Save calls POST/);
  assert.match(said(drive([api({ match: "api/widgets" })]))[0] ?? "", /does not match api\/things/);
  assert.match(said(drive([sql({ query: "SELECT 1 FROM Widgets" })]))[0] ?? "", /names none of Things/);
  assert.deepEqual(said(drive([api({ match: "things" })])), [], "a broader pattern still matches — only a different one is caught");
});

// The map writes a call's id as a template (`api/items/{id}`); the case asserts the very call it made, with the id
// the run bound (`api/items/${ID}`). Those are the same call, and a different path is still caught.
test("a placeholder in a match stands for the map's templated segment", () => {
  const archive = { ...graph, effectOn: new Map([["detail/Archive", { on: "detail/Archive", api: "DELETE api/things/{id}", timing: "sync" }]]) };
  const drive = (match) => validate({
    id: "x", _file: "/x.json", name: "x", seen: "src", start: "detail", params: [{ n: "ID", required: true }],
    steps: [
      { do: "goto", screen: "detail", url: "/things/${ID}", wait: "1" },
      { do: "click", on: "detail/Archive", wait: "1" },
      { do: "api", match, method: "DELETE", status: 200 },
      { do: "report", js: "1", expect: "true" },
    ],
  }, archive).filter((f) => /effects\.json/.test(f));
  assert.deepEqual(drive("api/things/${ID}"), [], "the id the run bound is the map's {id}");
  assert.match(drive("api/widgets/${ID}")[0] ?? "", /does not match api\/things\/\{id\}/);
});

// An effect record that names no call at all: asserting a request against it
// says the case and the map disagree about whether anything is even sent.
test("a verdict about a call the map says never happens is a finding", () => {
  const blind = { ...graph, effectOn: new Map([["dlg-thing/Save", { on: "dlg-thing/Save", timing: "sync" }]]) };
  const f = validate({
    id: "x", _file: "/x.json", name: "x", seen: "src", start: "home",
    steps: [
      { do: "goto", screen: "home", wait: "1" },
      { do: "click", on: "dlg-thing/Save", wait: "1" },
      { do: "api", match: "api/things", method: "POST", status: 201 },
      { do: "report", js: "1", expect: "true" },
    ],
  }, blind);
  assert.ok(f.some((x) => /makes no backend call, so there is no request to match/.test(x)), f.join(" | "));
});
