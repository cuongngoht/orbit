// The routing table is DATA (AGENTS.md's "vocabulary is data" rule applies to
// orbit-help's workflow registry too), so it is tested the way src/dsl.test.mjs
// tests verbs.mjs: over plain state, with no context to build.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { taskArg } from "../src/help/model.mjs";
import { recommend, ROUTES } from "../src/help/vocab.mjs";
import { classify } from "../src/routing/classify.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const CURRENT = { architecture: { total: 3, fresh: 3, stale: 0, unknown: 0 }, map: { screens: 2, edges: 1 }, qa: { plans: 1, clean: 1, errors: 0 }, learn: { total: 0, validated: 0, candidate: 0 } };
const state = (over) => ({ ...CURRENT, ...over });

test("nothing scanned yet routes to architecture ensure", () => {
  const s = state({ architecture: { total: 0, fresh: 0, stale: 0, unknown: 0 } });
  assert.equal(recommend(s).id, "architecture");
});

test("a stale fact routes to architecture ensure even when facts exist", () => {
  const s = state({ architecture: { total: 3, fresh: 2, stale: 1, unknown: 0 } });
  assert.equal(recommend(s).id, "architecture");
  assert.match(recommend(s).because(s), /1 architecture fact\(s\)/);
});

test("an empty map routes to orbit-ui-map in a project that already keeps a plan", () => {
  const s = state({ map: { screens: 0, edges: 0 } });
  assert.equal(recommend(s).id, "map");
});

// 1.8.9: a project with no UI is never sent down the UI-test path because it has nothing to test with.
const NO_QA = { map: { screens: 0, edges: 0 }, qa: { plans: 0, clean: 0, errors: 0 } };

test("no task, no map and no plan is READINESS -- what Orbit can do here -- never orbit-ui-map", () => {
  const s = state(NO_QA);
  assert.equal(recommend(s).id, "readiness");
  assert.match(recommend(s).because(s), /name a task/);
});

test("a QA task in a project with no map still starts at the map; a development task goes to the developer, never UI testing", () => {
  assert.equal(recommend(withTask("run the regression tests", NO_QA)).id, "map");
  assert.equal(recommend(withTask("fix the REST API bug", NO_QA)).id, "developer");
  assert.equal(recommend(withTask("refactor the backend service", NO_QA)).run, "orbit-develop");
});

test("what this project is, or how it builds code, goes to orbit-architecture", () => {
  assert.equal(recommend(withTask("explain the current architecture", NO_QA)).run, "orbit-architecture");
  assert.equal(recommend(withTask("what conventions does this project follow", NO_QA)).run, "orbit-architecture");
});

test("a repository read once that held nothing a fact could stand on is not sent to be read again", () => {
  const read = { architecture: { total: 0, fresh: 0, stale: 0, unknown: 0, scanned: true } };
  assert.notEqual(recommend(state({ ...NO_QA, ...read })).id, "architecture");
  assert.equal(recommend(state({ ...NO_QA, architecture: { total: 0, fresh: 0, stale: 0, unknown: 0 } })).id, "architecture", "never read: read it once");
});

test("no plan routes to orbit-test-plan", () => {
  const s = state({ qa: { plans: 0, clean: 0, errors: 0 } });
  assert.equal(recommend(s).id, "qa-plan");
});

test("a plan with an error routes to orbit-test-plan even though one exists", () => {
  const s = state({ qa: { plans: 1, clean: 0, errors: 1 } });
  assert.equal(recommend(s).id, "qa-plan");
});

test("current architecture, a populated map and a clean plan route to orbit-test-suite", () => {
  assert.equal(recommend(CURRENT).id, "run-tests");
});

test("the last row is unconditional, so a caller always gets exactly one route", () => {
  assert.equal(ROUTES.at(-1).when(CURRENT), true);
});

test("every route names a workflow that ships: a skill with a SKILL.md, or a CLI under cli/", () => {
  for (const r of ROUTES) {
    const cli = /^node <engine>\/(cli\/[a-z-]+\.mjs)/.exec(r.run)?.[1];
    assert.ok(cli ? existsSync(join(REPO, cli)) : existsSync(join(REPO, "skills", r.run, "SKILL.md")), `${r.id}: ${r.run} does not exist`);
  }
});

