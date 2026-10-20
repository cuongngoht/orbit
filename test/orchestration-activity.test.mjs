// An OBSERVED check, through the real loop and the real task write door (1.8.5, ADR 0020): what a running check is
// seen doing is written BESIDE the task and never in it -- the journal, its revision, the receipts and the
// verifications are byte for byte what they are with no observer; failed-as-before is still decided on the same
// output; the check's record keeps a bounded summary and the host's answer carries it; an observer that cannot be
// made or that breaks changes nothing; and the tree a check ran on is named only after the run has settled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contextOf } from "../src/orchestration/loop.mjs";
import { fails, orchestrationWorld, passes, prepared } from "./fakes/orchestration.mjs";

const cmd = (n, purpose, component, name, cwd) => ({ id: `rt-command-0000${String(n).padStart(4, "0")}`, purpose, component, declaredAs: name, argv: ["npm", "run", name], cwd });

const C = { webBuild: cmd(1, "build", "c:web", "build:web", "web"), webTest: cmd(2, "test", "c:web", "test:web", "web"), apiTest: cmd(5, "test", "c:api", "test:api", "api") };

const DECLARED = Object.values(C);

const node = (key, dir, dependsOn = []) => ({ key, dir, kind: "library", live: null, dependsOn, inherits: [], unresolved: [] });

const GRAPH = { components: [node("c:web", "web"), node("c:api", "api")] };

const TAP_FAIL = "TAP version 13\n# Subtest: refund form\nnot ok 1 - refund form rejects an amount over what was paid\n  ---\n  error: 'expected 400, got 200'\n  failureType: 'testCodeFailure'\n  code: 'ERR_ASSERTION'\n  ...\n1..1\n# tests 1\n# pass 0\n# fail 1\n";

const world = (t, opts = {}) => orchestrationWorld(t, { declared: DECLARED, graph: GRAPH, ...opts });

// Planned, baselined, changed, checked again: the same scenario whether observed or not.
async function scenario(o) {
  const { id, go } = await prepared(o);
  const planned = await go({ kind: "plan", intent: "a web change", scope: ["web/src/RefundForm.tsx"] });
  const baseline = [];
  for (const c of planned.data.verificationPlan.required) baseline.push(await go({ kind: "check", command: c.id }));
  await go({ kind: "implement" });
  o.ws.edit("web/src/RefundForm.tsx");
  await go({ kind: "record-changes" });
  const after = await go({ kind: "check", command: C.webBuild.id });
  const tested = await go({ kind: "check", command: C.webTest.id });
  return { id, baseline, after, tested };
}

const journalOf = (o, id) => o.w.tasks.read(id).map(({ at, ...rest }) => rest);

test("an observed check writes beside the task, never in it: the journal, receipts and verifications are what they are unobserved", async (t) => {
  const script = { "test:web": [fails(TAP_FAIL)] };
  const plain = world(t, { script });
  const seen = world(t, { script, observe: {} });
  const a = await scenario(plain);
  const b = await scenario(seen);
  assert.deepEqual(journalOf(seen, b.id).map((l) => ({ ...l, id: l.id })), journalOf(plain, a.id).map((l) => ({ ...l, id: l.id })), "not one journal line differs, and none was added");
  assert.equal(seen.w.view(b.id).revision, plain.w.view(a.id).revision);
  assert.deepEqual(seen.w.view(b.id).receipts.map((r) => [r.domain, r.ref, r.outcome]), plain.w.view(a.id).receipts.map((r) => [r.domain, r.ref, r.outcome]));
  assert.deepEqual(seen.w.view(b.id).verification, plain.w.view(a.id).verification);
  assert.equal(plain.activity.size, 0, "no observer bound, nothing observed");
  assert.ok(seen.activity.size >= 3, "every check action observed in its own file");
});

