// AUTONOMOUS SELF-IMPROVEMENT end to end (0.3.0, ADR 0045), on the REAL declared-playbook world: the task door, the
// skill factory, the resolver, the capability pipeline and the MCP broker are the real ones (test/fakes/skill-run.mjs),
// and so are the improvement store, the coordinator's own skill runner an evaluation runs through, and the learn port.
// Only the far end of a call, the clock and the session are made up.
//
// A playbook a workflow uses keeps answering outside its own declared contract, in independent sessions; Orbit
// OBSERVES it in the coordinators' receipts, DETECTS one opportunity, DIAGNOSES the definition (not the environment),
// PROPOSES the smallest change, has the skill factory GENERATE a successor the host writes, VALIDATES it, EVALUATES it
// against the version it would replace on the same frozen inputs in two independent sessions, PROMOTES it through the
// factory's own door, MONITORS later runs, and LEARNS -- every step a line in its journal.
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseNow, advance, step } from "../src/improvement/loop.mjs";
import { modelOf, phaseOf } from "../src/improvement/model.mjs";
import { IMPROVEMENT_SOURCE } from "../src/improvement/live.mjs";
import { FIXED, brokenHistory, coordinated, improvementWorld } from "./fakes/improvement.mjs";
import { SKILL_ID } from "./fakes/skill-run.mjs";

const campaignIn = (w) => w.store.list()[0];

const phase = (w, id) => phaseOf(modelOf(w.store.read(id)));

const kinds = (w, id) => w.store.read(id).map((l) => l.kind);

// The host writes the successor: the workflow reading the notes' hits where the server puts them, nothing else.
const written = (w) => w.factory.put({ id: SKILL_ID, name: "workflow.json", text: JSON.stringify(FIXED(), null, 2) });

async function toEvaluating(w) {
  const { v1, tasks } = await brokenHistory(w);
  const found = await analyseNow(w.imp, {});
  const id = campaignIn(w);
  written(w);
  const staged = await advance(w.imp, id);
  return { v1, tasks, found, id, staged };
}

test("a recurring contract violation in two sessions is ONE opportunity; the campaign it starts diagnoses the definition and drafts a successor through the factory", async (t) => {
  const w = improvementWorld(t);
  const { v1, tasks } = await brokenHistory(w);
  const dry = await analyseNow(w.imp, { dry: true });
  assert.equal(dry.opportunities.length, 1, "four runs of one problem are one opportunity");
  assert.deepEqual([dry.opportunities[0].signal, dry.opportunities[0].category, dry.opportunities[0].runs, dry.opportunities[0].sessions, dry.opportunities[0].eligible], ["contract-violation", "definition", 4, 2, true]);
  assert.deepEqual(dry.opportunities[0].signature, ["notes"]);
  assert.equal(w.store.list().length, 0, "a dry run writes nothing");
  const found = await analyseNow(w.imp, {});
  assert.equal(found.started.filter((s) => s.created).length, 1);
  const again = await analyseNow(w.imp, {});
  assert.equal(again.started.length, 0, "the same problem detected again starts nothing new");
  assert.equal(w.store.list().length, 1);
  assert.equal(w.store.opportunities().length, 1, "and is still one opportunity");
  const id = campaignIn(w);
  assert.equal(phase(w, id), "GENERATING", "analyse carried it as far as it goes without the host");
  const m = modelOf(w.store.read(id));
  assert.deepEqual([m.diagnosis.cause, m.diagnosis.confidence], ["definition", "high"]);
  assert.equal(m.generating.of, v1.pin);
  const draft = w.factory.successorDraft(SKILL_ID);
  assert.deepEqual([draft.exists, draft.successorOf, draft.campaign, draft.written], [true, v1.pin, id, false]);
  assert.equal(w.factory.current(SKILL_ID).pin, v1.pin, "nothing about what runs has moved");
  const waiting = await step(w.imp, id);
  assert.deepEqual([waiting.did, waiting.needs], ["WAITING", "host"]);
  assert.match(waiting.how, /skill-factory\.mjs put/);
  assert.equal(tasks.length, 4);
});