// ---- a task, as the router classifies it ---------------------------------------

const withTask = (prompt, over = {}) => ({ ...CURRENT, ...over, task: { intent: classify(prompt).intent.id } });

test("a change to the code goes to orbit-develop once architecture is current", () => {
  assert.equal(recommend(withTask("What should I use to implement this backend feature?")).run, "orbit-develop");
  assert.equal(recommend(withTask("rename the local helper method")).id, "developer");
});

test("a change to the code with no architecture scanned goes to the architecture workflow FIRST", () => {
  const s = withTask("implement the backend feature", { architecture: { total: 0, fresh: 0, stale: 0, unknown: 0 } });
  assert.equal(recommend(s).id, "architecture");
  assert.match(recommend(s).because(s), /a change needs that context first/);
});

test("a QA task keeps the QA path: map, plan, run", () => {
  assert.equal(recommend(withTask("run the regression tests")).id, "run-tests");
  assert.equal(recommend(withTask("run the regression tests", { qa: { plans: 0, clean: 0, errors: 0 } })).id, "qa-plan");
});

test("finding bugs in a running app goes to orbit-qa-agent, even before architecture is scanned", () => {
  const s = withTask("pls find bug in https://app.example.test/admin/dashboard", { architecture: { total: 0, fresh: 0, stale: 0, unknown: 0 } });
  assert.equal(recommend(s).run, "orbit-qa");
});

test("running the project, or the place it runs in, goes to orbit-runtime, even before architecture is scanned", () => {
  const unscanned = { architecture: { total: 0, fresh: 0, stale: 0, unknown: 0 } };
  const s = withTask("how do I run the app locally", unscanned);
  assert.equal(recommend(s).id, "runtime");
  assert.equal(recommend(s).run, "orbit-runtime");
  assert.match(recommend(s).because(s), /reads what the checkout needs from its own files/);
  assert.equal(recommend(withTask("design a dev container for this project")).run, "orbit-runtime");
  assert.equal(recommend(withTask("run the regression tests")).id, "run-tests", "a test question keeps the QA path");
});

test("managing MCP servers or tools goes to orbit-control, even before architecture is scanned", () => {
  assert.equal(recommend(withTask("add an MCP server for the company docs", { architecture: { total: 0, fresh: 0, stale: 0, unknown: 0 } })).run, "orbit-control");
});

test("exactly one NEXT for any state, and the task's text is reduced to an intent word", () => {
  for (const prompt of ["", "hello", "implement x", "add an MCP server", "run tests", "review PR 3"]) assert.equal(ROUTES.filter((r) => r === recommend(withTask(prompt))).length, 1, prompt);
  assert.equal(taskArg(["--json", "--for=implement the webhook"]), "implement the webhook");
  assert.equal(taskArg(["--json"]), null);
});

// ---- requirements --------------------------------------------------------------------------------

test("a task that names a work item goes to orbit-requirements, before architecture and before the change", () => {
  const s = withTask("Implement PBI 4312");
  assert.equal(recommend(s).run, "orbit-requirements");
  assert.match(recommend(s).because(s), /work item, PBI, issue or ticket/);
  const unscanned = withTask("Implement PBI 4312", { architecture: { total: 0, fresh: 0, stale: 0, unknown: 0 } });
  assert.equal(recommend(unscanned).run, "orbit-requirements", "what the item asks is settled without a scan of the architecture");
  assert.equal(recommend(withTask("implement the ZETA-9181 webhook")).run, "orbit-develop", "a change with no work item is still a change");
});

test("a work whose requirement is not yet complete is carried on, even from a task that does not name it", () => {
  const s = withTask("rename the local helper method", { work: { total: 2, open: 1, blocked: 0 } });
  assert.equal(recommend(s).id, "requirements");
  assert.match(recommend(s).because(s), /1 piece\(s\) of work rest on a requirement that is not complete yet/);
  assert.equal(recommend(withTask("rename the local helper method", { work: { total: 2, open: 0, blocked: 0 } })).id, "developer", "nothing open, nothing to continue");
  assert.equal(recommend(withTask("add an MCP server for the company docs", { work: { total: 1, open: 1, blocked: 0 } })).run, "orbit-control", "what Orbit may use is managed first");
});
