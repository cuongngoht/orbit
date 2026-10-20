import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBrowser } from "../src/browser/index.mjs";
import { createEval } from "../src/browser/eval.mjs";
import { createState } from "../src/browser/state.mjs";
import { fakeBrowser } from "./fakes/browser.mjs";
import { highestRequest, newerMatching, parseRequests, summarize } from "../src/browser/requests.mjs";
import { parseRows } from "../src/database/rows.mjs";
import { createDatabase } from "../src/database/index.mjs";
import { identityProblems } from "../src/identity/check.mjs";
import { resolveIdentity } from "../src/identity/mapping.mjs";
import { configFindings, expand, loadConfig } from "../src/project/config.mjs";
import { requireUiTests, projectPaths } from "../src/project/locate.mjs";
import { UI_TESTS, FIXTURES } from "./fakes/context.mjs";

test("the browser settle port and its fake agree on success and exhausted polls", () => {
  for (const succeed of [2, Infinity]) {
    let actual = 0;
    let simulated = 0;
    const real = createState({ dir: () => "/unused" }, { truthy: () => ++actual >= succeed });
    const fake = fakeBrowser({ answers: [["!!(ready)", () => ++simulated >= succeed]] });
    assert.equal(real.settle("ready", 3), fake.settle("ready", 3));
    assert.equal(actual, simulated);
    assert.equal(actual, Math.min(succeed, 3));
  }
});

test("parseRows anchors on the dashed line, so a one-column result is not empty", () => {
  assert.deepEqual(parseRows("n\n--\n17\n\n(1 rows affected)\n"), [{ n: "17" }]);
  assert.deepEqual(parseRows("Id|Name\n--|----\n1|a\n2|b\n(2 rows affected)"), [{ Id: "1", Name: "a" }, { Id: "2", Name: "b" }]);
  assert.deepEqual(parseRows("Login failed for user"), []);
  assert.deepEqual(parseRows(" username | signed_in \n----------+-----------\n alice    | t\n bob      | f\n(2 rows)\n\n"), [{ username: "alice", signed_in: "t" }, { username: "bob", signed_in: "f" }], "a dashed line joined by +, and a count that closes the rows without `affected`");
  assert.deepEqual(parseRows(" n \n---\n 17\n(1 row)\n"), [{ n: "17" }], "one column, one row: the count is never a row");
  assert.deepEqual(parseRows(" username \n----------\n(0 rows)\n"), [], "no rows is no rows");
});

test("the database port reports BLOCKED-style failures instead of throwing", () => {
  const failing = createDatabase(["sqlx", "q"], { spawn: () => ({ status: 1, stdout: "Login failed\nmore", stderr: "" }) });
  assert.deepEqual(failing.query("SELECT 1"), { ok: false, rows: [], error: "Login failed" });
  const none = createDatabase(null);
  assert.match(none.query("SELECT 1").error, /no sql.command/);
  const ok = createDatabase(["sqlx"], { spawn: (bin, args) => ({ status: 0, stdout: `${args.at(-1)}\nn\n--\n2\n`, stderr: "" }) });
  assert.deepEqual(ok.query("SELECT 2 AS n").rows, [{ n: "2" }]);
});

test("ev parses the CLI's single JSON encoding once and keeps error text as text", () => {
  const session = { cli: (args) => (args[2] === "1+1" ? "2\n" : args[2] === "location.hostname" ? '"app.test"\n' : "ERROR: is not open") };
  const { ev, truthy } = createEval(session);
  assert.equal(ev("1+1"), 2);
  assert.equal(ev("location.hostname"), "app.test");
  assert.equal(ev("nope"), "ERROR: is not open");
  assert.equal(truthy("nope"), false);
});

