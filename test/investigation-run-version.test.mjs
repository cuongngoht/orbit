// RUN-VERSION (PBI 12, 13): a frozen version is run in the sandbox through the ports the
// composition root binds; its grants, its sealed bindings and its intent are journaled BEFORE the
// dispatch; and what it came to is decided by the HOST -- its own check of the envelope, then
// RESULT -- never by the worker. A version that writes runs only in a mode that may write.
import assert from "node:assert/strict";
import { test } from "node:test";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { inputFindings } from "../src/capability/invoke.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { ACTIONS } from "../src/investigation/dispatch.mjs";
import { generated } from "../src/investigation/generate.mjs";
import { loopWorld } from "../src/investigation/loop.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { ranVersion } from "../src/investigation/run-version.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { WORKER_API } from "../src/run/worker.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ID = "inv-20261022-110000-abcd";
const caps = new Map(familyCapabilities().map((c) => [c.id, { ...c, from: "pack:orbit-backend-test" }]));
const call = (capability, input) => ({ do: "call", capability, input });
const design = { obligation: "tob-abc123", skeleton: { steps: [call("orbit.scheduler.trigger", { scheduleRef: "billing-daily", fixtureRef: "fx", request: {} }), call("orbit.state.read", { stateRef: "reminders", fixtureRef: "fx", request: {} })] }, assertions: [{ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 2 }], controls: [{ role: "positive" }], fixtureRefs: ["fx"], trigger: { kind: "schedule", ref: "billing-daily", step: 1 }, effectScope: "fixture" };

function world(runAnswer) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "one reminder per due occurrence" });
  store.appendOnce(ID, "obligation", { id: "obr-1", eventId: eventIdOf("obligation", "tob-abc123", 0, "r1"), obligation: "tob-abc123", revision: "r1", shape: "occurrence-one-execution", authority: "accepted" });
  const graph = fakeContext().graph;
  const generation = { contextFor: () => ({ expectations: new Map([["FIX-ASYNC-1/E2", { id: "E2", property: "effect.count", op: "count-eq", value: 1 }]]), outputsOf: (step) => ({ 1: { executionRef: "execution.ref" }, 2: { count: "effect.count" } })[step], shape: { ...shapeOf("occurrence-one-execution"), controls: ["positive"] }, caseId: "gen-billing-once", title: "one reminder", validate: (c) => validate(c, graph, CORE, undefined, (id) => caps.get(id) ?? null), inputFindings: (s) => inputFindings(caps.get(s.capability), s.input), dsl: CORE, pageOf: (id) => caps.get(id)?.page }), saveDraft: () => {}, versions: { engineVersion: "0.1.0", validatorVersion: "core", dslDigest: "d".repeat(64), extensionsDigest: "e".repeat(64) } };
  const calls = { prepare: [], run: [] };
  const dispatch = { prepare: (x) => (calls.prepare.push(x), { bindings: { schedule: { "billing-daily": { alias: "billing-daily" } } }, secrets: { ORBIT_BIND_HOOKS_TOKEN: "s3cr3t" }, grants: [{ id: "grt-0000000000000001", capability: { id: "orbit.scheduler.trigger" }, bounds: { maxUses: 1 } }], fixture: { namespace: "orbit-ab12", fresh: true }, gaps: [], sandbox: "sbx-1", tree: "tree-a" }), run: (x) => (calls.run.push(x), runAnswer(x)), provedBy: (s) => CORE.provedBy(s), canStop: () => false };
  const w = { id: ID, store, io, generation, dispatch, ctx: { graph } };
  const out = generated(w, { obligation: "tob-abc123", design });
  return { w, calls, version: out.version, model: () => modelOf(store.read(ID)) };
}

const envelopeFor = (x, status, steps, result = {}) => {
  const digest = x.request.case.digest;
  const records = [{ kind: "run", case_digest: digest }, ...steps];
  const proved = {};
  for (const s of steps.filter((r) => r.ok)) proved[x.frozen.case.steps[s.i - 1].proves] = (proved[x.frozen.case.steps[s.i - 1].proves] ?? 0) + 1;
  return { envelope: { v: WORKER_API, runId: x.request.runId, nonce: x.request.nonce, caseDigest: digest, status, result: { status, case_digest: digest, proved, verdicts: Object.values(proved).reduce((a, b) => a + b, 0), done: steps.filter((s) => s.ok).length, ...result }, evidence: null, files: [] }, records, listed: new Map() };
};

