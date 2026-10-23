// RECOVERY: a worker can die at any point, and reconcile reads every open action back from where it would have left a
// trace -- and NEVER sends it again. A provider "dies" here by never answering: the intent and the lease are on disk,
// exactly as a crash after DISPATCH_INTENT leaves them. Every row also holds the two invariants that matter most: the
// provider is never asked twice for one decision, and a worker that wakes after reconcile closed its action is FENCED
// and writes nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextOf } from "../src/mission/context.mjs";
import { finish } from "../src/mission/finish.mjs";
import { start, step } from "../src/mission/loop.mjs";
import { reconcile } from "../src/mission/reconcile.mjs";
import { STALE_AFTER_MS } from "../src/mission/vocab.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { readLease } from "../src/recovery/lease.mjs";
import { act, explorerRole, intentFor } from "./fakes/flow.mjs";
import { completedTask, decided, runningTask, satelliteWorld } from "./fakes/world.mjs";

const GOAL = "Make the nightly build's retry loop respect the job deadline.";
const TASK = "tsk-0123456789ab";
const IMPLEMENT = { key: "fix", kind: "implement", objective: "make the retry loop end before the job's deadline", acceptanceCriteriaRefs: ["acc-1"] };
const IMPLEMENTER = { unit: "wu-1", responsibilities: [{ activity: "implement", subject: "retry-loop" }], profile: "IMPLEMENT", purpose: "Change the retry loop.", restrictions: ["It edits only inside the engineering task's own workspace."], completionCriteria: ["The task completes on its own verification."] };

// A provider that answers its FIRST call only when the test says so -- the call is out and the worker is "gone" -- and
// every later call at once.
function hung(later) {
  const h = { calls: 0 };
  h.call = () => ((h.calls += 1), h.calls === 1 ? new Promise((resolve) => (h.wake = resolve)) : Promise.resolve(later));
  return h;
}

const journalOf = (w, mission) => worldOf(w, mission).journal.read();

const position = (w, mission) => worldOf(w, mission).m.position;

async function analyzed(w) {
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  return mission;
}

async function staffedImplement(w) {
  const mission = await analyzed(w);
  await act(w, mission, { kind: "plan", units: [IMPLEMENT] });
  await act(w, mission, { kind: "resolve-role", ...IMPLEMENTER });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  return mission;
}

const parked = (w, mission, id, action) => step(w, mission, decided(id, contextOf(w, mission).revision, action));

const RECALL = { kind: "recall", for: "what the project already knows about its nightly build", via: "context" };

test("a read whose worker died is INTERRUPTED; a woken worker is FENCED; only a NEW decision asks again", async () => {
  const h = hung({ ok: true, answer: { text: "asked again" } });
  const w = satelliteWorld({ providers: { context: () => h.call() } });
  const mission = await analyzed(w);
  const zombie = parked(w, mission, "rec-1", RECALL);
  const open = contextOf(w, mission).open[0];
  assert.deepEqual([open.status, Boolean(readLease(w, mission, open.id))], ["INTENT_PERSISTED", true]);
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["INTERRUPTED"]);
  assert.equal(readLease(w, mission, open.id), null);
  const before = position(w, mission);
  h.wake({ ok: true, answer: { text: "too late" } });
  await assert.rejects(zombie, (e) => e.code === "FENCED");
  assert.equal(position(w, mission), before);
  assert.deepEqual([(await step(w, mission, decided("rec-1", before, RECALL))).replay, h.calls], [true, 1]);
  assert.equal((await act(w, mission, RECALL)).outcome, "answered");
  assert.equal(h.calls, 2);
});

test("a worker that still holds its lease is left alone, and settles normally when its provider answers", async () => {
  const h = hung();
  const w = satelliteWorld({ providers: { context: () => h.call() }, liveness: () => true });
  const mission = await analyzed(w);
  const worker = parked(w, mission, "rec-1", RECALL);
  const before = position(w, mission);
  assert.deepEqual([reconcile(w, mission).reconciled.map((r) => r.to), position(w, mission)], [["STILL_RUNNING"], before]);
  h.wake({ ok: true, answer: { text: "the nightly build runs at two" } });
  assert.deepEqual([(await worker).outcome, h.calls], ["answered", 1]);
});

