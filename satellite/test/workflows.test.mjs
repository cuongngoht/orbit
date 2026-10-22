// WORKFLOW TEMPLATES: one is generated, held to its contract, and instantiated into a mission's plan; a later mission
// REUSES it by its pin with its own parameters -- fresh units, filled for the new goal, and nothing of the first
// mission's runs, attempts or evidence. A template that holds a cycle, recurses, depends across branches, carries
// state or exceeds the mission's bounds is rejected.
import assert from "node:assert/strict";
import { test } from "node:test";
import { WORKFLOW_API, instantiate, workflowFindings } from "../src/factories/workflow/workflow.mjs";
import { contextOf } from "../src/mission/context.mjs";
import { start } from "../src/mission/loop.mjs";
import { act, intentFor } from "./fakes/flow.mjs";
import { satelliteWorld } from "./fakes/world.mjs";

const TEMPLATE = { api: WORKFLOW_API, name: "event-delivery-investigation", purpose: "Investigate why an event never reaches its consumer.", provides: "event.delivery.investigation", parameters: { event: { type: "string", required: true }, consumer: { type: "string", required: true }, deep: { type: "boolean" } }, units: [{ key: "trace", kind: "explore", objective: "trace where {event} is published" }, { key: "consumer", kind: "diagnose", objective: "read why {consumer} does not handle {event}", dependsOn: ["trace"] }, { key: "replay", kind: "diagnose", objective: "replay {event} against {consumer}", dependsOn: ["consumer"], when: { param: "deep", eq: true } }, { key: "review", kind: "review", objective: "review the findings about {event}", dependsOn: ["consumer"], serves: "none" }] };

const LIMITS = { limits: { maxUnits: 12, maxDepth: 2, maxAgentRuns: 12 } };

async function analyzed(w, goal) {
  const { mission, goalDigest } = start(w, { goal });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  return mission;
}

test("a workflow template is generated, instantiated into fresh units, and reused by a later mission with its own parameters", async () => {
  const w = satelliteWorld();
  const first = await analyzed(w, "The order-paid event never reaches the mailer.");
  const generated = await act(w, first, { kind: "resolve-workflow", template: TEMPLATE });
  await act(w, first, { kind: "plan", workflow: generated.result.pin, params: { event: "order-paid", consumer: "mailer", deep: true } });
  const second = await analyzed(w, "The refund-issued event never reaches the ledger.");
  const reused = await act(w, second, { kind: "resolve-workflow", pin: generated.result.pin });
  await act(w, second, { kind: "plan", workflow: reused.result.pin, params: { event: "refund-issued", consumer: "ledger" } });
  assert.deepEqual([generated.outcome, reused.outcome, reused.result.pin], ["generated", "reused", generated.result.pin]);
  assert.deepEqual(contextOf(w, first).units.map((u) => u.objective), ["trace where order-paid is published", "read why mailer does not handle order-paid", "replay order-paid against mailer", "review the findings about order-paid"]);
  assert.deepEqual(contextOf(w, second).units.map((u) => [u.objective, u.state, u.attempts, u.runs.length]), [["trace where refund-issued is published", "ready", 0, 0], ["read why ledger does not handle refund-issued", "planned", 0, 0], ["review the findings about refund-issued", "planned", 0, 0]]);
});

test("the template a mission reused carries no state of any mission", async () => {
  const w = satelliteWorld();
  const mission = await analyzed(w, "The order-paid event never reaches the mailer.");
  const generated = await act(w, mission, { kind: "resolve-workflow", template: TEMPLATE });
  const kept = JSON.stringify(w.definitions.read(generated.result.pin).content);
  for (const word of ["state", "status", "attempt", "assignedAgentRunIds", "verdict", "evidence", "approval"]) assert.doesNotMatch(kept, new RegExp(`"${word}"`), word);
});

const broken = (patch) => workflowFindings({ ...TEMPLATE, ...patch }, LIMITS).map((f) => f.id);

test("a cycle, recursion, an impossible branch, carried state and exceeded bounds are each rejected", () => {
  assert.deepEqual(broken({}), []);
  assert.ok(broken({ units: [{ key: "a", kind: "explore", objective: "a", dependsOn: ["b"] }, { key: "b", kind: "explore", objective: "b", dependsOn: ["a"] }] }).includes("WF_CYCLE"));
  assert.ok(broken({ units: [{ key: "a", kind: "explore", objective: "a", requiredCapabilities: ["event.delivery.investigation"] }] }).includes("WF_RECURSION"));
  assert.ok(broken({ units: [{ key: "a", kind: "explore", objective: "a", when: { param: "deep", eq: true } }, { key: "b", kind: "explore", objective: "b", dependsOn: ["a"], when: { param: "deep", eq: false } }] }).includes("WF_IMPOSSIBLE_DEPENDENCY"));
  assert.ok(broken({ status: "COMPLETED", units: [{ key: "a", kind: "explore", objective: "a", verdict: "PASS" }] }).includes("WF_STATE"));
  assert.ok(broken({ bounds: { maxUnits: 99 } }).includes("WF_BOUNDS"));
  assert.ok(broken({ units: [{ key: "a", kind: "explore", objective: "a", requestedEffects: ["source.patch"] }] }).includes("WF_UNITS"));
});

test("instantiation checks its parameters and drops a branch that does not apply", () => {
  assert.deepEqual(instantiate(TEMPLATE, { event: "x" }).problems, ["parameter consumer is required"]);
  assert.deepEqual(instantiate(TEMPLATE, { event: "x", consumer: "y", deep: false }).units.map((u) => u.key), ["trace", "consumer", "review"]);
});
