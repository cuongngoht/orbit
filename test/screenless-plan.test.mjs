// A plan about NO screen: a requirement behind an API, a PBI with no UI yet.
//
// It lives in screens/_no-screen/ -- the reserved folder a case with no start
// already lives in -- and names the feature it is about. Nothing about the map
// changes: no screen is invented to hold it. Its permission scenarios owe the
// server's refusal, not a screen's.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NO_SCREEN, planFile, planFolderOf } from "../src/tests-tree.mjs";
import { placeFindings } from "../src/qa/rules/place.mjs";
import { planFindings } from "../src/qa/validate.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { UI_TESTS } from "./fakes/context.mjs";
import { sealed } from "./home.mjs";
import { seedStore } from "./fakes/store.mjs";
import { fixtureProject } from "./fakes/context.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");
const GRAPH = loadGraph(join(UI_TESTS, "graph"));

function tree() {
  const dir = mkdtempSync(join(tmpdir(), "orbit-screenless-"));
  mkdirSync(join(dir, NO_SCREEN), { recursive: true });
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

test("a plan that names no screen belongs in the reserved no-screen folder", () => {
  assert.equal(planFolderOf({ id: "refunds" }), NO_SCREEN);
  assert.equal(planFolderOf({ id: "things", screen: "home" }), "home");
  assert.equal(planFile("/t/screens", { id: "refunds" }), join("/t/screens", NO_SCREEN, "refunds.plan.json"));
});

test("placement: in no-screen and naming its feature is clean; anywhere else, or with no feature, is an error", () => {
  const dir = tree();
  const world = { dir, graph: GRAPH };
  assert.deepEqual(placeFindings({ id: "refunds", feature: "Refunds", _file: join(dir, NO_SCREEN, "refunds.plan.json") }, world), []);
  assert.match(placeFindings({ id: "refunds", feature: "Refunds", _file: join(dir, "home", "refunds.plan.json") }, world)[0].say, /names no screen — move it to screens\/_no-screen\//);
  assert.match(placeFindings({ id: "orphan", _file: join(dir, NO_SCREEN, "orphan.plan.json") }, world)[0].say, /names no screen and no feature/);
  assert.deepEqual(placeFindings({ id: "drafted", feature: "Refunds", _draft: true, _file: "/store/drafts/plans/drafted.plan.json" }, world), [], "a draft sits in the flat drafts room and has no folder to be wrong about");
});

test("a permission scenario in a screenless plan owes the server's refusal, not a screen's", () => {
  const plan = { schema: 1, id: "refunds", feature: "Refunds", title: "Refund rules", revision: "1", at: "2026-09-29", sources: [{ id: "PBI1", kind: "requirement", ref: "PBI-7", revision: "7", authority: "accepted", says: "only a finance role may refund" }], criteria: [{ id: "AC1", says: "a clerk cannot refund", source: "PBI1" }], scenarios: [{ id: "S1", name: "a clerk is refused", covers: ["AC1"], technique: "permission", priority: "P1", actor: { as: "clerk", notRoles: ["Finance"] }, expect: { api: { need: "required", says: "POST /refunds answers 403" }, sql: { need: "required", says: "no refund row" } }, denial: { lacks: ["Finance"], action: "refund an order", backend: { need: "required", says: "403" }, unchanged: { need: "required", says: "the order is unchanged" } }, cases: [], readiness: "draft" }] };
  const findings = planFindings(plan, { graph: GRAPH }).map((f) => f.say);
  assert.ok(!findings.some((f) => /denial says nothing about the screen/.test(f)), findings.join("\n"));
  assert.ok(planFindings({ ...plan, screen: "home" }, { graph: GRAPH }).some((f) => /denial says nothing about the screen/.test(f.say)), "a plan about a screen still owes the screen's side");
});

test("qa-plan new --no-screen --feature writes the plan into screens/_no-screen/", () => {
  const data = join(mkdtempSync(join(tmpdir(), "orbit-new-")), "ui-tests");
  cpSync(UI_TESTS, data, { recursive: true });
  const store = seedStore(null, fixtureProject());
  const env = sealed({ ORBIT_UI_TESTS: data, ORBIT_STORE_DIR: store });
  const r = spawnSync(process.execPath, [join(CLI, "qa-plan.mjs"), "new", "refunds", "--no-screen", "--feature=Refunds", "Refund rules"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  const file = join(data, "screens", NO_SCREEN, "refunds.plan.json");
  assert.ok(existsSync(file));
  const plan = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(plan.screen, undefined);
  assert.equal(plan.feature, "Refunds");
  const refused = spawnSync(process.execPath, [join(CLI, "qa-plan.mjs"), "new", "other", "--no-screen"], { encoding: "utf8", env });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--no-screen needs --feature/);
});
