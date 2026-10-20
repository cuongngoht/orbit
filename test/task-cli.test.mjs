// The composition root of a TASK, driven as an agent and a person would drive it: the PBI-482
// acceptance scenario end to end -- three attempts, a decision, receipts, a migration that waits
// for a person, Approve once, the one action it allows, its receipt -- in a real Git checkout and a
// throwaway store. The real CLI binds the checkout, asks for the approval, is refused when it tries
// to grant it, spends it and reads the journal back; the many steps in between run in this process
// through the same command table the CLI dispatches, because a process per step is what a Windows
// runner pays for most. Nothing here reaches a network.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { CLI_COMMANDS, COMMANDS } from "../src/task/index.mjs";
import { apply } from "../src/task/ops.mjs";
import { createTasks } from "../src/task/store.mjs";
import { projectStoreRoot } from "../src/project/repository.mjs";
import { guardedIo } from "../src/store/guard.mjs";
import { documented, headerOf } from "../src/trace/commands.mjs";
import { EVENT_TYPES } from "../src/trace/events.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "cli", "task.mjs");

function parsed(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

// A Git checkout nobody ran Orbit in yet, and a store of its own.
function checkout(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-task-cli-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  return { base, repo, store: join(base, "store") };
}

const cli = (at, cwd, env = {}) => (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: sealed({ ORBIT_STORE_DIR: at.store, ...env }), encoding: "utf8", timeout: 60000 });
  return { status: r.status, out: r.stdout, err: r.stderr, json: parsed(r.stdout) };
};

const ok = (r) => {
  assert.equal(r.status, 0, `${r.err}${r.out}`);
  return r;
};

test("the usage header documents every subcommand a terminal may run, so the session trail may name each and nothing else", () => {
  assert.deepEqual([...documented(headerOf(readFileSync(CLI, "utf8")), "task")].sort(), [...CLI_COMMANDS].sort());
  assert.deepEqual(Object.keys(COMMANDS).filter((name) => !CLI_COMMANDS.includes(name)).sort(), ["approve", "resume"], "what allows something is Orbit Control's");
});

// A person's Approve once, through the door Orbit Control writes it with -- the page's token
// checked -- over the same store the CLI used. A terminal has no such door.
function approvedInControl(at, project, checkout, id, expected) {
  const root = projectStoreRoot(at.store, project);
  const ctx = { tasks: createTasks(root, guardedIo(root, realIo())), project, checkout, session: null, door: "control", now: () => new Date().toISOString() };
  return apply(ctx, id, "approve", { approval: "apr-1", human: true, expected });
}

test("a task is named before anything is looked at", () => {
  const inert = new Proxy({}, { get: () => { throw new Error("touched the context"); } });
  for (const name of ["show", "events", "stage", "decide", "block", "unblock", "complete", "fail", "pause", "resume", "cancel", "approve", "reject", "request-approval"]) assert.throws(() => COMMANDS[name].run(inert, []), /name the task/, name);
  for (const name of ["attempt", "act", "link", "approval"]) assert.throws(() => COMMANDS[name].run(inert, []), /one of:/, name);
  assert.throws(() => COMMANDS.attempt.run(inert, ["constructor"]), /one of:/, "an inherited name is not a subcommand");
});

// The table cli/task.mjs dispatches, in this process, over the CLI's own store and checkout: every
// subcommand's arguments are read exactly as the CLI reads them, and nothing proves a person here.
function inProcess(at, project, checkout) {
  const root = projectStoreRoot(at.store, project);
  const ctx = { tasks: createTasks(root, guardedIo(root, realIo())), project, checkout, checkoutSummary: null, session: null, now: () => new Date().toISOString() };
  return (cmd, ...args) => ({ status: 0, json: COMMANDS[cmd].run(ctx, args) });
}

