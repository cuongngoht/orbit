// RUN-VERSION (PBI 12, 13): a frozen version is run in the sandbox through the ports the
// composition root binds; its grants, its sealed bindings and its intent are journaled BEFORE the
// dispatch; and what it came to is decided by the HOST -- its own check of the envelope, then
// RESULT -- never by the worker. A version that writes runs only in a mode that may write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { envelopeOf as workerEnvelopeOf } from "../cli/sandbox-worker.mjs";
import { run as hooks } from "../skills/orbit-backend-test/hooks/operations.mjs";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { createAdapterRegistry } from "../src/adapters/registry.mjs";
import { mergeSemantics } from "../src/adapters/semantics.mjs";
import { HELPER_API } from "../src/capability/helper.mjs";
import { inputFindings, invokeCapability } from "../src/capability/invoke.mjs";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { ACTIONS } from "../src/investigation/dispatch.mjs";
import { generated } from "../src/investigation/generate.mjs";
import { loopWorld, resultView } from "../src/investigation/loop.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { NEVER_RAN, ranVersion } from "../src/investigation/run-version.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { WORKER_API } from "../src/run/worker.mjs";
import { WORKER_NOW } from "../src/runtime/sandbox/dispatch.mjs";
import { freezeVersion } from "../src/qa/generation/version.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeTools } from "./fakes/tools.mjs";

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

// A worker that claims a PASS its own run log does not hold is not believed -- and a worker the host does not believe has
// said nothing of what it did. These runs had grants to write (`world`'s prepare mints one), so they are AMBIGUOUS: held
// back, never dispatched again (0.5.0 review of B7). They were EXECUTION_ERROR, whose "read back first" nothing enforced,
// so the next attempt ran -- and a write that may have happened was free to happen again.
const liarOf = (x) => ({ ...envelopeFor(x, "PASS", [{ kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: true }]), records: [{ kind: "run", case_digest: x.request.case.digest }, { kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: false, error: "x" }] });

test("a contradiction of the compiled verdict is CONTRADICTED; a claimed PASS over a failed step is the worker not believed -- and with grants, never sent again", () => {
  const failed = world((x) => envelopeFor(x, "FAIL", [{ kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: false, error: "EXPECT FAILED", contradiction: true }], { failure: { contradiction: true } }));
  assert.equal(ranVersion(failed.w, { version: failed.version }).outcome, "CONTRADICTED");
  const liar = world(liarOf);
  const out = ranVersion(liar.w, { version: liar.version });
  assert.deepEqual([out.outcome, out.rule], ["AMBIGUOUS", "UNBELIEVED_WRITE"], out.why);
  assert.ok(out.findings.length > 0);
  assert.deepEqual([ranVersion(liar.w, { version: liar.version }).outcome, liar.calls.run.length], ["AMBIGUOUS", 1], "what it did is unknown: held back, never dispatched again");
  const silent = world(() => ({ why: "the worker was killed" }));
  const s = ranVersion(silent.w, { version: silent.version });
  assert.deepEqual([s.rule, s.outcome], ["UNBELIEVED_WRITE", "AMBIGUOUS"], "no envelope, and nothing saying its worker never ran: what reconcile calls LOST");
  assert.deepEqual([ranVersion(silent.w, { version: silent.version }).outcome, silent.calls.run.length], ["AMBIGUOUS", 1]);
});

// What frees an attempt the host could not believe to run again: that it could write nothing, or that its worker's own
// receipt says it never ran (src/investigation/run-version.mjs NEVER_RAN, the words of src/runtime/sandbox/dispatch.mjs
// WORKER_NOW) -- never a missing word, and never a worker that ran and ended without one.
test("a run the host could not believe runs again only when it could write nothing, or its worker's receipt says it never ran", () => {
  const readOnly = (t) => ((prepare) => (t.w.dispatch.prepare = (x) => ({ ...prepare(x), grants: [] })))(t.w.dispatch.prepare);
  const liar = world(liarOf);
  readOnly(liar);
  const l = ranVersion(liar.w, { version: liar.version });
  assert.deepEqual([l.rule, l.outcome], ["ENVELOPE", "EXECUTION_ERROR"], l.why);
  ranVersion(liar.w, { version: liar.version });
  assert.equal(liar.calls.run.length, 2, "it could write nothing: a new attempt runs");
  for (const worker of NEVER_RAN) {
    const never = world(() => ({ why: "the worker left no envelope", worker }));
    const a = ranVersion(never.w, { version: never.version });
    assert.deepEqual([a.rule, a.outcome], ["NEVER_RAN", "EXECUTION_ERROR"], worker);
    ranVersion(never.w, { version: never.version });
    assert.equal(never.calls.run.length, 2, `${worker}: nothing it was granted was spent, so a new attempt runs`);
  }
  for (const worker of ["ended", "gone", "running", null]) {
    const may = world(() => ({ why: "the worker left no envelope", worker }));
    assert.equal(ranVersion(may.w, { version: may.version }).outcome, "AMBIGUOUS", `${worker}: it may have run`);
  }
  assert.deepEqual(NEVER_RAN.filter((id) => !WORKER_NOW.some((row) => row.id === id)), [], "each is a word a worker's receipt is read back as");
});

