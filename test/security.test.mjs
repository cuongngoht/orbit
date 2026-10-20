// What this engine must never disclose, in one file.
//
// The rules are scattered across the code that enforces them -- src/scrub.mjs,
// the allow-list in src/learn/evidence.mjs, a pattern on a field's row, an
// advisory in src/query/check.mjs -- and each of those files tests the mechanism
// it owns. This tests the PROPERTY: given something secret, does it come out the
// other end of each door that leads off this machine.
//
// There are three such doors now, and 1.4.2 changed which one matters most:
//
//   the ledger and the notes  -- machine state, but projected into the host's
//                                MEMORY.md and quoted into lessons
//   a lesson                  -- machine state, projected the same way
//   a REPORT                  -- the one artefact meant to travel: mailed,
//                                attached to a ticket, with every screenshot
//                                embedded in it as base64
//
// The report used to be build output sitting beside its evidence. It is now the
// only thing this plugin writes outside its own store, which makes it the door
// worth testing hardest.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validate } from "../src/dsl/index.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { createMemory } from "../src/memory/index.mjs";
import { memoryPaths } from "../src/memory/store.mjs";
import { reportHtml } from "../src/report/index.mjs";
import { model } from "../src/report/model.mjs";
import { SECRET_NAME, scrub, scrubbed } from "../src/scrub.mjs";
import { UI_TESTS } from "./fakes/context.mjs";

// A run that carried everything worth protecting: a password handed in on the
// command line, a signed-in person, a token, a connection string, and rows a
// query returned about a real customer.
const LOADED = [
  { kind: "run", case: "create-thing", file: "/x/cases/create-thing.json", sqlCommand: ["sqlcmd", "-S", "db01"], params: { NAME: "TC-1", PASSWORD: "hunter2", TARGET_UPN: "teacher1@contoso.example" }, source: { id: "create-thing", steps: [{ do: "goto", screen: "home" }] } },
  { kind: "identity", as: "admin", upn: "real.person@customer.example", roles: ["Category Administrator"] },
  { kind: "step", i: 1, do: "sql", query: "SELECT Id FROM Users WHERE Upn = 'teacher1@contoso.example'", rows: [{ Id: "8373" }], ok: true },
  { kind: "result", status: "PASS", done: 1, of: 1, proved: { ui: 0, api: 0, sql: 1 } },
];

// Everything that reaches the page through a MASKED field. The same UPN also
// appears inside the SQL literal, which is deliberately not masked -- that is
// the next test, and keeping the two apart is the point.
const SECRETS = ["hunter2", "real.person@customer.example"];

// The report is built from run-log.jsonl, which is RAW on purpose -- it is the
// run talking to itself, inside the store. The rendering is where that stops.
test("a report masks everything the ledger refuses to keep, through the same declaration", () => {
  const html = reportHtml(LOADED);
  for (const secret of SECRETS) assert.ok(!html.includes(secret), `the report leaked "${secret}" into a file people mail`);
  assert.match(html, /TC-1/, "a value that is not secret-shaped still has to be there — it is how a run is re-read");
  assert.match(html, /\[upn\]/, "and what was masked says so, rather than vanishing");
});

// A deliberate disclosure, asserted so that nobody "fixes" it into uselessness:
// the report exists so a tester can repeat the query by hand, and a masked
// query is one nobody can run. `query check` is what says this costs something
// when a project writes its reports inside a repository.
test("the SQL a tester re-runs is deliberately NOT masked, and the page says so", () => {
  const html = reportHtml(LOADED);
  assert.match(html, /SELECT Id FROM Users/, "the query has to stay runnable");
  assert.ok(html.includes("teacher1@contoso.example"), "which means a literal in it travels — pinned here so nobody discovers it by accident");
  assert.match(html, /shown verbatim so it can be re-run/, "and whoever forwards the file is told, on the page, next to the query");
});

test("the case JSON travels with the report, so a reader sees what was ASKED", () => {
  const html = reportHtml(LOADED);
  assert.match(html, /The case, as written/);
  assert.match(html, /&quot;do&quot;: &quot;goto&quot;/, "the DSL, escaped like every other value the product supplied");
});

