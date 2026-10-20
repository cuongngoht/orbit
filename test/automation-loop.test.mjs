// The coordinator's loop over a REAL task journal: a workflow planned from facts, each step decided by the
// host, run through its owner or handed to the host, settled ONLY on evidence its owner keeps, retried by
// the engine's own rules, and completed when every step is done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { automationWorld, childEnds, contextOf, decided, next, outcome, settle, start, step } from "./fakes/automation.mjs";

const SPEC = { objective: "Implement PBI-482 refund validation and test it until it passes", ref: "PBI-482" };

const receipts = (o, id, domain) => o.w.view(id).receipts.filter((r) => r.domain === domain);

async function begun(t, opts = {}) {
  const o = automationWorld(t, opts);
  const r = start(o.ports, SPEC);
  return { o, id: r.task, r };
}

test("start plans the engineering workflow from the facts, writes the plan before its receipt, and opens one attempt", async (t) => {
  const { o, id, r } = await begun(t);
  assert.equal(r.created, true);
  assert.deepEqual(r.plan.steps.map((s) => s.id), ["requirement", "context", "runtime", "engineering", "qa", "regression", "review"]);
  assert.deepEqual(o.w.kinds(id), ["created", "receipt", "attempt-started"]);
  const plan = receipts(o, id, "plan")[0];
  assert.equal(plan.outcome, "ACTIVE");
  assert.deepEqual(o.room(id).get(`plans/${plan.ref}`).steps.map((s) => s.id), r.plan.steps.map((s) => s.id), "the receipt names an artifact that exists");
  assert.equal(o.w.view(id).task.provider, "automation");
  assert.equal(o.w.view(id).task.work, null, "a coordinator holds no work, so its child may");
  assert.deepEqual(contextOf(o.ports, id).ready, ["requirement", "context"], "a graph: what waits for nothing is ready at once, and the host picks");
  assert.deepEqual(r.plan.steps.find((s) => s.id === "review").after, ["qa", "regression"], "review waits for both checks of the change");
});

test("a step's conditions come from the facts: no QA without something startable, no requirement step without a reference", (t) => {
  const o = automationWorld(t, { startable: [] });
  const r = start(o.ports, { objective: "Implement the refund validation rule" });
  assert.deepEqual(r.plan.steps.map((s) => s.id), ["context", "runtime", "engineering", "regression", "review"]);
});

test("a fresh install starts with no settings at all; a kept restriction (off, manual, planning) starts nothing", (t) => {
  const fresh = automationWorld(t, { settings: {} });
  assert.equal(start(fresh.ports, SPEC).created, true, "nothing to turn on");
  for (const settings of [{ enabled: false }, { mode: "manual" }, { enabled: false, mode: "autonomous" }, { enabled: true, mode: "manual" }]) {
    const o = automationWorld(t, { settings });
    assert.throws(() => start(o.ports, SPEC), (e) => e.code === "AUTOMATION_SETTINGS_INVALID");
    assert.deepEqual(o.w.tasks.list(), []);
  }
  const o = automationWorld(t, { settings: { mode: "planning" } });
  assert.throws(() => start(o.ports, SPEC), (e) => e.code === "AUTOMATION_SETTINGS_INVALID");
});

test("an objective no workflow coordinates is refused with nothing written", (t) => {
  const o = automationWorld(t, { intent: "mcp-tooling", matched: ["mcp-tooling"], requirements: ["mcp.management"] });
  assert.throws(() => start(o.ports, { objective: "add the github MCP server" }), (e) => e.code === "NOTHING_TO_COORDINATE");
  assert.deepEqual(o.w.tasks.list(), []);
});

