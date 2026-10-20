// A DECLARED PLAYBOOK, RUN by the engine (0.0.4, src/automation/skill-run.mjs): its steps asked through the doors
// that already exist -- a project capability's pipeline, a managed server's broker -- with the provider the resolver
// picks at the moment a step runs, one output bound into the next step, every call a receipt in the coordinator's own
// journal, and nothing called VERIFIED that an owner's record does not prove. The task door, the factory, the
// registry, the resolver, the pipeline and the broker are the real ones (test/fakes/skill-run.mjs); only what answers
// on the far end is made up.
import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile } from "../src/automation/loop.mjs";
import { runIdOf } from "../src/automation/skill-run.mjs";
import { recentActivity } from "../src/mcp/activity.mjs";
import { listOf } from "../src/skill-factory/lifecycle.mjs";
import { apply } from "../src/task/ops.mjs";
import { contextOf, next, start } from "./fakes/automation.mjs";
import { again, crashed, declared, evidenceCapability, eventsOf, notesServer, receiptsOf, skillWorld, spec, workflowOf } from "./fakes/skill-run.mjs";

// The workflow taken to its playbook step: started, the context step settled, the playbook step run.
async function ran(s, over = {}) {
  const st = start(s.ports, { ...spec, ...over });
  await next(s, st.task);
  const r = await next(s, st.task);
  return { id: st.task, r };
}

const stepWord = (s, id, step) => receiptsOf(s, id, "skillstep").find((r) => r.ref === `${runIdOf(id, "playbook")}.${step}`)?.outcome ?? null;

const runWord = (s, id) => receiptsOf(s, id, "skillrun").at(-1)?.outcome ?? null;

test("AC-06: a declared playbook's two steps are asked through the capability pipeline and the MCP broker, each by its resolved provider", async (t) => {
  const s = skillWorld(t);
  assert.equal((await declared(s)).ok, true);
  const { id } = await ran(s);
  assert.deepEqual(s.calls.map((c) => c.provider), ["acme:acme.evidence", "managed:corp"].map((k) => (k.startsWith("acme") ? s.resolve("release.evidence.read").provider.key : k)));
  assert.equal(s.evidence.asked.length, 1, "the project capability was asked once, through its pipeline");
  const invoked = recentActivity(s.mcp.io, s.mcp.rooms).find((l) => l.kind === "mcp-invoked");
  assert.deepEqual([invoked.tool, invoked.capability, invoked.workflow, invoked.operation], ["search", "release.notes.search", "orbit-help", "read"], "the broker logged the call, for its capability, under the coordinator's workflow");
  const calls = eventsOf(s, id, "invocation");
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.outcome, "OK");
    assert.match(c.queryDigest, /^[0-9a-f]{64}$/);
    assert.match(c.resultDigest, /^[0-9a-f]{64}$/);
    assert.equal(c.operation, "read");
  }
  assert.deepEqual(calls.map((c) => c.providerKey), [s.resolve("release.evidence.read").provider.key, "managed:corp"]);
});

test("AC-07: what one step answered is bound into the next by its declared output, and the answer itself is never kept", async (t) => {
  const s = skillWorld(t, { evidence: evidenceCapability({ items: ["REL-42", "REL-43"] }) });
  await declared(s);
  const { id } = await ran(s);
  assert.deepEqual(s.evidence.asked, [{ q: "Check the release is ready" }], "the first step read the workflow's objective");
  assert.deepEqual(s.server.calls.map((c) => c.arguments), [{ query: "REL-42" }], "the second step was asked with the first one's `first` output");
  const journal = JSON.stringify(s.ports.task.events(id));
  assert.equal(journal.includes("notes for REL-42"), false, "the server's answer never reached the journal");
  assert.equal(journal.includes("REL-43"), false, "nor the capability's");
});

test("AC-08: calls that answered and met their contracts, with no owner's record, are REPORTED -- never VERIFIED", async (t) => {
  const s = skillWorld(t);
  await declared(s);
  const { id, r } = await ran(s);
  assert.deepEqual([stepWord(s, id, "evidence"), stepWord(s, id, "notes")], ["CONTRACT_MET", "CONTRACT_MET"]);
  assert.equal(runWord(s, id), "REPORTED");
  assert.equal(r.stepState, "reported", "the plan step is reported, not succeeded");
  const v = s.w.view(id).verification.find((x) => x.subject === "step:playbook");
  assert.equal(v.state, "not-verified");
  assert.equal(s.w.view(id).verification.some((x) => x.state === "satisfied"), false);
});