test("a lease on another machine is never judged dead from here, unless it is older than a run may stay open", async () => {
  const h = hung();
  const w = satelliteWorld({ providers: { context: () => h.call() }, liveness: () => null });
  const mission = await analyzed(w);
  parked(w, mission, "rec-1", RECALL);
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["STILL_RUNNING"]);
  w.io.state.nowMs += 2 * STALE_AFTER_MS;
  assert.deepEqual([reconcile(w, mission).reconciled.map((r) => r.to), h.calls], [["INTERRUPTED"], 1]);
});

test("an engineering start whose worker died before any task existed is INTERRUPTED, and the unit is dispatched again", async () => {
  const h = hung({ task: "tsk-bbbbbbbbbbbb", created: true });
  const w = satelliteWorld({ providers: { engineering: { start: () => h.call() } } });
  const mission = await staffedImplement(w);
  const zombie = parked(w, mission, "dsp-1", { kind: "dispatch", unit: "wu-1" });
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["INTERRUPTED"]);
  const view = contextOf(w, mission);
  assert.deepEqual([view.agentRuns[0].outcome, view.units[0].state], ["interrupted", "ready"]);
  h.wake({ task: "tsk-aaaaaaaaaaaa", created: true });
  await assert.rejects(zombie, (e) => e.code === "FENCED");
  const again = await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  assert.deepEqual([again.result.run, again.result.envelope.drive.task, contextOf(w, mission).agentRuns[1].attempt, h.calls], ["arn-2", "tsk-bbbbbbbbbbbb", 2, 2]);
});

test("an engineering start whose worker died after the task existed ADOPTS that one task, and starts no second", async () => {
  const h = hung();
  const w = satelliteWorld({ providers: { engineering: { start: () => h.call() } } });
  const mission = await staffedImplement(w);
  const zombie = parked(w, mission, "dsp-1", { kind: "dispatch", unit: "wu-1" });
  w.state.tasks[TASK] = { ...runningTask(), objective: IMPLEMENT.objective, createdAt: "2099-01-01T00:00:00.000Z" };
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["PROVIDER_ACCEPTED"]);
  const run = contextOf(w, mission).agentRuns[0];
  assert.deepEqual([run.providerRef, contextOf(w, mission).open[0].status], [`task:${TASK}`, "PROVIDER_ACCEPTED"]);
  h.wake({ task: TASK, created: true });
  await assert.rejects(zombie, (e) => e.code === "FENCED");
  assert.equal(h.calls, 1);
});

test("two tasks for one unit since its intent are AMBIGUOUS: nothing is resent, and a replay only answers what was", async () => {
  const h = hung();
  const w = satelliteWorld({ providers: { engineering: { start: () => h.call() } } });
  const mission = await staffedImplement(w);
  parked(w, mission, "dsp-1", { kind: "dispatch", unit: "wu-1" });
  const revision = contextOf(w, mission).revision;
  for (const id of [TASK, "tsk-cccccccccccc"]) w.state.tasks[id] = { ...runningTask(), objective: IMPLEMENT.objective, createdAt: "2099-01-01T00:00:00.000Z" };
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["AMBIGUOUS"]);
  const replay = await step(w, mission, decided("dsp-1", revision, { kind: "dispatch", unit: "wu-1" }));
  const again = await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  assert.deepEqual([replay.replay, replay.status, again.refused, again.rule, h.calls], [true, "AMBIGUOUS", true, "UNIT_NOT_READY", 1]);
  assert.deepEqual(reconcile(w, mission).reconciled, []);
});

