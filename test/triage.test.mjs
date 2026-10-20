import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { UI_TESTS } from "./fakes/context.mjs";
import { sealed } from "./home.mjs";

// The sentence this view exists to stop is "the click timed out, so the
// selector must have changed". So the assertions below are mostly about what
// triage must NOT say: it may not promote a hypothesis to a cause, it may not
// re-judge a verdict, and it may not let a green exit code read as a pass.
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");

const triage = (dir) =>
  spawnSync(process.execPath, [join(CLI, "query.mjs"), "triage", dir], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: UI_TESTS }) });

// Always named explicitly: `latestRun` would pick up any run somebody left in
// the fixture's evidence directory, and then this file would test that instead.
function evidence(...records) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-triage-"));
  writeFileSync(join(dir, "run-log.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return dir;
}

const run = { kind: "run", case: "create-thing", file: "cases/create-thing.json", fe_commit: "abc1234" };

const result = (over) => ({ kind: "result", status: "PASS", done: 8, of: 8, steps: 8, slice: { from: 1, to: 8, whole: true }, verdicts: 4, proved: { ui: 2, api: 1, sql: 1 }, ms: 12000, ...over });

const MAP_DRIFT = /no longer where the record says/;

// A 500 the UI swallowed is the commonest real defect this engine catches, and
// the commonest one a session misfiles as a map problem. The call is in the
// record, so it is shown -- and nothing invites anybody to edit the map.
test("a call outside 2xx is shown as evidence, and never offered as a map problem", () => {
  const dir = evidence(run,
    { kind: "step", i: 6, do: "api", match: "api/things", method: "POST", status: 201, ok: false, error: "POST api/things answered 500, not 201", url: "/home", networkCalls: 5, networkFailures: ["5 POST https://app.test/api/things => [500]"] },
    result({ status: "FAIL", done: 5, verdicts: 2, proved: { ui: 2, api: 0, sql: 0 } }));
  const r = triage(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /outside 2xx\s+5 POST .*\[500\]/);
  assert.match(r.stdout, /the product: it answered, and the answer is not what the case requires/);
  assert.doesNotMatch(r.stdout, MAP_DRIFT, "a backend answering 500 is not a reason to touch the map");
});

// The ambiguous one. All three explanations are printed, and the view says in
// so many words that it cannot choose between them.
test("a spent wait names every explanation and refuses to pick one", () => {
  const dir = evidence(run,
    { kind: "step", i: 3, do: "click", on: "home/Add", screen: "home", wait: "document.querySelector('[role=dialog]')", ok: false, error: "wait never held after 25 tries / 13s", url: "/home", networkCalls: 4, networkFailures: [] },
    result({ status: "FAIL", done: 2, verdicts: 0, proved: { ui: 0, api: 0, sql: 0 } }));
  const r = triage(dir);
  assert.match(r.stdout, MAP_DRIFT);
  assert.match(r.stdout, /never reached the state the wait describes/);
  assert.match(r.stdout, /asks about something this step does not cause/);
  assert.match(r.stdout, /which of those three it is/);
  assert.match(r.stdout, /a timeout is NOT evidence of map drift/);
  assert.match(r.stdout, /query\.mjs verify/, "the one command that CAN name a drifted record must be offered");
});

test("BLOCKED rules on nothing and is never dressed up as a defect", () => {
  const dir = evidence(run,
    { kind: "step", i: 7, do: "sql", query: "SELECT COUNT(*) AS n FROM Things WHERE Name='TC-1'", ok: false, blocked: "the database could not be reached" },
    result({ status: "BLOCKED", done: 6, verdicts: 3, proved: { ui: 2, api: 1, sql: 0 } }));
  const r = triage(dir);
  assert.match(r.stdout, /verdict\s+BLOCKED/);
  assert.match(r.stdout, /never a defect/);
  assert.match(r.stdout, /anything whatever about the product/);
  assert.doesNotMatch(r.stdout, MAP_DRIFT);
});

// The step field is printed as the run RESOLVED it, so a tester can re-ask the
// database the same question by hand instead of taking the view's word for it.
test("the failing step's own fields are shown with their placeholders already filled", () => {
  const dir = evidence(run,
    { kind: "step", i: 7, do: "sql", query: "SELECT COUNT(*) AS n FROM Things WHERE Name='TC-1'", expect: "Number(it[0].n) === 1", ok: false, error: "expect was false over [{\"n\":\"0\"}]", url: "/home", networkCalls: 2, networkFailures: [] },
    result({ status: "FAIL", done: 6, verdicts: 3, proved: { ui: 2, api: 1, sql: 0 } }));
  assert.match(triage(dir).stdout, /query=SELECT COUNT\(\*\) AS n FROM Things WHERE Name='TC-1'/);
});

// Three zeroes and a four that are not passes. Each has to keep its own name:
// the ledger counts none of them as a pass, and neither may this.
for (const status of ["PARTIAL", "INCONCLUSIVE", "SKIP"]) {
  test(`${status} is reported as itself, never as a pass`, () => {
    const dir = evidence(run, result({ status, verdicts: status === "PARTIAL" ? 1 : 0, slice: { from: 1, to: 3, whole: status === "PARTIAL" ? false : true } }));
    const r = triage(dir);
    assert.equal(r.status, 0, "triage is a view; it does not carry the run's exit code");
    assert.match(r.stdout, new RegExp(`verdict\\s+${status}`));
    assert.doesNotMatch(r.stdout, /verdict\s+PASS/);
    assert.match(r.stdout, /what this still leaves for a person/);
  });
}

// A PASS that watched a screen and nothing else is the false green this whole
// engine is built around. The words come from the session review's own table,
// so one tester's day has one story.
test("a PASS proving only the screen says which side a person must still check", () => {
  const dir = evidence(run, result({ verdicts: 2, proved: { ui: 2, api: 0, sql: 0 } }));
  const r = triage(dir);
  assert.match(r.stdout, /passed on the screen alone/);
  assert.match(r.stdout, /api\/sql side yourself/);
});

test("a PASS witnessed below the screen says so instead", () => {
  const r = triage(evidence(run, result({})));
  assert.match(r.stdout, /it ruled below the screen as well as on it/);
  assert.doesNotMatch(r.stdout, /passed on the screen alone/);
});

test("a directory with no run in it answers in a sentence, not a stack trace", () => {
  const r = triage(mkdtempSync(join(tmpdir(), "orbit-empty-")));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no run-log\.jsonl in/);
  assert.doesNotMatch(r.stdout + r.stderr, /at \w+ \(/, "a stack trace reached the terminal");
});

test("the committed fixture run reads back, so the view has evidence without a browser", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const r = triage(join(here, "fixtures", "runs", "create-thing-2026-09-18-08-10-00"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /TRIAGE {2}create-thing {2}FAIL/);
  assert.match(r.stdout, /stopped at {3}step 3 click home\/Add/);
});
