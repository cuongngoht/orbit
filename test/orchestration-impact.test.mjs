// IMPACT-BASED VERIFICATION, end to end through the real task write door: a change is held to the checks
// of what it REACHES -- never to every check the checkout declares -- read off the component graph runtime
// understanding hands in. The acceptance cases of 1.8.4 (A-J), on one monorepo-shaped graph: a web
// client and an api that both use a contracts package and a shared library, the api over a database
// package, and an infrastructure folder nothing depends on. No case names a stack: the graph is data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contextOf, finish } from "../src/orchestration/loop.mjs";
import { fails, orchestrationWorld, passes, prepared } from "./fakes/orchestration.mjs";

const cmd = (n, purpose, component, name, cwd) => ({ id: `rt-command-0000${String(n).padStart(4, "0")}`, purpose, component, declaredAs: name, argv: ["npm", "run", name], cwd });

const C = {
  webBuild: cmd(1, "build", "c:web", "build:web", "web"),
  webTest: cmd(2, "test", "c:web", "test:web", "web"),
  webLint: cmd(3, "verify", "c:web", "lint:web", "web"),
  apiBuild: cmd(4, "build", "c:api", "build:api", "api"),
  apiTest: cmd(5, "test", "c:api", "test:api", "api"),
  contractsTest: cmd(6, "test", "c:contracts", "test:contracts", "contracts"),
  libTest: cmd(7, "test", "c:lib", "test:lib", "lib"),
  dbTest: cmd(8, "test", "c:db", "test:db", "db"),
  infraValidate: cmd(9, "verify", "c:infra", "validate:infra", "infra"),
};

const DECLARED = Object.values(C);

const node = (key, dir, dependsOn = [], extra = {}) => ({ key, dir, kind: "library", live: null, dependsOn, inherits: [], unresolved: [], ...extra });

const GRAPH = { components: [node("c:web", "web", ["c:contracts", "c:lib"], { kind: "web", live: "browser" }), node("c:api", "api", ["c:contracts", "c:lib", "c:db"], { kind: "api", live: "http" }), node("c:contracts", "contracts"), node("c:lib", "lib"), node("c:db", "db"), node("c:infra", "infra")] };

const world = (t, opts = {}) => orchestrationWorld(t, { declared: DECLARED, graph: GRAPH, ...opts });

const STAGE_PURPOSES = { BUILDING: ["build", "verify"], TESTING: ["test"], REGRESSION: ["test"] };

const nextOwed = (o, id) => ((c) => c.verificationPlan.required.find((x) => !x.settled && x.state !== "running" && (STAGE_PURPOSES[c.stage] ?? []).includes(x.purpose)))(contextOf(o.ports, id));

// Planned, every required check baselined, changed, and every owed check run until the stage moves on or a
// check fails -- then the review, when the task reached it.
async function verified(o, { scope, edits = scope, baseline = true }) {
  const { id, go } = await prepared(o);
  const planned = await go({ kind: "plan", intent: "the smallest change the requirement asks for", scope });
  for (const c of baseline ? planned.data.verificationPlan.required : []) await go({ kind: "check", command: c.id });
  await go({ kind: "implement" });
  for (const p of edits) o.ws.edit(p);
  await go({ kind: "record-changes" });
  for (let c = nextOwed(o, id); c; c = nextOwed(o, id)) await go({ kind: "check", command: c.id });
  const reviewed = o.w.view(id).stage === "REVIEWING" ? await go({ kind: "review" }) : null;
  return { id, go, reviewed, ctx: contextOf(o.ports, id) };
}

const ids = (rows) => rows.map((r) => r.id).sort();
const ran = (o, name) => o.process.calls.some((c) => c.args[1] === name);

test("A: a change to the web client completes though the api's build is broken -- the api is NOT AFFECTED, NOT RUN", async (t) => {
  const o = world(t, { script: { "build:api": [fails("error: api does not compile")] } });
  const { id, ctx } = await verified(o, { scope: ["web/src/App.tsx"] });
  assert.equal(o.w.view(id).lifecycle, "COMPLETED");
  assert.deepEqual(ids(ctx.verificationPlan.required), ids([C.webBuild, C.webTest, C.webLint]));
  assert.ok(ctx.verificationPlan.excluded.every((x) => x.state === "NOT_AFFECTED"), "never PASSED");
  assert.equal(ran(o, "build:api"), false, "a check the change does not reach is never run");
  const rows = o.w.view(id).verification;
  assert.equal(rows.find((v) => v.subject === C.apiBuild.id).state, "not-applicable");
  assert.match(rows.find((v) => v.subject === C.apiBuild.id).obligation, /not affected, not run/);
});

