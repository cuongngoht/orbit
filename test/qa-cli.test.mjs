// The two QA-plan entry points, spawned for real: argv, output and -- the whole
// interface for CI and for an agent -- the exit codes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { planMarkdown } from "../src/qa/markdown.mjs";
import { findPlan } from "../src/qa/load.mjs";
import { UI_TESTS, fixtureProject } from "./fakes/context.mjs";
import { seedStore } from "./fakes/store.mjs";
import { sealed } from "./home.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");
const PLANS = join(UI_TESTS, "screens");
const FIXTURES = dirname(UI_TESTS);

// A store seeded with the coverage fixtures' own ledger, kept apart from the
// project's for the reason test/fixtures/ledger/README.md gives: those runs
// exist to demonstrate one plan's coverage, and folding them into the shared
// history changes what `learn analyse` concludes about another subject.
const QA_STORE = seedStore("qa", fixtureProject(), { digests: true });

const run = (script, args, uiTests = UI_TESTS) =>
  spawnSync(process.execPath, [join(CLI, script), ...args], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: uiTests, ORBIT_STORE_DIR: QA_STORE }) });

// A copy, so a deliberately broken plan stays contained.
function copied(change) {
  const dir = join(mkdtempSync(join(tmpdir(), "orbit-plan-")), "ui-tests");
  cpSync(UI_TESTS, dir, { recursive: true });
  change(dir);
  return dir;
}

test("plan-check exits 0 on a clean plan and 1 on one with errors", () => {
  const clean = run("plan-check.mjs", []);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /things {2}no errors/);
  assert.match(clean.stdout, /0 error\(s\)/);

  const broken = copied((dir) => cpSync(join(FIXTURES, "plan.bad.json"), join(dir, "screens", "home", "plan-bad.plan.json")));
  const bad = run("plan-check.mjs", [], broken);
  assert.equal(bad.status, 1, "an error has to fail the command CI runs");
  assert.match(bad.stdout, /ERROR {3}plan-bad/);
});

// Advisories are heuristics. One must never be able to break somebody's build.
test("plan-check stays 0 when only advisories print", () => {
  const r = run("plan-check.mjs", ["things"]);
  assert.match(r.stdout, /advice/, "the fixture plan does print advisories");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /advisories never change the exit code/);
});

test("plan-check exits 2 for a plan that does not exist, and says how to list them", () => {
  const r = run("plan-check.mjs", ["nope"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no plan "nope"/);
  assert.match(r.stderr, /qa-plan.mjs plans/);
});

test("--json is a stable shape a machine can branch on", () => {
  const r = run("plan-check.mjs", ["things", "--json"]);
  assert.equal(r.status, 0);
  const found = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(found), ["plans", "errors", "advisories"]);
  assert.deepEqual(Object.keys(found.plans[0]), ["id", "file", "errors", "advisories"]);
  assert.equal(found.errors, 0);
  assert.ok(found.advisories > 0);
  assert.deepEqual(Object.keys(found.plans[0].advisories[0]), ["at", "say"], "an anchor for a machine and a sentence for a person");
  assert.deepEqual(JSON.parse(run("plan-check.mjs", ["things", "--json"]).stdout), found, "two runs, one answer");
});

test("a plan without current metadata is unavailable rather than imported", () => {
  const r = run("qa-plan.mjs", ["show", "unsupported-plan"]);
  assert.match(r.stdout, /no plan|not found/i);
});

test("qa-plan prints its usage when the command is not one it has", () => {
  const r = run("qa-plan.mjs", []);
  assert.match(r.stdout, /node qa-plan.mjs coverage <id>/);
  assert.match(r.stdout, /Checking a plan is a GATE and lives in its own command/);
});

test("qa-plan show reports the four axes apart", () => {
  const r = run("qa-plan.mjs", ["show", "things"]);
  assert.match(r.stdout, /design ready · build validated · run PASS · evidence fresh/);
  assert.match(r.stdout, /design blocked · build planned · run never · evidence unknown/);
  assert.match(r.stdout, /gap {4}api/);
});

