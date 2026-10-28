// A task's SANDBOX through the orchestrator: the environment it owns to run what it changed. The REAL
// task write door and the real loop, over a fake runtime that answers the way runtime's contract says
// (docs/plans/release-1.7.9-task-sandbox-runtime.md, section 5): a sandbox that is not trusted answers
// BLOCKED as data, a stale one is replaced, an application that stops by itself is reported.
//
// What these hold: every receipt names the source tree its evidence is about; the journal keeps no
// path, port or URL; a failure of the application is diagnosed like a failing check; the sandbox is
// stopped ONCE and released when the task ends; and a library -- nothing to run -- is told nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/task/ops.mjs";
import { cleanup, contextNow, contextOf, protocolOf, step } from "../src/orchestration/loop.mjs";
import { EVIDENCE, currentRuntimeEvidence } from "../src/orchestration/evidence.mjs";
import { HINTS } from "../src/orchestration/hints.mjs";
import { COMMANDS } from "../src/orchestration/index.mjs";
import { PREPARED, STARTED } from "../src/orchestration/sandbox.mjs";
import { TEST, decided, orchestrationWorld, passes, prepared, testing } from "./fakes/orchestration.mjs";
import { FAILING, PLAN, changed } from "./fakes/orchestration.mjs";

const APP = "node:web";
const WITH_APP = { sandbox: { startable: [APP] } };
const CRASH = (extra = "") => ({ status: 1, lines: ["Error: listen EADDRINUSE 127.0.0.1:5173", `    at Server.listen (/home/dev/app/server.js:41:9)${extra}`, "API_TOKEN=s3cr3t-value"] });

const sandboxReceipts = (o, id) => o.w.view(id).receipts.filter((r) => r.domain === "sandbox");
const sessionReceipts = (o, id) => o.w.view(id).receipts.filter((r) => r.domain === "runtime" && r.environment);

// Started, planned, changed, built and tested: in REVIEWING, with the workspace's tree as it was read back.
async function reviewing(o, spec) {
  const at = await testing(o, spec);
  await at.go({ kind: "check", command: TEST });
  return at;
}

// ---- the happy path ---------------------------------------------------------------------------

test("REVIEWING: start-sandbox prepares and starts the changed code, receipts it with the tree it ran, and the context says what to verify", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await reviewing(o);
  const before = contextOf(o.ports, id);
  assert.equal(before.stage, "REVIEWING");
  assert.deepEqual([before.sandbox, before.evidence.id], [null, "NO_SANDBOX"]);
  assert.match(before.next, /the tests pass and this checkout declares an application to run \(node:web\): start-sandbox runs the changed code/);
  assert.ok(before.allowed.includes("start-sandbox") && !before.allowed.includes("prepare-sandbox"), "REVIEWING starts one, and start prepares it");
  const out = await go({ kind: "start-sandbox" });
  const tree = o.ws.treeOf();
  assert.deepEqual([out.outcome, out.stage, out.lifecycle], ["succeeded", "REVIEWING", "VERIFYING"], "a healthy application moves nothing");
  assert.equal(out.data.sandbox.endpoints[0].port, 5173, "the host is told where it runs");
  const [box] = sandboxReceipts(o, id);
  const [session] = sessionReceipts(o, id);
  assert.deepEqual([box.outcome, box.ref === box.environment, box.sourceTree], ["READY", true, tree]);
  assert.deepEqual([session.outcome, session.environment, session.sourceTree], ["RUNNING", box.environment, tree], "the application's receipt names the same environment and tree");
  assert.equal(out.receipts[0], `sandbox:${box.ref}`, "the first receipt is the one the action cites");
  const c = await contextNow(o.ports, id);
  assert.deepEqual([c.sandbox.state, c.sandbox.stale, c.sandbox.tree, c.sandbox.running.map((r) => r.current)], ["READY", false, tree, [true]]);
  assert.match(c.next, new RegExp(`the application runs from the changed code in ${box.environment}: verify it live \\(orbit-qa-agent plan --sandbox=${box.environment}`));
  const text = COMMANDS.context.say(c);
  assert.match(text, new RegExp(`SANDBOX    ${box.environment} · READY · tree ${tree.slice(0, 12)} · 1 running`));
  assert.match(text, /APP        node:web · RUNNING/);
  assert.match(text, /NETWORK    data unknown/);
  assert.match(text, /QA         live evidence none \(NO_INVESTIGATION\)/);
});