test("B: a change to the api completes though the web client's build is broken", async (t) => {
  const o = world(t, { script: { "build:web": [fails("error: web does not compile")] } });
  const { id, ctx } = await verified(o, { scope: ["api/src/Refunds.cs"] });
  assert.equal(o.w.view(id).lifecycle, "COMPLETED");
  assert.deepEqual(ids(ctx.verificationPlan.required), ids([C.apiBuild, C.apiTest]));
  assert.equal(ran(o, "build:web"), false);
});

test("C: a change to the shared library holds every component that uses it to its checks", async (t) => {
  const o = world(t);
  const { id, ctx } = await verified(o, { scope: ["lib/money.ts"] });
  assert.deepEqual(ids(ctx.verificationPlan.required), ids([C.libTest, C.webBuild, C.webTest, C.webLint, C.apiBuild, C.apiTest]));
  assert.deepEqual(ctx.verificationPlan.impact.components.map((c) => [c.key, c.reason]), [["c:lib", "MODIFIED"], ["c:web", "DEPENDENT"], ["c:api", "DEPENDENT"]]);
  assert.equal(o.w.view(id).lifecycle, "COMPLETED");
});

test("D: a change to the api contract reaches the web client's tests because the web client depends on the contract -- and only because it does", async (t) => {
  const o = world(t);
  const { ctx } = await verified(o, { scope: ["contracts/refunds.yaml"] });
  assert.ok(ctx.verificationPlan.required.some((c) => c.id === C.webTest.id));
  const alone = world(t, { graph: { components: GRAPH.components.map((c) => (c.key === "c:web" ? { ...c, dependsOn: ["c:lib"] } : c)) } });
  const without = await verified(alone, { scope: ["contracts/refunds.yaml"] });
  assert.equal(without.ctx.verificationPlan.required.some((c) => c.id === C.webTest.id), false, "no evidence, no obligation");
});

test("E: a full-stack change is held to both sides", async (t) => {
  const o = world(t);
  const { id, ctx } = await verified(o, { scope: ["web/src/Refund.tsx", "api/src/Refunds.cs"] });
  assert.deepEqual(ids(ctx.verificationPlan.required), ids([C.webBuild, C.webTest, C.webLint, C.apiBuild, C.apiTest]));
  assert.equal(o.w.view(id).lifecycle, "COMPLETED");
});

test("F: a database migration reaches the application that runs on it, and not the one that does not", async (t) => {
  const o = world(t);
  const { ctx } = await verified(o, { scope: ["db/migrations/0042_refund_limit.sql"] });
  assert.deepEqual(ids(ctx.verificationPlan.required), ids([C.dbTest, C.apiBuild, C.apiTest]));
});

test("G: an infrastructure-only change is held to its own validation and to no application's build", async (t) => {
  const o = world(t);
  const { id, ctx } = await verified(o, { scope: ["infra/main.tf"] });
  assert.deepEqual(ids(ctx.verificationPlan.required), [C.infraValidate.id]);
  assert.equal(o.w.view(id).lifecycle, "COMPLETED", "verified by its own check, with no test to run");
  assert.equal(["build:web", "build:api"].some((n) => ran(o, n)), false);
});

test("H: a test that passed before the change and fails after it is a regression: the attempt fails, and nothing completes", async (t) => {
  const o = world(t, { script: { "test:web": [passes(), fails("FAIL RefundForm rejects an amount over what was paid")] } });
  const { id, ctx } = await verified(o, { scope: ["web/src/RefundForm.tsx"] });
  assert.deepEqual([o.w.view(id).stage, o.w.view(id).attempts[0].outcome], ["DIAGNOSING", "failed"]);
  assert.deepEqual(ctx.verificationPlan.regressions, [C.webTest.id]);
  assert.equal(ctx.latestFailure.class, "TEST");
  await assert.rejects(finish(o.ports, id), /NOT_COMPLETE/);
});

