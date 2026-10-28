// The tables the loop reads, row by row: what each stage allows, what a settled action moves, what
// completion needs, what a review calls drift, why the loop stops -- and the governance table held
// against the command and action surface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { documented, headerOf } from "../src/trace/commands.mjs";
import { ACTIONS, ACTION_KINDS } from "../src/orchestration/dispatch.mjs";
import { DISPATCHER, NOT_ORCHESTRATION, OPERATIONS, classOfAction, classOfCommand } from "../src/orchestration/governance.mjs";
import { COMMANDS, COMMAND_NAMES } from "../src/orchestration/index.mjs";
import { gateOf, verdictOf } from "../src/orchestration/policy.mjs";
import { fingerprintOf } from "../src/protected/authorize.mjs";
import { BOUNDARY_IDS } from "../src/protected/boundaries.mjs";
import { inScope, reviewOf, scopeProblem, unexpectedOf } from "../src/orchestration/review.mjs";
import { CLEARS, MOVES, STAGES, allowedNow, beforeAct, movesOf, unblocks } from "../src/orchestration/stages.mjs";
import { STOPS, STOP_EVIDENCE, stopOf } from "../src/orchestration/stop.mjs";
import { COMPLETION, completable, unmet } from "../src/orchestration/verification.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "autonomous-engineering.mjs");

// A synthetic world: a view, its journal lines, the declared checks. It holds one changed file and no
// component graph, so every component with a check is held to it (WIDENED) unless a test hands one in.
const action = (id, type, state, extra = {}) => ({ id, type, state, mutates: false, startedAt: "2026-10-07T10:00:00.000Z", ...extra });
const world = (view = {}, events = [], checks = []) => ({ id: "tsk-0123456789ab", view: { stage: "PLANNING", lifecycle: "EXECUTING", terminal: false, blocked: null, actions: [], approvals: [], attempts: [], verification: [], receipts: [], changes: { files: 1, added: 1, removed: 0, paths: [{ path: "src/a.cs" }] }, attempt: { open: false, current: null }, budget: { attempts: { spent: 0, limit: 8 }, actions: { spent: 0, limit: 100 }, minutes: { spent: 0, limit: null } }, repeats: 0, ...view }, events, checks, investigations: new Map(), now: "2026-10-07T10:00:00.000Z" });

const passedRun = (n, type, tool, at) => ({ action: action(`act-${n}`, type, "succeeded", { tool }), line: { kind: "action-started", id: `act-${n}`, n: at } });

const BUILD = { id: "rt-b", purpose: "build", component: "c", declaredAs: "build" };
const TESTS = [{ id: "rt-t1", purpose: "test", component: "c", declaredAs: "test" }, { id: "rt-t2", purpose: "test", component: "d", declaredAs: "test" }];

// ---- stages -------------------------------------------------------------------------------------

test("each stage allows exactly its row's actions, and every action is allowed somewhere", () => {
  for (const row of STAGES) assert.deepEqual(allowedNow(world({ stage: row.stage })), row.actions, row.stage);
  assert.deepEqual(ACTION_KINDS.filter((k) => !STAGES.some((s) => s.actions.includes(k))), []);
  assert.deepEqual(allowedNow(world({ stage: null })), [], "a task with no stage allows nothing");
});