test("an owner-record step is VERIFIED only by a record its owner proves, and the run is VERIFIED only when every required step is", async (t) => {
  const s = skillWorld(t, { evidence: evidenceCapability({ record: "investigation:inv-20261020-101500-ab12" }) });
  await declared(s, { wf: workflowOf({ evidence: { outputs: { count: { type: "number", path: "count" }, first: { type: "string", path: "first" }, proof: { type: "record", path: "record" } }, evidence: "owner-record" }, notes: { required: false } }) });
  const st = start(s.ports, spec);
  s.state.investigations.set("inv-20261020-101500-ab12", { lifecycle: "completed", ended: true, reason: "nothing failed", findings: 2, defects: 0, task: st.task });
  await next(s, st.task);
  const r = await next(s, st.task);
  assert.equal(stepWord(s, st.task, "evidence"), "VERIFIED");
  assert.ok(s.w.view(st.task).verification.some((v) => v.subject === `skillstep:${runIdOf(st.task, "playbook")}.evidence` && v.state === "satisfied" && v.evidence === "investigation:inv-20261020-101500-ab12"));
  assert.equal(runWord(s, st.task), "VERIFIED");
  assert.equal(r.stepState, "succeeded");
  assert.equal(s.w.view(st.task).verification.find((x) => x.subject === "step:playbook").state, "satisfied");
});

test("a record the workflow cannot read back proves nothing: the step stays a met contract", async (t) => {
  const s = skillWorld(t, { evidence: evidenceCapability({ record: "investigation:inv-20261020-101500-ab12" }) });
  await declared(s, { wf: workflowOf({ evidence: { outputs: { count: { type: "number", path: "count" }, first: { type: "string", path: "first" }, proof: { type: "record", path: "record" } }, evidence: "owner-record" } }) });
  s.state.investigations.set("inv-20261020-101500-ab12", { lifecycle: "completed", ended: true, findings: 0, defects: 0, task: "tsk-999999999999" });
  const { id } = await ran(s);
  assert.equal(stepWord(s, id, "evidence"), "CONTRACT_MET", "another workflow's investigation is not this one's proof");
  assert.equal(runWord(s, id), "REPORTED");
});

test("AC-10: a provider switched off after the plan was made blocks the playbook step before anything is asked", async (t) => {
  const s = skillWorld(t);
  await declared(s);
  const st = start(s.ports, spec);
  await next(s, st.task);
  s.disable("corp");
  const r = await next(s, st.task);
  assert.equal(r.state, "blocked", "the playbook needs what nothing may serve now: the resolver says so before it runs");
  assert.match(r.say, /release\.notes\.search is unmet/);
  assert.deepEqual([s.evidence.asked.length, s.server.calls.length], [0, 0], "nothing was asked");
  assert.equal(receiptsOf(s, st.task, "skillrun").length, 0, "no run was opened");
  assert.equal(s.w.view(st.task).lifecycle, "BLOCKED");
});

test("AC-10: a provider switched off WHILE a run goes on blocks its step at the moment that step runs", async (t) => {
  const ev = evidenceCapability();
  const first = ev.cap.invoke;
  const box = {};
  ev.cap.invoke = (ext, input) => (box.s.disable("corp"), first(ext, input));
  const s = (box.s = skillWorld(t, { evidence: ev }));
  await declared(s);
  const { id, r } = await ran(s);
  assert.equal(stepWord(s, id, "evidence"), "CONTRACT_MET");
  assert.equal(stepWord(s, id, "notes"), "BLOCKED");
  assert.match(receiptsOf(s, id, "skillstep").find((x) => x.ref.endsWith(".notes")).summary, /^TOOL_UNAVAILABLE/);
  assert.deepEqual(s.server.calls, [], "the switched-off server was never asked");
  assert.equal(runWord(s, id), "BLOCKED");
  assert.equal(r.stepState, "blocked");
  assert.equal(s.w.view(id).lifecycle, "BLOCKED");
});