test("I: a failure that was there before the change stays visible as one, never a pass -- and does not block", async (t) => {
  const SAME = fails("FAIL RefundHistory shows refunds of another tenant");
  const o = world(t, { script: { "test:web": [SAME] } });
  const { id, ctx } = await verified(o, { scope: ["web/src/RefundForm.tsx"] });
  assert.equal(o.w.view(id).lifecycle, "COMPLETED");
  const webTest = ctx.verificationPlan.required.find((c) => c.id === C.webTest.id);
  assert.deepEqual([webTest.state, webTest.baseline], ["failed-as-before", "failed"]);
  assert.ok(ctx.verificationPlan.baselineFailures.includes(C.webTest.id));
  const check = o.w.view(id).receipts.filter((r) => r.domain === "check").at(-1);
  assert.equal(o.w.view(id).actions.filter((a) => a.type === "test").at(-1).state, "failed", "the action is still a failure");
  assert.ok(o.w.view(id).receipts.some((r) => r.domain === "check" && r.outcome === "failed-as-before"), check.outcome);
  assert.match(o.w.view(id).verification.find((v) => v.subject === C.webTest.id).obligation, /fails no worse than before the change/);
});

test("I: a failure that CHANGED since the baseline is a new one, and blocks", async (t) => {
  const o = world(t, { script: { "test:web": [fails("FAIL RefundHistory paging"), fails("FAIL RefundForm accepts an amount over what was paid")] } });
  const { id } = await verified(o, { scope: ["web/src/RefundForm.tsx"] });
  assert.equal(o.w.view(id).stage, "DIAGNOSING");
});

test("I: only failing as before is not verified -- something the change is held to must pass", async (t) => {
  const SAME = fails("FAIL everything");
  const o = world(t, { declared: [C.webBuild, C.webTest], script: { "test:web": [SAME] } });
  const { id, go } = await verified(o, { scope: ["web/src/RefundForm.tsx"] });
  assert.notEqual(o.w.view(id).lifecycle, "COMPLETED", "nothing showed the change works");
  await assert.rejects(finish(o.ports, id), /at least one test or verify command .* passed/);
  assert.ok(go);
});

test("J: a failure with no baseline is an unknown comparison, and never satisfies anything", async (t) => {
  const o = world(t, { script: { "test:web": [fails("FAIL RefundForm")] } });
  const { id, ctx } = await verified(o, { scope: ["web/src/RefundForm.tsx"], baseline: false });
  assert.equal(o.w.view(id).stage, "DIAGNOSING");
  assert.equal(ctx.verificationPlan.required.find((c) => c.id === C.webTest.id).baseline, "none");
});

test("J: a changed path no component holds has nothing to verify it -- the review fails on it, and only a stop the journal supports ends the task", async (t) => {
  const o = world(t);
  const { id, reviewed, ctx } = await verified(o, { scope: ["web/src/App.tsx", "docs/refunds.md"] });
  assert.deepEqual(ctx.verificationPlan.missing.map((m) => m.what), ["docs/refunds.md"]);
  assert.equal(o.w.view(id).verification.find((v) => v.subject === ctx.verificationPlan.missing[0].subject).state, "blocked");
  assert.deepEqual([reviewed.outcome, reviewed.failure.class], ["failed", "CAPABILITY"]);
  await assert.rejects(finish(o.ports, id), /NOT_COMPLETE/);
  assert.equal((await finish(o.ports, id, { stop: "VERIFICATION_FAILED", because: "nothing declared verifies the docs" })).stop, "VERIFICATION_FAILED");
});

test("J: a component whose dependency nothing resolves is held to its checks when anything changes -- unknown is never unrelated", async (t) => {
  const graph = { components: GRAPH.components.map((c) => (c.key === "c:api" ? { ...c, dependsOn: [], unresolved: ["../gone/Gone.csproj"] } : c)) };
  const o = world(t, { graph });
  const { ctx } = await verified(o, { scope: ["lib/money.ts"] });
  assert.deepEqual(ctx.verificationPlan.impact.components.find((c) => c.key === "c:api").reason, "UNRESOLVED");
  assert.ok(ctx.verificationPlan.required.some((c) => c.id === C.apiTest.id));
});

test("J: with no component graph to read, every component with a check is held to it, and the plan says so", async (t) => {
  const o = world(t, { graph: null });
  const { ctx } = await verified(o, { scope: ["web/src/App.tsx"] });
  assert.equal(ctx.verificationPlan.word, "WIDENED");
  assert.equal(ctx.verificationPlan.required.length, DECLARED.length);
});

test("the scope moves with the change: a plan of one component, a change of two, and the second is owed too", async (t) => {
  const o = world(t);
  const { id, ctx } = await verified(o, { scope: ["web/src/App.tsx"], edits: ["web/src/App.tsx", "api/src/Refunds.cs"] });
  assert.equal(ctx.verificationPlan.source, "changes");
  assert.ok(ctx.verificationPlan.required.some((c) => c.id === C.apiTest.id), "the api changed, so its checks are owed");
  assert.notEqual(o.w.view(id).lifecycle, "COMPLETED", "and the review finds the api outside the plan's scope");
});