test("without a sandbox a context prints no SANDBOX, APP or NETWORK line -- and always the QA one", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await prepared(o);
  const text = COMMANDS.context.say(await contextNow(o.ports, id));
  assert.doesNotMatch(text, /^(SANDBOX|APP|NETWORK) /m);
  assert.match(text, /^QA         live evidence none \(NO_SANDBOX\) — no sandbox holds this task's change/m);
  assert.equal(o.box.calls.length, 0, "a task with no sandbox asks runtime nothing about one");
});

// ---- trust: a person's, relayed by Control ----------------------------------------------------------

test("an untrusted sandbox blocks the environment, needing a person -- and once trusted, a prepare lifts it", async (t) => {
  const o = orchestrationWorld(t, { sandbox: { startable: [APP], trust: false } });
  const { id, go } = await testing(o);
  const blocked = await go({ kind: "prepare-sandbox" });
  assert.deepEqual([blocked.outcome, blocked.stage, blocked.lifecycle], ["error", "TESTING", "BLOCKED"]);
  const view = o.w.view(id);
  assert.deepEqual([view.blocked.stop, view.blocked.needs], ["ENVIRONMENT_BLOCKED", "person"]);
  assert.match(view.blocked.because, /not trusted yet: a person trusts it in Orbit Control/);
  assert.deepEqual(sandboxReceipts(o, id).map((r) => r.outcome), ["BLOCKED"], "what was refused is on the journal, with its environment");
  const c = contextOf(o.ports, id);
  assert.deepEqual(c.allowed, ["check-environment", "check", "prepare-sandbox", "start-sandbox"]);
  assert.match(c.next, /the sandbox waits for a person: trust it in Orbit Control \(Mission Control\), then prepare-sandbox again/);
  await assert.rejects(go({ kind: "link-investigation", investigation: "inv-20261007-120000-abcd" }), /STAGE:.*does not allow link-investigation while blocked \(ENVIRONMENT_BLOCKED\)/);
  const again = await go({ kind: "start-sandbox" });
  assert.deepEqual([again.outcome, o.w.view(id).blocked?.needs], ["error", "person"], "start asks the same question and gets the same answer");
  o.box.state.trusted = true;
  const lifted = await go({ kind: "prepare-sandbox" });
  assert.deepEqual([lifted.outcome, lifted.lifecycle, o.w.view(id).blocked], ["succeeded", "VERIFYING", null]);
  assert.deepEqual(sandboxReceipts(o, id).map((r) => [r.outcome, r.sourceTree]), [["READY", o.ws.treeOf()]], "ONE receipt, rewritten as the sandbox moved");
});

test("an interrupted preparation is AMBIGUOUS: a person settles it, and it is never prepared again by itself", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await testing(o);
  o.box.prepare = async ({ task }) => ({ environment: `env-${task.slice(4)}`, state: "AMBIGUOUS", tree: o.ws.treeOf(), reused: false, placements: {}, endpoints: [], blocked: null });
  const out = await go({ kind: "prepare-sandbox" });
  assert.deepEqual([out.outcome, o.w.view(id).blocked.needs], ["error", "person"]);
  assert.match(o.w.view(id).blocked.because, /interrupted.*a person settles it in Orbit Control/);
  assert.deepEqual(sandboxReceipts(o, id).map((r) => r.outcome), ["AMBIGUOUS"]);
});

// ---- the workspace moves ----------------------------------------------------------------------------