test("Scenario A: existing skills only, every step settled on its owner's evidence, then COMPLETED", async (t) => {
  const { o, id } = await begun(t, { investigations: { "inv-20261008-aa11": { lifecycle: "completed", ended: true, reason: "goal-reached", findings: 4, defects: 0 } } });
  const req = await next(o, id);
  assert.equal(req.stepState, "succeeded", "a snapshot no question blocks is read back by the engine");
  assert.equal((await next(o, id)).stepState, "reported", "project context is reported, never proven");
  assert.equal((await next(o, id)).stepState, "succeeded");
  const eng = await next(o, id);
  assert.equal(eng.mode, "agent");
  assert.equal(eng.how.provider.id, "orbit-engineering-agent");
  const child = receipts(o, id, "task")[0].ref;
  assert.match(eng.how.invoke, new RegExp(`resume ${child}`));
  childEnds(o, child, "complete");
  const settled = await settle(o.ports, id, outcome(eng, { evidenceRefs: [`task:${child}`] }));
  assert.equal(settled.stepState, "succeeded");
  o.state.investigations.get("inv-20261008-aa11").task = child;
  const qa = await next(o, id);
  assert.equal(qa.how.provider.id, "orbit-qa-agent");
  assert.equal((await settle(o.ports, id, outcome(qa, { evidenceRefs: ["investigation:inv-20261008-aa11"] }))).stepState, "succeeded");
  assert.equal((await next(o, id)).stepState, "succeeded");
  const last = await next(o, id);
  assert.equal(last.lifecycle, "COMPLETED");
  const v = o.w.view(id);
  assert.deepEqual(v.verification.filter((x) => x.state === "satisfied").map((x) => x.subject).sort(), ["step:engineering", "step:qa", "step:regression", "step:requirement", "step:review", "step:runtime"]);
  assert.ok(!/\/(Users|tmp|home|private)\/|[A-Z]:\\|node \S+\.mjs|--[a-z]/.test(o.w.text(id)), "the journal holds no path and no command line");
});

test("a host's word never satisfies a step: a child still running is refused, and a strict step with nothing readable is refused", async (t) => {
  const { o, id } = await begun(t);
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const eng = await next(o, id);
  const child = receipts(o, id, "task")[0].ref;
  const revision = o.w.view(id).revision;
  await assert.rejects(settle(o.ports, id, outcome(eng, { evidenceRefs: [`task:${child}`] })), (e) => e.code === "STILL_RUNNING");
  await assert.rejects(settle(o.ports, id, outcome(eng, { evidenceRefs: [] })), (e) => e.code === "EVIDENCE_REQUIRED");
  await assert.rejects(settle(o.ports, id, outcome(eng, { evidenceRefs: ["task:tsk-000000000000"] })), (e) => e.code === "EVIDENCE_REQUIRED");
  assert.equal(o.w.view(id).revision, revision, "a refused settle writes nothing");
});

test("a forged success is refused by name before anything is read", async (t) => {
  const { o, id } = await begun(t);
  const req = await next(o, id);
  for (const word of ["outcome", "verdict", "satisfied", "approved", "stage"]) {
    await assert.rejects(settle(o.ports, id, { ...outcome(req), [word]: "succeeded" }), (e) => e.code === "FORBIDDEN");
    await assert.rejects(step(o.ports, id, { ...decided("context", o.w.view(id).revision), [word]: true }), (e) => e.code === "FORBIDDEN");
  }
});

test("only a ready step runs: one whose predecessor is not done is refused, and nothing is written", async (t) => {
  const { o, id } = await begun(t);
  const revision = o.w.view(id).revision;
  await assert.rejects(step(o.ports, id, decided("engineering", revision)), (e) => e.code === "READY");
  await assert.rejects(step(o.ports, id, decided("deploy", revision)), (e) => e.code === "STEP");
  await assert.rejects(step(o.ports, id, decided("requirement", revision - 1)), (e) => e.code === "STALE");
  assert.equal(o.w.view(id).revision, revision);
});

test("the same decision delivered twice runs once: replayed, or AMBIGUOUS for an engine step that never settled, or refused when reused", async (t) => {
  const { o, id } = await begun(t);
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const eng = await next(o, id);
  const before = o.w.view(id).revision;
  const again = await step(o.ports, id, eng.decision);
  assert.equal(again.state, "replayed");
  assert.equal(o.w.view(id).revision, before, "nothing ran twice");
  await assert.rejects(step(o.ports, id, { ...eng.decision, action: { kind: "run", step: "qa" } }), (e) => e.code === "ID_REUSED");
  assert.equal(o.state.children.length, 1, "one child, however often the decision arrives");
});

