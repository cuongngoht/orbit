// RECONCILING a generated test's dispatch that never settled (doc §11; PBI 19): a start with no evaluation is read back
// by the rows of RECONCILE, never sent again. One that may still be running is left alone; a late envelope is held to
// the very request that was dispatched; a worker that never ran proved and spent nothing; one that is gone with grants
// to write is AMBIGUOUS, keeps its step unsettled for a person, and its version is never sent again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { inputFindings } from "../src/capability/invoke.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { generated } from "../src/investigation/generate.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { RECONCILE, reconciledRuns } from "../src/investigation/reconcile-runs.mjs";
import { DISPATCH_SLACK_MS, ranVersion } from "../src/investigation/run-version.mjs";
import { unsettled } from "../src/investigation/stop.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { WORKER_API } from "../src/run/worker.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ID = "inv-20261022-120000-abcd";
const STARTED_AT = Date.parse("2026-09-20T00:00:00.000Z");
const DEADLINE_MS = 120000;
const caps = new Map(familyCapabilities().map((c) => [c.id, { ...c, from: "pack:orbit-backend-test" }]));
const call = (capability, input) => ({ do: "call", capability, input });
const design = { obligation: "tob-abc123", skeleton: { steps: [call("orbit.scheduler.trigger", { scheduleRef: "billing-daily", fixtureRef: "fx", request: {} }), call("orbit.state.read", { stateRef: "reminders", fixtureRef: "fx", request: {} })] }, assertions: [{ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 2 }], controls: [{ role: "positive" }], fixtureRefs: ["fx"], trigger: { kind: "schedule", ref: "billing-daily", step: 1 }, effectScope: "fixture" };

// A world whose host DIES mid-dispatch: everything up to `started` is journaled, and the dispatch never answers.
function died({ grants = [{ id: "grt-0000000000000001", capability: { id: "orbit.scheduler.trigger" }, bounds: { maxUses: 1 } }] } = {}) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "one reminder per due occurrence" });
  store.appendOnce(ID, "obligation", { id: "obr-1", eventId: eventIdOf("obligation", "tob-abc123", 0, "r1"), obligation: "tob-abc123", revision: "r1", shape: "occurrence-one-execution", authority: "accepted" });
  const graph = fakeContext().graph;
  const generation = { contextFor: () => ({ expectations: new Map([["FIX-ASYNC-1/E2", { id: "E2", property: "effect.count", op: "count-eq", value: 1 }]]), outputsOf: (step) => ({ 1: { executionRef: "execution.ref" }, 2: { count: "effect.count" } })[step], shape: { ...shapeOf("occurrence-one-execution"), controls: ["positive"] }, caseId: "gen-billing-once", title: "one reminder", validate: (c) => validate(c, graph, CORE, undefined, (id) => caps.get(id) ?? null), inputFindings: (s) => inputFindings(caps.get(s.capability), s.input), dsl: CORE, pageOf: (id) => caps.get(id)?.page }), saveDraft: () => {}, versions: { engineVersion: "0.1.0", validatorVersion: "core", dslDigest: "d".repeat(64), extensionsDigest: "e".repeat(64) } };
  const seen = { prepared: 0, sent: [], back: null };
  const dispatch = { prepare: () => (seen.prepared++, { bindings: { schedule: { "billing-daily": { alias: "billing-daily" } } }, secrets: { ORBIT_BIND_HOOKS_TOKEN: "s3cr3t" }, grants, fixture: { namespace: "orbit-ab12" }, gaps: [], sandbox: "sbx-1", tree: "tree-a", deadlineMs: DEADLINE_MS }), run: (x) => { seen.sent.push(x); throw new Error("the host died"); }, readBack: () => seen.back, provedBy: (s) => CORE.provedBy(s), canStop: () => false };
  const clock = { ms: STARTED_AT };
  const w = { id: ID, store, io, generation, dispatch, now: () => clock.ms, ctx: { graph } };
  const version = generated(w, { obligation: "tob-abc123", design }).version;
  store.append(ID, "decision", { id: "dec-1", revision: 1, target: "tob-abc123", action: { kind: "run-version", version }, evidence: [], hypothesis: "it holds", reason: "run it", mutates: true });
  assert.throws(() => ranVersion(w, { version }), /the host died/);
  return { w, seen, version, clock, model: () => modelOf(store.read(ID)), sent: () => seen.sent[0] };
}

const PASSED = (sent) => {
  const digest = sent.request.case.digest;
  return { envelope: { v: WORKER_API, runId: sent.request.runId, nonce: sent.request.nonce, caseDigest: digest, status: "PASS", result: { status: "PASS", case_digest: digest, proved: { api: 1, sql: 1 }, verdicts: 2, done: 2 }, evidence: null, files: [] }, records: [{ kind: "run", case_digest: digest }, { kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: true }], listed: new Map() };
};

const past = (t) => (t.clock.ms = STARTED_AT + DEADLINE_MS + DISPATCH_SLACK_MS + 1);

test("RECONCILE is ordered: what may still run first, a late envelope before any loss, and AMBIGUOUS last", () => {
  assert.deepEqual(RECONCILE.map((r) => r.id), ["IN_FLIGHT", "LATE", "RUNNING", "NEVER_RAN", "LOST_READ", "LOST"]);
});