// What 0.4.0's diagnosis found (0.5.0 B7): a worker interrupted before its runner finished -- its deadline, its
// supervisor, a runner that ended without a word -- left the envelope its wrapper writes (cli/sandbox-worker.mjs), and
// the host judged it EXECUTION_ERROR, "ran another case", which a host may try again. It is its own outcome: INTERRUPTED,
// a new attempt that may run, when the run could write nothing; AMBIGUOUS when it had grants to write, which is read back
// and never sent again -- a run that may have written is never free to retry.
const INTERRUPTION = "its deadline passed before the runner finished";
const interruptedRun = (x) => ({ envelope: workerEnvelopeOf(x.request, "INTERRUPTED", INTERRUPTION), records: [], listed: new Map() });

test("an interrupted worker is its own outcome: INTERRUPTED when it could write nothing, AMBIGUOUS -- never sent again -- when it had grants", () => {
  const writing = world(interruptedRun);
  const a = ranVersion(writing.w, { version: writing.version });
  assert.deepEqual([a.outcome, a.rule, a.findings], ["AMBIGUOUS", "INTERRUPTED_WRITE", []], a.why);
  assert.deepEqual([ranVersion(writing.w, { version: writing.version }).outcome, writing.calls.run.length], ["AMBIGUOUS", 1], "what it did is unknown: held back, never dispatched again");
  const reading = world(interruptedRun);
  const prepare = reading.w.dispatch.prepare;
  reading.w.dispatch.prepare = (x) => ({ ...prepare(x), grants: [] });
  const b = ranVersion(reading.w, { version: reading.version });
  assert.deepEqual([b.outcome, b.rule, b.findings], ["INTERRUPTED", "INTERRUPTED", []], b.why);
  assert.deepEqual(b.stopped, { step: null, do: null, capability: null, as: "interrupted", says: INTERRUPTION }, "it says why its worker said it stopped");
  const run = reading.model().runs.at(-1);
  assert.deepEqual([run.status, run.cause, run.proved, reading.model().evaluations.at(-1).outcome], ["BLOCKED", "interrupted", null, "INTERRUPTED"], "the run never reached a verdict, and proved nothing");
  ranVersion(reading.w, { version: reading.version });
  assert.equal(reading.calls.run.length, 2, "it could write nothing, so a new attempt runs");
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

// What the first real runs taught (0.1.0): a control that did not hold makes its obligation INCONCLUSIVE, never a
// contradiction -- a positive one a negative rests on, and a fault the run never saw happen.
const READS = ["owner", "other"].map((who) => ({ do: "call", capability: "orbit.http.read", input: { endpointRef: "api", identityRef: who, method: "GET", path: "/x" }, expect: "compiled:{}", proves: "api" }));

function controlled(controls, records, steps = READS, answer = answered) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "controls" });
  store.appendOnce(ID, "obligation", { id: "obr-1", eventId: eventIdOf("obligation", "tob-abc123", 0, "r1"), obligation: "tob-abc123", revision: "r1", shape: "permission-enforced", authority: "accepted" });
  const frozen = freezeVersion({ case: { id: "gen-ctl", name: "controls", seen: "src", steps }, design: "tds-ctl", versionNumber: 1, engineVersion: "0.1.0", validatorVersion: "core", dslDigest: "d".repeat(64), extensionsDigest: "e".repeat(64) });
  const kept = store.putArtifact(ID, "designs", { id: "tds-ctl", controls, compiled: [] });
  store.appendOnce(ID, "designed", { id: "dsg-1", eventId: "e-dsg", obligation: "tob-abc123", design: "tds-ctl", digest: kept.digest, state: "designed" });
  store.putVersion(ID, frozen);
  store.appendOnce(ID, "version", { id: "ver-1", eventId: "e-ver", design: "tds-ctl", case: "gen-ctl", version: frozen.id, digest: frozen.version.caseDigest });
  const dispatch = { prepare: () => ({ bindings: {}, secrets: {}, grants: [], gaps: [] }), run: ({ request }) => answer(request, records(request.case.digest)), provedBy: () => "api", canStop: () => false };
  return { w: { id: ID, store, io, dispatch }, version: frozen.id };
}

