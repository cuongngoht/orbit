// THE STOP HOLD (0.5.0, B22 M3, ADR 0050): the one place Orbit keeps the model going, held to every condition the
// design names -- at most twice a prompt, never a turn already held, never past a person's pause, cancel, approval or
// question, never without a workflow's own command in the turn, never with a halt cue, never when the trail cannot count
// or the setting is off -- and cheap: a turn that ran no workflow command never reaches the owners' records. First the
// table, over a world of ports; then the real hooks, in a real checkout and store, as Claude Code runs them.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AUTOMATION_SCHEMA } from "../src/automation/settings.mjs";
import { HOLD, HOLD_ROWS, MAX_HOLDS, NOT_RUNNING, PAIRED_MS, WORKFLOW_COMMANDS, hold, holdRowOf, needsOwners } from "../src/lifecycle/subscribers/hold.mjs";
import { hostSession } from "../src/memory/session.mjs";
import { stateRooms, writeState } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { eventOf } from "../src/trace/events.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- the table, over a world of ports --------------------------------------------------------------------------------

const AT = "2026-11-05T10:00:00.000Z";
const NOW = Date.parse("2026-11-05T10:00:30.000Z");
const OWNER = { kind: "workflow", id: "tsk-0123456789ab", lifecycle: "EXECUTING", state: "running", ready: ["qa", "review"], open: [] };

let seq = 0;
const ev = (type, data = {}, at = AT) => eventOf(type, data, { id: `e-${String(seq++).padStart(4, "0")}`, at, session: "claude:s1" });

const STEP = () => ev("command.ran", { orbit: "cli/automation", sub: "step", ok: true });
const turnOf = (events, marks = []) => ({ prompt: ev("prompt.submitted", { routing: "on", ...(marks.length ? { marks } : {}) }), events });

// Every fact a row may ask for is a port, and each records that it was asked: a cheap row must decide before a dear one.
function worldOf(over = {}) {
  const asked = [];
  const wrote = [];
  const port = (name, value) => () => (asked.push(name), value);
  return { asked, wrote, host: over.host ?? { formatHold: (reason) => ({ decision: "block", reason }) }, input: {}, plugin: "orbit", engine: "/plug", nowMs: () => NOW, turn: port("turn", "turn" in over ? over.turn : turnOf([STEP()])), settings: port("settings", "settings" in over ? over.settings : { trigger: { holdOnStop: true } }), governed: port("governed", "owner" in over ? over.owner : OWNER), held: (d) => wrote.push(d) };
}

const STOP = { event: "turn-end" };
const rowOf = (w, event = STOP) => holdRowOf(event, w).row;

test("a turn its own workflow can go on from is held: the ready steps, the one command, or say why -- and one turn.held", () => {
  const w = worldOf();
  const answer = hold.run(STOP, w);
  assert.equal(answer.decision, "block");
  assert.match(answer.reason, /workflow tsk-0123456789ab \(EXECUTING\) is still running and steps qa, review are ready/);
  assert.match(answer.reason, /node \/plug\/cli\/automation\.mjs context tsk-0123456789ab says how/);
  assert.match(answer.reason, /or say in one sentence why you stop here/);
  assert.deepEqual(w.wrote, [{ task: "tsk-0123456789ab", steps: ["qa", "review"], count: 1 }], "what it writes is turn.held, and only that");
});

test("a goal is held through its own command, naming the units it may start next", () => {
  const w = worldOf({ owner: { kind: "goal", id: "goal-0123456789ab", lifecycle: "ready", state: "running", ready: ["gu-0a1b2c3d"], open: [] }, turn: turnOf([ev("command.ran", { orbit: "cli/orbit", sub: "goal", op: "step", ok: true })]) });
  assert.match(hold.run(STOP, w).reason, /goal goal-0123456789ab \(ready\) is still running and step gu-0a1b2c3d is ready.*node \/plug\/cli\/orbit\.mjs goal resume goal-0123456789ab/);
});

test("at most twice per prompt: the third Stop of one prompt is never held", () => {
  const once = ev("turn.held", { task: OWNER.id, steps: ["qa"], count: 1 });
  assert.equal(MAX_HOLDS, 2);
  const second = worldOf({ turn: turnOf([STEP(), once]) });
  assert.match(hold.run(STOP, second).reason, /\(2 of 2 for this prompt\)/);
  assert.equal(second.wrote[0].count, 2);
  const third = worldOf({ turn: turnOf([STEP(), once, ev("turn.held", { task: OWNER.id, steps: ["qa"], count: 2 })]) });
  assert.deepEqual([hold.run(STOP, third), rowOf(third), third.wrote], [null, "spent", []]);
});

