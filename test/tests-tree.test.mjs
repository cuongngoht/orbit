// The screen-folder tree: where a case and a plan sit, how either is found by
// id wherever it sits, and the rules that hold the tree to its own shape.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { NO_SCREEN, caseFile, caseFiles, folderOf, placedIn, planFile, planFiles } from "../src/tests-tree.mjs";
import { findCase, loadCases } from "../src/dsl/load.mjs";
import { findPlan } from "../src/qa/load.mjs";
import { placeFindings as casePlacement } from "../src/dsl/rules/place.mjs";
import { placeFindings as planPlacement } from "../src/qa/rules/place.mjs";
import { Refused } from "../src/errors.mjs";

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-tree-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(body));
  }
  return dir;
}

const GRAPH = { screens: new Map([["home", {}], ["detail", {}]]) };

test("a case is found by id in whichever screen folder holds it, and a flat file still loads", () => {
  const dir = tree({ "home/cases/a.json": { id: "a", start: "home" }, "detail/cases/b.json": { id: "b", start: "detail" }, "c.json": { id: "c" }, "home/cases/deeper/x.json": { id: "x" } });
  assert.deepEqual(loadCases(dir).map((c) => c.id), ["a", "b", "c"], "two levels and no deeper: a folder under cases/ is somebody's scratch");
  assert.equal(findCase(dir, "b").start, "detail");
  assert.equal(findCase(dir, "nope"), null);
});

test("a plan is found by id in its screen folder, beside the cases and never among them", () => {
  const dir = tree({ "home/p.plan.json": { id: "p", screen: "home" }, "home/cases/a.json": { id: "a" } });
  assert.deepEqual(planFiles(dir).map((f) => relative(dir, f)), [join("home", "p.plan.json")]);
  assert.ok(!caseFiles(dir).some((f) => f.endsWith(".plan.json")), "a plan is never read as a case");
  assert.equal(findPlan(dir, "p").screen, "home");
});

test("the folder is the start screen, `_no-screen` without one, and never a guessed spelling of an unsafe id", () => {
  assert.equal(folderOf({ start: "home" }), "home");
  assert.equal(folderOf({}), NO_SCREEN);
  for (const start of ["../escape", "a/b", "a\\b", ".hidden", ".."]) {
    assert.equal(folderOf({ start }), null, start);
    assert.throws(() => caseFile("/t", { id: "x", start }), Refused, start);
  }
  assert.throws(() => planFile("/t", { id: "p", screen: "../x" }), Refused);
  assert.equal(caseFile("/t", { id: "x", start: "home" }), join("/t", "home", "cases", "x.json"));
  assert.equal(placedIn("/t", join("/t", "home", "cases", "x.json")), "home");
  assert.equal(placedIn("/t", join("/t", "x.json")), null);
});

test("check names a case in another screen's folder, and one id held by two files", () => {
  const dir = tree({ "home/cases/a.json": { id: "a", start: "detail" }, "home/cases/b.json": { id: "b", start: "home" }, "detail/cases/b.json": { id: "b", start: "detail" }, "loose.json": { id: "loose", start: "home" } });
  const found = casePlacement(loadCases(dir), dir);
  assert.equal(found.filter((f) => f.startsWith("a: sits in home but starts on detail")).length, 1);
  assert.equal(found.filter((f) => f.startsWith("b: one id, 2 files")).length, 1, "reported once, naming both files");
  assert.equal(found.filter((f) => f.startsWith("loose: sits in the tree's root")).length, 1);
  assert.deepEqual(casePlacement(loadCases(dir), undefined), [], "no tree, nothing to be misplaced in");
  assert.equal(found.length, 3, "both b files sit where they start: only the shared id is wrong");
});

test("plan-check holds a plan to the screen it names", () => {
  const dir = tree({ "home/p.plan.json": {}, "detail/q.plan.json": {} });
  const world = { dir, graph: GRAPH };
  assert.deepEqual(planPlacement({ id: "p", screen: "home", _file: join(dir, "home", "p.plan.json") }, world), []);
  assert.match(planPlacement({ id: "q", screen: "home", _file: join(dir, "detail", "q.plan.json") }, world)[0].say, /sits in detail but names screen home/);
  assert.match(planPlacement({ id: "r", _file: join(dir, "home", "p.plan.json") }, world)[0].say, /names no screen/);
  assert.match(planPlacement({ id: "s", screen: "gone", _file: join(dir, "gone", "s.plan.json") }, world)[0].say, /the map does not have/);
  assert.deepEqual(planPlacement({ id: "t", _file: "/anywhere/t.plan.json" }, { graph: GRAPH }), [], "a plan read from outside the tree has no folder to be wrong about");
});