// A worker's answer that holds to its own records: what passed before the failure is what it proved.
function answered(request, records) {
  const ok = records.filter((r) => r.kind === "step" && r.ok).length;
  return { envelope: { v: WORKER_API, runId: request.runId, nonce: request.nonce, caseDigest: request.case.digest, status: "FAIL", result: { status: "FAIL", case_digest: request.case.digest, proved: { ui: 0, api: ok, sql: 0 }, verdicts: ok, done: ok, failure: { contradiction: true } }, evidence: null, files: [] }, records, listed: new Map() };
}

// The same, of a run every step of which held.
function passed(request, records) {
  const ok = records.filter((r) => r.kind === "step" && r.ok).length;
  return { envelope: { v: WORKER_API, runId: request.runId, nonce: request.nonce, caseDigest: request.case.digest, status: "PASS", result: { status: "PASS", case_digest: request.case.digest, proved: { ui: 0, api: ok, sql: 0 }, verdicts: ok, done: ok }, evidence: null, files: [] }, records, listed: new Map() };
}

const failedAt = (i, more = []) => (digest) => [{ kind: "run", case_digest: digest }, ...more, ...[1, 2].slice(0, i - 1).map((n) => ({ kind: "step", i: n, ok: true })), { kind: "step", i, ok: false, error: "EXPECT FAILED", contradiction: true }];

test("a failed POSITIVE control a negative rests on is INCONCLUSIVE; one in a design about its positive case alone is that case's contradiction", () => {
  const paired = controlled([{ role: "positive", identityRef: "owner" }, { role: "negative", identityRef: "other" }], failedAt(1));
  const a = ranVersion(paired.w, { version: paired.version });
  const alone = controlled([{ role: "positive", identityRef: "owner" }], failedAt(1));
  const b = ranVersion(alone.w, { version: alone.version });
  const negative = controlled([{ role: "positive", identityRef: "owner" }, { role: "negative", identityRef: "other" }], failedAt(2));
  const c = ranVersion(negative.w, { version: negative.version });
  assert.deepEqual([a.outcome, a.rule, b.outcome, c.outcome], ["INCONCLUSIVE", "POSITIVE_CONTROL", "CONTRADICTED", "CONTRADICTED"], JSON.stringify([a.findings, b.findings, c.findings]));
});

test("a fault the run never saw happen makes what failed after it INCONCLUSIVE, and a fault it saw lets a contradiction stand", () => {
  const seenAs = (reason) => (reason ? [{ kind: "capability", result: { attempts: [{ outcome: "fault", terminalReason: reason }] } }] : []);
  const fault = [{ role: "fault", point: "after-commit-before-ack", step: 1 }, { role: "state" }];
  const unseen = controlled(fault, failedAt(2, seenAs(null)));
  const a = ranVersion(unseen.w, { version: unseen.version });
  const seen = controlled(fault, failedAt(2, seenAs("fault:after-commit-before-ack")));
  const b = ranVersion(seen.w, { version: seen.version });
  assert.deepEqual([a.outcome, a.rule, b.outcome, b.rule], ["INCONCLUSIVE", "FAULT_NOT_SEEN", "CONTRADICTED", "CONTRADICTED"], JSON.stringify([a.findings, b.findings]));
});

