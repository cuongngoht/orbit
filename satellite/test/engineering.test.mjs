// ENGINEERING THROUGH ITS OWNER. An implement unit's change is made in ONE autonomous-engineering task the engine asks
// Orbit for -- outside the mission's lock, once -- and the host is told to drive that task, by id, in its own
// workspace. A build or test unit drives the task its dependency handed off and starts none. What the task's own
// verification says is what a criterion stands on; a failed start is an interrupted run, never a pretended one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextOf } from "../src/mission/context.mjs";
import { finish } from "../src/mission/finish.mjs";
import { start } from "../src/mission/loop.mjs";
import { agentReport } from "../src/mission/report.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { act, intentFor } from "./fakes/flow.mjs";
import { completedTask, reportOf, runningTask, satelliteWorld } from "./fakes/world.mjs";

const GOAL = "Make the nightly build's retry loop respect the job deadline.";
const TASK = "tsk-0123456789ab";

const IMPLEMENT = { key: "fix", kind: "implement", objective: "make the retry loop end before the job's deadline", acceptanceCriteriaRefs: ["acc-1"] };
const TEST = { key: "prove", kind: "test", objective: "run the tests the change is held to", dependsOn: ["fix"], acceptanceCriteriaRefs: ["acc-1"] };

const roleFor = (unit, activity, profile) => ({ unit, responsibilities: [{ activity, subject: "retry-loop" }], profile, purpose: "Change the retry loop so it ends before the job's deadline.", restrictions: ["It edits only inside the engineering task's own workspace."], completionCriteria: ["The engineering task completes on its own verification."] });

async function planned(w, units) {
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units });
  return mission;
}

async function staffed(w, mission, unit, activity, profile) {
  await act(w, mission, { kind: "resolve-role", ...roleFor(unit, activity, profile) });
  return act(w, mission, { kind: "resolve-template", unit });
}

async function implementing(w) {
  const mission = await planned(w, [IMPLEMENT]);
  await staffed(w, mission, "wu-1", "implement", "IMPLEMENT");
  return { mission, out: await act(w, mission, { kind: "dispatch", unit: "wu-1" }) };
}

test("an implement unit asks autonomous engineering for ONE task and hands the host that task to drive", async () => {
  const w = satelliteWorld();
  const { mission, out } = await implementing(w);
  const run = contextOf(w, mission).agentRuns[0];
  assert.deepEqual(w.state.started, [IMPLEMENT.objective]);
  assert.deepEqual([out.open, out.outcome, out.result.envelope.drive.task, out.result.envelope.agent.subagentType], [true, "dispatched", TASK, "orbit:satellite-engineer"]);
  assert.match(out.result.envelope.drive.commands[0], new RegExp(`autonomous-engineering\\.mjs context ${TASK} --json$`));
  assert.deepEqual([run.mode, run.profile], ["IMPLEMENTING", "IMPLEMENT"]);
  assert.equal(contextOf(w, mission).open[0].status, "PROVIDER_ACCEPTED");
});

test("the task's own satisfied verification completes the mission; the report's word adds nothing to it", async () => {
  const w = satelliteWorld({ tasks: { [TASK]: runningTask() } });
  const { mission } = await implementing(w);
  assert.throws(() => agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: [`task:${TASK}`] })), (e) => e.code === "EVIDENCE_PENDING");
  w.state.tasks[TASK] = completedTask();
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: [`task:${TASK}`, `check:${TASK}:chk-1`] }));
  const end = finish(w, mission);
  assert.deepEqual([r.outcome, end.lifecycle, end.verdict], ["succeeded", "COMPLETED", "VERIFIED"]);
  assert.deepEqual(w.state.started.length, 1);
});

test("a report that names no reference stands on the task the run drives, never on nothing", async () => {
  const w = satelliteWorld({ tasks: { [TASK]: completedTask() } });
  const { mission } = await implementing(w);
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: undefined, findings: [{ say: "the loop now stops at the deadline" }] }));
  const row = [...worldOf(w, mission).m.evidence.values()].find((e) => e.ref === `task:${TASK}`);
  assert.deepEqual([r.outcome, row?.level], ["succeeded", "VERIFIED"]);
});

test("a task that could not be started is an interrupted run, and the unit may be dispatched again", async () => {
  const w = satelliteWorld({ startFails: true });
  const { mission, out } = await implementing(w);
  const view = contextOf(w, mission);
  assert.deepEqual([out.open ?? false, view.agentRuns[0].outcome, view.units[0].state, view.open.length], [false, "interrupted", "ready", 0]);
  assert.equal(w.state.started.length, 0);
});

test("a test unit drives the task its dependency handed off, and starts none of its own", async () => {
  const w = satelliteWorld({ tasks: { [TASK]: completedTask() } });
  const mission = await planned(w, [IMPLEMENT, TEST]);
  await staffed(w, mission, "wu-1", "implement", "IMPLEMENT");
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: [`task:${TASK}`] }));
  await staffed(w, mission, "wu-2", "test", "VERIFY");
  const out = await act(w, mission, { kind: "dispatch", unit: "wu-2" });
  assert.deepEqual([w.state.started.length, out.result.envelope.drive.task, contextOf(w, mission).agentRuns[1].mode], [1, TASK, "TESTING"]);
});

test("a test unit whose inputs name no engineering task is refused before anything is written", async () => {
  const w = satelliteWorld({ files: { "src/client.mjs": "x" } });
  const mission = await planned(w, [{ key: "look", kind: "explore", objective: "find the retry loop", acceptanceCriteriaRefs: ["acc-1"] }, { ...TEST, dependsOn: ["look"] }]);
  await act(w, mission, { kind: "resolve-role", unit: "wu-1", responsibilities: [{ activity: "explore", subject: "repository" }], profile: "READ_ONLY", purpose: "Find the retry loop.", restrictions: ["It reads only."], completionCriteria: ["It names the file."] });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  agentReport(w, mission, "arn-1", reportOf("arn-1"));
  await staffed(w, mission, "wu-2", "test", "VERIFY");
  const out = await act(w, mission, { kind: "dispatch", unit: "wu-2" });
  assert.deepEqual([out.refused, out.rule], [true, "TASK_INHERITED"]);
  assert.equal(contextOf(w, mission).agentRuns.length, 1);
});