test("the observation says why each check ran, in the journal's own terms: a baseline before the change, required after it", async (t) => {
  const o = world(t, { script: { "test:web": [fails(TAP_FAIL)] }, observe: {} });
  const s = await scenario(o);
  const startOf = (action) => o.activityLines(action)[0];
  const baselineAct = o.w.view(s.id).actions.find((a) => a.type === "test").id;
  assert.match(startOf(baselineAct).why, /^baseline: how it does on the base revision/);
  assert.match(startOf(s.tested.action).why, /^required: the change reaches c:web \(modified/);
  assert.deepEqual(startOf(s.tested.action).command, { id: C.webTest.id, purpose: "test", component: "c:web", declaredAs: "test:web", program: "npm" }, "never the argument list: the program's own name only");
  assert.equal(startOf(s.tested.action).authority, "observation");
  assert.equal(startOf(s.tested.action).check, `chk-${s.tested.action.slice(4)}`);
});

test("the check's record keeps the bounded observation, the host's answer carries it, and the receipt's word is still the check's", async (t) => {
  const o = world(t, { script: { "test:web": [fails(TAP_FAIL)] }, observe: {} });
  const s = await scenario(o);
  const record = o.roomOf(s.id).read(`checks/chk-${s.tested.action.slice(4)}`);
  assert.deepEqual([record.observation.adapter.id, record.observation.counts.failed, record.observation.total], ["tap", 1, 1]);
  assert.deepEqual(record.observation.failures.map((f) => [f.name, f.category]), [["refund form rejects an amount over what was paid", "assertion"]]);
  assert.equal(s.tested.data.observation.counts.failed, 1);
  assert.equal(s.tested.outcome, "failed", "the step's outcome is the receipt's, from the exit");
  assert.ok(["failed", "failed-as-before"].includes(o.w.view(s.id).receipts.find((r) => r.ref === `chk-${s.tested.action.slice(4)}`).outcome));
});

test("failed exactly as before is decided on the same output with an observer as without -- the observer adds nothing to it", async (t) => {
  for (const observe of [undefined, {}]) {
    const o = world(t, { script: { "test:web": [fails(TAP_FAIL)] }, observe });
    const s = await scenario(o);
    const plan = contextOf(o.ports, s.id).verificationPlan.required.find((c) => c.id === C.webTest.id);
    assert.deepEqual([plan.state, plan.baseline], ["failed-as-before", "failed"], observe ? "observed" : "unobserved");
  }
});

test("an observer that cannot be made, or that breaks, changes nothing about the check", async (t) => {
  const plain = world(t, { script: { "test:web": [fails(TAP_FAIL)] } });
  const broken = world(t, { script: { "test:web": [fails(TAP_FAIL)] }, observe: { throws: true } });
  const a = await scenario(plain);
  const b = await scenario(broken);
  assert.deepEqual(journalOf(broken, b.id), journalOf(plain, a.id));
  assert.equal(broken.activity.size, 0);
  assert.equal(b.tested.data.observation, null, "no observation, said as none");
  const chunky = world(t, { script: { "test:web": [{ ...fails(TAP_FAIL), chunks: [["out", TAP_FAIL.slice(0, 40)], ["out", TAP_FAIL.slice(40)]] }] }, observe: {} });
  const c = await scenario(chunky);
  assert.deepEqual(journalOf(chunky, c.id), journalOf(plain, a.id), "the output in two chunks: the same check, the same journal");
  assert.equal(c.tested.data.observation.counts.failed, 1, "the line cut by the chunk boundary was read whole");
});

test("the tree a check ran on is named only after the run settled: an edit while the awaited run is still going leaves it with no tree", async (t) => {
  const o = world(t, { observe: {} });
  const run = o.ports.checks.run;
  o.ports.checks.run = async (command, at) => {
    const r = await run(command, at);
    await new Promise((resolve) => setImmediate(resolve));
    o.ws.edit("web/src/written-while-the-tests-ran.ts");
    return r;
  };
  const { id, go } = await prepared(o);
  const planned = await go({ kind: "plan", intent: "a web change", scope: ["web/src/RefundForm.tsx"] });
  for (const c of planned.data.verificationPlan.required) await go({ kind: "check", command: c.id });
  const test = contextOf(o.ports, id).verificationPlan.required.find((c) => c.id === C.webTest.id);
  assert.equal(test.baseline, "none", "a run the workspace moved under is no baseline");
  assert.ok(o.w.view(id).receipts.filter((r) => r.domain === "check").every((r) => !r.sourceTree), "no receipt names a tree for it");
});

test("a passing observed check: every case the runner reported, no gap, and the record says complete", async (t) => {
  const TAP_PASS = "TAP version 13\n# Subtest: a\nok 1 - a\n# Subtest: b\nok 2 - b\n1..2\n# tests 2\n# pass 2\n# fail 0\n";
  const o = world(t, { script: { "test:web": [passes(TAP_PASS)] }, observe: {} });
  const s = await scenario(o);
  assert.equal(s.tested.outcome, "succeeded");
  assert.deepEqual([s.tested.data.observation.counts.passed, s.tested.data.observation.complete, s.tested.data.observation.gaps], [2, true, []]);
});
