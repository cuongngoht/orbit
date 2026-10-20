import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Blocked, EXIT, Refused, StepError } from "../src/run/errors.mjs";
import { finalStatus } from "../src/run/status.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { runStep } from "../src/run/step.mjs";
import { startScreenGate } from "../src/run/gates/start-screen.mjs";
import { verdict } from "../src/run/verdict.mjs";
import { exitCode, resultJson, resultLine } from "../src/run/result.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { loadCase } from "../src/dsl/load.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { fakeBrowser, happy, opened } from "./fakes/browser.mjs";
import { fakeContext as baseContext, UI_TESTS } from "./fakes/context.mjs";

const STORE = mkdtempSync(join(tmpdir(), "orbit-runner-store-"));
const OUT = join(STORE, "evidence");
const fakeContext = (opts = {}) => baseContext({ ...opts, store: () => STORE });
const REQ = "1. [POST] https://app.test/api/things => [201] Created";
const outFlag = (name) => `--out=${join(OUT, name)}`;
const logOf = (o) => readFileSync(o.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
test.before(() => rmSync(OUT, { recursive: true, force: true }));

test("start-screen checks skip session selection only before a navigation", () => {
  const ctx = fakeContext({ browser: fakeBrowser({ answers: [["location.pathname", "/elsewhere"]] }) });
  const c = { id: "x", start: "home" };
  assert.doesNotThrow(() => startScreenGate(ctx, { c, slice: [{ do: "as" }, { do: "goto" }] }));
  assert.throws(() => startScreenGate(ctx, { c, slice: [{ do: "as" }, { do: "assert" }] }), Refused);
  assert.throws(() => startScreenGate(ctx, { c, slice: [{ do: "skip-if" }, { do: "goto" }] }), Refused);
});

test("a whole case passes through the fake browser: UI, API and SQL layers all ruled on", () => {
  const ctx = fakeContext();
  const o = runCase(ctx, ["create-thing", "NAME=TC-1", outFlag("pass")]);
  assert.equal(o.status, "PASS");
  const log = logOf(o);
  assert.deepEqual(log.map((r) => r.kind), ["run", "identity", "step", "step", "step", "step", "step", "step", "step", "step", "result"]);
  assert.deepEqual(log.find((r) => r.do === "sql").rows, [{ n: "1" }]);

  // What a tester needs to check the same thing by hand: the query AS SENT,
  // every ${PARAM} filled in. The log used to keep the answer and drop the
  // question, so the one number anybody would want to re-derive was the one
  // thing nowhere on disk.
  assert.equal(log.find((r) => r.do === "sql").query, "SELECT COUNT(*) AS n FROM Things WHERE Name='TC-1'");
  assert.equal(log.find((r) => r.do === "fill").value, "TC-1");
  assert.match(log.find((r) => r.do === "report").js, /includes\('TC-1'\)/);
  assert.equal(log.find((r) => r.do === "sql").selector, undefined, "a field the step never carried is not in its record");

  // A PASS has to say WHAT it proved. `verdicts: 3` read the same for three UI
  // asserts as for the screen, the call and the row.
  assert.deepEqual(resultJson(o).proved, { ui: 1, api: 1, sql: 1 });
  assert.match(resultLine(o), /proved ui 1 · api 1 · sql 1/);
  assert.equal(log.find((r) => r.do === "api").result.status, 201);
  assert.match(resultLine(o), /^RESULT: PASS 8\/8/);
  assert.deepEqual(resultJson(o).report, { created: true });
  assert.deepEqual(resultJson(o).identity, [{ as: "admin", atStep: null, upn: "a@b.c", roles: ["App.Admin"] }]);
  assert.deepEqual(ctx.browser.calls.filter((c) => c[0] === "fill"), [["fill", "getByRole('textbox',{name:'Name'})", "TC-1"]]);
});

test("a failing assert stops the run, captures screenshot + network + console, and says why", () => {
  const browser = fakeBrowser({ answers: [[/innerText\.length>0\)$/, true], [/^!!\(location/, true], [/^!!\(document\.title/, false], ["location.pathname", "/home"], ["document.body.innerText.slice(0,600)", "blank"]], requests: "1. [GET] https://app.test/api/menu => [403] Forbidden" });
  const o = runCase(fakeContext({ browser }), ["smoke", outFlag("fail")]);
  assert.equal(o.status, "FAIL");
  assert.match(resultLine(o), /^RESULT: FAIL at step 2\/3/);
  const failed = logOf(o).find((r) => r.kind === "step" && r.ok === false);
  assert.match(failed.error, /assert failed: has a title/);
  assert.ok(existsSync(failed.screenshot));
  assert.deepEqual(failed.networkFailures, ["1. [GET] https://app.test/api/menu => [403] Forbidden"]);
  assert.equal(resultJson(o).failedStep.do, "assert");
  assert.equal(failed.js, "document.title.length>0", "the failed step says what it asked, not only that it failed");
  assert.deepEqual(resultJson(o).proved, { ui: 0, api: 0, sql: 0 }, "a failed verdict proves nothing");
});

test("skip-if true ends the case as SKIP without touching later steps", () => {
  const browser = fakeBrowser({ answers: [[/innerText\.length>0\)$/, true], [/^!!\(location/, true], [/includes\('TC-1'\)\)$/, true]] });
  const o = runCase(fakeContext({ browser }), ["create-thing", "NAME=TC-1", outFlag("skip")]);
  assert.equal(o.status, "SKIP");
  assert.equal(o.run.done, 2);
  assert.ok(!browser.calls.some((c) => c[0] === "click"));
});

test("an unreachable database is BLOCKED, never FAIL", () => {
  const o = runCase(fakeContext({ db: { query: () => ({ ok: false, rows: [], error: "VPN is down" }) } }), ["create-thing", "NAME=TC-1", outFlag("blocked")]);
  assert.equal(o.status, "BLOCKED");
  assert.match(logOf(o).find((r) => r.blocked).blocked, /VPN is down/);
});

test("an unfilled placeholder fails the step loudly instead of asking a different question", () => {
  const ctx = fakeContext();
  const run = { c: { id: "x" }, out: OUT, log: { record() {} }, identities: [], print: { say() {} } };
  assert.throws(() => runStep(ctx, run, { i: 1, do: "sql", query: "SELECT 1 WHERE Name = '${NAME}'", expect: "true" }), /unresolved placeholder\(s\) \$\{NAME\}/);
  assert.equal(runStep(ctx, run, { i: 1, do: "sql", query: "SELECT 1", expect: "it.length === 1" }).result.length, 1);
});

test("gates refuse before the browser is touched", () => {
  assert.throws(() => runCase(fakeContext(), ["create-thing", "--dry"]), Refused, "missing required param");
  assert.throws(() => runCase(fakeContext(), ["nope"]), /no case nope/);
  const signedOut = fakeBrowser({ answers: happy(), host: "SIGNIN" });
  assert.throws(() => runCase(fakeContext({ browser: signedOut }), ["smoke", outFlag("x")]), /parked on a sign-in page/);
  const wrong = fakeContext({ claims: { upn: "u", roles: [] } });
  assert.throws(() => runCase(wrong, ["create-thing", "NAME=TC-1", outFlag("x")]), /missing role\(s\): App.Admin/);
  assert.throws(() => runCase(fakeContext({ db: { query: () => ({ ok: true, rows: [] }) } }), ["smoke", "--from=9", outFlag("x")]), /selects no step/);
});

test("verdict rules over the recorded value, and a broken expect is an error, not a pass", () => {
  assert.deepEqual(verdict({ expect: "it.a === 1" }, '{"a":1}'), { a: 1 });
  assert.throws(() => verdict({ expect: "it.a === 2" }, '{"a":1}'), StepError);
  assert.throws(() => verdict({ expect: "it.(" }, "1"), /could not be evaluated/);
  assert.ok(new Blocked("x") instanceof Error);
});

// run.status starts at "PASS" and is only ever downgraded, so reaching the last
// step of the SLICE with nothing thrown used to BE the pass -- even when the
// slice contained no verdict at all, and even when it was three steps of eight.
test("a run that ruled on nothing is INCONCLUSIVE, and a sliced one is PARTIAL — never PASS", () => {
  const recorded = [];
  const memory = { recordRun: (r) => recorded.push(r), runs: () => [], saveNote() {}, notes: () => [] };
  const run = (...flags) => runCase(fakeContext({ memory }), ["create-thing", "NAME=TC-1", ...flags, "--json"]);

  const whole = run(outFlag("whole"));
  assert.equal(whole.status, "PASS");
  assert.equal(resultJson(whole).verdicts, 3, "api, sql and report+expect all ruled");

  const nothing = run("--from=1", "--to=3", outFlag("nothing"));
  assert.equal(nothing.status, "INCONCLUSIVE", "goto, skip-if, click prove nothing about the product");
  assert.equal(exitCode(nothing.status), 4, "CI must not be green on a run that asked nothing");
  assert.equal(resultJson(nothing).verdicts, 0);

  const part = run("--from=7", "--to=8", outFlag("part"));
  assert.equal(part.status, "PARTIAL", "it ruled on two things, but not on the case");
  assert.equal(exitCode(part.status), 0, "a deliberate slice is not an error");
  assert.equal(resultJson(part).verdicts, 2);
  assert.deepEqual(resultJson(part).slice, { from: 7, to: 8, whole: false });
  assert.match(resultLine(part), /steps 7..8 of 8 only/);

  assert.deepEqual(recorded.map((r) => r.status), ["PASS", "INCONCLUSIVE", "PARTIAL"], "the ledger keeps them apart");
});

// The judgement in one place, so the precedence between the words is a table
// rather than three conditions buried in conclude().
test("finalStatus never re-judges a run that already said what happened", () => {
  const run = (status, verdicts, from, to) => ({ status, verdicts, from, to, c: { steps: Array(8) } });
  assert.equal(finalStatus(run("PASS", 3, 1, 8)), "PASS");
  assert.equal(finalStatus(run("PASS", 3, 6, 8)), "PARTIAL");
  assert.equal(finalStatus(run("PASS", 0, 1, 8)), "INCONCLUSIVE");
  assert.equal(finalStatus(run("PASS", 0, 1, 3)), "INCONCLUSIVE", "proving nothing outranks running part");
  assert.equal(finalStatus(run("SKIP", 0, 1, 8)), "SKIP", "a fired skip-if rules on nothing by design");
  assert.equal(finalStatus(run("FAIL", 1, 1, 8)), "FAIL");
  assert.equal(finalStatus(run("BLOCKED", 0, 1, 8)), "BLOCKED");
  assert.equal(finalStatus(run("FAIL", 0, 6, 8)), "FAIL", "a failure is a failure even in a slice");
});

// exitCode falls open to 0 for an unknown status, so a word without a code would
// silently become a pass.
test("every status the runner can produce has an exit code", () => {
  for (const s of ["PASS", "SKIP", "PARTIAL", "FAIL", "REFUSED", "BLOCKED", "INCONCLUSIVE"]) assert.equal(typeof EXIT[s], "number", s);
  assert.deepEqual([EXIT.PASS, EXIT.SKIP, EXIT.PARTIAL, EXIT.FAIL, EXIT.REFUSED, EXIT.BLOCKED, EXIT.INCONCLUSIVE], [0, 0, 0, 1, 2, 3, 4]);
});

// times: 0 left `last` undefined and {...undefined} spreads to nothing, so the
// step was logged ok:true having never run. The validator refuses it; the loop
// can no longer express it either.
test("a step always executes at least once, whatever times says", () => {
  const ctx = fakeContext();
  const never = { i: 1, do: "assert", js: "false", why: "must run" };
  assert.throws(() => runStep(ctx, {}, { ...never, times: 0 }), StepError, "times: 0 must not skip the assertion");
  assert.throws(() => runStep(ctx, {}, { ...never, times: -3 }), StepError);
  assert.throws(() => runStep(ctx, {}, never), StepError);
});

// Until now every ${PARAM} was bound when the PLAN was made, so no step could
// use a value an earlier step produced -- and the fixture map's own detail
// screen, /things/{id}, was unreachable by any case.
test("a value one step binds with into is usable by the next, and the url is really interpolated", () => {
  const browser = fakeBrowser({ answers: opened() });
  const db = { query: () => ({ ok: true, rows: [{ Id: "42" }] }) };
  const o = runCase(fakeContext({ browser, db }), ["open-thing", "NAME=TC-1", outFlag("open")]);

  assert.equal(o.status, "PASS");
  assert.ok(browser.calls.some((c) => c[0] === "goto" && c[1] === "https://app.test/things/42"), "the id reached the url: " + JSON.stringify(browser.calls.filter((c) => c[0] === "goto")));
  assert.deepEqual(resultJson(o).captured, [{ at: 2, into: "ID", value: "42" }]);
  assert.deepEqual(logOf(o).filter((r) => r.kind === "capture").map((r) => r.into), ["ID"]);
});

// The slice is honest only while it is self-contained: starting after the step
// that binds ${ID} asks a question with a hole in it, and the old runner found
// that out three steps in, with the browser already open.
test("a slice that starts after the step binding its values is refused before the browser", () => {
  const browser = fakeBrowser({ answers: opened() });
  const db = { query: () => ({ ok: true, rows: [{ Id: "42" }] }) };
  assert.throws(() => runCase(fakeContext({ browser, db }), ["open-thing", "NAME=TC-1", "--from=3", outFlag("hole")]), /bound by a step outside the slice/);
  assert.deepEqual(browser.calls.filter((c) => c[0] === "goto"), [], "nothing was driven");
});

// The edge record knows which controls delete things; the case's flag is a
// promise the author has to remember. Relying on the promise alone meant one
// forgotten line ran a real delete against a real environment.
test("a case that drives a control the map marks destructive cannot run unguarded", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-destructive-"));
  const wrote = (body) => { const p = join(dir, "wipe.json"); writeFileSync(p, JSON.stringify({ id: "wipe", name: "Archive it", start: "detail", seen: "src", ...body })); return p; };
  const steps = [{ do: "click", on: "detail/Archive", wait: "1" }, { do: "report", js: "1", expect: "true" }];

  const forgot = fakeContext();
  assert.throws(() => runCase(forgot, [wrote({ steps }), outFlag("d1")]), /drives detail\/Archive, which the map marks destructive/);
  assert.deepEqual(forgot.browser.calls.filter((c) => c[0] === "click"), [], "nothing was clicked");

  const declared = fakeContext();
  assert.throws(() => runCase(declared, [wrote({ destructive: true, steps }), outFlag("d2")]), /is DESTRUCTIVE.*--force-destructive/s);
  assert.deepEqual(declared.browser.calls.filter((c) => c[0] === "click"), [], "still nothing was clicked");
});

