// EVIDENCE INTEGRITY, SECRETS, CORRUPTION and IDEMPOTENCY. A tool that ran, a report that holds to its contract and an
// agent's word never verify an acceptance criterion: only an independent owner's record does, read back when the
// report comes in. A secret never reaches the journal. A record changed by hand is refused, kept as it is. A decision
// or a report sent twice is answered, never applied twice.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextOf, goalOf } from "../src/mission/context.mjs";
import { finish } from "../src/mission/finish.mjs";
import { start, step } from "../src/mission/loop.mjs";
import { agentReport } from "../src/mission/report.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { missionFile } from "../src/store/rooms.mjs";
import { act, explorerRole, intentFor } from "./fakes/flow.mjs";
import { completedTask, decided, reportOf, runningTask, satelliteWorld } from "./fakes/world.mjs";

const GOAL = "Find why the nightly build times out.";

async function dispatched(w, unit = { key: "verify", kind: "verify", objective: "read the build's own checks back", acceptanceCriteriaRefs: ["acc-1"] }, role = explorerRole("wu-1", { responsibilities: [{ activity: "verify", subject: "acceptance" }], profile: "VERIFY" })) {
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units: [unit] });
  await act(w, mission, { kind: "resolve-role", ...role });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  return mission;
}

const TASK = "tsk-0123456789ab";

test("an agent's word that a check passed counts for nothing: with no owner record, a verify unit never succeeds", async () => {
  const w = satelliteWorld();
  const mission = await dispatched(w);
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1", { findings: [{ say: "all the tests pass, trust me" }], evidenceRefs: [] }));
  assert.deepEqual([r.outcome, contextOf(w, mission).acceptance[0].verified], ["insufficient", false]);
});

test("an engineering task's own satisfied verification makes the criterion VERIFIED by an independent owner", async () => {
  const w = satelliteWorld({ tasks: { [TASK]: completedTask() } });
  const mission = await dispatched(w);
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: [`task:${TASK}`, `check:${TASK}:chk-1`] }));
  const end = finish(w, mission);
  assert.deepEqual([r.outcome, end.lifecycle, end.verdict, end.acceptance[0].level, end.acceptance[0].independent], ["succeeded", "COMPLETED", "VERIFIED", "VERIFIED", true]);
});

test("a task that completed with a violated verification is behaviour observed, never verified", async () => {
  const w = satelliteWorld({ tasks: { [TASK]: completedTask([{ subject: "test", obligation: "the tests pass", evidence: "check:chk-1", state: "violated" }]) } });
  const mission = await dispatched(w);
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: [`task:${TASK}`] }));
  const row = [...worldOf(w, mission).m.evidence.values()].find((e) => e.ref === `task:${TASK}`);
  assert.deepEqual([r.outcome, row.level, row.independent, row.verified], ["insufficient", "BEHAVIOR_OBSERVED", true, false]);
  // A run that did not succeed counts toward no criterion: what it observed is kept, and the criterion is still owed.
  assert.deepEqual([contextOf(w, mission).acceptance[0].verified, contextOf(w, mission).owed.length], [false, 1]);
});

test("a report while the owner's task is still running is refused, and nothing is written", async () => {
  const w = satelliteWorld({ tasks: { [TASK]: runningTask() } });
  const mission = await dispatched(w);
  const before = worldOf(w, mission).m.position;
  assert.throws(() => agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: [`task:${TASK}`] })), (e) => e.code === "EVIDENCE_PENDING");
  assert.equal(worldOf(w, mission).m.position, before);
});

test("the checkout changing while a run was open voids the run: what it says cannot be told apart from what changed", async () => {
  const w = satelliteWorld({ files: { "src/a.mjs": "x" } });
  const mission = await dispatched(w, { key: "look", kind: "explore", objective: "look", acceptanceCriteriaRefs: ["acc-1"] }, explorerRole());
  w.state.tree = { head: "b".repeat(40), dirty: 1, digest: "e".repeat(64) };
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: ["file:src/a.mjs"] }));
  assert.deepEqual([r.outcome, contextOf(w, mission).units[0].state], ["violated", "ready"]);
});

test("a secret never reaches the journal: a goal with one is refused, and one in a decision is masked", async () => {
  const w = satelliteWorld();
  assert.throws(() => start(w, { goal: "Fix login. password=hunter2 is the admin's" }), /cannot be stored safely/);
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) }, { observed: "the api_key=abc123secret header was in the log" });
  const kept = JSON.stringify(worldOf(w, mission).journal.read());
  assert.doesNotMatch(kept, /abc123secret|hunter2/);
  assert.match(kept, /api_key \[redacted\]/);
});

test("the goal is read back with its digest checked, and a goal changed by hand is refused and kept as it is", () => {
  const w = satelliteWorld();
  const { mission } = start(w, { goal: GOAL });
  assert.deepEqual([goalOf(w, mission).body, goalOf(w, mission).matches], [GOAL, true]);
  const file = missionFile(w.rooms, mission, "goal.json");
  const tampered = w.io.files.get(file).replace("nightly", "weekly");
  w.io.files.set(file, tampered);
  assert.throws(() => goalOf(w, mission), (e) => e.code === "GOAL_CORRUPT");
  assert.equal(w.io.files.get(file), tampered);
});

test("a plan revision changed by hand is no longer intact, and a journal from a newer Satellite is refused", async () => {
  const w = satelliteWorld();
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units: [{ key: "look", kind: "explore", objective: "look", acceptanceCriteriaRefs: ["acc-1"] }] });
  const file = [...w.io.files.keys()].find((k) => /rev-1-[0-9a-f]{8}\.json$/.test(k));
  assert.equal(contextOf(w, mission).plan.intact, true);
  w.io.files.set(file, w.io.files.get(file).replace("look", "leak"));
  assert.equal(contextOf(w, mission).plan.intact, false);
  const journal = worldOf(w, mission).journal.file;
  w.io.files.set(journal, w.io.files.get(journal).replace('"schema":1', '"schema":9'));
  assert.throws(() => contextOf(w, mission), (e) => e.code === "NEWER_MISSION");
});

test("the same decision twice is a replay, nothing written again; the same id for another action is refused", async () => {
  const w = satelliteWorld();
  const { mission, goalDigest } = start(w, { goal: GOAL });
  const d = decided("same", 1, { kind: "analyze", intent: intentFor(goalDigest) });
  await step(w, mission, d);
  const after = worldOf(w, mission).m.position;
  const again = await step(w, mission, { ...d, expectedRevision: after });
  assert.deepEqual([again.replay, worldOf(w, mission).m.position], [true, after]);
  await assert.rejects(step(w, mission, { ...d, expectedRevision: after, action: { kind: "checkpoint" } }), (e) => e.code === "DECISION_ID_REUSED");
});

test("the same report twice is a replay; a different one for an ended run is refused", async () => {
  const w = satelliteWorld({ files: { "src/client.mjs": "x" } });
  const mission = await dispatched(w, { key: "look", kind: "explore", objective: "look", acceptanceCriteriaRefs: ["acc-1"] }, explorerRole());
  agentReport(w, mission, "arn-1", reportOf("arn-1"));
  const after = worldOf(w, mission).m.position;
  assert.deepEqual([agentReport(w, mission, "arn-1", reportOf("arn-1")).replay, worldOf(w, mission).m.position], [true, after]);
  assert.throws(() => agentReport(w, mission, "arn-1", reportOf("arn-1", { summary: "a different story" })), (e) => e.code === "RUN_ENDED");
});
