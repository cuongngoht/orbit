// What can be verified right now, projected -- and never a verdict. Runtime says
// whether something is up; it does not say whether it is right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { project } from "../src/runtime/verification.mjs";
import { NODE_AND_DOTNET, UNKNOWN_STACK, viewOf } from "./fakes/runtime.mjs";

const session = (component, readiness, over = {}) => ({ component, state: "RUNNING", ownership: "ORBIT_OWNED", readiness, ...over });
const READY = { state: "READY", probe: { kind: "tcp", target: 5000 } };
const input = (over = {}) => ({ plan: { overall: "READY" }, sessions: [], view: viewOf(NODE_AND_DOTNET), browser: { state: "AVAILABLE" }, capabilities: { sql: { can: true, because: "sql.command is configured" } }, ...over });

test("nothing running means nothing can be reached or driven, and it says to start it", () => {
  const out = project(input());
  assert.deepEqual([out.http.state, out.browser.state], ["BLOCKED", "BLOCKED"]);
  assert.match(out.http.because, /nothing is running: start it first/);
});

test("something running and ANSWERING makes the http and browser capabilities available", () => {
  const out = project(input({ sessions: [session("dotnet:api", READY)] }));
  assert.deepEqual([out.http.state, out.browser.state], ["AVAILABLE", "AVAILABLE"]);
  assert.match(out.http.because, /dotnet:api answers \(tcp 5000\)/);
});

test("running with nothing to ask is UNKNOWN, never available -- and not-yet-answering says so", () => {
  const unknown = project(input({ sessions: [session("node:web", { state: "READINESS_UNKNOWN" })] }));
  assert.deepEqual([unknown.http.state, unknown.browser.state], ["UNKNOWN", "UNKNOWN"]);
  assert.match(unknown.http.because, /nothing says how to tell it is ready/);
  assert.match(project(input({ sessions: [session("dotnet:api", { state: "NOT_READY" })] })).http.because, /not answering yet/);
});

test("a process that is not Orbit's, or not running, is not something this reports as up", () => {
  const out = project(input({ sessions: [session("dotnet:api", READY, { ownership: "UNKNOWN" }), session("node:web", READY, { state: "STOPPED" })] }));
  assert.equal(out.http.state, "BLOCKED");
});

test("a browser needs a tool as well as an application, and a tool nobody asked about is UNKNOWN", () => {
  const up = [session("dotnet:api", READY)];
  assert.equal(project(input({ sessions: up, browser: { state: "UNAVAILABLE", reason: "not installed" } })).browser.state, "BLOCKED");
  assert.equal(project(input({ sessions: up, browser: null })).browser.state, "UNKNOWN");
  assert.equal(project(input({ sessions: up, browser: { state: "UNKNOWN" } })).browser.state, "UNKNOWN");
});

test("the database answer is the QA layer's own, handed in -- not recomputed here", () => {
  assert.equal(project(input()).database.state, "AVAILABLE");
  assert.deepEqual([project(input({ capabilities: { sql: { can: false, because: "no sql.command configured" } } })).database.state, project(input({ capabilities: {} })).database.state], ["BLOCKED", "UNKNOWN"]);
});

test("a declared test command makes the runner available, every one is NAMED, and none is chosen", () => {
  const out = project(input());
  assert.equal(out.testRunner.state, "AVAILABLE");
  assert.deepEqual(out.testRunner.commands.map((c) => [c.component, c.declaredAs, c.safe]).sort(), [["dotnet:tests/Api.Tests", "test", true], ["node:web", "test", true]]);
  const none = project(input({ view: viewOf(UNKNOWN_STACK).components.length ? { ...viewOf(UNKNOWN_STACK), components: [] } : viewOf(UNKNOWN_STACK) }));
  assert.deepEqual([none.testRunner.state, none.testRunner.because], ["BLOCKED", "no file declares a way to run tests"]);
});

test("runtime NEVER says healthy, passing or verified: it projects what can be reached, and a verdict is somebody else's", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "runtime", "verification.mjs"), "utf8").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(source, /["'`](PASS|FAIL|healthy|passing|verified|passed)["'`]/i);
  const out = project(input({ sessions: [session("dotnet:api", READY)] }));
  assert.deepEqual(Object.keys(out).sort(), ["browser", "database", "http", "testRunner"]);
  assert.ok(Object.values(out).every((v) => ["AVAILABLE", "BLOCKED", "UNKNOWN"].includes(v.state)));
});
