// WHICH HOST AGENT CARRIES A RUN (0.2.2, ADR 0044): a pure join of the mission's runs with the session trail, read off
// what the hooks observed and what the dispatcher reported -- and every gap said as such, never filled by the nearest run.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RUN_REF, runRefOf } from "../../src/attribution.mjs";
import { bindingsOf } from "../src/hosts/attribution.mjs";
import { modelOf } from "../src/mission/fold.mjs";
import { ID_PATTERNS, missionIdOf } from "../src/store/ids.mjs";

const MSN = "msn-0123456789ab";
const A = "claude:00000000000000aa";
const B = "claude:00000000000000bb";
const C = "claude:00000000000000cc";
let clock = 0;
const at = () => `2026-10-30T10:00:${String(clock++ % 60).padStart(2, "0")}.000Z`;
const run = (id, over = {}) => ({ kind: "agentrun.created", id, unit: "wu-1", parentAgentRun: over.parent, dispatch: over.dispatch ?? "native", profile: "READ_ONLY", attempt: 1, mode: "EXPLORING", action: `act-${id.slice(4)}`, depth: 0, at: at() });
const model = (...extra) => modelOf([{ kind: "mission.created", id: MSN, objective: "x", at: at() }, run("arn-1"), run("arn-2"), ...extra]);
const ev = (type, data) => ({ type, data, at: at() });
const invoked = (call, ref) => ev("agent.invoked", { id: "orbit:satellite-reader", call, run: ref });
const launched = (call, agent, by = undefined, ref = undefined) => ev("agent.launched", { id: "orbit:satellite-reader", call, launched: agent, ...(by ? { agent: by } : {}), ...(ref ? { run: ref } : {}) });
const used = (agent, ok = true) => ev("tool.used", { tool: "Read", kind: "read", ok, agent });
const bound = (id, hostAgent) => ({ kind: "agentrun.bound", id, hostAgent, by: "host", at: at() });

test("a run reference is the mission's own id grammar, qualified", () => {
  assert.equal(runRefOf(MSN, "arn-12"), `${MSN}/arn-12`);
  assert.ok(ID_PATTERNS.run.test("arn-12") && RUN_REF.test(`${missionIdOf({ project: "p", checkout: "c", goalDigest: "g", at: "t" })}/arn-12`));
});

test("observed: the Agent call that carried a run's envelope launched an agent, and that agent's calls are the run's", () => {
  const b = bindingsOf({ model: model(), trail: [invoked("c1", `${MSN}/arn-1`), launched("c1", A), used(A), used(A, false), used(B)] }).get("arn-1");
  assert.deepEqual([b.word, b.hostAgent, b.counts.direct, b.counts.failed, b.calls.length], ["HOST_OBSERVED", A, 2, 1, 2]);
  assert.match(b.basis, /the Agent call that carried its envelope launched/);
});

test("two runs of one agent type in parallel keep their own agents and their own calls", () => {
  const got = bindingsOf({ model: model(), trail: [invoked("c1", `${MSN}/arn-1`), invoked("c2", `${MSN}/arn-2`), launched("c2", B), launched("c1", A), used(A), used(B), used(B)] });
  assert.deepEqual([...got].map(([id, b]) => [id, b.hostAgent, b.counts.direct]), [["arn-1", A, 1], ["arn-2", B, 2]]);
});