test("a version that held: authorized, prepared and started BEFORE the dispatch, and SATISFIED by the host's own check", () => {
  const t = world((x) => envelopeFor(x, "PASS", [{ kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: true }]));
  const out = ranVersion(t.w, { version: t.version });
  assert.equal(out.outcome, "SATISFIED", JSON.stringify(out.findings));
  const m = t.model();
  assert.deepEqual([m.authorizations[0].state, m.preparations[0].state, m.starts[0].execution, m.evaluations[0].outcome], ["granted", "prepared", out.execution, "SATISFIED"]);
  const sent = t.calls.run[0].request;
  assert.equal(sent.evaluation.mode, "compiled");
  assert.deepEqual(Object.keys(sent.evaluation.digests), ["1", "2"], "every verdict the design compiled is pinned");
  assert.equal(JSON.stringify(m.starts).includes("s3cr3t"), false, "the intent names its secrets, never their values");
});

test("a contradiction of the compiled verdict is CONTRADICTED; a claimed PASS over a failed step is the worker not believed", () => {
  const failed = world((x) => envelopeFor(x, "FAIL", [{ kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: false, error: "EXPECT FAILED", contradiction: true }], { failure: { contradiction: true } }));
  assert.equal(ranVersion(failed.w, { version: failed.version }).outcome, "CONTRADICTED");
  const liar = world((x) => ({ ...envelopeFor(x, "PASS", [{ kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: true }]), records: [{ kind: "run", case_digest: x.request.case.digest }, { kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: false, error: "x" }] }));
  const out = ranVersion(liar.w, { version: liar.version });
  assert.equal(out.outcome, "EXECUTION_ERROR");
  assert.ok(out.findings.length > 0);
  const silent = world(() => ({ why: "the worker was killed" }));
  assert.equal(ranVersion(silent.w, { version: silent.version }).outcome, "EXECUTION_ERROR");
});

test("what cannot be bound is BLOCKED before anything starts, and nothing is dispatched", () => {
  const t = world(() => assert.fail("nothing is dispatched"));
  t.w.dispatch.prepare = () => ({ gaps: [{ kind: "schedule", alias: "billing-daily", why: "this sandbox minted no hooks token" }] });
  const out = ranVersion(t.w, { version: t.version });
  assert.equal(out.outcome, "ENVIRONMENT_BLOCKED");
  const m = t.model();
  assert.deepEqual([m.preparations[0].state, m.starts.length], ["blocked", 0]);
});

test("a version that writes runs only in a mode that may write", () => {
  const t = world(() => ({}));
  const lw = loopWorld({ ...t.w, settings: {}, mode: "observe", ctx: { graph: t.w.ctx.graph, now: () => 0 } });
  assert.equal(ACTIONS["run-version"].mutates({ version: t.version }, lw), true, "a trigger is a write");
  assert.equal(ACTIONS["run-version"].allowed("observe", { version: t.version }, lw), false);
  assert.equal(ACTIONS["run-version"].allowed("fixture-write", { version: t.version }, lw), true);
  assert.match(ACTIONS["run-version"].check({ version: "nope" }), /frozen version id/);
});

// Security review (PBI 12): the run record is the HOST's, a dispatch that never settled is never
// sent again, and a step nothing can vouch for is taken to write.
test("a worker the host did not believe leaves a run record that is BLOCKED and proved nothing", () => {
  const liar = world((x) => ({ ...envelopeFor(x, "PASS", [{ kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: true }]), records: [{ kind: "run", case_digest: x.request.case.digest }, { kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: false, error: "x" }] }));
  ranVersion(liar.w, { version: liar.version });
  const run = liar.model().runs.at(-1);
  assert.deepEqual([run.status, run.proved, run.cause], ["BLOCKED", null, "envelope"]);
});

test("a dispatch that started and never settled is read back, never sent again", () => {
  const t = world(() => assert.fail("never dispatched twice"));
  t.w.store.appendOnce(ID, "started", { id: "str-1", eventId: "e-unsettled", attempt: 1, version: t.version, execution: "exe-dead-1" });
  const out = ranVersion(t.w, { version: t.version });
  assert.equal(out.outcome, "AMBIGUOUS");
  assert.equal(t.calls.prepare.length, 0, "nothing was even prepared");
});

test("a version step nothing can vouch for is taken to write", () => {
  const t = world(() => ({}));
  const lw = (c) => ({ versionCaseOf: () => c, ctx: { graph: { edgeOn: new Map() } } });
  assert.equal(ACTIONS["run-version"].mutates({ version: t.version }, lw({ steps: [{ do: "call", capability: "acme.unknown" }] })), true);
  assert.equal(ACTIONS["run-version"].mutates({ version: t.version }, lw({ steps: [{ do: "click", on: "home/Unmapped" }] })), true);
  assert.equal(ACTIONS["run-version"].mutates({ version: t.version }, lw({ steps: [{ do: "call", capability: "orbit.worker.observe" }, { do: "sql", query: "SELECT 1" }] })), false);
  assert.equal(ACTIONS["run-version"].mutates({ version: t.version }, lw({ destructive: true, steps: [] })), true);
});