test("while blocked, only what can show the block gone may run; while a change is being made, only reading it back", () => {
  const blocked = (stage, stop) => world({ stage, blocked: { stop } });
  assert.deepEqual(allowedNow(blocked("TESTING", "REQUIREMENT_BLOCKED")), ["check-requirement"]);
  assert.deepEqual(allowedNow(blocked("BUILDING", "ENVIRONMENT_BLOCKED")).sort(), ["check", "check-environment"]);
  assert.deepEqual(allowedNow(blocked("WORKSPACE", "ENVIRONMENT_BLOCKED")).sort(), ["check-environment", "prepare-workspace"]);
  assert.deepEqual(allowedNow(blocked("TESTING", "ENVIRONMENT_BLOCKED")), ["check-environment", "check", "prepare-sandbox", "start-sandbox"], "a sandbox that needs a person is retried from the stage it blocked in");
  assert.deepEqual(allowedNow(blocked("PLANNING", "ENVIRONMENT_BLOCKED")), ["check-environment", "check", "prepare-sandbox"]);
  assert.deepEqual(allowedNow(blocked("REVIEWING", "ENVIRONMENT_BLOCKED")), ["check-environment", "start-sandbox"], "REVIEWING starts one, and prepares it as it does");
  assert.deepEqual(allowedNow(blocked("REVIEWING", "REQUIREMENT_BLOCKED")), ["check-requirement"], "a sandbox clears an environment block, never a requirement's");
  assert.deepEqual(allowedNow(world({ stage: "IMPLEMENTING", actions: [action("act-3", "implement", "running")] })), ["record-changes", "gather-context"]);
  assert.ok(Object.keys(CLEARS).every((k) => ACTIONS[k]));
  assert.deepEqual(["prepare-sandbox", "start-sandbox"].map((k) => CLEARS[k]), ["ENVIRONMENT_BLOCKED", "ENVIRONMENT_BLOCKED"]);
});

test("a block is lifted only when an action that clears it shows the condition gone", () => {
  const lw = world({ stage: "BUILDING", blocked: { stop: "ENVIRONMENT_BLOCKED" } });
  assert.deepEqual(unblocks(lw, "check", { outcome: "failed" }).map((o) => o[0]), ["unblock"], "a check that RAN shows the machine can run it");
  assert.deepEqual(unblocks(lw, "check", { outcome: "error" }), []);
  assert.deepEqual(unblocks(lw, "check-requirement", { outcome: "succeeded" }), [], "it does not clear an environment block");
  assert.deepEqual(unblocks(world({ blocked: { stop: "REQUIREMENT_BLOCKED" } }), "check-requirement", { outcome: "succeeded" }).length, 1);
  const trusted = world({ stage: "TESTING", blocked: { stop: "ENVIRONMENT_BLOCKED", needs: "person" } });
  assert.deepEqual(unblocks(trusted, "prepare-sandbox", { outcome: "succeeded" }).map((o) => o[0]), ["unblock"], "trusting it, then preparing, lifts the block");
  assert.deepEqual(unblocks(trusted, "prepare-sandbox", { outcome: "error" }), [], "still not trusted: still blocked");
});

test("a check in a checking stage with no open attempt opens one, cause retry -- and nowhere else", () => {
  assert.deepEqual(beforeAct(world({ stage: "BUILDING" }), "check"), [["attempt-start", { cause: "retry" }]]);
  assert.deepEqual(beforeAct(world({ stage: "BUILDING", attempt: { open: true, current: "att-1" } }), "check"), []);
  assert.deepEqual(beforeAct(world({ stage: "PLANNING" }), "check"), [], "a baseline belongs to no attempt");
  assert.deepEqual(beforeAct(world({ stage: "BUILDING" }), "review"), []);
  assert.deepEqual(beforeAct(world({ stage: "TESTING" }), "start-sandbox"), [["attempt-start", { cause: "retry" }]], "an application that stops after an abandoned attempt belongs to one");
  assert.deepEqual(beforeAct(world({ stage: "TESTING", attempt: { open: true, current: "att-1" } }), "start-sandbox"), []);
  assert.deepEqual(beforeAct(world({ stage: "REVIEWING" }), "start-sandbox"), [], "REVIEWING is no checking stage");
  assert.deepEqual(beforeAct(world({ stage: "TESTING" }), "prepare-sandbox"), [], "preparing is no attempt's work");
});

