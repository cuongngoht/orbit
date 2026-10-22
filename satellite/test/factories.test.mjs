// THE ROLE AND TEMPLATE FACTORIES through the real engine: a responsibility nothing answers for gets a role of its own,
// NAMED from that responsibility, validated, published and pinned -- and a later mission asking the same REUSES it,
// as it reuses the same agent template. A role that tries to grant itself anything is rejected by name; a role a
// person revoked is never pinned again; generation stops at the mission's budget.
import assert from "node:assert/strict";
import { test } from "node:test";
import { start } from "../src/mission/loop.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { act, intentFor } from "./fakes/flow.mjs";
import { satelliteWorld } from "./fakes/world.mjs";

const GOAL = "Payment succeeds, but the customer never receives the confirmation email.";

const unit = (key, kind = "diagnose") => ({ key, kind, objective: `${kind} why the confirmation email is never sent (${key})`, acceptanceCriteriaRefs: ["acc-1"] });

const role = (unitId, responsibilities, extra = {}) => ({ unit: unitId, responsibilities, profile: "READ_ONLY", purpose: "Find where the confirmation is lost.", restrictions: ["It changes nothing."], completionCriteria: ["Every finding cites the record that shows it."], ...extra });

async function planned(w, units = [unit("why")]) {
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units });
  return mission;
}

const kinds = (w, mission, prefix) => worldOf(w, mission).journal.read().filter((r) => r.kind.startsWith(prefix)).map((r) => r.kind);

test("a responsibility nothing answers for gets a role named from it, validated, registered and pinned", async () => {
  const w = satelliteWorld();
  const mission = await planned(w);
  const r = await act(w, mission, { kind: "resolve-role", ...role("wu-1", [{ activity: "analyze", subject: "consumer failure" }, { activity: "trace", subject: "message delivery" }]) });
  assert.deepEqual([r.outcome, r.result.pin.split(":")[0]], ["generated", "rol-consumer-failure-analyst"]);
  assert.deepEqual(kinds(w, mission, "role."), ["role.validated", "role.generated", "role.registered"]);
  assert.equal(worldOf(w, mission).m.units.get("wu-1").rolePin, r.result.pin);
  assert.equal(w.definitions.read(r.result.pin).content.displayName, "ConsumerFailureAnalyst");
});

test("a later mission asking the same responsibilities reuses the role AND the agent template, and runs a fresh agent run", async () => {
  const w = satelliteWorld();
  const first = await planned(w);
  const r1 = await act(w, first, { kind: "resolve-role", ...role("wu-1", [{ activity: "analyze", subject: "consumer failure" }]) });
  const t1 = await act(w, first, { kind: "resolve-template", unit: "wu-1" });
  const second = await planned(w);
  const r2 = await act(w, second, { kind: "resolve-role", ...role("wu-1", [{ activity: "analyze", subject: "consumer failure" }]) });
  const t2 = await act(w, second, { kind: "resolve-template", unit: "wu-1" });
  const d1 = await act(w, first, { kind: "dispatch", unit: "wu-1" });
  const d2 = await act(w, second, { kind: "dispatch", unit: "wu-1" });
  assert.deepEqual([r2.outcome, r2.result.pin, t2.outcome, t2.result.pin], ["reused", r1.result.pin, "reused", t1.result.pin]);
  assert.notEqual(d1.result.envelope.missionId, d2.result.envelope.missionId);
  assert.deepEqual([d1.result.envelope.instruction.templatePin, d2.result.envelope.instruction.templatePin], [t1.result.pin, t1.result.pin]);
});

test("a decision that offers a role grants or tools is refused before anything is written, and a role's name grants nothing", async () => {
  const w = satelliteWorld();
  const mission = await planned(w, [unit("look", "explore")]);
  const before = worldOf(w, mission).m.position;
  await assert.rejects(act(w, mission, { kind: "resolve-role", ...role("wu-1", [{ activity: "explore", subject: "production" }], { grants: ["source.patch"] }) }), (e) => e.code === "DECISION_FORBIDDEN");
  await assert.rejects(act(w, mission, { kind: "resolve-role", ...role("wu-1", [{ activity: "explore", subject: "production" }], { tools: ["Bash"] }) }), (e) => e.code === "ACTION_FIELDS");
  assert.equal(worldOf(w, mission).m.position, before);
  const admin = await act(w, mission, { kind: "resolve-role", ...role("wu-1", [{ activity: "administer", subject: "production" }]) });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  const env = (await act(w, mission, { kind: "dispatch", unit: "wu-1" })).result.envelope;
  assert.deepEqual([w.definitions.read(admin.result.pin).content.displayName, env.agent.tools, env.grants.operationKinds.includes("source.patch")], ["ProductionAdministerer", ["Read", "Glob", "Grep"], false]);
});

test("ORCHESTRATOR is the engine's own: a role asking for it is rejected and published nowhere", async () => {
  const w = satelliteWorld();
  const mission = await planned(w);
  const r = await act(w, mission, { kind: "resolve-role", ...role("wu-1", [{ activity: "analyze", subject: "logs" }], { profile: "ORCHESTRATOR" }) });
  assert.deepEqual([r.outcome, worldOf(w, mission).journal.read().filter((x) => x.kind === "role.rejected").at(-1).findings, w.definitions.index("role").length], ["rejected", ["ROLE_PROFILE"], 0]);
});

test("two roles that together answer for a need are composed into one that names them both", async () => {
  const w = satelliteWorld();
  const mission = await planned(w, [unit("a"), unit("b"), unit("c")]);
  const a = await act(w, mission, { kind: "resolve-role", ...role("wu-1", [{ activity: "analyze", subject: "consumer failure" }]) });
  const b = await act(w, mission, { kind: "resolve-role", ...role("wu-2", [{ activity: "trace", subject: "message delivery" }]) });
  const c = await act(w, mission, { kind: "resolve-role", ...role("wu-3", [{ activity: "analyze", subject: "consumer failure" }, { activity: "trace", subject: "message delivery" }]) });
  assert.equal(c.outcome, "composed");
  assert.deepEqual(w.definitions.read(c.result.pin).content.composedOf, [a.result.pin, b.result.pin]);
});

test("generation stops at the mission's budget for generated definitions", async () => {
  const w = satelliteWorld({ limits: { maxGeneratedDefinitions: 0 } });
  const mission = await planned(w);
  const r = await act(w, mission, { kind: "resolve-role", ...role("wu-1", [{ activity: "analyze", subject: "consumer failure" }]) });
  assert.equal(r.outcome, "rejected");
  assert.deepEqual(worldOf(w, mission).journal.read().filter((x) => x.kind === "role.rejected").at(-1).findings, ["ROLE_BUDGET"]);
});

test("a role a person revoked is never reused, and proposing its very content again is refused", async () => {
  const first = satelliteWorld();
  const mission = await planned(first);
  const r = await act(first, mission, { kind: "resolve-role", ...role("wu-1", [{ activity: "analyze", subject: "consumer failure" }]) });
  const w = { ...first, policy: { ...first.policy, revoked: [{ ref: r.result.pin.split(":")[0], because: "a person revoked it" }] } };
  w.definitions = (await import("../src/store/port.mjs")).definitionsPort(w.io, w.rooms, w.policy);
  const again = await planned(w);
  const r2 = await act(w, again, { kind: "resolve-role", ...role("wu-1", [{ activity: "analyze", subject: "consumer failure" }]) });
  assert.equal(r2.outcome, "rejected");
  assert.deepEqual(worldOf(w, again).journal.read().filter((x) => x.kind === "role.rejected").at(-1).findings, ["ROLE_REVOKED"]);
});
