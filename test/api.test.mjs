import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCase } from "../src/run/run-case.mjs";
import { resultJson } from "../src/run/result.mjs";
import { readFileSync } from "node:fs";
import { fakeBrowser, SAVE } from "./fakes/browser.mjs";
import { fakeContext } from "./fakes/context.mjs";

const OUT = mkdtempSync(join(tmpdir(), "orbit-api-test-"));
const dir = mkdtempSync(join(tmpdir(), "orbit-api-"));

// A case whose only point is the api step: go, click Save, assert the call.
function caseFile(api = {}) {
  const file = join(dir, "api-case.json");
  writeFileSync(file, JSON.stringify({
    id: "api-case", name: "The call the click caused", start: "home", seen: "src",
    steps: [
      { do: "goto", screen: "home", wait: "document.body.innerText.length>0" },
      { do: "click", on: "dlg-thing/Save", wait: "document.body.innerText.length>0" },
      { do: "api", match: "api/things", method: "POST", status: 201, tries: 6, ...api },
      { do: "report", js: "JSON.stringify({ok:true})", expect: "it.ok === true" },
    ],
  }));
  return file;
}

const ANSWERS = [
  [/^!!\(document\.body\.innerText\.length>0\)$/, true],
  [/^!!\(location\.pathname===/, true],
  ["location.pathname", "/home"],
  ["document.body.innerText.slice(0,600)", "Home"],
  [/^JSON\.stringify\(\{ok:/, JSON.stringify({ ok: true })],
];

const POST = { n: 1, method: "POST", url: "https://app.test/api/things" };
// A failing step does not throw out of runCase -- it is caught, given evidence
// and recorded. The message a reader would see is the one in the log.
const failure = (o) => logOf(o).find((r) => r.kind === "step" && r.ok === false).error ?? "";

const logOf = (o) => readFileSync(o.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const run = (requests, args = [], name = "x") => {
  const browser = fakeBrowser({ answers: ANSWERS, requests });
  const out = { browser, ctx: fakeContext({ browser }) };
  out.go = () => runCase(out.ctx, [caseFile(), ...args]);
  return out;
};

// THE defect: the request log holds every call the session ever made, and the
// step took the LAST match -- so a POST from the page load, from the previous
// case, or from a run ten minutes ago passed a step asking about THIS click.
test("a request that predates the action does not satisfy the step", () => {
  const { go } = run([{ ...POST, status: 201, at: 0 }], [], "stale");
  const o = go();
  assert.equal(o.status, "FAIL");
  assert.match(failure(o), /no NEW POST matching api\/things — the UI never called it here/);
  assert.match(failure(o), /1 matching call\(s\), all from before this step/);
  assert.match(failure(o), /counted from step 2 \(click dlg-thing\/Save\)/);
});

test("the request the click actually caused does satisfy it", () => {
  const { go } = run([{ ...POST, status: 201, afterCall: ["click", SAVE] }], [], "fresh");
  const o = go();
  assert.equal(o.status, "PASS");
  assert.equal(resultJson(o).verdicts, 2);
});

// A request with no answer yet is neither a pass nor a wrong status. Before the
// parser could see one at all, an in-flight call read as "never made".
test("a call still in flight is waited for, and named if it never answers", () => {
  const slow = run([{ ...POST, status: 201, afterCall: ["click", SAVE], respondsAfterMs: 1200 }], [], "slow");
  assert.equal(slow.go().status, "PASS", "it answered inside the budget");

  const never = run([{ ...POST, status: 201, afterCall: ["click", SAVE], respondsAfterMs: 9e9 }], [], "never");
  const o = never.go();
  assert.equal(o.status, "FAIL");
  assert.match(failure(o), /is still in flight — 1 matching call\(s\), none answered yet/);
});

// The watermark is taken BEFORE the action. A call already in flight at that
// moment is not new when it lands -- which is only true because the parser can
// see a request that has no status yet.
test("a call already in flight when the mark is taken is not new when it answers", () => {
  const { go } = run([{ ...POST, status: 201, at: 0, respondsAfterMs: 1500 }], [], "inflight");
  const o = go();
  assert.equal(o.status, "FAIL");
  assert.match(failure(o), /no NEW POST matching/);
});

test("a new call with the wrong status is a failure that says which status", () => {
  const { go } = run([{ ...POST, status: 500, afterCall: ["click", SAVE] }], [], "error");
  const o = go();
  assert.equal(o.status, "FAIL");
  assert.match(failure(o), /=> 500, expected 201/);
});

// An app that answers 401, refreshes and retries 201 is not accused of the 401.
test("among several new calls, the first that satisfies wins", () => {
  const { go } = run([
    { n: 1, method: "POST", url: "https://app.test/api/things", status: 401, afterCall: ["click", SAVE] },
    { n: 2, method: "POST", url: "https://app.test/api/things", status: 201, afterCall: ["click", SAVE] },
  ], [], "retry");
  const o = go();
  assert.equal(o.status, "PASS");
});

// With no action in the slice there is nothing to count from, and the only
// fallback would be "any request ever" -- the false pass itself.
test("a slice that starts on the api step is refused before the browser is touched", () => {
  const { go, browser } = run([{ ...POST, status: 201, at: 0 }], ["--from=3", "--to=3"], "unanchored");
  assert.throws(go, /has no action before it in this slice/);
  assert.deepEqual(browser.calls.filter((c) => c[0] === "click"), [], "nothing was driven");
});