// A literal selector names no record in the map, so the engine infers nothing
// from it: the case's own flag governs, and a LABEL is never enough to refuse.
test("a literal selector is not guessed at — the case's own flag governs", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-literal-"));
  const p = join(dir, "wipe2.json");
  writeFileSync(p, JSON.stringify({ id: "wipe2", name: "Archive by selector", start: "detail", seen: "src",
    steps: [{ do: "click", selector: "getByRole('button',{name:'Archive'})", wait: "1" }, { do: "report", js: "1", expect: "true" }] }));
  assert.deepEqual(validate(loadCase(p), loadGraph(join(UI_TESTS, "graph"))), [], "no finding is invented from the label");
});

// resolveTargets ran BEFORE every gate, so a run that was never going to happen
// -- destructive, stale, signed out, wrong identity -- read the database first.
test("the database is not read until the gates have passed", () => {
  const asked = [];
  const db = { query: (sql) => { asked.push(sql); return { ok: true, rows: [{ Id: "1" }] }; } };
  const dir = mkdtempSync(join(tmpdir(), "orbit-order-"));
  const p = join(dir, "wipe3.json");
  writeFileSync(p, JSON.stringify({ id: "wipe3", name: "Archive it", start: "detail", seen: "src", destructive: true,
    resolve: [{ as: "ID", sql: "SELECT Id FROM Things" }],
    steps: [{ do: "click", on: "detail/Archive", wait: "'${ID}'" }, { do: "report", js: "1", expect: "true" }] }));
  assert.throws(() => runCase(fakeContext({ db }), [p, outFlag("order")]), /is DESTRUCTIVE/);
  assert.deepEqual(asked, [], "the refusal came first");
});

