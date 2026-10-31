// The QA suite's cases: each a defect planted in Orbit's own synthetic application. What this file holds: every case
// loads and holds to its fields; its ground truth IS acceptance's own for its stack and variant (a copy that drifted
// would grade against a truth nobody checks); the coding host is asked the same thing whatever is planted; and nothing
// the host's plugin carries names the planted variant, holds the ground truth or holds the reference designs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HARNESS } from "../benchmark/lib/core/freeze.mjs";
import { matchesAny } from "../benchmark/lib/core/paths.mjs";
import { caseFindings, casesOf, TRUTH_OUTCOMES } from "../benchmark/lib/core/suites.mjs";
import { TARGETS } from "../benchmark/lib/qa/invoice.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");
const QA = casesOf(ROOT, "orbit-qa");
const ACCEPTANCE = JSON.parse(readFileSync(join(ROOT, "acceptance", "truth.json"), "utf8"));
const truthOf = (c) => JSON.parse(readFileSync(join(c.dir, c.acceptance.truth), "utf8"));

test("every QA case loads, holds to its fields, and plants a variant its application has", () => {
  assert.ok(QA.length >= 7, `${QA.length} cases`);
  for (const c of QA) {
    assert.deepEqual(caseFindings(JSON.parse(readFileSync(join(c.dir, "case.json"), "utf8")), c.dir), [], c.id);
    assert.ok(TARGETS[c.target.app], `${c.id} names an application the harness knows`);
    assert.ok(Object.hasOwn(ACCEPTANCE.stacks[c.target.stack].variants, c.target.variant), `${c.id}: ${c.target.variant}`);
    assert.ok(Object.hasOwn(ACCEPTANCE.stacks[c.target.stack].variants, c.target.clean));
  }
  assert.equal(new Set(QA.map((c) => c.target.variant)).size, QA.length, "one case per variant");
});

test("each case's ground truth is acceptance's own, for its stack and variant", () => {
  for (const c of QA) {
    const t = truthOf(c);
    assert.deepEqual([t.default, t.shapes, t.expect], [ACCEPTANCE.default, ACCEPTANCE.shapes, ACCEPTANCE.stacks[c.target.stack].variants[c.target.variant]], c.id);
    assert.ok(Object.values(t.expect).every((w) => TRUTH_OUTCOMES.includes(w)));
  }
});

test("the coding host is asked the same thing whatever is planted, and the request names no variant and no shape", () => {
  const requests = new Set(QA.map((c) => readFileSync(join(c.dir, c.request), "utf8")));
  assert.equal(requests.size, 1);
  const [request] = requests;
  for (const word of [...Object.keys(ACCEPTANCE.stacks["invoice-a"].variants).filter((v) => v !== "correct"), ...ACCEPTANCE.shapes]) assert.ok(!request.includes(word), word);
});

// Every file the plugin a QA host is handed would carry: the repository's own files (tracked or about to be), less
// the harness and what the case withholds.
const pluginFiles = (c) => spawnSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], { cwd: ROOT, env: sealed(), encoding: "utf8" }).stdout.split("\0").filter(Boolean).filter((rel) => !matchesAny([...HARNESS, ...c.target.withheld], rel));

const textOf = (rel) => {
  try { return readFileSync(join(ROOT, rel), "utf8"); }
  catch { return ""; }
};

test("nothing a QA host's plugin carries names the planted variant, holds the ground truth or the reference designs", () => {
  const files = pluginFiles(QA[0]);
  assert.ok(files.length > 500 && files.every((f) => !f.startsWith("acceptance/") && f !== "docs/backend-acceptance.json"));
  const texts = files.map((rel) => [rel, textOf(rel)]);
  for (const c of QA.filter((x) => x.target.variant !== "correct")) assert.deepEqual(texts.filter(([, t]) => t.includes(c.target.variant)).map(([rel]) => rel), [], c.id);
  assert.ok(QA.every((c) => c.target.withheld.join() === QA[0].target.withheld.join()), "every case withholds the same, so what is missing says nothing of what is planted");
});

test("the loader refuses a QA case whose truth is another variant's, or says an outcome the engine never says", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-qa-case-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(QA[0].dir, dir, { recursive: true });
  const c = { ...JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) };
  writeFileSync(join(dir, "verifier", "truth.json"), JSON.stringify({ ...truthOf(QA[0]), from: { ...truthOf(QA[0]).from, variant: "no-dedupe" } }));
  assert.ok(caseFindings(c, dir).some((f) => /another stack's or variant's/.test(f)));
  writeFileSync(join(dir, "verifier", "truth.json"), JSON.stringify({ ...truthOf(QA[0]), expect: { "persisted-after-write": "FOUND_IT" } }));
  assert.ok(caseFindings(c, dir).some((f) => /expect\.persisted-after-write/.test(f)));
  mkdirSync(join(dir, "x"), { recursive: true });
  assert.ok(caseFindings({ ...c, target: { ...c.target, withheld: ["../outside"] } }, dir).some((f) => /withheld globs reach outside/.test(f)));
  assert.ok(caseFindings({ ...c, controls: [{ id: "x", host: "a-model-of-my-own", expect: "PASS" }] }, dir).some((f) => /host/.test(f)));
});