test("a sandbox the workspace has left is STALE until a start replaces it: the old session STOPPED, the new one RUNNING at the new tree", async (t) => {
  const o = orchestrationWorld(t, { ...WITH_APP, script: { test: [FAILING, passes()] } });
  const { id, go } = await testing(o);
  await go({ kind: "start-sandbox" });
  const first = sessionReceipts(o, id)[0];
  const oldTree = first.sourceTree;
  assert.equal((await go({ kind: "check", command: TEST })).stage, "DIAGNOSING");
  await go({ kind: "diagnose", then: "fix" });
  await changed(o, go, "src/RefundValidator.cs");
  const newTree = o.ws.treeOf();
  assert.notEqual(oldTree, newTree);
  const stale = contextOf(o.ports, id);
  assert.deepEqual([stale.sandbox.state, stale.sandbox.stale, stale.sandbox.tree, stale.sandbox.currentTree], ["STALE", true, oldTree, newTree], "derived on every read, never stored");
  assert.deepEqual([stale.evidence.state, stale.evidence.id], ["stale", "SANDBOX_STALE"]);
  await go({ kind: "check", command: "rt-command-0000b01d" });
  assert.equal((await go({ kind: "check", command: TEST })).stage, "REVIEWING");
  const held = contextOf(o.ports, id);
  assert.match(held.next, /the workspace moved since env-[0-9a-f]{12} was prepared: start-sandbox replaces what runs there with the changed code/);
  const out = await go({ kind: "start-sandbox" });
  assert.equal(out.outcome, "succeeded");
  const now = sessionReceipts(o, id);
  assert.deepEqual(now.map((r) => [r.ref === first.ref ? "old" : "new", r.outcome, r.sourceTree]), [["old", "STOPPED", oldTree], ["new", "RUNNING", newTree]], "evidence names the tree it was taken from");
  assert.deepEqual(sandboxReceipts(o, id).map((r) => [r.outcome, r.sourceTree]), [["READY", newTree]]);
  const fresh = contextOf(o.ports, id);
  assert.deepEqual([fresh.sandbox.state, fresh.sandbox.stale], ["READY", false]);
});

test("edits made in the workspace and not read back make live evidence stale before anything else says so", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await reviewing(o);
  await go({ kind: "start-sandbox" });
  assert.equal(contextOf(o.ports, id).evidence.id, "NO_INVESTIGATION");
  o.ws.edit("src/RefundValidator.cs");
  const c = contextOf(o.ports, id);
  assert.deepEqual([c.evidence.state, c.evidence.id], ["stale", "UNRECORDED_EDITS"]);
  assert.equal(c.sandbox.stale, true, "and the sandbox itself runs code the workspace no longer holds");
});

// ---- the application stops by itself ----------------------------------------------------------------

test("an application that stops after a change FAILS the attempt: CODE, low, one signature per exit -- and a start while DIAGNOSING moves nothing", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await testing(o);
  o.box.state.exitsNext = CRASH();
  const out = await go({ kind: "start-sandbox" });
  assert.deepEqual([out.outcome, out.stage, out.failure.class, out.failure.confidence], ["failed", "DIAGNOSING", "CODE", "low"]);
  assert.match(out.failure.because, /started from the changed code and stopped by itself/);
  assert.match(out.failure.signature, /^[a-f0-9]{12}$/);
  assert.match(out.data.check, /^sbx-\d+$/);
  assert.ok(out.data.excerpt.some((l) => l.includes("EADDRINUSE")), "the host sees why");
  assert.ok(out.data.excerpt.every((l) => !l.includes("s3cr3t-value")), "and nothing a secret");
  assert.deepEqual(o.w.view(id).attempts.map((a) => [a.outcome, a.failureSignature]), [["failed", out.failure.signature]]);
  assert.deepEqual(sessionReceipts(o, id).map((r) => r.outcome), ["EXITED"], "an application that is gone is owed no stop");
  const log = COMMANDS.log.run(o.ports, [id, out.data.check]);
  assert.ok(log.lines.some((l) => l.includes("EADDRINUSE")), "log <task> sbx-n reads what it printed");
  assert.ok(log.lines.every((l) => !l.includes("s3cr3t-value")));
  const c = contextOf(o.ports, id);
  assert.deepEqual([c.latestFailure.check, c.latestFailure.class, c.latestFailure.signature], [out.data.check, "CODE", out.failure.signature], "the diagnosis is shown the failure that is latest, check or application");
  o.box.state.exitsNext = CRASH();
  const again = await go({ kind: "start-sandbox" });
  assert.deepEqual([again.outcome, again.stage, again.failure.signature], ["failed", "DIAGNOSING", out.failure.signature], "the same exit, the same signature");
  assert.equal(o.w.view(id).attempts.length, 1, "a look while diagnosing opens and ends no attempt");
});