test("a child that FAILED fails the step on its own journal's word, and the engine plans it again with a new attempt", async (t) => {
  const { o, id } = await begun(t);
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const eng = await next(o, id);
  const child = receipts(o, id, "task")[0].ref;
  childEnds(o, child, "fail");
  const r = await settle(o.ports, id, outcome(eng, { executionState: "succeeded", evidenceRefs: [`task:${child}`] }));
  assert.equal(r.plan, "plan-2", "a failed step with a retry left is planned again");
  assert.equal(r.stepState, "pending");
  const v = o.w.view(id);
  assert.deepEqual(receipts(o, id, "plan").map((p) => p.outcome), ["SUPERSEDED", "ACTIVE"]);
  assert.equal(v.attempts.at(-2).outcome, "failed");
  assert.match(v.attempts.at(-2).failureSignature, /^[a-f0-9]{12}$/);
  assert.equal(v.attempts.at(-1).cause, "fix");
  assert.deepEqual(contextOf(o.ports, id).ready, ["engineering"]);
  const again = await next(o, id);
  assert.notEqual(receipts(o, id, "task").at(-1).ref, child, "a new child: the old one ended");
  childEnds(o, receipts(o, id, "task").at(-1).ref, "fail");
  const end = await settle(o.ports, id, outcome(again, { evidenceRefs: [`task:${receipts(o, id, "task").at(-1).ref}`] }));
  assert.equal(end.lifecycle, "FAILED", "no retry left: the workflow fails");
  assert.equal(o.w.view(id).stopReason, "VERIFICATION_FAILED");
});

test("a QA finding sends the workflow back to engineering, not to QA", async (t) => {
  const { o, id } = await begun(t, { investigations: { "inv-20261008-bb22": { lifecycle: "completed", ended: true, reason: "goal-reached", findings: 2, defects: 1 } } });
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const eng = await next(o, id);
  const child = receipts(o, id, "task")[0].ref;
  childEnds(o, child, "complete");
  await settle(o.ports, id, outcome(eng, { evidenceRefs: [`task:${child}`] }));
  o.state.investigations.get("inv-20261008-bb22").task = child;
  const qa = await next(o, id);
  const r = await settle(o.ports, id, outcome(qa, { evidenceRefs: ["investigation:inv-20261008-bb22"] }));
  assert.equal(r.plan, "plan-2");
  assert.deepEqual(contextOf(o.ports, id).ready, ["engineering"]);
});

test("a blocked child blocks the workflow naming who it waits for, and only that step runs again", async (t) => {
  const { o, id } = await begun(t);
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const eng = await next(o, id);
  const child = receipts(o, id, "task")[0].ref;
  childEnds(o, child, "block");
  await settle(o.ports, id, outcome(eng, { evidenceRefs: [`task:${child}`] }));
  const v = o.w.view(id);
  assert.equal(v.lifecycle, "BLOCKED");
  assert.equal(v.blocked.needs, "person");
  assert.deepEqual(contextOf(o.ports, id).ready, ["engineering"]);
  o.w.op(child, "unblock", { because: "a person trusted the sandbox" });
  const again = await next(o, id);
  assert.equal(o.w.view(id).lifecycle !== "BLOCKED", true, "running the blocked step again unblocks the workflow");
  assert.equal(again.how.provider.id, "orbit-engineering-agent");
  assert.equal(o.state.children.length, 1, "the same child is picked up, not a second one");
});

test("a switched-off provider blocks the step, says which switch, and nothing replaces it", async (t) => {
  const { o, id } = await begun(t, { resolved: { "engineering.execution": { capability: "engineering.execution", outcome: "gap", remedy: "enable", status: "missing", provider: { kind: "skill", id: "orbit-engineer", key: "orbit-engineer", ownership: "plugin" }, why: "orbit-engineering-agent could provide it, but is not usable here (switched off in the plugin settings)" } } });
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const r = await next(o, id);
  assert.equal(r.state, "blocked");
  assert.match(r.say, /switched off/);
  assert.match(r.say, /nothing is generated/);
  assert.equal(o.state.children.length, 0, "no child started past the switch");
  assert.equal(o.w.view(id).lifecycle, "BLOCKED");
});