test("every MOVES row is reachable, and the last always matches and moves nothing", () => {
  const cases = [
    ["REQUIREMENT", "check-requirement", { outcome: "succeeded" }],
    ["TESTING", "check-requirement", { outcome: "failed", because: "x" }],
    ["CONTEXT", "gather-context", { outcome: "succeeded" }],
    ["ENVIRONMENT", "check-environment", { outcome: "succeeded" }],
    ["BUILDING", "check-environment", { outcome: "failed", needs: "capability", because: "x" }],
    ["WORKSPACE", "prepare-workspace", { outcome: "succeeded", workspace: { id: "ws-x", baseRevision: "a".repeat(40) } }],
    ["WORKSPACE", "prepare-workspace", { outcome: "error", reason: "x" }],
    ["PLANNING", "check", { outcome: "error", reason: "ENOENT" }],
    ["FIXING", "record-changes", { outcome: "succeeded" }],
    ["TESTING", "check", { outcome: "failed", failure: { signature: "aaaaaaaaaaaa" } }],
    ["TESTING", "check", { outcome: "failed", asBefore: true }],
    ["REGRESSION", "check", { outcome: "error", reason: "x" }],
    ["BUILDING", "check", { outcome: "succeeded" }],
    ["TESTING", "check", { outcome: "succeeded" }],
    ["REGRESSION", "check", { outcome: "succeeded" }],
    ["DIAGNOSING", "diagnose", { outcome: "succeeded", then: "retest" }],
    ["REVIEWING", "review", { outcome: "succeeded" }],
    ["REVIEWING", "review", { outcome: "failed", failure: { signature: "bbbbbbbbbbbb" } }],
    ["DIAGNOSING", "check", { outcome: "failed" }],
    ["BUILDING", "prepare-sandbox", { outcome: "error", needs: "person", because: "trust it" }],
    ["PLANNING", "start-sandbox", { outcome: "error", reason: "nothing started" }],
    ["REVIEWING", "start-sandbox", { outcome: "failed", failure: { signature: "cccccccccccc" } }],
  ];
  const hit = new Set();
  const done = [passedRun(6, "test", "rt-t1", 12), passedRun(7, "test", "rt-t2", 13)];
  const regressed = world({ stage: "REGRESSION", actions: done.map((r) => r.action) }, done.map((r) => r.line), [BUILD, ...TESTS]);
  hit.add(MOVES.findIndex((row) => row.stages?.includes("REGRESSION") && row.kind === "check" && row.results?.includes("succeeded") && (row.when?.(regressed, {}) ?? true)));
  const built = [passedRun(5, "build", "rt-b", 11)];
  const building = world({ stage: "BUILDING", actions: built.map((r) => r.action) }, built.map((r) => r.line), [BUILD, ...TESTS]);
  hit.add(MOVES.findIndex((row) => row.stages?.includes("BUILDING") && row.kind === "check" && row.results?.includes("succeeded") && (row.when?.(building, {}) ?? true)));
  assert.deepEqual(movesOf(building, "check", { outcome: "succeeded" }), [["stage", { stage: "TESTING" }]]);
  assert.deepEqual(movesOf(world({ stage: "BUILDING" }, [], [BUILD, ...TESTS]), "check", { outcome: "succeeded" }), [], "a build still owed keeps the task in BUILDING");
  for (const [stage, kind, r] of cases) {
    const lw = world({ stage }, [], [BUILD, ...TESTS]);
    hit.add(MOVES.findIndex((row) => (row.stages === null || row.stages.includes(stage)) && (row.kind === null || row.kind === kind) && (row.results === null || row.results.includes(r.outcome)) && (row.when?.(lw, r) ?? true)));
    assert.ok(Array.isArray(movesOf(lw, kind, r)));
  }
  assert.equal(hit.size, MOVES.length, `unreached rows: ${MOVES.map((_, i) => i).filter((i) => !hit.has(i)).join(", ")}`);
  assert.deepEqual(movesOf(world({ stage: "DIAGNOSING" }, [], [BUILD]), "check", { outcome: "failed" }), [], "a diagnostic check moves nothing");
  assert.deepEqual(movesOf(world({ stage: "TESTING" }), "prepare-sandbox", { outcome: "error", needs: "person", because: "trust it" }), [["block", { stop: "ENVIRONMENT_BLOCKED", needs: "person", because: "trust it" }]]);
  assert.deepEqual(movesOf(world({ stage: "TESTING" }), "start-sandbox", { outcome: "error", reason: "nothing started" })[0][1], { stop: "ENVIRONMENT_BLOCKED", needs: "environment", because: "nothing started" }, "no one named: the machine");
  const open = { attempt: { open: true, current: "att-1" } };
  assert.deepEqual(movesOf(world({ stage: "TESTING", ...open }), "start-sandbox", { outcome: "failed", failure: { signature: "cccccccccccc" } }), [["attempt-complete", { outcome: "failed", failureSignature: "cccccccccccc" }], ["stage", { stage: "DIAGNOSING" }]]);
  assert.deepEqual(movesOf(world({ stage: "TESTING" }), "start-sandbox", { outcome: "failed", failure: { signature: "cccccccccccc" } }), [["stage", { stage: "DIAGNOSING" }]], "with no attempt open there is none to end");
  for (const stage of ["TESTING", "REGRESSION", "REVIEWING"]) assert.equal(movesOf(world({ stage, ...open }), "start-sandbox", { outcome: "failed" })[1][1].stage, "DIAGNOSING", stage);
  for (const kind of ["prepare-sandbox", "start-sandbox"]) assert.deepEqual(movesOf(world({ stage: "TESTING", ...open }), kind, { outcome: "succeeded" }), [], `${kind} succeeding moves nothing`);
  assert.deepEqual(movesOf(world({ stage: "DIAGNOSING", ...open }), "start-sandbox", { outcome: "failed" }), [], "a look at the application while diagnosing is a look, never a verdict");
  assert.deepEqual(movesOf(world({ stage: "DIAGNOSING" }, [], [BUILD]), "diagnose", { outcome: "succeeded", then: "retest" }), [["attempt-start", { cause: "retest" }], ["stage", { stage: "BUILDING" }]]);
  assert.deepEqual(movesOf(world({ stage: "DIAGNOSING" }, [], TESTS), "diagnose", { outcome: "succeeded", then: "retest" })[1], ["stage", { stage: "TESTING" }], "no build declared: straight to the tests");
});