test("the same exit on two attempts is the same failure: NO_PROGRESS counts it like any repeated failure", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await testing(o);
  const signatures = [];
  for (let i = 0; i < 3; i++) {
    o.box.state.exitsNext = CRASH(` (pid ${4000 + i})`);
    const out = await go({ kind: "start-sandbox" });
    signatures.push(out.failure.signature);
    if (i < 2) {
      await go({ kind: "diagnose", then: "fix" });
      await changed(o, go);
      await go({ kind: "check", command: "rt-command-0000b01d" });
    }
  }
  assert.equal(new Set(signatures).size, 1, "a pid and a line number are not what failed");
  assert.deepEqual([o.w.view(id).lifecycle, o.w.view(id).stopReason, o.w.view(id).repeats], ["FAILED", "NO_PROGRESS", 3]);
});

// ---- the end: stopped once, released after ----------------------------------------------------------

test("cancel: ONE sandbox stop, then the release -- STOPPED and RELEASED are receipted, and a second cleanup owes nothing", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await reviewing(o);
  await go({ kind: "start-sandbox" });
  const owner = o.w.view(id).receipts.find((r) => r.domain === "runtime" && !r.environment);
  assert.equal(owner, undefined, "nothing of the developer's checkout was started");
  apply(o.w.ctx, id, "link-receipt", { domain: "runtime", ref: "rs-0000000000aa", outcome: "RUNNING", summary: "started in the checkout" });
  apply(o.w.ctx, id, "cancel", { human: true, expected: o.w.view(id).revision, because: "the requirement changed" });
  o.box.calls.length = 0;
  const out = await step(o.ports, id, decided(o.ports, id, { kind: "review" }));
  assert.equal(out.state, "cancelled");
  assert.deepEqual(o.box.calls.map((c) => c.op), ["stop", "release"], "one stop, and the release only after it");
  assert.deepEqual(o.calls.stopped.map((s) => s.session), ["rs-0000000000aa"], "the developer's checkout is stopped as it always was, and the sandbox's sessions are not asked of it");
  const [box] = sandboxReceipts(o, id);
  assert.deepEqual([box.outcome, box.environment, box.sourceTree === null], ["RELEASED", box.ref, false], "released, and still saying which tree it held");
  assert.deepEqual(sessionReceipts(o, id).map((r) => [r.outcome, r.environment === box.ref, r.sourceTree === box.sourceTree]), [["STOPPED", true, true]]);
  assert.deepEqual(out.cleanup.sessions.map((s) => s.outcome).sort(), ["STOPPED", "STOPPED"]);
  assert.equal(out.cleanup.sandbox.released, true);
  o.box.calls.length = 0;
  const second = await cleanup(o.ports, id);
  assert.deepEqual([second.sessions, second.sandbox, o.box.calls.length], [[], null, 0], "nothing owed twice, nothing asked twice");
});

test("a sandbox that cannot be released is REFUSED on the journal and tried again by the next cleanup", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await reviewing(o);
  await go({ kind: "start-sandbox" });
  apply(o.w.ctx, id, "cancel", { human: true, expected: o.w.view(id).revision });
  o.box.release = async () => ({ released: false, why: "a process runtime cannot prove its own is still using it" });
  const first = await cleanup(o.ports, id);
  assert.deepEqual([first.sandbox.released, sandboxReceipts(o, id)[0].outcome], [false, "REFUSED"]);
  assert.match(sandboxReceipts(o, id)[0].summary, /not released: a process runtime cannot prove/);
  o.box.release = async () => ({ released: true });
  assert.equal((await cleanup(o.ports, id)).sandbox.released, true);
  assert.equal(sandboxReceipts(o, id)[0].outcome, "RELEASED");
  assert.deepEqual(sessionReceipts(o, id).map((r) => r.outcome), ["STOPPED"], "stopped once, the first time");
});