// playwright-cli prints an object or an array over several lines; the last line of one is "}" or "]".
test("ev reads a pretty-printed object or array whole, never its last line", () => {
  const said = { obj: '{\n  "n": 1,\n  "listed": true\n}\n', arr: "[\n  1,\n  2\n]\n", noisy: "a warning\n42\n" };
  const { ev } = createEval({ cli: (args) => said[args[2]] });
  assert.deepEqual(ev("obj"), { n: 1, listed: true });
  assert.deepEqual(ev("arr"), [1, 2]);
  assert.equal(ev("noisy"), 42, "a line before the result is still not the result");
});

// A request with no `=> [status]` yet is IN FLIGHT. It used to be dropped by
// the pattern, so one that had not answered when the watermark was taken looked
// NEW when it finally landed -- the same false pass, one step further along.
test("request log: parse (including in flight), what is new since a mark, non-2xx summarised", () => {
  const text = "1. [GET] https://a/api/x => [200] OK\n2. [POST] https://a/api/x => [500] Boom\n3. [POST] https://a/api/x => [201] Created\n4. [POST] https://a/api/x\nnoise";
  const reqs = parseRequests(text);
  assert.equal(reqs.length, 4);
  assert.deepEqual(reqs[3], { n: 4, method: "POST", url: "https://a/api/x", status: null }, "in flight, and visible");
  assert.equal(highestRequest(reqs), 4);
  assert.deepEqual(newerMatching(reqs, 2, "api/x", "post").map((r) => r.n), [3, 4], "only what came after the mark");
  assert.deepEqual(newerMatching(reqs, 4, "api/x").map((r) => r.n), [], "nothing is newer than the newest");
  assert.deepEqual(newerMatching(reqs, 0, "api/y"), []);
  assert.deepEqual(summarize(text), { calls: 3, bad: ["2. [POST] https://a/api/x => [500] Boom"] });
});

test("identityProblems: missing, forbidden and wrong upn are each named", () => {
  const claims = { roles: ["A"], upn: "Me@X.com" };
  assert.deepEqual(identityProblems({ roles: ["A"], upn: "me@x.com" }, claims), []);
  assert.deepEqual(identityProblems({ roles: ["A", "B"], notRoles: ["A"], upn: "other" }, claims), ["missing role(s): B", "holds role(s) it must NOT: A", "signed in as Me@X.com, case requires other"]);
});

test("config expands ~ and ${ENV}, drops entries whose variable is unset, and lets the environment win", () => {
  assert.equal(expand("${HOME}/x", { HOME: "/h" }), "/h/x");
  assert.equal(expand("${NOPE}/x", {}), null);
  assert.equal(expand("~/x", {}), `${homedir()}/x`);
  const c = loadConfig(projectPaths(UI_TESTS), { ORBIT_ORIGIN: "https://other.test" });
  assert.equal(c.origin, "https://other.test");
  assert.equal(c.name, "fixture");
  assert.equal(c.runDir, projectPaths(UI_TESTS).sessionDir);
});

// A report embeds every screenshot it shows, so one committed inside a checkout
// publishes the pictures of whatever tenant the run drove -- as text, in a
// history the team pushes. The default is therefore a machine path, the same
// shape runDir has always had. `evidence` is gone: a run's screenshots, network
// dumps and log live in the machine store with the ledger, and a project does
// not get to put them anywhere.
test("reports default outside the repository, and the retired evidence key is named", () => {
  const root = join(tmpdir(), "acme-group", "my-app");
  const c = loadConfig(projectPaths(join(root, "ui-tests")), {});
  assert.equal(c.reports, projectPaths(join(root, "ui-tests")).reportsDir);
  assert.ok(!c.reports.startsWith(root), "the default never resolves into the checkout");
  assert.equal(c.retention, 10, "evidence is pruned by default — a memory that only grows is one people delete whole");
  assert.deepEqual(configFindings({ evidence: "runs" }), ['project.json: unknown key "evidence"']);
});

