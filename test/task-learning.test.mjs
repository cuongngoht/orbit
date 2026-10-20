// What a FINISHED engineering task teaches engineering memory (1.8.9, src/engineering/observe/task.mjs and the
// `verified` analyser): a completed task's changed places and the declared checks that passed after its last change,
// through the observer's one untrusted door, once -- and nothing from a task that did not complete, a check that
// failed as before, or an action only reported.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { CHECK_CLASS, TASK_INPUT, learnedFrom, taskInputOf, taskObservation } from "../src/engineering/observe/task.mjs";
import { verified } from "../src/engineering/analyzers/verified.mjs";
import { ANALYZER_NAMES } from "../src/engineering/analyzers/index.mjs";
import { engineeringContext } from "../src/engineering/context.mjs";
import { repositoryPaths } from "../src/project/repository.mjs";
import { RECEIPT_DOMAINS } from "../src/task/vocab.mjs";
import { BUILD, DECLARED, PLAN, TEST, changed, orchestrationWorld, passes, prepared } from "./fakes/orchestration.mjs";
import { sealed } from "./home.mjs";

const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-task-learning-")));
after(() => rmSync(temp, { recursive: true, force: true }));

// A view the way src/task/views.mjs draws one, with only what the mapper reads.
const viewOf = (over = {}) => ({ task: { id: "tsk-0123456789ab", updatedAt: "2026-10-18T05:00:00.000Z" }, lifecycle: "COMPLETED", changes: { paths: [{ path: "src/RefundValidator.cs", change: "modified" }] }, receipts: [{ domain: "check", ref: "chk-7", outcome: "succeeded" }, { domain: "check", ref: "chk-8", outcome: "succeeded" }], verification: [{ subject: BUILD, evidence: "check:chk-7", state: "satisfied" }, { subject: TEST, evidence: "check:chk-8", state: "satisfied" }], ...over });

test("a completed task is observed where it changed, with the declared checks that passed after its last change", () => {
  const o = taskObservation(viewOf(), DECLARED);
  assert.equal(o.operation, "task:tsk-0123456789ab");
  assert.deepEqual(o.scopes, ["src"]);
  assert.deepEqual(o.verified.map((c) => c.id).sort(), [BUILD, TEST].sort());
  assert.deepEqual(o.commands, [{ class: "build", ok: true }, { class: "test", ok: true }]);
  assert.deepEqual(CHECK_CLASS, { build: "build", test: "test", verify: "lint" });
  assert.deepEqual(taskObservation(viewOf({ changes: { paths: [{ path: "validator.js" }] } }), DECLARED).scopes, ["validator.js"], "a top-level file is a place of its own");
});

test("nothing it did not prove: a failed-as-before check, a reported action, a task that did not complete, a change with no place", () => {
  const asBefore = viewOf({ receipts: [{ domain: "check", ref: "chk-8", outcome: "failed-as-before" }], verification: [{ subject: TEST, evidence: "check:chk-8", state: "satisfied" }] });
  assert.deepEqual(taskObservation(asBefore, DECLARED).verified, [], "settled, never a pass");
  const reported = viewOf({ receipts: [], verification: [{ subject: TEST, evidence: null, state: "not-verified" }] });
  assert.deepEqual(taskObservation(reported, DECLARED).verified, []);
  for (const lifecycle of ["FAILED", "CANCELLED", "EXECUTING"]) {
    assert.equal(taskObservation(viewOf({ lifecycle }), DECLARED), null, lifecycle);
    assert.match(taskInputOf(viewOf({ lifecycle })).say, /teaches nothing/);
  }
  assert.equal(taskObservation(viewOf({ changes: { paths: [] } }), DECLARED), null);
  assert.equal(TASK_INPUT.at(-1).when({}), true, "the last row always answers");
});

test("the verified analyser proposes `observed` at most, about a declared check, and nothing without both a check and a place", () => {
  const out = verified({ verified: [{ purpose: "test", component: "node:.", declaredAs: "test" }], verifiedScopes: ["src"] });
  assert.equal(out.candidates.length, 1);
  const c = out.candidates[0];
  assert.deepEqual([c.kind, c.key, c.strength, c.source], ["workflow", "verified-by-test-node-test", "observed", "test-suite"]);
  assert.deepEqual([c.scope, c.evidence], [["src"], ["src"]]);
  assert.ok(c.unknowns.some((u) => /rules are adopted, not observed/.test(u)));
  assert.deepEqual(verified({ verified: [], verifiedScopes: ["src"] }).candidates, []);
  assert.deepEqual(verified({ verified: [{ purpose: "test", component: "x", declaredAs: "t" }], verifiedScopes: [] }).candidates, []);
  assert.ok(ANALYZER_NAMES.includes("verified"));
  assert.ok(RECEIPT_DOMAINS.includes("learning"), "the task's receipt of what it taught has a domain of its own");
});

// The primary checkout: the change's place is tracked there, so a fact may cite it.
function primary(name) {
  const dir = join(temp, name);
  for (const f of ["src/RefundValidator.cs", "test/RefundTests.cs", "README.md"]) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), "//\n");
  }
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "init"]);
  return dir;
}

function engineeringOver(dir) {
  const env = sealed({ ORBIT_STORE_DIR: join(temp, `${basename(dir)}-store`) });
  const ctx = engineeringContext({ project: repositoryPaths(dir, env), config: { frontend: { roots: [] } } }, env);
  return { ...ctx, now: () => "2026-10-18T06:00:00.000Z", gates: () => new Set() };
}

test("a task the orchestrator completed teaches a fact through reconciliation, once -- a second finish adds nothing", async (t) => {
  const o = orchestrationWorld(t, { script: { test: [passes("2 passed")] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  await go({ kind: "check", command: TEST });
  assert.equal((await go({ kind: "review" })).lifecycle, "COMPLETED");
  const ctx = engineeringOver(primary("completed"));
  const receipt = learnedFrom(ctx, o.w.view(id), DECLARED);
  assert.deepEqual([receipt.domain, receipt.ref, receipt.outcome], ["learning", `task:${id}`, "OBSERVED"]);
  assert.match(receipt.summary, /kept \(observed at most\), 0 refused/);
  const fact = ctx.eng.all().find((f) => f.key === "verified-by-test-node-test");
  assert.ok(fact, "the declared test that passed after the change");
  assert.deepEqual([fact.strength, fact.confidence], ["observed", "possible"], "one task is one session: possible, and never stronger than observed");
  const journal = ctx.eng.observations().length;
  learnedFrom(ctx, o.w.view(id), DECLARED);
  assert.equal(ctx.eng.observations().length, journal, "the same task finished twice is a replay: no line, no support");
});

test("a task that did not complete teaches nothing, and its receipt says why", () => {
  const ctx = engineeringOver(primary("failed"));
  const receipt = learnedFrom(ctx, viewOf({ lifecycle: "FAILED" }), DECLARED);
  assert.deepEqual([receipt.domain, receipt.outcome], ["learning", "NOTHING"]);
  assert.match(receipt.summary, /a change nobody verified teaches nothing/);
  assert.deepEqual(ctx.eng.all(), []);
});