// ---- completion, review, stops --------------------------------------------------------------------

// Two components: c holds the change, and d depends on it -- so both are held to their checks.
const GRAPH = { components: [{ key: "c", dir: "src", dependsOn: [] }, { key: "d", dir: "lib", dependsOn: ["c"] }] };

function complete() {
  const runs = [passedRun(5, "build", "rt-b", 11), passedRun(6, "test", "rt-t1", 12), passedRun(7, "test", "rt-t2", 13), passedRun(8, "review", null, 14)];
  const view = { stage: "REVIEWING", lifecycle: "VERIFYING", actions: runs.map((r) => r.action), attempts: [{ outcome: "succeeded", endedAt: "x" }], verification: [{ state: "satisfied" }] };
  return Object.assign(world(view, [{ kind: "file-changed", n: 10 }, ...runs.map((r) => r.line)], [BUILD, ...TESTS]), { graph: () => GRAPH });
}

// Both tests failed exactly as they did on the base revision: settled, and visible -- and nothing passed.
function asBeforeOnly(lw) {
  for (const a of lw.view.actions.slice(1, 3)) Object.assign(a, { state: "failed", receipts: [`check:chk-${a.id.slice(4)}`] });
  lw.view.receipts.push(...lw.view.actions.slice(1, 3).map((a) => ({ domain: "check", ref: `chk-${a.id.slice(4)}`, outcome: "failed-as-before" })));
}

// An investigation the task linked looked at a sandbox the workspace has since left.
function staleEvidence(lw) {
  lw.view.receipts.push({ domain: "sandbox", ref: "env-1", outcome: "READY", environment: "env-1", sourceTree: "a".repeat(40) }, { domain: "investigation", ref: "inv-1" });
  lw.investigations.set("inv-1", { ended: true, defects: 0, runtime: { environment: "env-1", task: lw.id, sourceTree: "a".repeat(40) } });
  lw.tree = () => ({ live: "b".repeat(40), recorded: null });
}