test("cleanup when runtime cannot even be asked leaves UNKNOWN receipts and an error's words -- it never throws and never invents an ending", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await reviewing(o);
  await go({ kind: "start-sandbox" });
  apply(o.w.ctx, id, "cancel", { human: true, expected: o.w.view(id).revision });
  const gone = async () => {
    throw new Error("t-9 has no workspace of its own here");
  };
  Object.assign(o.box, { stop: gone, release: gone });
  const out = await cleanup(o.ports, id);
  assert.deepEqual([out.sessions.map((s) => s.outcome), out.sandbox.released], [["UNKNOWN"], false]);
  assert.deepEqual(sandboxReceipts(o, id).map((r) => r.outcome), ["REFUSED"]);
});

// ---- the evidence ------------------------------------------------------------------------------------

const TREE = "c0de000000000000000000000000000000000001";
const OTHER = "c0de000000000000000000000000000000000002";

const GOOD = () => ({ task: "tsk-0123456789ab", taskTree: { live: TREE, recorded: TREE }, sandbox: { environment: "env-0123456789ab", state: "READY", stale: false, owner: "tsk-0123456789ab" }, investigation: { ended: true, runtime: { environment: "env-0123456789ab", task: "tsk-0123456789ab", sourceTree: TREE } } });

test("every EVIDENCE row is reachable on its own, in order, and only a current one rests on this task's sandbox at this task's tree", () => {
  const breaks = {
    NO_SANDBOX: [(e) => { e.sandbox = null; }, "none"],
    NOT_OWNED: [(e) => { e.sandbox.owner = "tsk-ffffffffffff"; }, "none"],
    UNRECORDED_EDITS: [(e) => { e.taskTree.recorded = OTHER; }, "stale"],
    SANDBOX_STALE: [(e) => { e.sandbox.state = "STALE"; }, "stale"],
    NO_INVESTIGATION: [(e) => { e.investigation = null; }, "none"],
    OTHER_ENVIRONMENT: [(e) => { e.investigation.runtime.environment = "env-ffffffffffff"; }, "none"],
    OTHER_TASK: [(e) => { e.investigation.runtime.task = "tsk-ffffffffffff"; }, "none"],
    INVESTIGATION_STALE: [(e) => { e.investigation.runtime.sourceTree = OTHER; }, "stale"],
    UNSETTLED: [(e) => { e.investigation.ended = false; }, "pending"],
    CURRENT: [() => {}, "current"],
  };
  assert.deepEqual(EVIDENCE.map((r) => r.id), Object.keys(breaks), "the rows, in the order they are asked");
  for (const [id, [make, state]] of Object.entries(breaks)) {
    const e = GOOD();
    make(e);
    assert.deepEqual([currentRuntimeEvidence(e).id, currentRuntimeEvidence(e).state], [id, state], id);
    assert.ok(currentRuntimeEvidence(e).say.length > 0);
  }
  const two = GOOD();
  two.sandbox.state = "STALE";
  two.investigation = null;
  assert.equal(currentRuntimeEvidence(two).id, "SANDBOX_STALE", "the earlier row decides");
  assert.deepEqual([...new Set(EVIDENCE.map((r) => r.state))].sort(), ["current", "none", "pending", "stale"]);
  assert.equal(EVIDENCE.at(-1).when({}), true, "the last row always answers");
  assert.equal(currentRuntimeEvidence({ ...GOOD(), investigation: { ended: true, runtime: null } }).id, "OTHER_ENVIRONMENT", "an investigation that was told no sandbox did not look at this one");
});