// The project name defaults to the LAST SEGMENT of the root, and the default run
// directory is built from it. A hand-rolled split on "/" returned the whole path
// on Windows, so the default run directory was <tmp>/pw-C:Users… -- a path no
// platform can create. Built with join(), this fails on whichever OS regresses.
test("the project name is the root's last segment on every platform", () => {
  const root = join(tmpdir(), "acme-group", "my-app");
  const uiTests = join(root, "ui-tests");
  mkdirSync(uiTests, { recursive: true });
  writeFileSync(join(uiTests, "project.json"), JSON.stringify({ origin: "https://x" }));
  const c = loadConfig(projectPaths(uiTests), {});
  assert.equal(c.name, "my-app");
  assert.equal(c.runDir, projectPaths(uiTests).sessionDir);
});

// Which hosts mean "sign in first" and which browser to open are the project's
// facts; the engine used to hard-code one vendor's answers to both.
test("project.json carries the stack facts the engine must not know", () => {
  const c = loadConfig(projectPaths(UI_TESTS), {});
  assert.deepEqual(c.signIn.hosts, ["login.idp.test"]);
  assert.deepEqual(c.launch, { channel: "chromium", env: "test" });
  assert.deepEqual(loadConfig(projectPaths(UI_TESTS), { ORBIT_CHANNEL: "msedge", ORBIT_ENV: "acceptance" }).launch, { channel: "msedge", env: "acceptance" });
});

test("a host is a sign-in page only because project.json says so", () => {
  const at = (host, hosts) => createBrowser("/d", { exec: () => JSON.stringify(host), signInHosts: hosts }).state();
  assert.equal(at("login.idp.test", ["login.idp.test"]), "SIGNIN");
  assert.equal(at("app.test", ["login.idp.test"]), "app.test");
  assert.equal(at("login.idp.test", []), "login.idp.test");
});

test("ORBIT_* names resolve for origin, ui-tests and identity", () => {
  assert.equal(loadConfig(projectPaths(UI_TESTS), { ORBIT_ORIGIN: "https://legacy.test" }).origin, "https://legacy.test");
  assert.equal(requireUiTests({ ORBIT_UI_TESTS: UI_TESTS }, "/").dataRoot, UI_TESTS);
  assert.equal(resolveIdentity("admin", { ORBIT_IDENTITY_ADMIN: "p" }, "/nope.json").from, "ORBIT_IDENTITY_ADMIN");
});

test("locate: ORBIT_UI_TESTS wins, otherwise walk up from cwd", () => {
  assert.equal(requireUiTests({ ORBIT_UI_TESTS: UI_TESTS }, "/").dataRoot, UI_TESTS);
  assert.ok(FIXTURES.endsWith("fixtures"));
});

// project.json is hand-written and was never validated: "sql": {"command": "sqlcmd"}
// (a string where a list belongs) crashed on .map six frames inside createContext,
// which reads as the engine being broken rather than the file.
test("a mistyped project.json is a finding, not a crash inside createContext", () => {
  assert.deepEqual(configFindings({ sql: { command: "sqlcmd" } }), ["project.json sql: command must be an array"]);
  assert.deepEqual(configFindings({ frontend: { roots: 5 } }), ["project.json frontend: roots must be an array"]);
  assert.deepEqual(configFindings({ signIn: { hosts: ["a", 2] } }), ["project.json signIn: every entry of hosts must be a string"]);
  assert.deepEqual(configFindings({ launch: { channle: "chrome" } }), ['project.json launch: unknown key "channle"']);
  assert.deepEqual(configFindings({ origin: 5 }), ["project.json: origin must be a string"]);
  assert.deepEqual(configFindings("text"), ["project.json: must be a JSON object"]);
  assert.deepEqual(configFindings({ name: "f", origin: "https://a.test", reports: "out", retention: 5, signIn: { hosts: ["x"] } }), []);
  assert.deepEqual(loadConfig(projectPaths(UI_TESTS), {}).findings, [], "the fixture project.json is valid");
});
