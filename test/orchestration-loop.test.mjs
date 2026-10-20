// The loop end to end, through the REAL task write door: a requirement taken to a verified change,
// a failure diagnosed and fixed, a regression that re-enters the repair loop, a loop that makes no
// progress, a spent budget, a requirement that moves under a running task, and a person's pause in
// the middle of a check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/task/ops.mjs";
import { contextOf, finish, resume, start, step } from "../src/orchestration/loop.mjs";
import { BUILD, DECLARED, FAILING, PLAN, TEST, TEST_API, changed, decided, fails, orchestrationWorld, passes, prepared, stagesOf } from "./fakes/orchestration.mjs";

test("PBI-482: requirement → snapshot → work → task → workspace → change → build → a failing test → DIAGNOSING → FIXING → attempt 2 → passing → regression → review → COMPLETED", async (t) => {
  const o = orchestrationWorld(t, { script: { test: [FAILING, passes("2 passed")] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  await changed(o, go);
  assert.equal((await go({ kind: "check", command: BUILD })).outcome, "succeeded");
  const failed = await go({ kind: "check", command: TEST });
  assert.deepEqual([failed.outcome, failed.stage, failed.failure.class], ["failed", "DIAGNOSING", "TEST"]);
  assert.match(failed.failure.signature, /^[a-f0-9]{12}$/);
  assert.ok(failed.data.excerpt.some((l) => l.includes("rejects_amount_over_paid")), "the host sees what failed");
  await go({ kind: "diagnose", then: "fix" }, { observed: "the over-paid case is accepted", hypothesis: "the validator ignores the paid amount" });
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  const passed = await go({ kind: "check", command: TEST });
  assert.equal(passed.stage, "REVIEWING", "one test command: targeted and regression are the same run");
  const reviewed = await go({ kind: "review" });
  assert.equal(reviewed.lifecycle, "COMPLETED");
  const view = o.w.view(id);
  assert.deepEqual(stagesOf(o.w, id), ["REQUIREMENT", "CONTEXT", "ENVIRONMENT", "WORKSPACE", "PLANNING", "IMPLEMENTING", "BUILDING", "TESTING", "DIAGNOSING", "FIXING", "BUILDING", "TESTING", "REGRESSION", "REVIEWING"]);
  assert.deepEqual(view.attempts.map((a) => [a.cause, a.outcome]), [["fresh", "failed"], ["fix", "succeeded"]]);
  assert.equal(view.attempts[0].failureSignature, failed.failure.signature);
  assert.deepEqual([view.task.work, view.task.root, view.task.snapshot, view.task.baseRevision.length, view.task.workspace], ["w-0123456789ab", "req-0123456789ab", "rs-0123456789ab", 40, `ws-${id.slice(4)}`]);
  assert.deepEqual(view.verification.map((v) => v.state).sort(), ["satisfied", "satisfied"]);
  assert.ok(view.actions.filter((a) => ["build", "test"].includes(a.type)).every((a) => a.evidence === "receipt"), "every check is evidenced by a receipt, never only reported");
});

test("the journal of a whole run keeps no command line, no output, no absolute path and no environment value", async (t) => {
  const o = orchestrationWorld(t, { script: { test: [FAILING, passes()] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  await go({ kind: "check", command: TEST });
  const text = o.w.text(id);
  for (const leak of ["npm", "run build", "rejects_amount_over_paid", "Expected:", o.dir, "/bin", "s3cr3t-value", "argv", "stdout", "stderr"]) assert.ok(!text.includes(leak), `the journal holds ${leak}`);
  assert.ok(o.process.calls.every((c) => Array.isArray(c.args) && c.opts.shell === undefined), "argv only");
  assert.deepEqual(Object.keys(o.process.calls[0].opts.env).sort(), ["HOME", "PATH"], "a check gets what a child needs to start, not the environment's secrets");
});

test("a regression failure re-enters the repair loop, and REVIEWING waits for every test the change is held to since the last change", async (t) => {
  const declared = [...DECLARED, { id: TEST_API, purpose: "test", component: "node:api", declaredAs: "test", argv: ["npm", "run", "test:api"], cwd: "api" }];
  const o = orchestrationWorld(t, { declared, dependsOn: { "node:api": ["node:."] }, script: { test: [passes()], "test:api": [fails("FAIL api contract changed"), passes()] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  assert.equal((await go({ kind: "check", command: TEST })).stage, "REGRESSION", "a targeted test passed; another is still owed");
  const broke = await go({ kind: "check", command: TEST_API });
  assert.deepEqual([broke.outcome, broke.stage], ["failed", "DIAGNOSING"]);
  await go({ kind: "diagnose", then: "fix" });
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  assert.equal((await go({ kind: "check", command: TEST })).stage, "REGRESSION");
  assert.deepEqual(contextOf(o.ports, id).checks.filter((c) => c.owed).map((c) => c.id), [TEST_API], "what passed before the last change is owed again");
  assert.equal((await go({ kind: "check", command: TEST_API })).stage, "REVIEWING");
});

test("two builds the change reaches: BUILDING waits for both since the last change, and the context says which is owed", async (t) => {
  const API_BUILD = "rt-command-0000b01e";
  const declared = [...DECLARED, { id: API_BUILD, purpose: "build", component: "node:api", declaredAs: "build", argv: ["npm", "run", "build:api"], cwd: "api" }];
  const o = orchestrationWorld(t, { declared, dependsOn: { "node:api": ["node:."] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  await changed(o, go);
  assert.equal((await go({ kind: "check", command: BUILD })).stage, "BUILDING");
  assert.deepEqual(contextOf(o.ports, id).checks.filter((c) => c.owed && c.purpose === "build").map((c) => c.id), [API_BUILD]);
  assert.equal((await go({ kind: "check", command: API_BUILD })).stage, "TESTING");
});

test("NO_PROGRESS: the same failure three attempts in a row fails the task, and says why", async (t) => {
  const o = orchestrationWorld(t, { script: { test: [FAILING] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  let last = null;
  for (let i = 0; i < 3; i++) {
    await changed(o, go);
    await go({ kind: "check", command: BUILD });
    last = await go({ kind: "check", command: TEST });
    if (i < 2) await go({ kind: "diagnose", then: "fix" });
  }
  const view = o.w.view(id);
  assert.deepEqual([last.lifecycle, view.stopReason, view.repeats], ["FAILED", "NO_PROGRESS", 3]);
  assert.match(view.ended.because, /3 attempts .* one failure/);
  await assert.rejects(go({ kind: "diagnose", then: "fix" }), /ENDED/);
});

test("a DIFFERENT failure resets the count: progress is a new signature, not a new edit", async (t) => {
  const o = orchestrationWorld(t, { script: { test: [FAILING, FAILING, fails("FAIL RefundTests.accepts_amount_within_paid"), FAILING] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  for (let i = 0; i < 4; i++) {
    await changed(o, go);
    await go({ kind: "check", command: BUILD });
    await go({ kind: "check", command: TEST });
    if (i < 3) await go({ kind: "diagnose", then: "fix" });
  }
  assert.deepEqual([o.w.view(id).lifecycle, o.w.view(id).repeats], ["EXECUTING", 1]);
});

test("a spent attempt budget ends the task BUDGET_EXHAUSTED when the next step would need another attempt -- never a hidden extra one", async (t) => {
  const o = orchestrationWorld(t, { script: { test: [FAILING] } });
  const { id, go } = await prepared(o, { ref: "PBI-482", attempts: 1 });
  await go(PLAN);
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  const out = await go({ kind: "check", command: TEST });
  assert.deepEqual([out.lifecycle, o.w.view(id).stopReason, o.w.view(id).budget.attempts.limit], ["FAILED", "BUDGET_EXHAUSTED", 1]);
});

test("a spent action budget ends the task the moment its last action settles: nothing more could start", async (t) => {
  const o = orchestrationWorld(t);
  const id = (await start(o.ports, { ref: "PBI-482", actions: 2 })).task;
  const out = await step(o.ports, id, decided(o.ports, id, { kind: "gather-context" }));
  assert.deepEqual([out.outcome, out.lifecycle, o.w.view(id).stopReason, o.w.view(id).budget.actions.spent], ["succeeded", "FAILED", "BUDGET_EXHAUSTED", 2]);
  await assert.rejects(step(o.ports, id, decided(o.ports, id, { kind: "check-environment" })), /ENDED/);
});

test("a time budget that ran out while nobody stepped: the next step writes the stop instead of running anything", async (t) => {
  const o = orchestrationWorld(t);
  const id = (await start(o.ports, { ref: "PBI-482", minutes: 5 })).task;
  o.w.tick(6);
  const out = await step(o.ports, id, decided(o.ports, id, { kind: "gather-context" }));
  assert.deepEqual([out.state, out.stop, o.w.view(id).stopReason, o.calls.context], ["stopped", "budget", "BUDGET_EXHAUSTED", 0]);
});

test("an ad-hoc objective starts at CONTEXT with no requirement, and a second start of one work picks the running task up", async (t) => {
  const o = orchestrationWorld(t);
  const adhoc = await start(o.ports, { objective: "tidy the refund messages" });
  assert.deepEqual([adhoc.context.stage, adhoc.context.task.root, adhoc.context.requirement.ok], ["CONTEXT", null, true]);
  const first = await start(o.ports, { ref: "PBI-482" });
  const again = await start(o.ports, { ref: "PBI-482" });
  assert.deepEqual([again.created, again.resumed, again.task], [false, true, first.task]);
  assert.equal(resume(o.ports, "PBI-482").task, first.task);
});

test("a requirement with a blocking question stops at REQUIREMENT: the task is blocked, and nothing but a recheck may run", async (t) => {
  const o = orchestrationWorld(t, { requirement: { open: [{ id: "rq-0123456789ab", blocking: true }] } });
  const id = (await start(o.ports, { ref: "PBI-482" })).task;
  const c = contextOf(o.ports, id);
  assert.deepEqual([c.lifecycle, c.blocked.stop, c.blocked.needs, c.allowed], ["BLOCKED", "REQUIREMENT_BLOCKED", "requirement", ["check-requirement"]]);
  await assert.rejects(step(o.ports, id, decided(o.ports, id, { kind: "gather-context" })), /STAGE:.*allows check-requirement/);
  o.requirement.open = [];
  const out = await step(o.ports, id, decided(o.ports, id, { kind: "check-requirement" }));
  assert.deepEqual([out.outcome, out.stage, out.lifecycle], ["succeeded", "CONTEXT", "PREPARING"]);
});

test("a requirement that MOVES under a running task blocks it -- the newer snapshot is never adopted silently", async (t) => {
  const o = orchestrationWorld(t);
  const { id, go } = await prepared(o);
  o.requirement.latest = { id: "rs-0123456789ff", digest: "b".repeat(64) };
  const out = await go(PLAN);
  assert.deepEqual([out.state, out.stop], ["stopped", "requirement-moved"]);
  const view = o.w.view(id);
  assert.deepEqual([view.lifecycle, view.blocked.stop, view.task.snapshot], ["BLOCKED", "REQUIREMENT_BLOCKED", "rs-0123456789ab"]);
  assert.match(view.blocked.because, /newer snapshot rs-0123456789ff/);
  const recheck = await go({ kind: "check-requirement" });
  assert.deepEqual([recheck.outcome, o.w.view(id).lifecycle], ["failed", "BLOCKED"], "still the old snapshot: still blocked");
});

test("a person pauses DURING a check: the check's result is recorded, its moves wait, and the next step after a person resumes applies them", async (t) => {
  const o = orchestrationWorld(t, { script: { build: [passes()] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  await changed(o, go);
  const answer = o.process.run;
  o.process.run = (...a) => (apply(o.w.ctx, id, "pause", { human: true, expected: o.w.view(id).revision, because: "lunch" }), answer(...a));
  const ran = await go({ kind: "check", command: BUILD });
  o.process.run = answer;
  assert.deepEqual([ran.outcome, ran.lifecycle, ran.stage], ["succeeded", "PAUSED", "BUILDING"], "recorded, not moved");
  assert.ok(o.roomOf(id).read("pending"), "the moves are kept");
  await assert.rejects(go({ kind: "gather-context" }), /PAUSED/);
  assert.throws(() => apply(o.w.ctx, id, "resume", { human: true, expected: o.w.view(id).revision }), /PERSON_UNPROVEN/, "an agent cannot resume a task a person paused");
  apply({ ...o.w.ctx, door: "control" }, id, "resume", { human: true, expected: o.w.view(id).revision });
  assert.match(contextOf(o.ports, id).next, /held back is applied by the next step/);
  const caught = await go({ kind: "check", command: TEST });
  assert.deepEqual([caught.state, o.w.view(id).stage], ["caught-up", "TESTING"], "the held-back move first -- and the host decides again on the stage it now sees");
  assert.equal(o.roomOf(id).read("pending"), null);
  assert.equal((await go({ kind: "check", command: TEST })).stage, "REVIEWING");
});

test("finish completes only what the journal proves, and otherwise refuses with what is unmet -- or ends with a stop the evidence supports", async (t) => {
  const o = orchestrationWorld(t, { script: { test: [FAILING] } });
  const { id, go } = await prepared(o);
  await go(PLAN);
  await assert.rejects(finish(o.ports, id), /NOT_COMPLETE: the task has reached REVIEWING/);
  await assert.rejects(finish(o.ports, id, { stop: "UNSAFE_CHANGE" }), /STOP: UNSAFE_CHANGE needs a review that found/);
  await changed(o, go);
  await go({ kind: "check", command: BUILD });
  await go({ kind: "check", command: TEST });
  const out = await finish(o.ports, id, { stop: "VERIFICATION_FAILED", because: "the fix needs a person" });
  assert.deepEqual([out.state, o.w.view(id).lifecycle, o.w.view(id).stopReason], ["failed", "FAILED", "VERIFICATION_FAILED"]);
});

test("gather-context reports the context command's own word, never a count taken for understanding; a BLOCKED context fails the action and the task stays where it is", async (t) => {
  const said = { word: "PARTIAL", because: "3 of 6 known; unknown: knowledge, work, working-set", summary: "PARTIAL: 3 of 6 known; unknown: knowledge, work, working-set" };
  const partial = orchestrationWorld(t, { contextStatus: said });
  const p = (await start(partial.ports, { ref: "PBI-482" })).task;
  const reported = await step(partial.ports, p, decided(partial.ports, p, { kind: "gather-context" }));
  assert.equal(reported.outcome, "succeeded");
  assert.equal(reported.summary, said.summary, "the action says how much is known, and what is not");
  assert.equal(reported.data.status.word, "PARTIAL");
  assert.equal(partial.w.view(p).stage, "ENVIRONMENT");
  const blocked = orchestrationWorld(t, { contextStatus: { word: "BLOCKED", because: "architecture could not answer here — locked by another session", summary: "BLOCKED: architecture could not answer here — locked by another session" } });
  const b = (await start(blocked.ports, { ref: "PBI-482" })).task;
  const out = await step(blocked.ports, b, decided(blocked.ports, b, { kind: "gather-context" }));
  assert.equal(out.outcome, "failed");
  assert.match(out.summary, /^BLOCKED: architecture could not answer here/);
  assert.equal(blocked.w.view(b).stage, "CONTEXT", "nothing moves on a context nobody could gather");
});