test("supervised mode asks a person before a skill runs, and the grant is spent on exactly that step", async (t) => {
  const { o, id } = await begun(t, { resourceApproval: true });
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const asked = await next(o, id);
  assert.equal(asked.state, "waiting-approval");
  assert.equal(o.w.view(id).lifecycle, "WAITING_APPROVAL");
  assert.equal(o.state.children.length, 0);
  const revision = o.w.view(id).revision;
  await assert.rejects(step(o.ports, id, decided("engineering", revision)), (e) => e.code === "WAITING");
});

test("budget: actions spent stop the workflow with BUDGET_EXHAUSTED instead of the step asked for", async (t) => {
  const o = automationWorld(t);
  const id = start(o.ports, { ...SPEC, actions: 2 }).task;
  await next(o, id);
  const second = await next(o, id);
  assert.equal(second.lifecycle, "FAILED", "the step that spent the last action settles, then the budget stop is written");
  assert.equal(o.w.view(id).stopReason, "BUDGET_EXHAUSTED");
  await assert.rejects(next(o, id), (e) => e.code === "ENDED");
});

test("starting the same objective while it runs picks the running workflow up", async (t) => {
  const { o, id } = await begun(t);
  const again = start(o.ports, SPEC);
  assert.equal(again.task, id);
  assert.equal(again.resumed, true);
  assert.equal(o.w.tasks.list().length, 1);
});

// ---- a person's grant, and recovery after a crash ---------------------------------------------------

import { apply } from "../src/task/ops.mjs";
import { reconcile } from "../src/automation/loop.mjs";

test("a grant only Control's door gives allows exactly the step it was asked for, once", async (t) => {
  const { o, id } = await begun(t, { resourceApproval: true });
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const asked = await next(o, id);
  assert.throws(() => o.w.op(id, "approve", { approval: asked.approval, expected: o.w.view(id).revision, human: true }), /PERSON|Control/, "a terminal cannot grant");
  apply({ ...o.w.ctx, door: "control" }, id, "approve", { approval: asked.approval, expected: o.w.view(id).revision, human: true });
  const r = await next(o, id, { decision: { approval: asked.approval } });
  assert.equal(r.mode, "agent");
  assert.equal(o.state.children.length, 1);
  assert.equal(o.w.view(id).approvals[0].state, "consumed");
});

test("reconcile reads a host step back from its owner: a child that ended settles it, one still running is left alone", async (t) => {
  const { o, id } = await begun(t);
  for (let i = 0; i < 3; i += 1) await next(o, id);
  await next(o, id);
  const child = receipts(o, id, "task")[0].ref;
  await assert.rejects(reconcile(o.ports, id), (e) => e.code === "STILL_RUNNING", "the child still runs: nothing to reconcile");
  childEnds(o, child, "complete");
  const r = await reconcile(o.ports, id);
  assert.equal(r.settled[0].settled, "settle");
  assert.deepEqual(contextOf(o.ports, id).ready, ["qa", "regression"], "both wait only for the engineering step");
  assert.equal(o.state.children.length, 1, "nothing was started again");
});

test("reconcile closes a host step its own session left with no evidence as interrupted, never re-running it", async (t) => {
  const { o, id } = await begun(t, { requirement: { latest: null }, settings: {} });
  const req = await next(o, id);
  assert.equal(req.mode, "skill", "no snapshot yet: the host runs orbit-requirements");
  const r = await reconcile(o.ports, id);
  assert.equal(r.settled[0].settled, "interrupted");
  const v = o.w.view(id);
  assert.equal(v.actions[0].state, "error");
  assert.equal(v.receipts.find((x) => x.key === "step:requirement").outcome, "FAILED");
});