test("a write a dead worker began through Orbit's skill factory is AMBIGUOUS, and is never sent again", async () => {
  const h = hung({ id: "skd-2", shape: "instruction" });
  const w = { ...satelliteWorld({ capabilities: {} }), factory: { scaffold: () => h.call() } };
  const mission = await analyzed(w);
  const zombie = parked(w, mission, "skl-1", { kind: "resolve-skill", capability: "release.notes.draft", because: "nothing here drafts release notes" });
  assert.equal(contextOf(w, mission).open[0].operationKind, "skill.draft");
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["AMBIGUOUS"]);
  h.wake({ id: "skd-1", shape: "instruction" });
  await assert.rejects(zombie, (e) => e.code === "FENCED");
  assert.equal(h.calls, 1);
});

async function engineeringRun(w) {
  const mission = await staffedImplement(w);
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  return mission;
}

test("an engineering run whose reporter is gone is concluded on the task's own record -- never on a guess", async () => {
  const w = satelliteWorld({ tasks: { [TASK]: runningTask() } });
  const mission = await engineeringRun(w);
  const before = position(w, mission);
  assert.deepEqual([reconcile(w, mission).reconciled.map((r) => r.to), position(w, mission)], [["STILL_RUNNING"], before]);
  w.state.tasks[TASK] = completedTask();
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["RESULT_RECORDED"]);
  const end = finish(w, mission);
  assert.deepEqual([contextOf(w, mission).agentRuns[0].outcome, end.lifecycle, end.verdict, w.state.started.length], ["succeeded", "COMPLETED", "VERIFIED", 1]);
});

test("an engineering run whose task cannot be read back is AMBIGUOUS", async () => {
  const w = satelliteWorld({ tasks: { [TASK]: runningTask() } });
  const mission = await engineeringRun(w);
  delete w.state.tasks[TASK];
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["AMBIGUOUS"]);
});

async function hostRun(w) {
  const mission = await analyzed(w);
  await act(w, mission, { kind: "plan", units: [{ key: "look", kind: "explore", objective: "find where the timeout comes from", acceptanceCriteriaRefs: ["acc-1"] }] });
  await act(w, mission, { kind: "resolve-role", ...explorerRole() });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  return mission;
}

test("a host's run stays open until the host reports it, says it is gone, or it outlives the time a run may stay open", async () => {
  const w = satelliteWorld();
  const mission = await hostRun(w);
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["STILL_RUNNING"]);
  assert.throws(() => reconcile(w, mission, { abandon: "arn-9" }), (e) => e.code === "RUN_UNKNOWN");
  assert.deepEqual(reconcile(w, mission, { abandon: "arn-1" }).reconciled.map((r) => r.to), ["INTERRUPTED"]);
  const again = await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  assert.deepEqual([again.result.run, contextOf(w, mission).agentRuns[1].attempt], ["arn-2", 2]);
  w.io.state.nowMs += 2 * STALE_AFTER_MS;
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["INTERRUPTED"]);
});

test("reconcile never asks a provider, and every move it makes is a line of its own", async () => {
  const h = hung();
  const w = satelliteWorld({ providers: { context: () => h.call() } });
  const mission = await analyzed(w);
  parked(w, mission, "rec-1", RECALL);
  reconcile(w, mission);
  reconcile(w, mission);
  const lines = journalOf(w, mission).filter((r) => r.kind === "recovery.reconciled");
  assert.deepEqual([h.calls, lines.length, lines[0].from, lines[0].to], [1, 1, "INTENT_PERSISTED", "INTERRUPTED"]);
});

test("a crash in the middle of a line leaves a torn tail: the mission reads on without it and the next line starts clean", async () => {
  const h = hung();
  const w = satelliteWorld({ providers: { context: () => h.call() } });
  const mission = await analyzed(w);
  parked(w, mission, "rec-1", RECALL);
  const file = worldOf(w, mission).journal.file;
  w.io.files.set(file, `${w.io.files.get(file)}{"kind":"action.recorded","id":"act-2","outc`);
  const before = position(w, mission);
  assert.deepEqual(reconcile(w, mission).reconciled.map((r) => r.to), ["INTERRUPTED"]);
  assert.equal((await act(w, mission, { kind: "checkpoint" })).outcome !== undefined, true);
  assert.ok(position(w, mission) > before);
  assert.equal(journalOf(w, mission).filter((r) => r.kind === "action.recorded" && r.id === "act-2").length, 1);
});