test("a turn a Stop hook already kept going is never held again in a row, and nothing is read for it", () => {
  const w = worldOf();
  assert.deepEqual([hold.run({ event: "turn-end", held: true }, w), w.asked, w.wrote], [null, [], []]);
});

test("never past a person's pause or cancel, a wait for a person, a block, a workflow that must stop, or one that ended", () => {
  assert.deepEqual(NOT_RUNNING, ["paused", "cancelled", "waiting", "blocked", "stopping", "ended"]);
  for (const state of NOT_RUNNING) {
    const w = worldOf({ owner: { ...OWNER, state } });
    assert.deepEqual([hold.run(STOP, w), rowOf(w), w.wrote], [null, "not-running", []], state);
  }
  const nothing = worldOf({ owner: { ...OWNER, ready: [] } });
  assert.deepEqual([hold.run(STOP, nothing), rowOf(nothing)], [null, "nothing-ready"], "a running workflow with no step ready has nothing to name");
});

test("never without one of the workflow's own commands in the turn: a turn that only answered a question is not held", () => {
  const reads = [ev("tool.used", { tool: "Read", kind: "read", ok: true }), ev("command.ran", { orbit: "cli/automation", sub: "context", ok: true }), ev("command.ran", { orbit: "cli/orbit", sub: "goal", op: "status", ok: true }), ev("command.ran", { orbit: "cli/orbit", sub: "goal", ok: true }), ev("command.ran", { class: "test", exe: "npm", ok: true })];
  const w = worldOf({ turn: turnOf(reads) });
  assert.deepEqual([hold.run(STOP, w), rowOf(w)], [null, "no-workflow-command"]);
  assert.deepEqual([...new Set(w.asked)], ["turn"], "the settings and the owners' records were never read");
  assert.deepEqual(WORKFLOW_COMMANDS.map((c) => c.orbit), ["cli/automation", "cli/orbit"]);
  for (const ran of [{ orbit: "cli/automation", sub: "start" }, { orbit: "cli/automation", sub: "settle" }, { orbit: "cli/orbit", sub: "goal", op: "start" }]) assert.equal(rowOf(worldOf({ turn: turnOf([ev("command.ran", { ...ran, ok: true })]) })), "hold", JSON.stringify(ran));
});

test("never when the prompt carried a halt cue", () => {
  const w = worldOf({ turn: turnOf([STEP()], ["halt"]) });
  assert.deepEqual([hold.run(STOP, w), rowOf(w), w.wrote], [null, "halted", []]);
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP()], ["continue"]) })), "hold", "a mark that is not a halt changes nothing");
});

test("never when the trail cannot count this prompt's holds: trace off, no prompt of this turn, or a Stop of it that was not held", () => {
  assert.deepEqual([hold.run(STOP, worldOf({ turn: null })), rowOf(worldOf({ turn: null }))], [null, "uncounted"], "trace off, or the trail unreadable");
  const ended = ev("turn.ended", {}, new Date(NOW - PAIRED_MS - 5000).toISOString());
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP(), ended]) })), "uncounted", "an earlier Stop of this prompt nobody held: this Stop belongs to a prompt the trail never heard of");
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP(), ev("session.ended", {})]) })), "uncounted");
  const heldEnd = ev("turn.ended", {}, new Date(NOW - 60_000).toISOString());
  const itsHold = ev("turn.held", { task: OWNER.id, steps: ["qa"], count: 1 }, new Date(NOW - 59_500).toISOString());
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP(), heldEnd, itsHold]) })), "hold", "a Stop that WAS held does not end the turn");
  assert.equal(rowOf(worldOf({ turn: turnOf([STEP(), ev("turn.ended", {}, new Date(NOW - 500).toISOString())]) })), "hold", "this Stop's own end, written beside the hold, is not an earlier one");
});

test("never when a person switched the hold off, or the settings cannot be read", () => {
  for (const settings of [{ trigger: { holdOnStop: false } }, null, {}]) {
    const w = worldOf({ settings });
    assert.deepEqual([hold.run(STOP, w), rowOf(w), w.wrote], [null, "switched-off", []], JSON.stringify(settings));
  }
});

test("never for a session with no governed work of its own, and never on a host that cannot hold a turn", () => {
  assert.deepEqual([hold.run(STOP, worldOf({ owner: null })), rowOf(worldOf({ owner: null }))], [null, "no-governed-work"]);
  const codex = worldOf({ host: { formatPostTool: () => null } });
  assert.deepEqual([hold.run(STOP, codex), codex.asked], [null, []], "no formatHold: nothing is even read");
});