// A secret in a RECORD is a key and a value in two different strings, so the
// sentence pattern never saw it: {"PASSWORD":"hunter2"} matched nothing, and a
// password handed to a case as a parameter reached the ledger, a lesson's
// evidence and the report in full. Still by SHAPE -- "what a secret is called"
// is not product knowledge, the way TARGET_UPN would be.
test("a secret-NAMED key is redacted, not only a secret-shaped sentence", () => {
  const out = scrubbed({ NAME: "TC-1", PASSWORD: "hunter2", Api_Key: "abc", nested: { client_secret: "s" }, list: [{ token: "t" }] });
  assert.deepEqual(out, { NAME: "TC-1", PASSWORD: "[redacted]", Api_Key: "[redacted]", nested: { client_secret: "[redacted]" }, list: [{ token: "[redacted]" }] });
  assert.ok(SECRET_NAME.test("pwd") && SECRET_NAME.test("Authorization"), "the word list is asked of a key, case-insensitively");
  assert.ok(!SECRET_NAME.test("NAME") && !SECRET_NAME.test("fe_commit"), "and leaves structural fields alone — masking fe_commit blinds coverage");
});

test("raw report records mask runtime answers and failure evidence, preserving only SQL and source", () => {
  const secret = "runtime.person@customer.example";
  const token = "opaque-token-value";
  const records = [
    { kind: "run", case: "x", fe_commit: "abcdef0123456789abcdef0123456789ab" },
    { kind: "resolve", resolved: [{ as: "ID", value: secret, sql: "SELECT 1" }] },
    { kind: "capture", into: "ID", value: secret },
    { kind: "step", i: 1, do: "report", expect: "it.ok", js: `read('${secret}')`, result: JSON.stringify({ PASSWORD: "hidden-password", upn: secret }), ok: true },
    { kind: "step", i: 2, do: "sql", query: "SELECT 1", rows: [{ Upn: secret, password: "hidden-password" }], ok: true },
    { kind: "step", i: 3, do: "assert", js: "false", ok: false, error: `failed for ${secret}`, observed: secret, console: `Authorization: Bearer ${token}`, networkFailures: [`GET /?token=${token}`] },
    { kind: "result", status: "FAIL", report: { upn: secret }, proved: { ui: 1, api: 0, sql: 1 } },
  ];
  const html = reportHtml(records);
  for (const value of [secret, token, "hidden-password"]) assert.ok(!html.includes(value), value);
  const m = model(records);
  assert.equal(m.captured[0].value, "[upn]");
  assert.equal(m.result.report.upn, "[upn]");
  assert.equal(m.run.fe_commit, records[0].fe_commit);
  assert.equal(records[1].resolved[0].value, secret, "rendering must not alter the raw records");
  assert.ok(!html.includes('href="run-log.jsonl"'), "a self-contained report has no dangling log link");
});

test("opaque bearer credentials and quoted secret values are masked as text", () => {
  for (const text of ['Authorization: Bearer opaque-credential', 'Bearer opaque-credential', '{"password":"opaque-credential"}', "password='opaque-credential with spaces'"]) {
    assert.ok(!scrubbed(text).includes("opaque-credential"), text);
  }
});

// Leaving the repository did not make the ledger private: it is projected into
// the host's MEMORY.md and quoted into lessons. The masking stays, and the
// reason it stays is the one written down here.
test("the ledger still masks at the write door, now that being uncommitted is its only defence", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-sec-"));
  const memory = createMemory(() => dir, { host: "laptop-a", now: () => "2026-09-21T00:00:00.000Z" });
  memory.recordRun({ case: "create-thing", status: "PASS", fe_commit: "0122d9eaf", params: { PASSWORD: "hunter2", TARGET_UPN: "teacher1@contoso.example" } });
  const line = readFileSync(join(memoryPaths(dir).runs, "laptop-a.jsonl"), "utf8");
  for (const secret of ["hunter2", "contoso.example"]) assert.ok(!line.includes(secret), `the ledger kept "${secret}"`);
  assert.match(line, /0122d9eaf/, "the build a verdict was taken on survives — coverage cannot date a PASS without it");
});