test("completion holds only when every row does, and each row alone can refuse it", () => {
  assert.equal(completable(complete()), true, JSON.stringify(unmet(complete())));
  const breaks = {
    REVIEWING: (lw) => { lw.view.stage = "TESTING"; },
    NOT_HELD: (lw) => { lw.view.lifecycle = "PAUSED"; },
    NO_OPEN_ACTION: (lw) => { lw.view.actions.push(action("act-9", "gather-context", "running")); },
    CHANGED: (lw) => { lw.events = lw.events.filter((e) => e.kind !== "file-changed"); },
    BUILD: (lw) => { lw.view.actions[0].state = "failed"; },
    TESTS: (lw) => { lw.view.actions[2].state = "failed"; },
    VERIFIED: asBeforeOnly,
    COVERED: (lw) => { lw.view.changes.paths.push({ path: "docs/notes.md" }); },
    LIVE: staleEvidence,
    REVIEWED: (lw) => { lw.view.actions[3].state = "failed"; },
    ATTEMPT: (lw) => { lw.view.attempts[0].outcome = "failed"; },
    VERIFICATION: (lw) => { lw.view.verification.push({ state: "violated" }); },
    INVESTIGATIONS: (lw) => { lw.view.receipts.push({ domain: "investigation", ref: "inv-1" }); lw.investigations.set("inv-1", { ended: true, defects: 1 }); },
  };
  assert.deepEqual(Object.keys(breaks).sort(), COMPLETION.map((r) => r.id).sort());
  for (const [id, broken] of Object.entries(breaks)) {
    const lw = complete();
    broken(lw);
    assert.deepEqual(unmet(lw).map((u) => u.id), [id], id);
  }
});

test("a change that passed before the last change counts for nothing after it", () => {
  const lw = complete();
  lw.events.push({ kind: "file-changed", n: 20 });
  assert.deepEqual(unmet(lw).map((u) => u.id).sort(), ["BUILD", "REVIEWED", "TESTS", "VERIFIED"]);
});

test("declared is not required: a check of a component the change does not reach is owed nothing, and a stale sandbox nobody investigated claims nothing", () => {
  const lw = complete();
  lw.graph = () => ({ components: [{ key: "c", dir: "src", dependsOn: [] }, { key: "d", dir: "lib", dependsOn: [] }] });
  lw.view.actions[2].state = "failed";
  assert.deepEqual(unmet(lw), [], "d's test failing does not matter: the change never reached d");
  const boxed = complete();
  boxed.view.receipts.push({ domain: "sandbox", ref: "env-1", outcome: "READY", environment: "env-1", sourceTree: "a".repeat(40) });
  boxed.tree = () => ({ live: "b".repeat(40), recorded: null });
  assert.deepEqual(unmet(boxed), []);
});