// The journal PBI-482 writes, as the agent's host would write it.
function attempts(task, id) {
  const steps = [
    ["stage", id, "CONTEXT", "--because=read the project context"], ["link", "workspace", id, "--workspace=task-a82f"], ["stage", id, "IMPLEMENTING"],
    ["attempt", "start", id], ["link", "file", id, "--path=src/RefundService.cs", "--change=modified", "--added=40", "--removed=10"],
    ["stage", id, "BUILDING"], ["act", "start", id, "--type=build", "--label=build"], ["act", "complete", id, "act-1", "--outcome=succeeded"],
    ["stage", id, "TESTING"], ["act", "start", id, "--type=test", "--label=RefundTests"],
    ["link", "receipt", id, "--domain=test", "--ref=test-receipt-28", "--outcome=FAILED", "--summary=2 failed", "--action=act-2"],
    ["act", "complete", id, "act-2", "--outcome=failed", "--summary=2 failed"], ["attempt", "complete", id, "--outcome=failed", "--signature=a1b2c3d4e5f6"],
    ["stage", id, "DIAGNOSING"], ["decide", id, "--observed=2 refund boundary tests failed", "--hypothesis=validation occurs after rounding", "--next=inspect-refund-validation", "--evidence=test:test-receipt-28"],
    ["attempt", "start", id, "--cause=fix"], ["stage", id, "FIXING"], ["link", "file", id, "--path=src/RefundService.cs", "--change=modified", "--added=21", "--removed=8"],
    ["stage", id, "TESTING"], ["act", "start", id, "--type=test", "--label=RefundTests"], ["act", "complete", id, "act-3", "--outcome=failed", "--summary=1 failed"],
    ["attempt", "complete", id, "--outcome=failed", "--signature=f6e5d4c3b2a1"], ["attempt", "start", id, "--cause=fix"],
    ["act", "start", id, "--type=test", "--label=RefundTests"], ["link", "receipt", id, "--domain=test", "--ref=test-receipt-31", "--outcome=PASSED", "--action=act-4"],
    ["act", "complete", id, "act-4", "--outcome=succeeded"], ["stage", id, "REGRESSION"], ["act", "start", id, "--type=test", "--label=Regression"],
    ["request-approval", id, "--type=database.migrate", "--environment=dev", "--reason=integration verification needs schema v82", "--risk=DEV database state will be changed", '--params={"schema":82}'],
  ];
  for (const step of steps) ok(task(...step));
}

test("PBI-482 end to end: a task waits for a person, Approve once allows exactly one migration, and the timeline is the journal", (t) => {
  const at = checkout(t);
  const task = cli(at, at.repo);
  const id = ok(task("create", "PBI-482 — Refund validation", "--work=w-0123456789ab", "--root=req-0123456789ab", "--snapshot=rs-0123456789ab", "--actor=claude-code", "--json")).json.task;
  const head = ok(task("show", id, "--json")).json.task;
  attempts(inProcess(at, head.project, head.checkout), id);

  const machine = ok(cli(at, at.base)("machine", "--json")).json;
  assert.deepEqual([machine.counts.projects, machine.counts.waitingApproval, machine.counts.running], [1, 1, 0]);
  assert.deepEqual(machine.approvals.map((a) => [a.task, a.id, a.action, a.environment, a.attempt]), [[id, "apr-1", "database.migrate", "dev", "att-3"]]);
  const waiting = ok(task("show", id, "--json")).json;
  assert.deepEqual([waiting.lifecycle, waiting.stage, waiting.stopReason, waiting.attempt.number, waiting.attempt.limit], ["WAITING_APPROVAL", "REGRESSION", "HUMAN_APPROVAL_REQUIRED", 3, 8]);
  assert.deepEqual([waiting.readiness.requirement.state, waiting.readiness.workspace.ref, waiting.readiness.agent.actor], ["READY", "task-a82f", "claude-code"]);
  assert.deepEqual([waiting.decision.observed, waiting.decision.nextAction, waiting.decision.evidence], ["2 refund boundary tests failed", "inspect-refund-validation", ["test:test-receipt-28"]]);
  assert.deepEqual([waiting.changes.files, waiting.changes.added, waiting.changes.removed], [1, 61, 18]);
  assert.deepEqual(waiting.actions.map((a) => [a.id, a.state, a.evidence]), [["act-1", "succeeded", "reported"], ["act-2", "failed", "receipt"], ["act-3", "failed", "reported"], ["act-4", "succeeded", "receipt"], ["act-5", "running", "reported"]]);

  const selfApproved = task("approve", id, "apr-1", "--human", `--expect=${waiting.revision}`);
  assert.deepEqual([selfApproved.status, /Mission Control/.test(selfApproved.err)], [2, true], "a terminal cannot approve, even with --human: an agent could type that");
  assert.equal(task("resume", id, "--human", `--expect=${waiting.revision}`).status, 2);
  assert.equal(ok(task("show", id, "--json")).json.approvals[0].state, "pending", "nothing was granted");
  assert.throws(() => approvedInControl(at, waiting.task.project, waiting.task.checkout, id, waiting.revision - 2), /STALE/);
  approvedInControl(at, waiting.task.project, waiting.task.checkout, id, waiting.revision);
  assert.throws(() => approvedInControl(at, waiting.task.project, waiting.task.checkout, id, waiting.revision + 1), /APPROVAL_DECIDED/, "a second approve grants nothing");
  ok(task("act", "start", id, "--type=database.migrate", "--environment=dev", '--params={"schema":82}', "--approval=apr-1", "--mutates"));
  const again = task("act", "start", id, "--type=database.migrate", "--environment=dev", '--params={"schema":82}', "--approval=apr-1");
  assert.deepEqual([again.status, /APPROVAL_NOT_GRANTED/.test(again.err)], [2, true]);
  ok(task("link", "receipt", id, "--domain=data", "--ref=migration-82", "--outcome=APPLIED", "--action=act-6"));
  ok(task("act", "complete", id, "act-6", "--outcome=succeeded"));

  const done = ok(task("show", id, "--json")).json;
  assert.deepEqual([done.lifecycle, done.approvals[0].state, done.approvals[0].consumedBy], ["VERIFYING", "consumed", "act-6"]);
  assert.equal(done.actions.find((a) => a.id === "act-6").evidence, "receipt");
  const kinds = ok(task("events", id, "--json")).json.events.map((e) => e.kind);
  assert.deepEqual(kinds.slice(-6), ["approval-requested", "approval-granted", "approval-consumed", "action-started", "receipt", "action-completed"]);
  assert.match(ok(task("show", id)).out, /STATE {6}VERIFYING · REGRESSION · attempt 3 \/ 8/);
  const journal = readFileSync(join(at.store, done.task.project, "tasks", id, "journal.jsonl"), "utf8");
  assert.doesNotMatch(journal, /"params"|"schema":82/, "the approved parameters were hashed, never kept");
});

