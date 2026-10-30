// What self-improvement must NEVER do (0.3.0, ADR 0045), on the same real world as the end-to-end test: promote a
// candidate that is worse, weakens what counts as a pass or asks for more than its parent had; move what runs past a
// person's switch or behind a stale read; keep a regressed version running; or run anything twice after a crash.
import assert from "node:assert/strict";
import { test } from "node:test";
import { advance, analyseNow, person, step } from "../src/improvement/loop.mjs";
import { modelOf, phaseOf } from "../src/improvement/model.mjs";
import { record } from "../src/improvement/ops.mjs";
import { BROKEN, FIXED, brokenHistory, coordinated, improvementWorld } from "./fakes/improvement.mjs";
import { SKILL_ID, notesServer, workflowOf } from "./fakes/skill-run.mjs";

const campaignIn = (w) => w.store.list()[0];

const modelIn = (w, id) => modelOf(w.store.read(id));

const put = (w, wf) => w.factory.put({ id: SKILL_ID, name: "workflow.json", text: JSON.stringify(wf, null, 2) });

async function detected(w, opts) {
  const h = await brokenHistory(w, opts);
  await analyseNow(w.imp, {});
  return { ...h, id: campaignIn(w) };
}

// Two independent sessions of evaluation, ending wherever the gates send it.
async function evaluatedTwice(w, id) {
  await advance(w.imp, id);
  w.state.session = "sess-B";
  return advance(w.imp, id);
}

async function promoted(w) {
  const d = await detected(w);
  put(w, FIXED());
  await evaluatedTwice(w, d.id);
  return { ...d, candidate: modelIn(w, d.id).promoted.to };
}

test("a candidate that newly fails a step the baseline met is WORSE: rejected, never chosen, and the same candidate is never evaluated again", async (t) => {
  const w = improvementWorld(t);
  const { v1, id } = await detected(w);
  put(w, workflowOf({ evidence: { outputs: { count: { type: "number", path: "nowhere" }, first: { type: "string", path: "first" } } } }));
  await advance(w.imp, id);
  const m = modelIn(w, id);
  assert.equal(m.evaluations[0].settled.verdict, "WORSE");
  assert.deepEqual(m.evaluations[0].settled.regressions, ["evidence"]);
  assert.deepEqual([m.ended.outcome, m.rejected.reason], ["candidate-rejected", "EVALUATED_WORSE"]);
  assert.equal(w.factory.current(SKILL_ID).pin, v1.pin, "nothing moved");
  w.w.tick(48 * 60);
  await analyseNow(w.imp, {});
  assert.equal(w.store.list().length, 1, "cooling down: no new campaign on the same playbook so soon");
});

test("a candidate that loosens a success rule, drops a required step or retypes what a rule reads is refused before it runs", async (t) => {
  const cases = [
    [workflowOf({ notes: { outputs: { hits: { type: "count", path: "hits" } }, success: [{ output: "hits", op: "gte", value: 0 }] } }), /RULE_LOOSENED/],
    [workflowOf({ notes: { outputs: { hits: { type: "count", path: "hits" } }, success: [] } }), /RULE_REMOVED/],
    [workflowOf({ notes: { required: false } }), /REQUIRED_DROPPED/],
    [workflowOf({ notes: { outputs: { hits: { type: "number", path: "hits" } } } }), /OUTPUT_RETYPED/],
  ];
  for (const [wf, why] of cases) {
    const w = improvementWorld(t);
    const { v1, id } = await detected(w);
    put(w, wf);
    await advance(w.imp, id);
    const m = modelIn(w, id);
    assert.equal(m.rejected?.reason, "CAND_ORACLE_WEAKENED", JSON.stringify(m.rejected));
    assert.match(m.rejected.because, why);
    assert.equal(m.evaluations.length, 0, "nothing ran");
    assert.equal(w.factory.current(SKILL_ID).pin, v1.pin);
  }
});

test("a regression after promotion, in two independent sessions, chooses the replaced version again -- and demotes the lesson", async (t) => {
  const box = { shape: "hits" };
  const w = improvementWorld(t, { server: notesServer({ reply: (args) => ({ [box.shape]: [{ title: `notes for ${args.query}` }] }) }) });
  const { v1, id, candidate } = await promoted(w);
  box.shape = "results";
  w.w.tick(24 * 60);
  await coordinated(w, "After the change, the notes moved (1)");
  w.w.tick(24 * 60);
  await coordinated(w, "After the change, the notes moved (2)");
  await advance(w.imp, id);
  const m = modelIn(w, id);
  assert.equal(m.regression?.sessions, 2, JSON.stringify(m.observations));
  assert.deepEqual([m.rolledBack?.from, m.rolledBack?.to], [candidate, v1.pin]);
  assert.equal(m.ended.outcome, "regression-detected");
  assert.equal(w.factory.current(SKILL_ID).pin, v1.pin, "new work runs the replaced version again");
  assert.equal(w.factory.pinned(candidate).loadable, true, "a task that pinned the candidate still reads it");
  assert.ok(w.state.traced.some(([type]) => type === "improvement.rolled_back"));
  await advance(w.imp, id);
  const lesson = w.lessons.all()[0];
  assert.ok(lesson, "the regression is learned");
  assert.notEqual(lesson.state, "validated", "contradicted in as many sessions as supported it, never validated");
  assert.equal(lesson.counters.against, 2);
});

