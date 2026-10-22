// MODE ACCURACY through the real engine: a unit's kind decides its mode and operation, never a host's word, never an
// agent's name. Reading source to investigate is EXPLORING; the same read during a review is REVIEWING; a source patch
// can never be planned into a reading unit; two runs open at once keep two modes; and the mission's concurrency is a
// limit the engine holds, one at a time on a host with no native agents.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextOf } from "../src/mission/context.mjs";
import { start, step } from "../src/mission/loop.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { act, explorerRole, intentFor } from "./fakes/flow.mjs";
import { decided, satelliteWorld } from "./fakes/world.mjs";

const GOAL = "Payment succeeds, but the customer never receives the confirmation email.";

const unit = (key, kind, extra = {}) => ({ key, kind, objective: `${kind} the confirmation path (${key})`, acceptanceCriteriaRefs: ["acc-1"], ...extra });

async function staffed(w, units, roleFor) {
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units });
  for (const [i, u] of units.entries()) await act(w, mission, { kind: "resolve-role", ...roleFor(u, `wu-${i + 1}`) });
  for (const [i] of units.entries()) await act(w, mission, { kind: "resolve-template", unit: `wu-${i + 1}` });
  return mission;
}

const readerRole = (u, id) => explorerRole(id, { responsibilities: [{ activity: u.kind === "review" ? "review" : u.kind, subject: "confirmation path" }] });

test("the same read is EXPLORING in an explore unit and REVIEWING in a review unit -- the unit's kind decides", async () => {
  const w = satelliteWorld();
  const mission = await staffed(w, [unit("look", "explore"), unit("judge", "review")], readerRole);
  const a = await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  const b = await act(w, mission, { kind: "dispatch", unit: "wu-2" });
  assert.deepEqual([a.result.envelope.mode, a.result.envelope.operationKind, b.result.envelope.mode, b.result.envelope.operationKind], ["EXPLORING", "repository.read", "REVIEWING", "repository.read"]);
});

test("a decision that names a mode or an operation kind is refused by name, and nothing is written", async () => {
  const w = satelliteWorld();
  const mission = await staffed(w, [unit("look", "explore")], readerRole);
  const before = worldOf(w, mission).m.position;
  await assert.rejects(step(w, mission, decided("x-1", before, { kind: "dispatch", unit: "wu-1", mode: "IMPLEMENTING" })), (e) => e.code === "DECISION_FORBIDDEN" && /mode/.test(e.message));
  await assert.rejects(step(w, mission, decided("x-2", before, { kind: "dispatch", unit: "wu-1" }, { operationKind: "repository.read" })), (e) => e.code === "DECISION_FORBIDDEN");
  assert.equal(worldOf(w, mission).m.position, before);
});

test("a source patch can never be planned into a reading unit", async () => {
  const w = satelliteWorld();
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  const r = await act(w, mission, { kind: "plan", units: [unit("look", "explore", { requestedEffects: ["repository.read", "source.patch"] })] });
  assert.deepEqual([r.refused, r.rule], [true, "PLAN_INVALID"]);
  assert.match(r.say, /EXPLORING, which never carries source\.patch/);
});

test("two runs open at once keep two modes, and a third is refused once concurrency is spent", async () => {
  const w = satelliteWorld({ limits: { maxConcurrency: 2 } });
  const mission = await staffed(w, [unit("look", "explore"), unit("why", "diagnose"), unit("judge", "review")], readerRole);
  for (const u of ["wu-1", "wu-2"]) await act(w, mission, { kind: "dispatch", unit: u });
  const third = await act(w, mission, { kind: "dispatch", unit: "wu-3" });
  assert.deepEqual(contextOf(w, mission).agentRuns.map((r) => [r.id, r.mode, r.lifecycle]), [["arn-1", "EXPLORING", "dispatched"], ["arn-2", "DIAGNOSING", "dispatched"]]);
  assert.deepEqual([third.refused, third.rule], [true, "CONCURRENCY"]);
});

test("on a host with no native agents the dispatch is serial, one run at a time, and says so", async () => {
  const w = satelliteWorld({ host: "codex", passed: [] });
  const mission = await staffed(w, [unit("look", "explore"), unit("why", "diagnose")], readerRole);
  const first = await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  const second = await act(w, mission, { kind: "dispatch", unit: "wu-2" });
  assert.deepEqual([first.result.envelope.dispatch.mode, first.result.envelope.dispatch.parallel, second.rule], ["serial", false, "CONCURRENCY"]);
});