test("an engine step whose process is gone is closed as interrupted; one still alive is left alone", async (t) => {
  const { o, id } = await begun(t);
  const revision = o.w.view(id).revision;
  o.ports.requirements.look = () => { throw new Error("crash"); };
  o.ports.task.apply(id, "decide", { observed: "a", hypothesis: "b", nextAction: "step.requirement", ref: "d-crash" });
  const act = o.ports.task.apply(id, "act-start", { type: "engine.run", tool: "requirement" }).lines[0].id;
  o.ports.task.apply(id, "link-receipt", { domain: "step", ref: "requirement", outcome: "RUNNING", action: act });
  o.ports.roomOf(id).write("running", { action: act, step: "requirement", mode: "engine", host: "laptop-a", pid: 1 });
  o.state.liveness = true;
  await assert.rejects(reconcile(o.ports, id), (e) => e.code === "STILL_RUNNING");
  await assert.rejects(step(o.ports, id, { ...decided("requirement", o.w.view(id).revision), decisionId: "d-crash" }), (e) => e.code === "AMBIGUOUS");
  o.state.liveness = false;
  assert.equal((await reconcile(o.ports, id)).settled[0].settled, "interrupted");
  assert.ok(o.w.view(id).revision > revision);
});

test("evidence is this workflow's own: another workflow's completed task, an unrelated investigation or a foreign draft proves nothing", async (t) => {
  const { o, id } = await begun(t, { investigations: { "inv-20261008-cc33": { lifecycle: "completed", ended: true, reason: "goal-reached", findings: 0, defects: 0, task: "tsk-999999999999" } } });
  const other = o.w.create({ objective: "an unrelated change", provider: "autonomous-engineering" });
  childEnds(o, other, "complete");
  for (let i = 0; i < 3; i += 1) await next(o, id);
  const eng = await next(o, id);
  await assert.rejects(settle(o.ports, id, outcome(eng, { evidenceRefs: [`task:${other}`] })), (e) => e.code === "EVIDENCE_REQUIRED", "a completed task this workflow did not start");
  const child = receipts(o, id, "task")[0].ref;
  childEnds(o, child, "complete");
  await settle(o.ports, id, outcome(eng, { evidenceRefs: [`task:${child}`] }));
  const qa = await next(o, id);
  await assert.rejects(settle(o.ports, id, outcome(qa, { evidenceRefs: ["investigation:inv-20261008-cc33"] })), (e) => e.code === "EVIDENCE_REQUIRED", "an investigation of another task");
  assert.equal(o.w.view(id).receipts.find((r) => r.key === "step:qa").outcome, "RUNNING");
});

test("project context is reported in its own word, never as understood because sections came back; one that could not be gathered here fails its step", async (t) => {
  const partial = await begun(t, { contextStatus: { word: "PARTIAL", because: "3 of 6 known; unknown: knowledge, work, working-set", summary: "PARTIAL: 3 of 6 known; unknown: knowledge, work, working-set" } });
  await next(partial.o, partial.id);
  const reported = await next(partial.o, partial.id);
  assert.equal(reported.step, "context");
  assert.equal(reported.stepState, "reported", "advisory, never proven");
  assert.equal(reported.summary, "PARTIAL: 3 of 6 known; unknown: knowledge, work, working-set", "the receipt says how much is known, and what is not");
  const blocked = await begun(t, { contextStatus: { word: "BLOCKED", because: "architecture could not answer here — locked by another session", summary: "BLOCKED: architecture could not answer here — locked by another session" } });
  await next(blocked.o, blocked.id);
  const failed = await next(blocked.o, blocked.id);
  assert.equal(failed.step, "context");
  assert.notEqual(failed.stepState, "reported");
  assert.notEqual(failed.stepState, "succeeded");
  const action = blocked.o.w.view(blocked.id).actions.find((a) => a.tool === "context");
  assert.equal(action.state, "failed", "a context that could not be gathered here fails, and the engine plans it again within its retries");
  assert.match(action.summary, /could not answer here/, "and the action says why, in the context command's own words");
});