test("with automatic promotion off a qualified candidate waits for a person; a terminal cannot promote it; Orbit Control's door can", async (t) => {
  const w = improvementWorld(t, { improvement: { promote: false } });
  const { id } = await detected(w);
  put(w, FIXED());
  await evaluatedTwice(w, id);
  assert.equal(phaseOf(modelIn(w, id)), "AWAITING_AUTHORITY");
  await assert.rejects(person(w.imp, id, "promote", {}), (e) => e.code === "IMP_DOOR");
  const control = { ...w.imp, ctx: { ...w.imp.ctx, door: "control" } };
  await assert.rejects(person(control, id, "promote", { expected: 1 }), (e) => e.code === "STALE_REVISION", "a person decides on the revision they read");
  const out = await person(control, id, "promote", { expected: modelIn(w, id).position });
  assert.equal(out.did, "PROMOTED");
  const m = modelIn(w, id);
  assert.deepEqual([m.promoted.door, m.promoted.by], ["control", "person"]);
});

test("a person's switch always wins: a disabled playbook blocks promotion until a person moves it back; disabled after promotion, monitoring stops and nothing is undone", async (t) => {
  const w = improvementWorld(t);
  const { id } = await detected(w);
  put(w, FIXED());
  await advance(w.imp, id);
  w.factory.status(SKILL_ID, "disabled");
  w.state.session = "sess-B";
  await advance(w.imp, id);
  const blocked = modelIn(w, id);
  assert.equal(blocked.blocked?.stop, "SUBJECT_WITHHELD", "nothing is evaluated behind a person's switch");
  assert.equal(blocked.evaluations.length, 1, "no evaluation attempt was spent on it");
  assert.equal(w.factory.current(SKILL_ID).status, "disabled");
  w.factory.status(SKILL_ID, "active");
  await advance(w.imp, id);
  const m = modelIn(w, id);
  assert.ok(m.promoted, "promoted once a person moved it back");
  w.factory.status(SKILL_ID, "disabled");
  await advance(w.imp, id);
  assert.equal(modelIn(w, id).ended.outcome, "superseded");
  assert.equal(w.factory.current(SKILL_ID).status, "disabled", "nothing switched it back on");
});

test("a promotion that another door made first is read back, never made twice; a crash between intent and record is read back and asked again", async (t) => {
  const w = improvementWorld(t);
  const { v1, id } = await detected(w);
  put(w, FIXED());
  await advance(w.imp, id);
  const ctx = w.imp.ctx;
  const cand = modelIn(w, id).candidate.pin;
  record({ ...ctx }, id, "qualified", { verdict: "BETTER", sessions: 2, because: "forged for the crash" });
  record({ ...ctx }, id, "promotion-started", { from: v1.pin, to: cand, door: "improvement", eid: `${id}:promote:x` });
  const read = await step(w.imp, id);
  assert.equal(read.did, "READ_BACK");
  assert.equal(phaseOf(modelIn(w, id)), "QUALIFIED", "nothing was chosen: the gates are asked again");
  w.factory.select(SKILL_ID, { pin: cand, expect: v1.pin, door: "control" });
  const again = await step(w.imp, id);
  assert.equal(modelIn(w, id).promoted?.to, cand, JSON.stringify(again));
  assert.equal(w.store.read(id).filter((l) => l.kind === "promoted").length, 1);
});

test("an evaluation a gone process left open is closed as interrupted and resumed with the runs it never recorded -- none twice", async (t) => {
  const w = improvementWorld(t, { improvement: { maxEvaluationMinutes: 1 } });
  const { id } = await detected(w);
  put(w, FIXED());
  await advance(w.imp, id);
  let m = modelIn(w, id);
  const ev = m.evaluations[0];
  assert.equal(ev.settled?.verdict, "BETTER");
  const recorded = ev.runs.length;
  w.state.session = "sess-B";
  w.state.pid = 777;
  const evTask = w.imp.evaluation.create({ objective: "a gone process's evaluation", actions: 50 });
  w.imp.evaluation.apply(evTask, "act-start", { type: "improvement.evaluate", tool: "skill-run", label: "left open", mutates: false });
  record(w.imp.ctx, id, "evaluation-started", { evaluation: "ev2", task: evTask, baseline: m.meta.pin, candidate: m.candidate.pin, inputs: ev.inputs, inputsDigest: ev.inputsDigest, oracleDigest: ev.oracleDigest, isolation: "gated", session: "sess-B", host: "laptop-a", pid: 999, planned: 6, eid: `${id}:ev2:started` });
  w.state.liveness = false;
  await advance(w.imp, id);
  m = modelIn(w, id);
  assert.equal(w.w.view(evTask).actions.filter((a) => a.state === "running").length, 0, "the action left open was closed");
  assert.equal(m.evaluations[1].runs.length, 6);
  assert.equal(new Set(m.evaluations[1].runs.map((r) => r.eid)).size, 6, "every run recorded once");
  assert.equal(recorded, 6);
  assert.ok(m.promoted, "and the campaign went on");
});

test("an evaluation whose candidate's files changed is invalidated, and a candidate a person never wrote is never staged", async (t) => {
  const w = improvementWorld(t);
  const { id } = await detected(w);
  const waiting = await step(w.imp, id);
  assert.equal(waiting.needs, "host");
  assert.equal(modelIn(w, id).candidate, null);
  put(w, FIXED());
  await step(w.imp, id);
  await step(w.imp, id);
  const m = modelIn(w, id);
  const { writeFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(w.factory.store.paths.candidates, SKILL_ID);
  writeFileSync(join(dir, readdirSync(dir)[0], "SKILL.md"), "changed after it was staged\n");
  const out = await step(w.imp, id);
  assert.equal(out.did, "INVALIDATED", JSON.stringify(out));
  assert.ok(m.validated);
});