test("a checkout is named from anywhere with --project and --checkout; unknown or absent, the command is refused", (t) => {
  const at = checkout(t);
  const id = ok(cli(at, at.repo)("create", "an ad-hoc task", "--json")).json.task;
  const row = ok(cli(at, at.base)("machine", "--json")).json.tasks[0];
  const elsewhere = cli(at, at.base);
  assert.equal(ok(elsewhere("show", id, `--project=${row.project}`, `--checkout=${row.checkout}`, "--json")).json.task.id, id);
  assert.equal(elsewhere("show", id, `--project=${row.project}`, `--checkout=${"e".repeat(64)}`).status, 2);
  const outside = elsewhere("create", "no checkout here");
  assert.deepEqual([outside.status, /Git checkout/.test(outside.err)], [2, true]);
  assert.equal(elsewhere("frobnicate").status, 0, "an unknown command prints the usage");
});

test("the session trail gets ids and counts of four moments, never a sentence -- and a task reads the same with no trail at all", (t) => {
  const at = checkout(t);
  const task = cli(at, at.repo);
  const id = ok(task("create", "SENTINEL objective about refunds", "--json")).json.task;
  ok(task("stage", id, "IMPLEMENTING"));
  ok(task("attempt", "start", id));
  ok(task("attempt", "complete", id, "--outcome=succeeded"));
  ok(task("complete", id, "--summary=SENTINEL summary"));
  const events = traceLog(stateRooms(at.store), realIo()).read({}).filter((e) => e.type.startsWith("task."));
  assert.deepEqual(events.map((e) => e.type), ["task.started", "task.attempt", "task.attempt", "task.finished"]);
  const declared = Object.fromEntries(EVENT_TYPES.map((r) => [r.type, r.fields]));
  for (const e of events) assert.ok(Object.keys(e.data).every((k) => declared[e.type].includes(k)), e.type);
  assert.doesNotMatch(JSON.stringify(events), /SENTINEL/);
  const shown = ok(task("show", id, "--json")).out;
  rmSync(join(at.store, "control"), { recursive: true, force: true });
  assert.equal(ok(task("show", id, "--json")).out.replace(/"updatedAt"[^,]*,/, ""), shown.replace(/"updatedAt"[^,]*,/, ""), "the journal is the record; the trail is a projection");
  const quiet = checkout(t);
  const silent = cli(quiet, quiet.repo, { ORBIT_TRACE: "off" });
  ok(silent("create", "with the trail off", "--json"));
  assert.deepEqual(traceLog(stateRooms(quiet.store), realIo()).read({}).filter((e) => e.type.startsWith("task.")), []);
});
