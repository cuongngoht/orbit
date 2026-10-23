// THE VERTICAL SLICE, end to end through the real engine with scripted owners: a goal, its intent, a one-unit plan, a
// starter role reused, a template generated, ONE agent run dispatched with its envelope, its report read back, its
// handoff published, and the mission reported -- NOT verified, because no independent owner proved its criterion.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextOf, eventsView } from "../src/mission/context.mjs";
import { finish } from "../src/mission/finish.mjs";
import { start } from "../src/mission/loop.mjs";
import { agentReport } from "../src/mission/report.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { act, explorerRole, exploreUnit, intentFor } from "./fakes/flow.mjs";
import { reportOf, satelliteWorld } from "./fakes/world.mjs";

const GOAL = "Find why the nightly build log shows a flaky timeout.\nThe failing job is ci/nightly.";

async function sliced(w) {
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units: [exploreUnit()] });
  await act(w, mission, { kind: "resolve-role", ...explorerRole() });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  return { mission, dispatched: await act(w, mission, { kind: "dispatch", unit: "wu-1" }) };
}

test("a mission is created from its goal and starts CREATED, with analyze as its next step", () => {
  const w = satelliteWorld();
  const { mission } = start(w, { goal: GOAL });
  const ctx = contextOf(w, mission);
  assert.deepEqual([ctx.lifecycle, ctx.allowed, ctx.next.decide.action.kind, ctx.revision], ["CREATED", ["analyze", "recall", "checkpoint"], "analyze", 1]);
});

test("the slice dispatches one run under a reused starter role, with an envelope naming the read-only agent", async () => {
  const w = satelliteWorld();
  const { mission, dispatched } = await sliced(w);
  assert.equal(dispatched.open, true);
  const env = dispatched.result.envelope;
  assert.deepEqual([env.agent.subagentType, env.agent.tools, env.mode, env.operationKind, env.profile, env.role.displayName, env.dispatch.mode], ["orbit:satellite-reader", ["Read", "Glob", "Grep"], "EXPLORING", "repository.read", "READ_ONLY", "RepositoryExplorer", "native"]);
  assert.equal(contextOf(w, mission).lifecycle, "RUNNING");
});

test("a report that holds to its contract ends the run succeeded, publishes its handoff, and the mission reports NOT_VERIFIED", async () => {
  const w = satelliteWorld({ files: { "src/client.mjs": "abc123" } });
  const { mission } = await sliced(w);
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1"));
  assert.deepEqual([r.outcome, r.handoff.id], ["succeeded", "hof-1"]);
  const end = finish(w, mission);
  assert.deepEqual([end.lifecycle, end.verdict, end.owed.map((o) => o.acceptance)], ["REPORTED", "NOT_VERIFIED", ["acc-1"]]);
});

test("every journal line is one event, and the events name the run's mode and the action's status", async () => {
  const w = satelliteWorld({ files: { "src/client.mjs": "abc123" } });
  const { mission } = await sliced(w);
  agentReport(w, mission, "arn-1", reportOf("arn-1"));
  const ev = eventsView(w, mission);
  assert.equal(ev.events.length, worldOf(w, mission).m.position);
  const created = ev.events.find((e) => e.kind === "agentrun.created");
  assert.deepEqual([created.agentRunId, created.mode, created.workUnitId, created.actionId, created.actionStatus], ["arn-1", "EXPLORING", "wu-1", "act-5", "INTENT_PERSISTED"]);
});