test("AC-10: a step a person must allow waits for a grant of exactly that action; a grant that expired allows nothing", async (t) => {
  const s = skillWorld(t);
  await declared(s, { wf: workflowOf({ notes: { approval: "owner" } }) });
  const st = start(s.ports, spec);
  await next(s, st.task);
  await next(s, st.task);
  assert.equal(stepWord(s, st.task, "notes"), "BLOCKED");
  const asked = s.w.view(st.task).approvals.find((a) => a.open);
  assert.ok(asked, "an approval was asked for the step");
  assert.deepEqual(s.server.calls, []);
  apply({ ...s.w.ctx, door: null }, st.task, "approval-expire", { approval: asked.id });
  await next(s, st.task);
  assert.deepEqual(s.server.calls, [], "an expired grant let nothing through");
  const fresh = s.w.view(st.task).approvals.find((a) => a.open);
  assert.ok(fresh && fresh.id !== asked.id, "a new request was made for the same action");
  apply({ ...s.w.ctx, door: "control" }, st.task, "approve", { approval: fresh.id, expected: s.w.view(st.task).revision, human: true });
  await next(s, st.task);
  assert.equal(s.server.calls.length, 1, "the granted action ran, once");
  assert.equal(s.w.view(st.task).approvals.find((a) => a.id === fresh.id).state, "consumed");
  assert.equal(stepWord(s, st.task, "notes"), "CONTRACT_MET");
});

test("AC-11: a run keeps the version it pinned, whatever is registered while it waits", async (t) => {
  const s = skillWorld(t);
  const v1 = await declared(s, { wf: workflowOf({ notes: { approval: "owner" } }) });
  const st = start(s.ports, spec);
  await next(s, st.task);
  await next(s, st.task);
  const v2 = await declared(s, { wf: workflowOf({ notes: { approval: "owner" } }), text: `${(await import("./fakes/skill-run.mjs")).SKILL_MD}\nA second version.\n`, values: again(s) });
  assert.equal(v2.ok, true);
  assert.notEqual(v2.pin, v1.pin);
  assert.equal(listOf(s.factory.store)[0].version, "0.1.1", "the second version is the one in place");
  apply({ ...s.w.ctx, door: "control" }, st.task, "approve", { approval: s.w.view(st.task).approvals.find((a) => a.open).id, expected: s.w.view(st.task).revision, human: true });
  await next(s, st.task);
  const runs = eventsOf(s, st.task, "skillrun");
  assert.deepEqual([...new Set(runs.map((r) => r.pin))], [v1.pin], "every line of the run names the first version");
  assert.equal(runWord(s, st.task), "REPORTED");
  assert.deepEqual(eventsOf(s, st.task, "skill").map((r) => [r.ref, r.outcome]), [[v1.pin, "REUSED"]], "pinned once, never re-pinned");
});

test("a write tool is refused by the broker before it is sent: a declared workflow reads only", async (t) => {
  const s = skillWorld(t);
  await declared(s, { wf: workflowOf({ notes: { tool: "publish" } }) });
  const { id, r } = await ran(s);
  assert.equal(stepWord(s, id, "notes"), "REFUSED");
  assert.match(receiptsOf(s, id, "skillstep").find((x) => x.ref.endsWith(".notes")).summary, /reading only/);
  assert.deepEqual(s.server.calls, [], "publish was never called");
  assert.equal(runWord(s, id), "FAILED");
  assert.equal(r.stepState, "failed");
});

test("a call that failed is asked again within its retries; a required step that never answers fails the run, and later steps never run", async (t) => {
  let n = 0;
  const flaky = evidenceCapability();
  const first = flaky.cap.invoke;
  flaky.cap.invoke = (ext, input) => ((n += 1) === 1 ? (() => { throw new Error("evidence store busy"); })() : first(ext, input));
  const s = skillWorld(t, { evidence: flaky });
  await declared(s, { wf: workflowOf({ evidence: { retries: 1 } }) });
  const { id } = await ran(s);
  const calls = eventsOf(s, id, "invocation").filter((c) => c.ref.includes(".evidence."));
  assert.deepEqual(calls.map((c) => c.outcome), ["BLOCKED", "OK"], "asked again once, after the failure");
  assert.equal(stepWord(s, id, "evidence"), "CONTRACT_MET");
  const broken = skillWorld(t, { evidence: evidenceCapability({ fail: new Error("down") }) });
  await declared(broken);
  const down = await ran(broken);
  assert.equal(stepWord(broken, down.id, "evidence"), "BLOCKED");
  assert.equal(stepWord(broken, down.id, "notes"), null, "a step after a required failure is never asked");
  assert.deepEqual(broken.server.calls, []);
});

test("an optional step that does not answer is recorded and the run goes on; one its contract fails stops nothing it does not hold", async (t) => {
  const s = skillWorld(t, { server: notesServer({ reply: () => ({ hits: [] }) }) });
  await declared(s, { wf: workflowOf({ notes: { required: false } }) });
  const { id, r } = await ran(s);
  assert.equal(stepWord(s, id, "notes"), "VERIFY_FAILED");
  assert.match(receiptsOf(s, id, "skillstep").find((x) => x.ref.endsWith(".notes")).summary, /^optional —/);
  assert.equal(runWord(s, id), "REPORTED");
  assert.equal(r.stepState, "reported");
});