test("cheapest first: the owners' records and the settings are reached only by a turn that ran a workflow's command", () => {
  const deep = HOLD.filter((r) => r.deep).map((r) => r.row);
  assert.deepEqual(deep, ["switched-off", "no-governed-work"]);
  assert.ok(HOLD_ROWS.indexOf("no-workflow-command") < HOLD_ROWS.indexOf(deep[0]), "every trail row decides before a dear one is asked");
  assert.equal(HOLD.at(-1).holds, true);
  assert.equal(HOLD.at(-1).when({}), true, "the last row always answers");
  assert.equal(needsOwners(STOP, worldOf({ turn: turnOf([ev("tool.used", { tool: "Read", kind: "read", ok: true })]) })), false, "an ordinary turn never loads the owners");
  assert.equal(needsOwners({ event: "turn-end", held: true }, worldOf()), false);
  assert.equal(needsOwners(STOP, worldOf()), true, "a turn that ran a workflow's step does");
});

// ---- the real hooks, in a real checkout and store --------------------------------------------------------------------

const RAW = "session-raw-hold";

function checkout(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-hold-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  return { dir, repo, store: join(dir, "store") };
}

const run = (p, file, args, env = {}, input = undefined) => spawnSync(process.execPath, [join(ROOT, "cli", file), ...args], { cwd: p.repo, env: sealed({ ORBIT_STORE_DIR: p.store, ...env }), input, encoding: "utf8", timeout: 60000 });

const hook = (p, file, payload, env = {}) => run(p, file, [], env, JSON.stringify({ session_id: RAW, cwd: p.repo, ...payload }));

// A coordinated workflow this session started, as /orbit-help starts one: its task carries the session's mark.
function workflow(p) {
  const started = run(p, "automation.mjs", ["start", "--for=implement the refund approval rule and verify it", "--json"], { ORBIT_SESSION: hostSession("claude", RAW) });
  assert.equal(started.status, 0, started.stderr);
  return JSON.parse(started.stdout).task;
}

// One turn, through the hooks: the person's prompt, then one command of the workflow's loop.
function turn(p, prompt, command, env = {}) {
  assert.equal(hook(p, "router-hook.mjs", { hook_event_name: "UserPromptSubmit", prompt }, env).status, 0);
  if (command) assert.equal(hook(p, "learn-hook.mjs", { hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: `toolu_${seq++}`, tool_input: { command } }, env).status, 0);
}

const stop = (p, env = {}, active = false) => hook(p, "follow-hook.mjs", { hook_event_name: "Stop", stop_hook_active: active }, env);

const stepLine = (task) => `node ${join(ROOT, "cli", "automation.mjs")} step ${task} --json`;

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

const trail = (p) => walk(join(p.store, "control", "activity", "trace")).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(f, "utf8").trim().split("\n")).map((l) => JSON.parse(l));

test("through the real hooks: this session's running workflow is held once, a held turn never again, and the trail's turn.held is the one write", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  turn(p, "carry on with the refund work", stepLine(task));
  const before = walk(p.store).filter((f) => !f.includes(join("control", "activity", "trace")));
  const first = stop(p);
  assert.equal(first.status, 0, first.stderr);
  const answer = JSON.parse(first.stdout);
  assert.equal(answer.decision, "block");
  assert.match(answer.reason, new RegExp(`workflow ${task} \\(EXECUTING\\) is still running and step context is ready`));
  assert.match(answer.reason, new RegExp(`node ${join(ROOT, "cli", "automation.mjs").replace(/[\\/.]/g, "\\$&")} context ${task}`));
  assert.deepEqual(walk(p.store).filter((f) => !f.includes(join("control", "activity", "trace"))), before, "nothing but the trail was written");
  const held = trail(p).filter((e) => e.type === "turn.held");
  assert.deepEqual(held.map((e) => e.data), [{ task, steps: ["context"], count: 1 }]);
  assert.match(String(held[0].project), /^[0-9a-f]{12}$/, "named by the project's short hash, never a path");
  assert.deepEqual([stop(p, {}, true).stdout, trail(p).filter((e) => e.type === "turn.held").length], ["", 1], "stop_hook_active: the turn ends");
});

test("through the real hooks: another session's workflow, a turn with no workflow command, and a halt cue are never held", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  turn(p, "carry on with the refund work", stepLine(task));
  const other = run(p, "follow-hook.mjs", [], {}, JSON.stringify({ session_id: "another-session", cwd: p.repo, hook_event_name: "Stop", stop_hook_active: false }));
  assert.deepEqual([other.status, other.stdout], [0, ""], "another session's workflow is not this session's to hold");
  turn(p, "what does the refund rule say?", `node ${join(ROOT, "cli", "automation.mjs")} context ${task} --json`);
  assert.deepEqual([stop(p).stdout], [""], "a turn that only read where the workflow stands");
  turn(p, "stop here, I will look at it myself", stepLine(task));
  assert.deepEqual([stop(p).stdout], [""], "the person said to stop");
  assert.equal(trail(p).filter((e) => e.type === "turn.held").length, 0);
});