test("an investigation that looked at THIS sandbox at THIS tree is current evidence; when the workspace moves it is stale", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await reviewing(o);
  await go({ kind: "start-sandbox" });
  const environment = sandboxReceipts(o, id)[0].environment;
  const inv = "inv-20261007-120000-abcd";
  o.investigations.set(inv, { lifecycle: "completed", ended: false, reason: null, findings: 0, defects: 0, runtime: { environment, task: id, sourceTree: o.ws.treeOf() } });
  await go({ kind: "link-investigation", investigation: inv });
  assert.deepEqual([contextOf(o.ports, id).evidence.state, contextOf(o.ports, id).evidence.id], ["pending", "UNSETTLED"]);
  o.investigations.get(inv).ended = true;
  assert.deepEqual([contextOf(o.ports, id).evidence.state, contextOf(o.ports, id).evidence.id], ["current", "CURRENT"]);
  assert.match(COMMANDS.context.say(contextOf(o.ports, id)), /QA         live evidence current \(CURRENT\)/);
  o.investigations.get(inv).runtime.sourceTree = OTHER;
  assert.equal(contextOf(o.ports, id).evidence.id, "INVESTIGATION_STALE");
});

// ---- the hints --------------------------------------------------------------------------------------

test("a library -- nothing to run -- is told nothing about a sandbox, and may not ask for one", async (t) => {
  const o = orchestrationWorld(t);
  const { id, go } = await reviewing(o);
  const c = contextOf(o.ports, id);
  assert.match(c.next, /^next: one of review, commit, push, link-investigation, gather-context, start-sandbox — decide on revision \d+$/);
  await assert.rejects(go({ kind: "start-sandbox" }), /ACTION_CHECK: this checkout declares nothing a sandbox could start — there is no application to run/);
  assert.equal(o.box.calls.length, 0);
});

test("the hints are ordered rows, each with a sentence, and none speaks while a diagnosis is owed", async (t) => {
  assert.deepEqual(HINTS.map((h) => h.id), ["PLAN_FIRST", "BASELINE", "SANDBOX_PERSON", "SANDBOX_STALE", "VERIFY_LIVE", "SANDBOX_READY", "PREPARE_SANDBOX"]);
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await reviewing(o);
  await go({ kind: "start-sandbox" });
  await go({ kind: "link-investigation", investigation: "inv-20261007-120000-abcd" }).catch(() => null);
  o.box.state.exitsNext = CRASH();
  apply(o.w.ctx, id, "stage", { stage: "DIAGNOSING" });
  assert.doesNotMatch(contextOf(o.ports, id).next, /application|moved since|verify it live|prepared/, "diagnose first");
});

test("PREPARE_SANDBOX names prepare-sandbox where it is allowed, and a prepared sandbox with nothing running says start", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await prepared(o);
  await go(PLAN);
  assert.doesNotMatch(contextOf(o.ports, id).next, /declares an application/, "tests have not passed yet");
  await changed(o, go);
  await go({ kind: "check", command: "rt-command-0000b01d" });
  assert.equal(o.w.view(id).stage, "TESTING");
  assert.doesNotMatch(contextOf(o.ports, id).next, /declares an application/, "and neither have the tests of this stage");
  await go({ kind: "prepare-sandbox" });
  const c = contextOf(o.ports, id);
  assert.equal(c.sandbox.state, "READY");
  assert.match(c.next, /is prepared and nothing runs in it: start-sandbox brings the application up from the changed code/);
});

// ---- the protocol ------------------------------------------------------------------------------------

test("start-sandbox takes a component and nothing else: a port, a provider, a cwd or a command is refused by name, never run", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id } = await reviewing(o);
  const refused = async (decision, rule) => {
    const before = o.w.text(id);
    await assert.rejects(step(o.ports, id, decision), new RegExp(`${rule}:`));
    assert.equal(o.w.text(id), before, `${rule} wrote nothing`);
  };
  const ok = (action) => decided(o.ports, id, action);
  for (const extra of [{ port: 5173 }, { provider: "native" }, { cwd: "src" }, { env: { A: "b" } }, { url: "http://127.0.0.1:1/" }]) await refused(ok({ kind: "start-sandbox", ...extra }), "FIELDS_OF_ACTION");
  await refused({ ...ok({ kind: "start-sandbox" }), command: "npm start" }, "FIELDS");
  await refused({ ...ok({ kind: "start-sandbox" }), sandbox: "env-0123456789ab" }, "FIELDS");
  for (const component of ["../x", "Web", "web app", "", "a".repeat(65), 7]) await refused(ok({ kind: "start-sandbox", component }), "ACTION_CHECK");
  assert.equal(o.box.calls.length, 0);
  const protocol = protocolOf();
  assert.deepEqual(protocol.actions.filter((a) => a.kind.endsWith("-sandbox")).map((a) => [a.kind, a.fields, a.required]), [["prepare-sandbox", [], []], ["start-sandbox", ["component"], []]]);
});