// `file` names a file INSIDE the evidence directory. It never had a pattern,
// and join(run.out, "../../x.png") escapes -- which was survivable while
// evidence was a directory the project chose, and is not now that it is a room
// in the machine store. Declared on the field's row, enforced from the
// declaration: there is no hand-written rule for this.
test("a screenshot cannot be written outside the evidence room", () => {
  const graph = loadGraph(join(UI_TESTS, "graph"));
  const of = (file) => validate({ id: "x", name: "X", start: "home", seen: "src", fe_commit: "a", identity: { as: "admin", roles: ["App.Admin"] }, steps: [{ do: "goto", screen: "home" }, { do: "screenshot", file }] }, graph);
  assert.ok(of("../../escape.png").some((f) => f.includes("file does not look like")));
  assert.ok(of("/etc/passwd.png").some((f) => f.includes("file does not look like")));
  assert.ok(!of("after.png").some((f) => f.includes("file does not look like")), "an ordinary name is still a name");
});

// THE test the allow-list exists for.
//
// A deny-list is a list of what to hide, so anything it has not heard of is
// shown -- and `loop.mjs asked()` logs every declared field of a step, so the
// set of free text grows the day `dsl/fields.mjs` gains a row. Nothing in this
// repo would fail if a deny-list had not been updated: the leak would ship, and
// the first evidence of it would be in somebody's inbox.
//
// Inverted, the default is safe: a field this table has never heard of is
// masked, and the cost of forgetting is a masked value in a report rather than
// a customer's data in one.
test("a log field nobody has declared yet is masked by default, not shown", () => {
  const future = model([
    { kind: "run", case: "x", inventedNextYear: "real.person@customer.example" },
    { kind: "step", i: 1, do: "assert", ok: true, somethingNew: { nested: "teacher1@contoso.example" }, alsoNew: ["hunter2 password=hunter2"] },
    { kind: "result", status: "PASS", proved: { ui: 1, api: 0, sql: 0 } },
  ]);
  assert.equal(future.run.inventedNextYear, "[upn]");
  assert.equal(future.steps[0].somethingNew.nested, "[upn]", "masked at depth, not only at the top of a record");
  assert.match(future.steps[0].alsoNew[0], /password \[redacted\]/, "and through an array");
  assert.equal(future.steps[0].i, 1, "while the structural fields a reader navigates by are untouched");
  assert.equal(future.result.status, "PASS");
});

// The counterpart: what the allow-list lets through has to be exactly what the
// report is FOR. A masking change that quietly emptied the page would pass
// every test above and be useless.
test("what the allow-list keeps is what a tester needs to re-check by hand", () => {
  const m = model([
    { kind: "run", case: "x", fe_commit: "abc1234", sqlCommand: ["sqlcmd", "-S", "db01"], source: { id: "x" }, params: { NAME: "TC-1", PASSWORD: "hunter2" } },
    { kind: "identity", as: "admin", atStep: 0, upn: "real.person@customer.example", roles: ["Category Administrator"] },
    { kind: "resolve", resolved: [{ as: "USER_ID", value: "teacher1@contoso.example", sql: "SELECT Id FROM Users" }] },
    { kind: "step", i: 1, do: "sql", query: "SELECT Upn FROM Users", rows: [{ Upn: "teacher1@contoso.example" }], ok: true },
    { kind: "result", status: "PASS", proved: { ui: 0, api: 0, sql: 1 } },
  ]);
  assert.equal(m.steps[0].query, "SELECT Upn FROM Users", "the query stays runnable");
  assert.equal(m.resolved[0].sql, "SELECT Id FROM Users", "including a resolve row's own — the report renders the line that repeats it");
  assert.deepEqual(m.run.sqlCommand, ["sqlcmd", "-S", "db01"], "and the command that runs it");
  assert.deepEqual(m.run.source, { id: "x" }, "the case JSON is authored content, not a runtime value");
  assert.equal(m.run.fe_commit, "abc1234", "masking a commit would blind coverage to a stale PASS");
  assert.deepEqual(m.identities[0].roles, ["Category Administrator"], "which roles were held is the point of recording an identity");
  assert.equal(m.run.params.NAME, "TC-1", "a param that is not secret-shaped is how a run is re-read");

  assert.equal(m.steps[0].rows[0].Upn, "[upn]", "but the rows a query RETURNED are a customer's data");
  assert.equal(m.resolved[0].value, "[upn]");
  assert.equal(m.identities[0].upn, "[upn]");
  assert.equal(m.run.params.PASSWORD, "[redacted]");
});

test("a long run of word characters is scrubbed in linear time, and an address in it is still masked", () => {
  const run = "w".repeat(200_000);
  const started = Date.now();
  const out = scrub(`${run} and ops.lead+user@corp.example ${run}`);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.ok(out.includes("[upn]") && !out.includes("ops.lead"));
});