test("the task's action budget holds every step: a step past it is blocked, never started", async (t) => {
  const s = skillWorld(t);
  await declared(s);
  const { id } = await ran(s, { actions: 3 });
  assert.equal(stepWord(s, id, "evidence"), "CONTRACT_MET");
  assert.equal(stepWord(s, id, "notes"), "BLOCKED");
  assert.match(receiptsOf(s, id, "skillstep").find((x) => x.ref.endsWith(".notes")).summary, /^BUDGET/);
  assert.deepEqual(s.server.calls, []);
});

// ---- AC-12: an interrupted run ------------------------------------------------------------------------

// A run left open the way a killed process leaves it: its call never answers, and the process that ran it is gone.
async function interrupted(t, { settings, wf = workflowOf({ notes: { timeoutMs: 120000 } }) } = {}) {
  const s = skillWorld(t, { server: notesServer({ hang: true }), settings });
  await declared(s, { wf });
  const st = start(s.ports, spec);
  await next(s, st.task);
  next(s, st.task).catch(() => null);
  for (let i = 0; i < 400 && stepWord(s, st.task, "notes") !== "RUNNING"; i += 1) await new Promise((r) => setTimeout(r, 5));
  return { s: crashed(s), id: st.task };
}

test("AC-12: reconcile closes an interrupted run's open step as INTERRUPTED -- it read -- and never runs it again by itself", async (t) => {
  const { s, id } = await interrupted(t);
  assert.equal(stepWord(s, id, "notes"), "RUNNING");
  const r = await reconcile(s.ports, id);
  assert.equal(r.settled.length, 2, "the playbook step's engine action and its open step");
  assert.equal(stepWord(s, id, "notes"), "INTERRUPTED");
  assert.equal(stepWord(s, id, "evidence"), "CONTRACT_MET", "what was settled before stays settled");
  assert.equal(runWord(s, id), "INTERRUPTED");
  assert.equal(s.w.view(id).actions.filter((a) => a.state === "running").length, 0);
  assert.equal(s.server.calls.length, 1, "the call that hung was sent once, and nothing was resent");
  assert.equal(s.w.view(id).lifecycle, "FAILED", "with no retry left for a playbook step, the workflow ends -- it is never run again by itself");
});

test("AC-12: the next attempt of an interrupted run keeps what settled, asks a read again, and never asks again what may have written", async (t) => {
  const wf = workflowOf({ notes: { timeoutMs: 120000 }, more: [{ id: "archive", capability: "release.notes.search", tool: "search", after: ["notes"], input: { query: { value: "archive" } }, outputs: { hits: { type: "count", path: "hits" } } }] });
  const { s, id } = await interrupted(t, { settings: { execution: { retries: { playbook: 1 } } }, wf });
  const run = runIdOf(id, "playbook");
  const writing = s.ports.task.apply(id, "act-start", { type: "skill.step", tool: "corp", label: `${run}.archive: release.notes.search`, mutates: true }).lines.at(-1).id;
  s.ports.task.apply(id, "link-receipt", { domain: "skillstep", ref: `${run}.archive`, outcome: "RUNNING", action: writing });
  await reconcile(s.ports, id);
  assert.deepEqual([stepWord(s, id, "notes"), stepWord(s, id, "archive")], ["INTERRUPTED", "AMBIGUOUS"], "a step that may have written is ambiguous, never merely interrupted");
  assert.deepEqual(contextOf(s.ports, id).ready, ["playbook"], "the playbook step was planned again after the interruption");
  s.server.state.hang = false;
  s.server.calls.length = 0;
  s.evidence.asked.length = 0;
  const r = await next(s, id);
  assert.equal(s.evidence.asked.length, 1, "a settled read is asked again only because a later step reads its outputs");
  assert.deepEqual(s.server.calls.map((c) => c.arguments.query), ["REL-7"], "the interrupted read is asked again, once; the ambiguous step never");
  assert.equal(stepWord(s, id, "notes"), "CONTRACT_MET");
  assert.equal(stepWord(s, id, "archive"), "AMBIGUOUS");
  assert.equal(runWord(s, id), "BLOCKED", "a person decides what an ambiguous step did");
  assert.equal(r.stepState, "blocked");
  assert.equal(eventsOf(s, id, "skillrun").filter((x) => x.outcome === "RUNNING").length, 2, "the same run, resumed: one RUNNING line per attempt");
});