// What 0.4.0's diagnosis found (0.5.0 B7): a fault control with no witness compiles no verdict of its own, so a run
// whose fault never fired held every step it had -- and was SATISFIED, a pass nothing earned: it never saw the system
// survive the fault it was about. A run is ruled INCONCLUSIVE whenever no observation carried the point, passed or
// failed; a design with no witness stays valid, and a run that saw its fault lets its pass stand.
test("a fault the run never saw happen makes a run that held INCONCLUSIVE too -- a pass after it is never earned -- and one it saw lets the pass stand", () => {
  const seenAs = (reason) => (reason ? [{ kind: "capability", result: { attempts: [{ outcome: "fault", terminalReason: reason }] } }] : []);
  const held = (seen) => (digest) => [{ kind: "run", case_digest: digest }, ...seen, { kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: true }];
  const unwitnessed = [{ role: "fault", point: "after-commit-before-ack" }, { role: "state" }];
  const never = controlled(unwitnessed, held(seenAs(null)), READS, passed);
  const a = ranVersion(never.w, { version: never.version });
  const fired = controlled(unwitnessed, held(seenAs("fault:after-commit-before-ack")), READS, passed);
  const b = ranVersion(fired.w, { version: fired.version });
  const other = controlled(unwitnessed, held(seenAs("fault:before-effect")), READS, passed);
  const c = ranVersion(other.w, { version: other.version });
  assert.deepEqual([a.outcome, a.rule, b.outcome, b.rule, c.outcome, c.rule], ["INCONCLUSIVE", "FAULT_NOT_SEEN", "SATISFIED", "MET", "INCONCLUSIVE", "FAULT_NOT_SEEN"], JSON.stringify([a.findings, b.findings, c.findings]));
  assert.equal(never.w.store.read(ID).filter((l) => l.kind === "evaluated").at(-1).outcome, "INCONCLUSIVE", "and that is what the journal keeps");
});

// What the first real Claude Code rows taught (0.4.0): a version refused at a step said why only in the worker's run
// log, and the host saw a bare INVALID_TEST / TEST_WRONG -- so it guessed at the request it should have sent. The run now
// says where it stopped and what that step's own stop said; never a failure's message, which quotes the product.
const REFUSAL = "postgres.reference read: a read below the interface names what it reads: request.key (the bound key column's value) or request.match, 4 columns at most — never a whole table — the request was not one it can make as asked — the case's mistake, not the product's";

test("a run refused at a step says where it stopped and what that step's own refusal said: the request it must send", () => {
  const t = world((x) => envelopeFor(x, "REFUSED", [{ kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: false, refused: REFUSAL, phase: "act", helperClass: "refused" }], { failure: { kind: "refused", helperClass: "refused" } }));
  const out = ranVersion(t.w, { version: t.version });
  assert.deepEqual([out.outcome, out.rule], ["INVALID_TEST", "TEST_WRONG"], JSON.stringify(out.findings));
  assert.deepEqual(out.stopped, { step: 2, do: "call", capability: "orbit.state.read", as: "refused", says: REFUSAL });
});

test("a run blocked at a step says so in words scrubbed of every secret: by shape, and by the value its dispatch sealed", () => {
  const sealed = "hooks-token-0123456789";
  const said = `workload.hooks control: POST /orbit/workload/v1/control could not reach the hooks — ${sealed} authorization: Bearer abc.def.ghi — the system behind it could not be reached`;
  const t = world((x) => envelopeFor(x, "BLOCKED", [{ kind: "step", i: 1, ok: false, blocked: `${said} ${"z".repeat(900)}`, helperClass: "transport" }], { failure: { kind: "blocked", helperClass: "transport" } }));
  const prepare = t.w.dispatch.prepare;
  t.w.dispatch.prepare = (x) => ({ ...prepare(x), secrets: { ORBIT_BIND_HOOKS_TOKEN: sealed } });
  const out = ranVersion(t.w, { version: t.version });
  assert.deepEqual([out.outcome, out.stopped.step, out.stopped.capability, out.stopped.as], ["ENVIRONMENT_BLOCKED", 1, "orbit.scheduler.trigger", "blocked"], JSON.stringify(out.findings));
  assert.equal(out.stopped.says.includes(sealed) || out.stopped.says.includes("abc.def.ghi"), false, out.stopped.says);
  assert.match(out.stopped.says, /^workload\.hooks control: POST \/orbit\/workload\/v1\/control could not reach the hooks — \[redacted\]/);
  assert.equal(out.stopped.says.length, 600, "bounded");
});

// A failed step is NAMED, so a repair knows which one it was (a fault's witness, or the read after it) -- and says
// nothing: its message quotes what the product answered.
test("a failure names the step it failed at and never its message -- it quotes what the product answered -- nor a word of a run the host did not believe", () => {
  const failed = world((x) => envelopeFor(x, "FAIL", [{ kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: false, error: 'EXPECT FAILED: count-eq 1\n     reported: {"count":0,"rows":[{"business_key":"tenant-a|inv-a"}]}', contradiction: true }], { failure: { contradiction: true } }));
  const a = ranVersion(failed.w, { version: failed.version });
  assert.deepEqual([a.outcome, a.stopped], ["CONTRADICTED", { step: 2, do: "call", capability: "orbit.state.read", as: "failed", says: null }]);
  const liar = world((x) => ({ ...envelopeFor(x, "REFUSED", [{ kind: "step", i: 1, ok: false, refused: REFUSAL }]), records: [{ kind: "run", case_digest: x.request.case.digest }, { kind: "step", i: 1, ok: true }] }));
  const b = ranVersion(liar.w, { version: liar.version });
  assert.deepEqual([b.outcome, b.stopped], ["AMBIGUOUS", null], "a worker not believed says nothing -- and this one had grants to write, so it is never sent again");
});