test("a check the change does not reach is refused in a checking stage, and may still be looked at while planning", async (t) => {
  const o = world(t);
  const { id, go } = await prepared(o);
  await go({ kind: "plan", intent: "a web change", scope: ["web/src/App.tsx"] });
  assert.equal((await go({ kind: "check", command: C.apiBuild.id })).outcome, "succeeded", "a look while planning");
  await go({ kind: "implement" });
  o.ws.edit("web/src/App.tsx");
  await go({ kind: "record-changes" });
  await assert.rejects(go({ kind: "check", command: C.apiBuild.id }), /not affected by this change/);
  assert.equal(o.w.view(id).verification.find((v) => v.subject === C.apiBuild.id).state, "not-applicable", "a baseline speaks for nothing");
});

test("implement before a plan is refused: the plan's scope is what says which checks to baseline", async (t) => {
  const o = world(t);
  const { go } = await prepared(o);
  await assert.rejects(go({ kind: "implement" }), /plan first/);
});

test("what a plan and a change reach is on the journal: one impact receipt each, in words a viewer can show", async (t) => {
  const o = world(t);
  const { id } = await verified(o, { scope: ["lib/money.ts"] });
  const impacts = o.w.view(id).receipts.filter((r) => r.domain === "impact");
  assert.deepEqual(impacts.map((r) => r.outcome), ["SCOPED", "SCOPED"]);
  assert.match(impacts[0].summary, /^plan: 3 component\(s\) reached \(c:lib modified, c:web dependent, c:api dependent\); 6 check\(s\) required, 3 not affected, 0 with nothing to verify it; live: c:web browser, c:api http$/);
  assert.match(impacts[1].summary, /^changes:/);
});

test("the context says it in words: impact, required, not affected, and what is worth seeing running", async (t) => {
  const o = world(t);
  const { id } = await prepared(o);
  const { COMMANDS } = await import("../src/orchestration/index.mjs");
  const go = (await import("./fakes/orchestration.mjs")).decided;
  await (await import("../src/orchestration/loop.mjs")).step(o.ports, id, go(o.ports, id, { kind: "plan", intent: "a web change", scope: ["web/src/App.tsx"] }));
  const text = COMMANDS.context.say(contextOf(o.ports, id));
  assert.match(text, /IMPACT     plan · SCOPED · c:web modified/);
  assert.match(text, /REQUIRED   c:web build build:web owed \(no baseline\)/);
  assert.match(text, /EXCLUDED   6 not affected — not run/);
  assert.match(text, /RUNTIME    c:web browser/);
  assert.match(contextOf(o.ports, id).next, /baseline what the change is held to/);
});

// ---- the gate holds against a host that tries to get round it (security review, 1.8.4) ---------------------

test("a NEW failure whose coarse signature matches the baseline's is still a regression: as-before is the exact output, not the signature", async (t) => {
  const before = fails("not ok 1 - refund limit\n  expected: 50\n  actual: 3");
  const after = fails("not ok 1 - refund limit\n  expected: 50\n  actual: 9");
  const o = world(t, { script: { "test:web": [before, after] } });
  const { id, ctx } = await verified(o, { scope: ["web/src/RefundForm.tsx"] });
  assert.equal(o.w.view(id).stage, "DIAGNOSING", "a different actual value is a different failure");
  assert.deepEqual(ctx.verificationPlan.regressions, [C.webTest.id]);
});

test("a baseline taken on a workspace edited before the change is no baseline: a failure made on purpose cannot be passed off as an old one", async (t) => {
  const broken = fails("not ok 1 - refund limit\n  expected: 50\n  actual: 0");
  const o = world(t, { script: { "test:web": [broken] } });
  const { id, go } = await prepared(o);
  const planned = await go({ kind: "plan", intent: "a web change", scope: ["web/src/RefundForm.tsx"] });
  o.ws.edit("web/src/RefundForm.tsx");
  for (const c of planned.data.verificationPlan.required) await go({ kind: "check", command: c.id });
  assert.equal(contextOf(o.ports, id).verificationPlan.required.find((c) => c.id === C.webTest.id).baseline, "none", "it ran on a tree the base revision does not hold");
  await go({ kind: "implement" });
  await go({ kind: "record-changes" });
  for (let c = nextOwed(o, id); c; c = nextOwed(o, id)) await go({ kind: "check", command: c.id });
  assert.equal(o.w.view(id).stage, "DIAGNOSING");
});

