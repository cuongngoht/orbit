// A CHANGE'S QA STEP IS NEVER LEFT OUT SILENTLY (0.5.0, backlog B1, ADR 0053). A coordinated workflow that makes a change
// always plans its QA step. Where something the checkout declares can be started, the step is the host's: an
// investigation of the running change. Where nothing can, the engine settles it SKIPPED and says why -- never passed,
// never a verification satisfied, and never a step the plan simply leaves out, so a change is never reported tested by a
// step nobody saw. The step answer, the workflow's context and its ending say it, and so does Orbit Live's plan.
// An investigation's QA is the work itself, and is never skipped.
import assert from "node:assert/strict";
import { test } from "node:test";
import { planFor } from "../src/automation/loop.mjs";
import { planRows } from "../src/live/tui/plan-view.mjs";
import { automationWorld, childEnds, contextOf, next, outcome, settle, start } from "./fakes/automation.mjs";

const SAID = /nothing this checkout declares can be started.*skipped, not passed/;

// The workflow taken to its QA step's turn: context, runtime, then the engineering task completed through its own door
// and settled on its own record.
async function toQa(o, id) {
  for (const s of ["context", "runtime"]) await next(o, id, { step: s });
  const eng = await next(o, id, { step: "engineering" });
  const child = /(tsk-[a-f0-9]{12})/.exec(eng.how.invoke)[1];
  childEnds(o, child);
  await settle(o.ports, id, outcome(eng, { evidenceRefs: [`task:${child}`] }));
  return child;
}

test("a change on a checkout with nothing to start still plans its QA step, waiting for the change", (t) => {
  const o = automationWorld(t, { startable: [] });
  const r = start(o.ports, { objective: "Implement the refund validation rule" });
  assert.deepEqual(r.plan.steps.map((s) => s.id), ["context", "runtime", "engineering", "qa", "regression", "review"]);
  assert.deepEqual(r.plan.steps.find((s) => s.id === "qa").after, ["context", "runtime", "engineering"]);
  assert.deepEqual(r.plan.steps.find((s) => s.id === "review").after, ["qa", "regression"], "review waits for the QA step, skipped or not");
  assert.match(planFor(o.ports, { objective: "Implement the refund validation rule" }).facts.missing.find((m) => m.what === "startable").say, /SKIPPED, saying why/);
});

test("with nothing to start, the engine SKIPS the change's QA step and says why; the workflow still completes", async (t) => {
  const o = automationWorld(t, { startable: [] });
  const id = start(o.ports, { objective: "Implement the refund validation rule" }).task;
  await toQa(o, id);
  assert.ok(contextOf(o.ports, id).ready.includes("qa"));
  const qa = await next(o, id, { step: "qa" });
  assert.equal(qa.stepState, "skipped");
  assert.match(qa.summary, SAID);
  assert.equal(qa.how, undefined, "no host is handed a QA step there is nothing to run for");
  const step = contextOf(o.ports, id).plan.steps.find((s) => s.id === "qa");
  assert.deepEqual([step.state, SAID.test(step.summary)], ["skipped", true]);
  const v = o.w.view(id).verification.find((x) => x.subject === "step:qa");
  assert.equal(v.state, "not-verified", "a skipped QA step verifies nothing");
  for (const s of ["regression", "review"]) assert.equal((await next(o, id, { step: s })).stepState, "succeeded");
  const view = o.w.view(id);
  assert.equal(view.lifecycle, "COMPLETED");
  assert.match(view.ended.because ?? view.ended.summary ?? JSON.stringify(view.ended), /qa skipped/, "the ending names the skipped step");
});

test("a host's word never skips a QA step: only the engine does, and only with nothing to start", async (t) => {
  const o = automationWorld(t, { startable: ["web"] });
  const id = start(o.ports, { objective: "Implement the refund validation rule" }).task;
  await toQa(o, id);
  const qa = await next(o, id, { step: "qa" });
  assert.equal(qa.mode, "agent", "something can be started: the QA step is the host's investigation");
  await assert.rejects(settle(o.ports, id, outcome(qa, { evidenceRefs: [] })), (e) => e.code === "EVIDENCE_REQUIRED");
  assert.equal(contextOf(o.ports, id).plan.steps.find((s) => s.id === "qa").state, "running");
});

test("an investigation's QA is the work itself: never skipped, whatever can be started", async (t) => {
  const o = automationWorld(t, { startable: [], intent: "investigation", matched: ["investigation"], requirements: ["qa.investigation"] });
  const id = start(o.ports, { objective: "Investigate why refunds fail" }).task;
  assert.deepEqual(contextOf(o.ports, id).plan.steps.map((s) => s.id), ["context", "qa"]);
  await next(o, id, { step: "context" });
  const qa = await next(o, id, { step: "qa" });
  assert.notEqual(qa.stepState, "skipped");
  assert.ok(qa.how, "the investigation is handed to the host");
});

const text = (rows) => rows.map((r) => [...r.left, ...r.right].map((s) => s.text).join("")).join("\n");

test("Orbit Live's plan says a skipped step was skipped, and why", () => {
  const because = "nothing this checkout declares can be started here, so there is no running change to investigate: QA was skipped, not passed";
  const plan = { n: 1, workflow: "engineering", steps: [{ id: "engineering", kind: "engineering", after: [], because: "the change itself" }, { id: "qa", kind: "qa", after: ["engineering"], because: "the running change is investigated against the objective" }] };
  const view = { task: { provider: "automation" }, receipts: [{ domain: "step", ref: "engineering", outcome: "SUCCEEDED" }, { domain: "step", ref: "qa", outcome: "SKIPPED", summary: because }] };
  const drawn = text(planRows({ d: { root: { view, plan, events: [], skills: {} } } }));
  assert.match(drawn, /qa.*nothing this checkout declares can be started.*SKIPPED/);
});