test("the host's successor is staged as a candidate nobody is offered, validated, and evaluated on the frozen inputs -- one session is never enough", async (t) => {
  const w = improvementWorld(t);
  const { v1, id } = await toEvaluating(w);
  const m = modelOf(w.store.read(id));
  assert.ok(m.candidate && m.validated, "generated and validated");
  assert.notEqual(m.candidate.pin, v1.pin);
  assert.equal(w.factory.current(SKILL_ID).pin, v1.pin, "the candidate is offered to nobody");
  assert.deepEqual(m.candidate.changed, ["workflow.json"]);
  const ev = m.evaluations[0];
  assert.equal(ev.settled.verdict, "BETTER");
  assert.equal(ev.runs.length, 6, "three runs of each version, run n beside run n");
  assert.ok(ev.runs.filter((r) => r.side === "baseline").every((r) => !r.met && r.failing.includes("notes")));
  assert.ok(ev.runs.filter((r) => r.side === "candidate").every((r) => r.met && r.attribution === "RUNTIME_BOUND"));
  assert.equal(phase(w, id), "EVALUATING", "one session's BETTER is an observation");
  const waiting = await step(w.imp, id);
  assert.deepEqual([waiting.needs], ["session"]);
  assert.match(waiting.how, /improve\.mjs evaluate/);
  const evalTask = w.w.view(ev.task);
  assert.equal(evalTask.task.provider, "improvement");
  assert.ok(evalTask.receipts.some((r) => r.domain === "improvement" && r.ref === id), "the evaluation task names its campaign for Live");
  assert.equal(evalTask.lifecycle, "COMPLETED");
});

test("a second independent session qualifies it; the gates hold; the factory's own door promotes it; old pins keep running", async (t) => {
  const w = improvementWorld(t);
  const { v1, id } = await toEvaluating(w);
  const cand = modelOf(w.store.read(id)).candidate.pin;
  w.state.session = "sess-B";
  const steps = await advance(w.imp, id);
  const m = modelOf(w.store.read(id));
  assert.equal(m.evaluations.length, 2);
  assert.equal(m.qualified.verdict, "BETTER");
  assert.ok(m.gates.rows.every((r) => r.holds), JSON.stringify(m.gates.rows));
  assert.deepEqual([m.promoted.from, m.promoted.to, m.promoted.door, m.promoted.by], [v1.pin, cand, "improvement", "improvement"]);
  assert.equal(w.factory.current(SKILL_ID).pin, cand, "new work runs the candidate");
  assert.equal(w.factory.pinned(v1.pin).loadable, true, "a task that pinned the old version still reads it");
  assert.ok(["PROMOTED", "MONITORING"].includes(phase(w, id)));
  assert.ok(steps.at(-1).needs === "session", "it waits for later runs");
  assert.ok(w.state.traced.some(([type]) => type === "improvement.promoted"));
});

test("later runs that hold in two sessions verify the improvement, and the campaign's lesson is learned once", async (t) => {
  const w = improvementWorld(t);
  const { id } = await toEvaluating(w);
  w.state.session = "sess-B";
  await advance(w.imp, id);
  w.w.tick(24 * 60);
  for (const n of [1, 2]) await coordinated(w, `After the change (${n})`);
  w.w.tick(24 * 60);
  await coordinated(w, "After the change (3)");
  const out = await advance(w.imp, id);
  const m = modelOf(w.store.read(id));
  assert.equal(m.ended.outcome, "improvement-verified", JSON.stringify(out));
  assert.equal(phase(w, id), "COMPLETED");
  assert.equal(m.learned.kept, true, m.learned.because);
  assert.match(m.learned.lesson, /^saw--improvement--/);
  assert.equal(w.lessons.all().length, 1);
  await advance(w.imp, id);
  assert.equal(kinds(w, id).filter((k) => k === "learned").length, 1, "taught once");
});

test("Live reads the campaign as one projection and its newest lines as named events -- and writes nothing", async (t) => {
  const w = improvementWorld(t);
  const { id } = await toEvaluating(w);
  const before = w.store.read(id).length;
  const src = IMPROVEMENT_SOURCE.open(w.w.dir, w.io);
  const view = src.read(id);
  assert.equal(view.phase, "EVALUATING");
  assert.equal(view.subject.id, SKILL_ID);
  assert.ok(view.events.some((e) => e.event === "improvement.detected" && e.campaign === id && e.subject === SKILL_ID));
  assert.ok(view.events.some((e) => e.event === "evaluation.completed" && e.verdict === "BETTER"));
  assert.ok(view.events.every((e) => !("because" in e) && !("hypothesis" in e)), "no sentence reaches an event");
  assert.equal(view.evaluations[0].attribution.join(), "RUNTIME_BOUND");
  assert.deepEqual(IMPROVEMENT_SOURCE.campaignsOf(w.w.view(view.evaluations[0].task)), [id]);
  assert.equal(w.store.read(id).length, before);
});