test("review: a path outside the plan's scope is drift, and a rename must stay inside on both ends", () => {
  assert.equal(inScope("src/refund/Validator.cs", ["src/refund"]), true);
  assert.equal(inScope("src/refundX/a.cs", ["src/refund"]), false, "a prefix of a name is not a directory");
  assert.equal(inScope("a\\b.cs", ["a/"]), true);
  assert.deepEqual(unexpectedOf([{ path: "src/refund/a.cs" }, { path: "deploy/app.yaml" }, { path: "src/refund/b.cs", from: "src/auth/b.cs" }], ["src/refund"]), ["deploy/app.yaml", "src/auth/b.cs"]);
  assert.match(reviewOf([{ path: "Startup.cs" }], ["src/refund"]).say, /1 outside the plan's scope \(Startup.cs\)/);
  assert.equal(scopeProblem(["src/a"]), null);
  for (const bad of [[], ["../x"], ["/etc"], ["C:\\x"], [""], "src", Array.from({ length: 65 }, () => "a")]) assert.ok(scopeProblem(bad), JSON.stringify(bad));
});

test("the stop rows, in order of urgency -- and only the evidence-backed ones write", () => {
  assert.deepEqual(STOPS.map((s) => s.id), ["cancelled", "ended", "paused", "waiting-approval", "requirement-moved", "no-progress", "budget", "unsettled", "blocked"]);
  assert.deepEqual(STOPS.filter((s) => s.writes).map((s) => s.id), ["requirement-moved", "no-progress", "budget"]);
  assert.equal(stopOf(world({ lifecycle: "CANCELLED", terminal: true })).id, "cancelled");
  assert.equal(stopOf(world({ repeats: 3, attempts: [{ endedAt: "x", failureSignature: "a" }] })).writes[1].stop, "NO_PROGRESS");
  assert.equal(stopOf(world({ budget: { attempts: { spent: 8, limit: 8 }, actions: { spent: 1, limit: 100 }, minutes: { spent: 0, limit: null } }, stage: "DIAGNOSING" })).id, "budget");
  assert.equal(stopOf(world({ budget: { attempts: { spent: 8, limit: 8 }, actions: { spent: 1, limit: 100 }, minutes: { spent: 0, limit: null } }, stage: "TESTING", attempt: { open: true, current: "att-8" } })), null, "the last attempt may still finish");
  assert.equal(stopOf(world()), null);
  assert.deepEqual(Object.keys(STOP_EVIDENCE).sort(), ["BUDGET_EXHAUSTED", "ENVIRONMENT_BLOCKED", "EXECUTION_FAILED", "NO_PROGRESS", "REQUIREMENT_BLOCKED", "UNSAFE_CHANGE", "VERIFICATION_FAILED"]);
});

// ---- policy and governance ------------------------------------------------------------------------

test("every step asks the protected-boundary leaf: a workspace write, a check and an ordinary write are AUTO; a push and a production deploy need a person -- and the gate carries the boundary", () => {
  const describe = (id) => ({ "x.write": { id: "x.write", mutates: true, effects: ["write"], environment: "production" }, "x.deploy": { id: "x.deploy", mutates: true, effects: ["deploy"], environment: "production" }, "x.read": { id: "x.read", mutates: false } })[id] ?? null;
  const lw = { id: "tsk-0123456789ab", describe, view: { task: { project: "repo-a" }, receipts: [{ domain: "commit", ref: "c".repeat(40) }] }, remote: () => "https://git.example.invalid/acme/repo.git" };
  for (const [kind, a] of [["implement", {}], ["record-changes", {}], ["commit", {}], ["check", { command: "rt" }], ["prepare-sandbox", {}], ["invoke", { capability: "x.read" }], ["invoke", { capability: "x.write", input: { n: 1 } }]]) {
    assert.equal(verdictOf(ACTIONS[kind], a, lw).decision, "auto", `${kind} ${a.capability ?? ""} is autonomous`);
    assert.equal(gateOf(ACTIONS[kind], a, lw), null);
  }
  assert.deepEqual(ACTIONS.implement.semantic({}, lw), { kind: "repository.write", home: "task-workspace" }, "the change is a write to the task's OWN workspace");
  const deploy = gateOf(ACTIONS.invoke, { capability: "x.deploy", input: { artifact: "a:1" } }, lw);
  assert.deepEqual([deploy.type, deploy.tool, deploy.environment, deploy.boundary, deploy.destructive], ["deployment.production", "x.deploy", "production", "PRODUCTION_DEPLOY", false]);
  assert.deepEqual(deploy.params.input, { artifact: "a:1" }, "the whole input is hashed into the fingerprint, and never kept");
  assert.notEqual(fingerprintOf(deploy), fingerprintOf(gateOf(ACTIONS.invoke, { capability: "x.deploy", input: { artifact: "a:2" } }, lw)));
  const push = gateOf(ACTIONS.push, {}, lw);
  assert.deepEqual([push.type, push.tool, push.environment, push.boundary, push.params.ref, push.params.commit, push.params.force], ["repository.push", "origin", "origin", "GIT_PUSH", "refs/heads/orbit/tsk-0123456789ab", "c".repeat(40), false]);
  assert.match(push.params.url, /^[0-9a-f]{64}$/, "the remote's URL is fingerprinted by digest, never kept");
  assert.equal(push.shows.at, "git.example.invalid/acme/repo.git", "and shown without who it signs in as");
  assert.deepEqual(BOUNDARY_IDS, ["PRIMARY_CHECKOUT_WRITE", "GIT_PUSH", "PRODUCTION_DEPLOY", "PRODUCTION_DB_MIGRATION", "PRODUCTION_DESTRUCTIVE_DATA"]);
});

test("governance: every command but the dispatcher and every action is in exactly one class, writing what its row says; none is a forbidden one", () => {
  const commands = OPERATIONS.flatMap((o) => o.commands);
  assert.deepEqual([...commands].sort(), COMMAND_NAMES.filter((c) => c !== DISPATCHER).sort());
  assert.equal(new Set(commands).size, commands.length);
  const actions = OPERATIONS.flatMap((o) => o.actions);
  assert.deepEqual([...actions].sort(), [...ACTION_KINDS].sort());
  assert.equal(new Set(actions).size, actions.length);
  for (const name of commands) assert.equal(COMMANDS[name].writes, classOfCommand(name).mutates === "none" ? "nothing" : classOfCommand(name).mutates, name);
  assert.equal(COMMANDS[DISPATCHER].writes, "by-action");
  assert.deepEqual(OPERATIONS.filter((o) => NOT_ORCHESTRATION.includes(o.class)), []);
  assert.ok(OPERATIONS.every((o) => !["repository", "primary"].includes(o.mutates)), "nothing writes the primary checkout");
  assert.deepEqual(OPERATIONS.filter((o) => o.approval !== "none").map((o) => [o.class, o.approval]), [["CAPABILITY_INVOKE", "boundary"], ["PROTECTED_DELIVERY", "control"]]);
  assert.deepEqual([classOfAction("push").class, classOfAction("commit").class], ["PROTECTED_DELIVERY", "WORKSPACE_WRITE"], "a local commit is the workspace's; a push is a protected boundary");
  assert.deepEqual([classOfAction("prepare-sandbox").class, classOfAction("start-sandbox").class], ["SANDBOX_DELEGATION", "SANDBOX_DELEGATION"]);
  assert.deepEqual([classOfAction("start-sandbox").mutates, classOfAction("start-sandbox").approval, classOfAction("prepare-sandbox").approval], ["machine", "none", "none"], "a task's own sandbox is autonomous");
  assert.equal(classOfAction("start-runtime").class, "RUNTIME_DELEGATION");
  assert.ok(ACTIONS["start-sandbox"].mutates({}, {}, null) && ACTIONS["prepare-sandbox"].mutates({}, {}, null), "both change the machine, so both are journaled as mutations");
  assert.deepEqual(ACTION_KINDS.filter((k) => ACTIONS[k].mutates({}, {}, null) === true && !["workspace", "machine"].includes(classOfAction(k).mutates)), ["push"], "the one mutation that leaves the machine is the protected push");
  assert.deepEqual(NOT_ORCHESTRATION, ["PRIMARY_CHECKOUT_WRITE", "MERGE", "ARBITRARY_SHELL", "HUMAN_APPROVAL_GRANT"]);
});

test("the CLI documents exactly its commands, offers no command-line, shell or person's flag, and its task context has no door", () => {
  const source = readFileSync(CLI, "utf8");
  const header = headerOf(source);
  assert.deepEqual([...documented(header, "autonomous-engineering")].sort(), [...COMMAND_NAMES].sort());
  assert.doesNotMatch(header, /--(cmd|command|shell|exec|human|approve|args)\b/);
  assert.match(header, /log <task> <chk-n\|sbx-n>/, "the log of a sandbox's application is read the way a check's is -- no new command");
  assert.doesNotMatch(header, /\b(sandbox|prepare-sandbox|start-sandbox)\s+<task>/, "a sandbox has no command of its own: it is two actions of step");
  const code = source.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(code, /\bdoor\s*:/, "no door: approve and resume are PERSON_UNPROVEN from here");
  assert.doesNotMatch(code, /"approve"/, "it never names a person's grant");
});