// What a real Claude Code QA row taught (0.4.0, ORBIT-QA-001 on Opus, three runs of three): its crash test faulted the
// worker after its effect, restarted it, then awaited the redelivery with a match on the message AND outcome
// `processed`. The clean application's redelivery settled as its own word for "no second effect"; the match left it
// out, the answer read none, complete, and the run CONTRADICTED its criterion -- on the clean application too, a false
// alarm a host could not see through, since a failed run says nothing of what it read. What the failed step's own
// match read of that very message and left out is said beside where the run stopped. The verdict is the one it was.
//
// Each observation goes through what a worker runs: the family capability, the adapter facade over the REAL worker.hooks
// declaration, and the REAL hooks helper's answer to exactly what the facade sent it -- the record the pipeline keeps.
const PACK = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "orbit-backend-test");
const SEMANTICS = mergeSemantics([{ layer: "orbit", from: "catalog/semantics.json", doc: JSON.parse(readFileSync(join(PACK, "..", "..", "catalog", "semantics.json"), "utf8")) }]);
const WORKER = JSON.parse(readFileSync(join(PACK, "adapters.json"), "utf8")).adapters.find((a) => a.id === "worker.hooks");
const MSG = "msg-0e1f0000000000c1";
const KEY = "acct-1|item-1|2026-10-25";
const helperSaid = (value) => ({ ok: true, out: `${JSON.stringify({ v: HELPER_API, ok: true, value })}\n`, err: "", status: 0 });

function pipeline(answer, records) {
  const capabilities = createCapabilityRegistry();
  for (const cap of familyCapabilities()) capabilities.register(cap, "pack:orbit-backend-test");
  const adapters = createAdapterRegistry(SEMANTICS);
  assert.deepEqual(adapters.register(WORKER, "pack:orbit-backend-test").problems, []);
  return { ctx: { capabilities, adapters, process: fakeProcess({ node: answer }), helpers: { launch: () => ({ file: "node", args: ["hooks/helper.mjs"], env: {} }) }, binder: { resolve: (kind, ref) => ({ ok: true, value: { alias: ref, transport: "orbit-workload-v1", origin: "http://hooks:8081", workload: ref }, env: {} }) }, tools: fakeTools({}), now: () => 1_000, grants: { check: () => null, spend: () => null } }, run: { c: { id: "gen-crash" }, log: { record: (r) => records.push(r) }, budget: { endsAt: 61_000 } } };
}

const observeStep = (request) => ({ do: "call", capability: "orbit.worker.observe", input: { workloadRef: "worker", request } });

async function observed(attempts, request) {
  const asked = pipeline(helperSaid({}), []);
  invokeCapability(asked.ctx, asked.run, observeStep(request));
  const deps = { fetch: async () => ({ status: 200, json: async () => ({ attempts, through: attempts.length }) }), env: {}, now: () => performance.now(), timers: { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) }, pollMs: 5 };
  const value = (await hooks(JSON.parse(asked.ctx.process.calls[0].opts.input), deps)).value;
  const kept = [];
  const answered = pipeline(helperSaid(value), kept);
  invokeCapability(answered.ctx, answered.run, observeStep(request));
  return kept.at(-1);
}