// interpolate leaves an unknown placeholder in place by design, and resolve had
// no guard -- so it ran the LITERAL text ${MISSING} against the database, matched
// nothing, and the empty answer read exactly like a result.
test("an unbound placeholder in a resolve row never reaches the database", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-resolve-"));
  const asked = [];
  const db = { query: (sql) => { asked.push(sql); return { ok: true, rows: [{ Id: "1" }] }; } };
  const wrote = (resolve, params) => {
    const p = join(dir, "needs.json");
    writeFileSync(p, JSON.stringify({ id: "needs", name: "Needs a row", start: "home", seen: "src", params, resolve,
      steps: [{ do: "goto", screen: "home", wait: "document.body.innerText.length>0" }, { do: "report", js: "JSON.stringify({ok:true})", expect: "it.ok === true" }] }));
    return p;
  };

  // MISSING is declared as a param, so validation lets it through -- and then
  // nobody supplies a value for it, because it is not required.
  const unbound = wrote([{ as: "ID", sql: "SELECT Id FROM Things WHERE Name='${MISSING}'" }], [{ n: "MISSING" }]);
  assert.throws(() => runCase(fakeContext({ db }), [unbound, outFlag("unbound")]), /is not a param, and no EARLIER resolve fills it/);
  assert.deepEqual(asked, [], "the database was never asked the wrong question");

  const bound = wrote([{ as: "ID", sql: "SELECT Id FROM Things WHERE Name='${NAME}'" }], [{ n: "NAME", default: "TC-1" }]);
  runCase(fakeContext({ db }), [bound, outFlag("bound")]);
  assert.deepEqual(asked, ["SELECT Id FROM Things WHERE Name='TC-1'"], "and it does ask the right one");
});

// A green run used to produce no picture at all, so the only illustrated report
// was a failing one -- and a team that learns a passing report is not worth
// opening stops opening reports. The screen is captured for the verdict that
// RULES on the screen, and only that one: a row count and an HTTP status are
// not things a screenshot can show, and each shot costs a browser round trip.
test("a verdict that held is photographed too, and only the one that rules on the screen", () => {
  const o = runCase(fakeContext(), ["create-thing", "NAME=TC-1", outFlag("shots")]);
  assert.equal(o.status, "PASS");
  const held = logOf(o).filter((r) => r.kind === "step" && r.ok === true);
  const shown = held.filter((r) => r.screenshot);
  assert.deepEqual(shown.map((r) => r.do), ["report"], "the ui verdict — not the api one, not the sql one");
  assert.ok(existsSync(shown[0].screenshot), "the report cites it as a sibling, so it has to be on disk");
});
