// A CAPABILITY ASKED ON BEHALF OF A RUN. The engine asks it once, through the door Orbit keeps (the broker narrowed to
// reading, or a project's capability pipeline with no case), OUTSIDE the lock. While the call is open the run shows the
// nested mode on top of its own, and its own mode again once the call is recorded. The answer goes back to the host
// once and is kept nowhere; what is kept is digests. A run never reaches through a nested action what it was not
// granted, and a provider that waits for a person, that is the host's own, or that reads through a credential is
// refused with nothing asked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextOf } from "../src/mission/context.mjs";
import { start } from "../src/mission/loop.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { eventsOf } from "../src/projection/fold.mjs";
import { act, explorerRole, intentFor } from "./fakes/flow.mjs";
import { providedBy, readAnswer, satelliteWorld } from "./fakes/world.mjs";

const GOAL = "Find why the nightly build times out.";
const CAP = "runbook.search";
const ONLY_IN_THE_ANSWER = "zq-answer-text-kept-nowhere";

async function exploring(w, unit = { key: "look", kind: "explore", objective: "find where the nightly timeout comes from", acceptanceCriteriaRefs: ["acc-1"] }, role = explorerRole()) {
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units: [unit] });
  await act(w, mission, { kind: "resolve-role", ...role });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  return mission;
}

const worldWith = (extra = {}) => satelliteWorld({ capabilities: { [CAP]: providedBy(CAP) }, answer: readAnswer({ cause: ONLY_IN_THE_ANSWER, file: "src/client.mjs" }), ...extra });

test("while the call is open the run shows DISPATCHING on top of EXPLORING, and EXPLORING again once it is recorded", async () => {
  const w = worldWith();
  const mission = await exploring(w);
  const seen = [];
  const door = w.invoker;
  w.invoker = { bind: door.bind, call: async (b, ask) => (seen.push(contextOf(w, mission).agentRuns[0].modes), door.call(b, ask)) };
  const out = await act(w, mission, { kind: "invoke", capability: CAP, agentRun: "arn-1", tool: "search", input: { q: "nightly timeout" } });
  const run = contextOf(w, mission).agentRuns[0];
  assert.deepEqual(seen, [["DISPATCHING"]]);
  assert.deepEqual([run.mode, run.modes, run.lifecycle], ["EXPLORING", [], "dispatched"]);
  assert.deepEqual([out.outcome, out.level, out.result.answer.cause], ["answered", "TOOL_COMPLETED", ONLY_IN_THE_ANSWER]);
});

test("the door is asked once, for reading only, in Satellite's name; the journal keeps digests and never the answer", async () => {
  const w = worldWith();
  const mission = await exploring(w);
  await act(w, mission, { kind: "invoke", capability: CAP, agentRun: "arn-1", tool: "search", input: { q: "nightly timeout" } });
  assert.deepEqual(w.state.invoked, [{ provider: "managed:runbooks", capability: CAP, tool: "search", input: { q: "nightly timeout" }, workflow: "orbit-satellite", readOnly: true }]);
  const kept = JSON.stringify(worldOf(w, mission).journal.read());
  assert.doesNotMatch(kept, new RegExp(ONLY_IN_THE_ANSWER));
  const row = [...worldOf(w, mission).m.evidence.values()].find((e) => e.owner === "capability");
  assert.deepEqual([row.level, row.independent, row.agentRun, row.ref], ["TOOL_COMPLETED", false, "arn-1", `capability:${CAP}:${"b".repeat(16)}`]);
});

test("an answer holding every field the decision expects is CONTRACT_MET; it is still the provider's word, never VERIFIED", async () => {
  const w = worldWith();
  const mission = await exploring(w);
  const out = await act(w, mission, { kind: "invoke", capability: CAP, agentRun: "arn-1", expects: ["cause", "file"] });
  const missing = await act(w, mission, { kind: "invoke", capability: CAP, agentRun: "arn-1", expects: ["owner"] });
  assert.deepEqual([out.level, missing.level], ["CONTRACT_MET", "TOOL_COMPLETED"]);
});