test("reported, agreeing, disagreeing, and nothing at all -- each its own word, and a conflict chooses no agent", () => {
  assert.equal(bindingsOf({ model: model(bound("arn-1", A)), trail: [] }).get("arn-1").word, "REPORTED");
  const agree = bindingsOf({ model: model(bound("arn-1", A)), trail: [launched("c1", A, undefined, `${MSN}/arn-1`)] }).get("arn-1");
  assert.deepEqual([agree.word, agree.hostAgent], ["HOST_OBSERVED", A]);
  assert.match(agree.basis, /as the dispatcher also said/);
  const clash = bindingsOf({ model: model(bound("arn-1", B)), trail: [launched("c1", A, undefined, `${MSN}/arn-1`), used(A)] }).get("arn-1");
  assert.deepEqual([clash.word, clash.hostAgent, clash.counts.direct, clash.agents], ["CONFLICTING", null, 0, [A, B]]);
  const none = bindingsOf({ model: model(), trail: [used(A)] }).get("arn-1");
  assert.deepEqual([none.word, none.hostAgent], ["UNATTRIBUTED", null]);
  assert.match(bindingsOf({ model: model(), trail: [], trailSource: "off" }).get("arn-1").basis, /switched off/);
});

test("a serial run is never bound, another mission's reference and a forged one bind nothing, and one agent for two runs is neither's", () => {
  const serial = modelOf([{ kind: "mission.created", id: MSN, at: at() }, run("arn-1", { dispatch: "serial" })]);
  const s = bindingsOf({ model: serial, trail: [invoked("c1", `${MSN}/arn-1`), launched("c1", A)] }).get("arn-1");
  assert.deepEqual([s.word, s.hostAgent], ["UNATTRIBUTED", null]);
  assert.match(s.basis, /serially/);
  const foreign = bindingsOf({ model: model(), trail: [invoked("c1", "msn-ffffffffffff/arn-1"), launched("c1", A), launched("c2", B, undefined, `${MSN}/arn-9`)] });
  assert.deepEqual([...foreign.values()].map((b) => b.word), ["UNATTRIBUTED", "UNATTRIBUTED"], "never moved onto the nearest run");
  assert.equal(foreign.has("arn-9"), false);
  const shared = bindingsOf({ model: model(), trail: [launched("c1", A, undefined, `${MSN}/arn-1`), launched("c2", A, undefined, `${MSN}/arn-2`)] });
  assert.deepEqual([...shared.values()].map((b) => [b.word, b.hostAgent]), [["CONFLICTING", null], ["CONFLICTING", null]]);
  assert.match(shared.get("arn-1").basis, /another run of this mission too/);
});

test("a launch observed after the run ended still binds it and reopens nothing; what it launched counts apart, once, with a cycle closed", () => {
  const ended = model({ kind: "agentrun.ended", id: "arn-1", outcome: "succeeded", at: at() });
  const trail = [launched("c1", A, undefined, `${MSN}/arn-1`), used(A), launched("c3", C, A), used(C), used(C), launched("c4", A, C), used(A)];
  const b = bindingsOf({ model: ended, trail }).get("arn-1");
  assert.deepEqual([b.word, b.counts.direct, b.counts.descendants, b.children], ["HOST_OBSERVED", 2, 2, [C]], "C's two calls are its own, not A's; A launched again by C is not counted twice");
  assert.equal(ended.runs.get("arn-1").ended.outcome, "succeeded", "a binding is read, never written");
});

test("the agent's own start and stop are the host's lifecycle of it, kept beside the run's", () => {
  const b = bindingsOf({ model: model(), trail: [launched("c1", A, undefined, `${MSN}/arn-1`), ev("agent.started", { id: "orbit:satellite-reader", agent: A })] }).get("arn-1");
  assert.equal(typeof b.hostLifecycle.startedAt, "string");
  assert.equal(b.hostLifecycle.endedAt, null, "no stop observed: never assumed ended");
});

test("an Agent call seen carrying a run's envelope and not answered yet is a launch in progress, said as such and never guessed", () => {
  const b = bindingsOf({ model: model(), trail: [invoked("c1", `${MSN}/arn-1`), ev("agent.started", { id: "orbit:satellite-reader", agent: A }), used(A)] }).get("arn-1");
  assert.deepEqual([b.word, b.hostAgent, b.carried, b.counts.direct], ["UNATTRIBUTED", null, 1, 0], "an agent started beside it is not taken to be its agent");
  assert.match(b.basis, /the agent it launched is named when that call answers/);
});