test("through the real hooks: the setting off, the trail off, a paused workflow -- nothing", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  writeState(realIo(), join(stateRooms(p.store).automation, "settings.json"), { trigger: { holdOnStop: false } }, AUTOMATION_SCHEMA);
  turn(p, "carry on with the refund work", stepLine(task));
  assert.equal(stop(p).stdout, "", "a person switched the hold off");
  writeState(realIo(), join(stateRooms(p.store).automation, "settings.json"), { trigger: { holdOnStop: true } }, AUTOMATION_SCHEMA);
  assert.equal(stop(p, { ORBIT_TRACE: "off" }).stdout, "", "the trail is off: nobody can count this prompt's holds");
  const revision = JSON.parse(run(p, "task.mjs", ["show", task, "--json"]).stdout).revision;
  const paused = run(p, "task.mjs", ["pause", task, "--human", `--expect=${revision}`, "--json"], { ORBIT_TRACE: "off" });
  assert.equal(paused.status, 0, paused.stderr);
  assert.equal(stop(p).stdout, "", "a person paused it");
  assert.equal(trail(p).filter((e) => e.type === "turn.held").length, 0);
});

test("fast and silent with no governed work: an ordinary Stop answers nothing and reads no owner", (t) => {
  const p = checkout(t);
  turn(p, "rename qty to quantity in orders.mjs", "git status");
  const started = process.hrtime.bigint();
  const r = stop(p);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
  assert.ok(ms < 5000, `an ordinary Stop took ${ms} ms`);
  const bare = spawnSync(process.execPath, [join(ROOT, "cli", "follow-hook.mjs")], { cwd: p.dir, env: sealed({ ORBIT_STORE_DIR: join(p.dir, "elsewhere") }), input: JSON.stringify({ session_id: "s", cwd: p.dir, hook_event_name: "Stop", stop_hook_active: false }), encoding: "utf8" });
  assert.deepEqual([bare.status, bare.stdout, bare.stderr], [0, "", ""], "no store, no trail, no checkout: nothing");
});

test("FAIL OPEN: garbage, no payload and an unknown host all exit 0 with nothing said", (t) => {
  const p = checkout(t);
  for (const input of ["", "not json", "{}", JSON.stringify({ hook_event_name: "Unheard" }), JSON.stringify({ hook_event_name: "Stop" })]) {
    const r = run(p, "follow-hook.mjs", [], {}, input);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], input);
  }
  const codex = run(p, "follow-hook.mjs", ["--host=codex", "--protocol=2"], {}, JSON.stringify({ hook_event_name: "Stop", session_id: "s", cwd: p.repo, turn_id: "t1" }));
  assert.deepEqual([codex.status, codex.stdout], [0, ""], "a host whose Stop blocking is unverified is never held");
});

// ---- the sweep: every captured Claude payload through the new entries ------------------------------------------------

test("every captured Claude payload, through the new synchronous entries, says nothing where no governed work exists", (t) => {
  const p = checkout(t);
  const dir = join(ROOT, "test", "fixtures", "hooks", "claude");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 30, `${files.length} fixtures`);
  for (const file of files) {
    const { input } = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const cwd of [input.cwd, p.repo]) {
      const r = spawnSync(process.execPath, [join(ROOT, "cli", "follow-hook.mjs")], { cwd: p.repo, env: sealed({ ORBIT_STORE_DIR: p.store }), input: JSON.stringify({ ...input, cwd }), encoding: "utf8", timeout: 30000 });
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], `${file} in ${cwd}`);
    }
  }
});

test("hooks.json wires the hold and the agent-return line SYNCHRONOUSLY, beside the async Stop entry it leaves as it was; the other hosts' files carry no hold", () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;
  const follow = (entries) => entries.flatMap((e) => e.hooks.map((h) => ({ ...h, matcher: e.matcher }))).filter((h) => /cli\/follow-hook\.mjs"$/.test(h.command));
  assert.deepEqual(follow(hooks.Stop).map((h) => [h.async, h.timeout <= 10]), [[undefined, true]], "a hold arrives only from a synchronous Stop hook");
  assert.deepEqual(follow(hooks.PostToolUse).map((h) => [h.matcher, h.async]), [["Agent", undefined]], "additionalContext reaches the model beside the result only from a synchronous hook");
  assert.deepEqual(hooks.Stop.flatMap((e) => e.hooks).filter((h) => /learn-hook/.test(h.command)).map((h) => h.async), [true], "the trail's turn boundary is still the async entry");
  for (const file of ["codex.json", "grok.json"]) assert.equal(readFileSync(join(ROOT, "hooks", file), "utf8").includes("follow-hook"), false, file);
});
