// SWE-bench as a task source and grader, with no network and no Docker: the image name the official harness uses, a row
// pinned by the digest of its canonical JSON, the agent handed the problem statement and nothing else of the row, and
// the harness's report mapped onto the outcome's facts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gradedFromReport } from "../lib/grade/swebench.mjs";
import { cacheFileOf, imageOf, REVISION, rowDigest, swebenchTask } from "../lib/tasks/swebench.mjs";
import { promptOf } from "../lib/run/prompt.mjs";
import { writeJson } from "../lib/core/util.mjs";

const ROW = { repo: "o/r", instance_id: "o__r-12", base_commit: "abc", patch: "diff --git a/x b/x\n", test_patch: "diff --git a/t b/t\nSECRET-TEST-PATCH\n", problem_statement: "The widget breaks on empty input.", hints_text: "SECRET-HINT look at widget.py", FAIL_TO_PASS: '["t::a"]', PASS_TO_PASS: '["t::b"]', version: "1.0" };

test("the instance image is the official one: lowercased, a double underscore written _1776_", () => {
  assert.equal(imageOf("pytest-dev__pytest-7982"), "swebench/sweb.eval.x86_64.pytest-dev_1776_pytest-7982:latest");
  assert.equal(imageOf("Foo__Bar-1"), "swebench/sweb.eval.x86_64.foo_1776_bar-1:latest");
});

test("a row is pinned by its canonical JSON, whatever the order of its keys", () => {
  const shuffled = Object.fromEntries(Object.entries(ROW).reverse());
  assert.equal(rowDigest(ROW), rowDigest(shuffled));
  assert.notEqual(rowDigest(ROW), rowDigest({ ...ROW, patch: "other" }));
});

test("the agent is handed the problem statement alone: never a hint, the patch, the test patch or a test name", () => {
  const home = mkdtempSync(join(tmpdir(), "evl-swe-"));
  try {
    writeJson(cacheFileOf(home), { revision: REVISION, rows: [ROW] });
    const t = swebenchTask("o__r-12", { home });
    const prompt = promptOf(t.issue);
    for (const s of ["SECRET-HINT", "SECRET-TEST-PATCH", "t::a", "t::b", "diff --git"]) assert.ok(!prompt.includes(s), s);
    assert.match(prompt, /The widget breaks on empty input\./);
    assert.equal(t.repo, "/testbed");
    assert.deepEqual(t.pin, { dataset: "princeton-nlp/SWE-bench_Verified", revision: REVISION, row: rowDigest(ROW) });
    assert.equal(t.controlPatch("gold").toString(), ROW.patch);
    assert.equal(t.controlPatch("half"), null);
    assert.throws(() => swebenchTask("o__r-13", { home }), /not a row/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the harness's report, mapped: resolved, a regression, a patch that did not apply, no report", () => {
  const rep = (o) => ({ "o__r-12": { patch_successfully_applied: true, resolved: false, tests_status: { FAIL_TO_PASS: { success: [], failure: [] }, PASS_TO_PASS: { success: [], failure: [] } }, ...o } });
  assert.equal(gradedFromReport(rep({ resolved: true, tests_status: { FAIL_TO_PASS: { success: ["a"], failure: [] }, PASS_TO_PASS: { success: ["b"], failure: [] } } }), "o__r-12").resolved, true);
  const regressed = gradedFromReport(rep({ tests_status: { FAIL_TO_PASS: { success: ["a"], failure: [] }, PASS_TO_PASS: { success: [], failure: ["b"] } } }), "o__r-12");
  assert.deepEqual([regressed.resolved, regressed.regressed, regressed.p2pFailed], [false, true, ["b"]]);
  assert.deepEqual(gradedFromReport(rep({ patch_successfully_applied: false }), "o__r-12"), { ran: true, applied: false, why: "the harness could not apply the patch" });
  assert.equal(gradedFromReport(null, "o__r-12").ran, false);
});