test("the nested call is projected with its run and its parent action, in its own mode", async () => {
  const w = worldWith();
  const mission = await exploring(w);
  await act(w, mission, { kind: "invoke", capability: CAP, agentRun: "arn-1" });
  const events = eventsOf(worldOf(w, mission).journal.read());
  const intended = events.filter((e) => e.kind === "action.intended").at(-1);
  const dispatchAction = contextOf(w, mission).agentRuns[0].action;
  assert.deepEqual([intended.agentRunId, intended.parentActionId, intended.mode, intended.operationKind], ["arn-1", dispatchAction, "DISPATCHING", "provider.invoke"]);
});

test("a run whose own mode reads through no provider is refused by what its run was granted, and nothing is asked", async () => {
  const w = worldWith({ tasks: {} });
  const unit = { key: "fix", kind: "implement", objective: "make the retry loop end before the deadline", acceptanceCriteriaRefs: ["acc-1"] };
  const role = { unit: "wu-1", responsibilities: [{ activity: "implement", subject: "retry-loop" }], profile: "IMPLEMENT", purpose: "Change the retry loop.", restrictions: ["It edits only inside the engineering task's own workspace."], completionCriteria: ["The task completes on its own verification."] };
  const mission = await exploring(w, unit, role);
  const out = await act(w, mission, { kind: "invoke", capability: CAP, agentRun: "arn-1" });
  assert.deepEqual([out.refused, out.rule], [true, "NOT_GRANTED"]);
  assert.match(out.say, /parent-run/);
  assert.equal(w.state.invoked.length, 0);
});

const REFUSALS = [
  { rule: "CAPABILITY_UNPROVIDED", world: { capabilities: {} }, action: {} },
  { rule: "CAPABILITY_APPROVAL", world: { capabilities: { [CAP]: providedBy(CAP, undefined, "approval") } }, action: {} },
  { rule: "CAPABILITY_HOST_ONLY", world: { capabilities: { [CAP]: providedBy(CAP, { kind: "skill", id: "orbit-qa", key: "skill:orbit-qa", ownership: "orbit" }) } }, action: {} },
  { rule: "CAPABILITY_CONNECTION", world: { connection: "reports" }, action: {} },
  { rule: "INVOKE_SECRET", world: {}, action: { input: { header: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789" } } },
  { rule: "INVOKE_CAPABILITY", world: {}, action: { capability: "search" } },
  { rule: "RUN_NOT_OPEN", world: {}, action: { agentRun: "arn-9" } },
];

for (const r of REFUSALS) {
  test(`${r.rule}: refused before anything is asked`, async () => {
    const w = worldWith(r.world);
    const mission = await exploring(w);
    const out = await act(w, mission, { kind: "invoke", capability: CAP, agentRun: "arn-1", ...r.action });
    assert.deepEqual([out.refused, out.rule, w.state.invoked.length], [true, r.rule, 0]);
  });
}

test("a call its door says wrote, or one the broker refused, counts for nothing and leaves the run open", async () => {
  const wrote = worldWith({ answer: { ...readAnswer(), operation: "write" } });
  const m1 = await exploring(wrote);
  const w1 = await act(wrote, m1, { kind: "invoke", capability: CAP, agentRun: "arn-1" });
  const refusedDoor = worldWith({ answer: { receipt: { provider: "managed:runbooks", tool: "search", outcome: "refused", why: "the server is disabled" }, answer: null, operation: null, error: new Error("disabled") } });
  const m2 = await exploring(refusedDoor);
  const w2 = await act(refusedDoor, m2, { kind: "invoke", capability: CAP, agentRun: "arn-1" });
  assert.deepEqual([w1.outcome, w1.level, /OPERATION_WRITE/.test(w1.summary), w2.outcome, /disabled/.test(w2.summary)], ["failed", "UNKNOWN", true, "failed", true]);
  assert.equal([...worldOf(wrote, m1).m.evidence.values()].filter((e) => e.owner === "capability").length, 0);
  assert.equal(contextOf(wrote, m1).agentRuns[0].lifecycle, "dispatched");
});