test("prepare-sandbox and start-sandbox need the task's workspace, and the stage that allows them", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id } = await prepared(o);
  await assert.rejects(step(o.ports, id, decided(o.ports, id, { kind: "start-sandbox" })), /STAGE: PLANNING does not allow start-sandbox — it allows plan, check, gather-context, prepare-sandbox/);
  await assert.rejects(step(o.ports, id, decided(o.ports, id, { kind: "prepare-sandbox", component: "web" })), /FIELDS_OF_ACTION/);
});

test("the whole journal of a sandboxed run keeps no path, no port, no URL, no command line and no line of output", async (t) => {
  const o = orchestrationWorld(t, WITH_APP);
  const { id, go } = await testing(o);
  await go({ kind: "prepare-sandbox" });
  o.box.state.exitsNext = CRASH();
  const out = await go({ kind: "start-sandbox" });
  assert.equal(out.outcome, "failed");
  await go({ kind: "diagnose", then: "retest" });
  const text = o.w.text(id);
  for (const leak of [o.dir, "/home/dev", "5173", "127.0.0.1", "http://", "https://", "EADDRINUSE", "s3cr3t-value", "server.js", "npm", "argv", "stdout", "stderr"]) assert.ok(!text.includes(leak), `the journal holds ${leak}`);
  assert.ok(text.includes(sandboxReceipts(o, id)[0].environment), "it names the environment");
  assert.ok(text.includes(o.ws.treeOf()), "and the tree");
});

test("the sandbox's own tables: a blocked answer names who must act, a clean one is ok, and nothing is invented", () => {
  assert.deepEqual(PREPARED.map((r) => r.id), ["BLOCKED", "AMBIGUOUS", "PREPARED"]);
  assert.deepEqual(STARTED.map((r) => r.id), ["BLOCKED", "EXITED", "NOTHING", "STARTED"]);
  assert.equal(PREPARED.at(-1).when({}), true);
  assert.equal(STARTED.at(-1).when({}), true);
  const none = { environment: "env-0123456789ab", tree: TREE, started: [], reused: [], replaced: [], exited: [], blocked: [], notReady: [], skipped: [] };
  const row = (s) => STARTED.find((r) => r.when(s)).id;
  assert.equal(row(none), "NOTHING");
  assert.equal(row({ ...none, blocked: [{ component: "web", because: "x" }] }), "BLOCKED", "nothing started and something blocked");
  assert.equal(row({ ...none, blocked: [{ component: "web", needs: "capability", because: "x" }], started: [{ component: "api", session: "rs-0123456789ab" }] }), "BLOCKED", "a need names who must act, even if another started");
  assert.equal(row({ ...none, started: [{ component: "web", session: "rs-0123456789ab" }] }), "STARTED");
  assert.equal(row({ ...none, reused: [{ component: "web", session: "rs-0123456789ab" }] }), "STARTED", "an application already running at this tree is enough");
  assert.equal(row({ ...none, state: "BLOCKED", blocked: { needs: "person", because: "x" } }), "BLOCKED", "a blocked answer is data, in either shape");
  const blocked = STARTED[0].then({ ...none, blocked: { needs: "person", because: "trust it" } });
  assert.deepEqual([blocked.outcome, blocked.needs, blocked.because], ["error", "person", "trust it"]);
  const still = STARTED[0].then({ ...none, blocked: [{ component: "web", needs: "capability", because: "x" }], started: [{ component: "api", session: "rs-0123456789ab" }] });
  assert.deepEqual(still.receipts.map((r) => [r.domain, r.outcome]), [["sandbox", "BLOCKED"], ["runtime", "RUNNING"]], "what is running is still owed a stop");
});