test("an edit after record-changes is never reviewed past: its reach was never computed", async (t) => {
  const o = world(t);
  const { id, go } = await prepared(o);
  await go({ kind: "plan", intent: "web and api", scope: ["web", "api"] });
  await go({ kind: "implement" });
  o.ws.edit("web/src/App.tsx");
  await go({ kind: "record-changes" });
  for (let c = nextOwed(o, id); c; c = nextOwed(o, id)) await go({ kind: "check", command: c.id });
  o.ws.edit("api/src/Refunds.cs");
  const reviewed = await go({ kind: "review" });
  assert.equal(reviewed.outcome, "failed");
  assert.match(reviewed.summary, /record-changes has not read back: api\/src\/Refunds\.cs/);
  assert.equal(ran(o, "test:api"), false, "and the api was never held to anything, so it may not complete");
  assert.notEqual(o.w.view(id).lifecycle, "COMPLETED");
});

test("a check that passed on a tree record-changes did not record counts for nothing, even once the recorded code is put back", async (t) => {
  const o = world(t);
  const { id, go } = await prepared(o);
  await go({ kind: "plan", intent: "a web change", scope: ["web/src/App.tsx"] });
  await go({ kind: "implement" });
  o.ws.edit("web/src/App.tsx", 1);
  await go({ kind: "record-changes" });
  o.ws.edit("web/src/App.tsx", 2);
  for (const c of [C.webBuild, C.webLint]) assert.equal((await go({ kind: "check", command: c.id })).outcome, "succeeded");
  o.ws.edit("web/src/App.tsx", 1);
  assert.equal(o.w.view(id).stage, "BUILDING", "nothing settled, so the stage did not move");
  assert.ok(contextOf(o.ports, id).verificationPlan.required.every((c) => c.state === "owed"), "every pass was of other code");
});

test("a component that holds a check and that the graph does not know is held to it once anything changes -- unknown is never unrelated", async (t) => {
  const o = world(t, { graph: { components: GRAPH.components.filter((c) => c.key !== "c:api") } });
  const { ctx } = await verified(o, { scope: ["web/src/App.tsx"] });
  assert.equal(ctx.verificationPlan.impact.components.find((c) => c.key === "c:api").reason, "UNKNOWN");
  assert.ok(ctx.verificationPlan.required.some((c) => c.id === C.apiTest.id));
});

// ---- the second review: a part of an output, an edit while a check runs, a file the tree leaves out ---------

async function baselined(o, before = () => {}) {
  const { id, go } = await prepared(o);
  const planned = await go({ kind: "plan", intent: "a web change", scope: ["web/src/RefundForm.tsx"] });
  before();
  for (const c of planned.data.verificationPlan.required) await go({ kind: "check", command: c.id });
  return { id, go, test: contextOf(o.ports, id).verificationPlan.required.find((c) => c.id === C.webTest.id) };
}

test("an output kept only in part has no exact identity: the same tail after a longer, different head is never 'as before'", async (t) => {
  const long = { ...fails("not ok 1 - refund limit"), overflow: true };
  const o = world(t, { script: { "test:web": [long] } });
  const { id } = await verified(o, { scope: ["web/src/RefundForm.tsx"] });
  assert.equal(o.w.view(id).stage, "DIAGNOSING", "an identity of a part is no identity");
});

test("an edit made while a check runs leaves the run with no tree: it is no baseline", async (t) => {
  const o = world(t);
  const run = o.ports.checks.run;
  let edits = 0;
  o.ports.checks.run = (command, at) => ((r) => (o.ws.edit(`web/src/scratch${++edits}.ts`), r))(run(command, at));
  const { test: webTest } = await baselined(o);
  assert.equal(webTest.baseline, "none");
});

test("a run beside a file the tree leaves out -- something ignores it -- is no baseline: the base revision is not all it ran on", async (t) => {
  const o = world(t);
  const { test: webTest } = await baselined(o, () => { o.ws.state.ignored = 1; });
  assert.equal(webTest.baseline, "none");
  const clean = world(t);
  assert.equal((await baselined(clean)).test.baseline, "passed", "with nothing ignored, the same run is one");
});

test("a file edited and put back while a check runs leaves the run with no tree: the same tree before and after is not enough", async (t) => {
  const o = world(t);
  const run = o.ports.checks.run;
  o.ports.checks.run = (command, at) => ((r) => (o.ws.edit("web/src/App.tsx", 9), o.ws.state.files.delete("web/src/App.tsx"), r))(run(command, at));
  const { test: webTest } = await baselined(o);
  assert.equal(webTest.baseline, "none");
});