test("the request is kept before the dispatch, its secrets by name only, under the digest its start records", () => {
  const t = died();
  const start = t.model().starts[0];
  const kept = t.w.store.readArtifact(ID, "dispatches", start.request);
  assert.deepEqual([kept.runId, kept.nonce, kept.secrets], [start.execution, t.sent().request.nonce, ["ORBIT_BIND_HOOKS_TOKEN"]]);
  assert.equal(JSON.stringify(kept).includes("s3cr3t"), false);
});

test("a start within its deadline and its dispatch's own bound may still be running: nothing is decided, nothing written", () => {
  const t = died();
  t.seen.back = { why: "no envelope yet", worker: "none" };
  const before = t.w.store.read(ID).length;
  assert.deepEqual(reconciledRuns(t.w).map((r) => [r.rule, r.outcome]), [["IN_FLIGHT", null]], "a worker not yet created is not a worker that never ran");
  assert.equal(t.w.store.read(ID).length, before);
});

test("a late envelope is judged now by the host's own check, against the request that was dispatched -- and settles its step", () => {
  const t = died();
  past(t);
  t.seen.back = { ...PASSED(t.sent()), worker: "gone" };
  const [r] = reconciledRuns(t.w);
  assert.deepEqual([r.rule, r.outcome, r.cause, r.settled], ["LATE", "SATISFIED", "MET", "dec-1"]);
  assert.deepEqual([t.model().runs.at(-1).status, unsettled(t.model()).length], ["PASS", 0]);
  const forged = died();
  past(forged);
  forged.seen.back = { ...PASSED(forged.sent()), worker: "ended" };
  forged.seen.back.envelope.nonce = "0".repeat(24);
  assert.equal(reconciledRuns(forged.w)[0].outcome, "EXECUTION_ERROR", "an envelope that answers another dispatch is never taken");
});

test("a worker that never ran proved and spent nothing: its attempt is an execution error, and the next attempt may run", () => {
  const t = died();
  past(t);
  t.seen.back = { why: "the worker left no envelope", worker: "none" };
  const [r] = reconciledRuns(t.w);
  assert.deepEqual([r.rule, r.outcome, r.settled], ["NEVER_RAN", "EXECUTION_ERROR", "dec-1"]);
  assert.throws(() => ranVersion(t.w, { version: t.version }), /the host died/, "a second attempt is dispatched");
  assert.equal(t.model().starts.at(-1).attempt, 2);
});

test("a worker gone with grants to write is AMBIGUOUS: its step stays for a person, and its version is never sent again", () => {
  const t = died();
  past(t);
  t.seen.back = { why: "the worker left no envelope", worker: "gone" };
  const [r] = reconciledRuns(t.w);
  assert.deepEqual([r.rule, r.outcome, r.settled], ["LOST", "AMBIGUOUS", undefined]);
  assert.deepEqual(unsettled(t.model()).map((d) => d.id), ["dec-1"], "the investigation stops on it until a person releases it");
  const prepared = t.seen.prepared;
  const again = ranVersion(t.w, { version: t.version });
  assert.deepEqual([again.outcome, t.seen.prepared], ["AMBIGUOUS", prepared], "nothing was even prepared");
  assert.deepEqual(reconciledRuns(t.w), [], "a settled start is never reconciled twice");
});

test("a worker gone that could not write is an execution error; one that still runs past every bound is left alone", () => {
  const t = died({ grants: [] });
  past(t);
  t.seen.back = { why: "the worker left no envelope", worker: "ended" };
  assert.deepEqual(reconciledRuns(t.w).map((r) => [r.rule, r.outcome]), [["LOST_READ", "EXECUTION_ERROR"]]);
  const running = died();
  past(running);
  running.seen.back = { why: "no envelope yet", worker: "running" };
  assert.deepEqual(reconciledRuns(running.w).map((r) => [r.rule, r.outcome]), [["RUNNING", null]]);
  assert.equal(running.model().evaluations.length, 0);
});

test("an envelope with no request kept to hold it to is never taken as it is", () => {
  const t = died();
  past(t);
  t.seen.back = { ...PASSED(t.sent()), worker: "ended" };
  const w = { ...t.w, store: { ...t.w.store, readArtifact: (id, kind, digest) => (kind === "dispatches" ? null : t.w.store.readArtifact(id, kind, digest)) } };
  assert.deepEqual(reconciledRuns(w).map((r) => r.rule), ["IN_FLIGHT"], "with no request kept, its deadline is not known either: it is given the longest a dispatch may run");
  t.clock.ms = STARTED_AT + 30 * 60 * 1000 + DISPATCH_SLACK_MS + 1;
  assert.deepEqual(reconciledRuns(w).map((r) => [r.rule, r.outcome]), [["LATE_UNJUDGED", "EXECUTION_ERROR"]]);
});

test("reconcile needs a way to read a dispatch back, bound by the composition root", () => {
  const t = died();
  assert.throws(() => reconciledRuns({ ...t.w, dispatch: { prepare() {}, run() {} } }), /read back a dispatch/);
});