const CRASH = [
  call("orbit.workload.control", { workloadRef: "worker", request: { action: "fault", point: "after-commit-before-ack" } }),
  call("orbit.messaging.publish", { channelRef: "requested", request: { messageId: MSG, correlationId: KEY, payload: { businessKey: KEY } } }),
  observeStep({ match: { messageId: MSG }, count: 1 }),
  call("orbit.workload.control", { workloadRef: "worker", request: { action: "restart" } }),
  observeStep({ match: { messageId: MSG, outcome: "processed" }, count: 1 }),
  call("orbit.state.read", { stateRef: "reminders", request: { key: KEY } }),
].map((s) => ({ ...s, expect: "compiled:{}", proves: "api" }));
const FAULTED = [{ seq: 1, messageId: "msg-earlier", deliveryAttempt: 1, outcome: "processed", executionRef: "exe-0" }, { seq: 2, messageId: MSG, deliveryAttempt: 1, outcome: "fault", terminalReason: "fault:after-commit-before-ack", executionRef: "exe-1" }];
const REDELIVERED = [...FAULTED, { seq: 3, messageId: MSG, deliveryAttempt: 2, outcome: "duplicate", executionRef: "exe-1", workload: "worker" }];
const CRASH_CONTROLS = [{ role: "fault", point: "after-commit-before-ack", step: 3 }, { role: "state" }];
const crashRun = (witness, awaited) => (digest) => [{ kind: "run", case_digest: digest }, { kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: true }, witness, { kind: "step", i: 3, ok: true }, { kind: "step", i: 4, ok: true }, awaited, { kind: "step", i: 5, ok: false, error: "EXPECT FAILED: complete on attempts[].outcome", phase: "act", contradiction: true }];
const unexcluded = (record) => ({ ...record, result: Object.fromEntries(Object.entries(record.result).filter(([k]) => k !== "excluded")) });

test("a run that failed on an observation whose match left out the very message it names says what it left out, where it stopped -- and its verdict is the one it was", async () => {
  const witness = await observed(FAULTED, { match: { messageId: MSG }, count: 1 });
  const awaited = await observed(REDELIVERED, { match: { messageId: MSG, outcome: "processed" }, count: 1 });
  const t = controlled(CRASH_CONTROLS, crashRun(witness, awaited), CRASH);
  const out = ranVersion(t.w, { version: t.version });
  assert.deepEqual([out.outcome, out.rule], ["CONTRADICTED", "CONTRADICTED"], JSON.stringify(out.findings));
  const host = resultView(out).stopped;
  assert.deepEqual([host.step, host.capability, host.as, host.says], [5, "orbit.worker.observe", "failed", null], "the failure itself still says nothing of what it read");
  assert.deepEqual(host.excluded, {
    field: "attempts",
    count: 2,
    by: ["outcome"],
    items: [{ messageId: MSG, deliveryAttempt: 1, outcome: "fault", terminalReason: "fault:after-commit-before-ack", executionRef: "exe-1" }, { messageId: MSG, deliveryAttempt: 2, outcome: "duplicate", executionRef: "exe-1" }],
    say: "2 of the attempts this step read have the messageId its match names and were left out by the rest of it — outcome fault, duplicate where the match asks processed: what this step ruled on never saw them",
  }, "the redelivery that settled another way, which an answer of none, complete, had hidden -- and no field the adapter does not declare");
  const before = controlled(CRASH_CONTROLS, crashRun(witness, unexcluded(awaited)), CRASH);
  const was = ranVersion(before.w, { version: before.version });
  assert.deepEqual([was.outcome, was.rule, was.stopped.excluded], ["CONTRADICTED", "CONTRADICTED", undefined], "the verdict of the same run with nothing said beside it");
});

test("a fault that shows only in what a match left out was never observed: FAULT_NOT_SEEN stands, exactly as before", async () => {
  const nothing = await observed([FAULTED[0]], { match: { messageId: MSG }, count: 1 });
  const awaited = await observed(REDELIVERED, { match: { messageId: MSG, outcome: "processed" }, count: 1 });
  assert.match(JSON.stringify(awaited.result.excluded), /fault:after-commit-before-ack/, "the fault's reason is there -- in what the match left out");
  const t = controlled(CRASH_CONTROLS, crashRun(nothing, awaited), CRASH);
  const out = ranVersion(t.w, { version: t.version });
  assert.deepEqual([out.outcome, out.rule], ["INCONCLUSIVE", "FAULT_NOT_SEEN"], JSON.stringify(out.findings));
  assert.equal(out.stopped.excluded.count, 2, "and it is still said to the host");
});

test("a run refused before any step says why its envelope gave, and names no step", () => {
  const why = 'case is invalid — fix it before running:\n  step 2: orbit.state.read input: unknown key "businessKey"';
  const t = world((x) => ({ envelope: { v: WORKER_API, runId: x.request.runId, nonce: x.request.nonce, caseDigest: x.request.case.digest, status: "REFUSED", why, result: null, evidence: null, files: [] }, records: [], listed: new Map() }));
  const out = ranVersion(t.w, { version: t.version });
  assert.deepEqual([out.outcome, out.stopped], ["INVALID_TEST", { step: null, do: null, capability: null, as: "refused", says: why }], JSON.stringify(out.findings));
});