test("qa-plan coverage prints every ratio with its denominator, and writes the page", () => {
  const out = join(mkdtempSync(join(tmpdir(), "orbit-cov-")), "coverage.html");
  const r = run("qa-plan.mjs", ["coverage", "things", `--out=${out}`]);
  assert.match(r.stdout, /criteria verified {4}1\/5 {6}20%/);
  assert.match(r.stdout, /scenarios verified {3}1\/4/);
  const html = readFileSync(out, "utf8");
  assert.match(html, /acceptance criteria verified against this revision/);
  assert.match(html, /SKIP, PARTIAL, REFUSED, BLOCKED and INCONCLUSIVE are outcomes, not evidence/);
  assert.ok(!html.includes("<script"), "every value on the page came from somebody's prose or a product's screen");
});

test("qa-plan select reports the shortfall rather than quietly running less", () => {
  const r = run("qa-plan.mjs", ["select", "things", "--budget=6"]);
  assert.match(r.stdout, /SHORTFALL: the must-run scenarios need 9 min and the budget is 6/);
  assert.match(r.stdout, /Nothing was demoted to make this fit/);
  assert.match(r.stdout, /not running 2 scenario\(s\)/);
});

test("qa-plan impact says how sure it is about each answer", () => {
  const r = run("qa-plan.mjs", ["impact", "things", "--now=REQ1=9", "--changed=dlg-thing/Save"]);
  assert.match(r.stdout, /REQ1 \[certain\] moved from 3 to 9/);
  assert.match(r.stdout, /\[possible\]/);
  assert.match(r.stdout, /S1 \[possible\] drives dlg-thing\/Save/);
});

test("qa-plan new writes a plan that is already clean, and refuses to overwrite one", () => {
  const dir = copied(() => {});
  assert.equal(run("qa-plan.mjs", ["new", "checkout", "Checkout"], dir).status, 2, "a plan has to name the screen whose folder holds it");
  assert.equal(run("qa-plan.mjs", ["new", "checkout", "--screen=nowhere"], dir).status, 2, "a screen the map does not have is a folder nobody looks in");
  const made = run("qa-plan.mjs", ["new", "checkout", "--screen=detail", "Checkout"], dir);
  assert.match(made.stdout, /wrote .*screens[\\/]detail[\\/]checkout\.plan\.json/);
  assert.ok(existsSync(join(dir, "screens", "detail", "checkout.md")), "the Markdown lands beside it");
  assert.equal(run("plan-check.mjs", ["checkout"], dir).status, 0);
  assert.match(run("qa-plan.mjs", ["new", "checkout", "--screen=detail"], dir).stdout, /already exists — nothing written/);
});

// One source, and the Markdown is its output.
test("the committed Markdown is what the renderer produces", () => {
  const disk = readFileSync(join(PLANS, "home", "things.md"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(disk, planMarkdown(findPlan(PLANS, "things")), "screens/home/things.md has drifted — node cli/qa-plan.mjs render things --write");
});

test("query check reports a stale plan schema, and says nothing to a project with no plans", () => {
  const stale = copied((dir) => writeFileSync(join(dir, "schema", "plan.schema.json"), "{}\n"));
  const r = run("query.mjs", ["check"], stale);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /schema\/plan.schema.json is out of date with the plan vocabulary/);

  const none = copied((dir) => { for (const f of ["things.plan.json", "things.md"]) rmSync(join(dir, "screens", "home", f)); rmSync(join(dir, "schema", "plan.schema.json")); });
  const quiet = run("query.mjs", ["check"], none);
  assert.equal(quiet.status, 0, quiet.stdout + quiet.stderr);
  assert.ok(!/plan.schema.json/.test(quiet.stdout), "a project that keeps no plans is not told about a schema it has never needed");
});

// A typed stop keeps its own code. Exit 1 would tell CI the PRODUCT is wrong
// because somebody left a trailing comma in project.json.
test("an unreadable project.json is REFUSED, with a sentence instead of a stack", () => {
  const dir = copied((d) => writeFileSync(join(d, "project.json"), "{ not json"));
  for (const script of ["plan-check.mjs", "qa-plan.mjs"]) {
    const r = spawnSync(process.execPath, [join(CLI, script), "plans"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: dir }) });
    assert.equal(r.status, 2, `${script}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /project.json is not valid JSON/);
    assert.ok(!/at Object\.|node:internal/.test(r.stderr), `${script} printed a stack trace`);
  }
});

test("plan.mjs still means what it meant: a click-path script, not a QA plan", () => {
  const r = run("plan.mjs", ["home", "dlg-thing"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /playwright-cli|pw |click/i);
  assert.ok(!/acceptance criteri/i.test(r.stdout));
});
