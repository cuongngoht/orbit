// Orbit LIVE shows THIS SESSION's work when no task's journal speaks for it (1.8.7). The bug: /orbit-help went the
// developer's way (or a coordinated workflow handed a step to the host), the agent read, edited and tested in the
// session itself, and the docked pane said "no task here yet" -- or a workflow's step RUNNING, "reported" -- for the
// whole of it, while the host's hooks had recorded every tool call in the session's working set all along.
//
// Pure first: the fold over a session's working-set lines (src/live/session.mjs). Then in real processes, the whole
// path a person sees: Claude Code's hook payloads through cli/learn-hook.mjs into the machine store, and
// `live pane --host=claude` -- what hooks/live-pane.tsx asks every two seconds -- reading them back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collect } from "../src/engineering/working-set/collect.mjs";
import { fold } from "../src/engineering/working-set/fold.mjs";
import { SESSION_LIMITS, sessionActivityOf, sessionLinesOf } from "../src/live/session.mjs";
import { hostSession, taskSessionMark } from "../src/memory/session.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = join(ROOT, "cli", "live.mjs");
const HOOK = join(ROOT, "cli", "learn-hook.mjs");
const TASK = join(ROOT, "cli", "task.mjs");
const INIT = join(ROOT, "cli", "init.mjs");
const CHECKS = ["test", "lint", "build"];
const T0 = Date.parse("2026-10-16T12:00:00.000Z");
const at = (s) => new Date(T0 + s * 1000).toISOString();

// ---- the fold: pure ------------------------------------------------------------------------------------------------

const pre = (s, call, cls = "test", exe = "node") => ({ t: at(s), ev: "pre-tool", tool: "command", paths: [], tokens: [], cmd: { class: cls, exe, ok: null }, ...(call ? { delivery: call } : {}) });
const post = (s, call, ok = true, cls = "test", exe = "node") => ({ t: at(s), ev: ok ? "post-tool" : "post-tool-failure", tool: "command", paths: [], tokens: [], cmd: { class: cls, exe, ok }, ...(call ? { delivery: call } : {}) });
const edit = (s, path) => ({ t: at(s), ev: "post-tool", tool: "edit", paths: [path], tokens: [], cmd: null });
const fold7 = (lines, s = 10) => sessionActivityOf(lines, { nowMs: T0 + s * 1000, idleAfterMs: 120_000, checks: CHECKS });

test("a command is RUNNING between its own pre-tool and post-tool, paired by delivery or by what ran, even when the hooks wrote them out of order", () => {
  assert.deepEqual(fold7([pre(1, "c:1")]).running.map((e) => e.what), ["node (named like a test)"]);
  assert.equal(fold7([pre(1, "c:1")]).state, "ACTIVE", "running is activity, whatever the clock says");
  assert.deepEqual(fold7([post(2, "c:1", false), pre(1, "c:1")]).running, [], "an async post-tool hook may land first");
  const done = fold7([pre(1, "c:1"), post(2, "c:1", false)]);
  assert.deepEqual([done.running.length, done.checks[0].ok, done.observed], [0, false, 1]);
  assert.deepEqual(fold7([pre(1, null), post(2, null)]).running, [], "a host with no ids is paired by what ran");
  assert.deepEqual(fold7([post(1, null), pre(2, null)]).running, [], "a quick command's post-tool hook may finish writing first");
  assert.equal(fold7([post(1, null), pre(30, null)], 31).running.length, 1, "a run that ended long before is another run");
});

test("nothing runs past the turn or the session it started in; a session that ended says so", () => {
  assert.deepEqual(fold7([pre(1, "c:1"), { t: at(2), ev: "turn-end" }]).running, []);
  assert.equal(fold7([edit(1, "a.js"), { t: at(2), ev: "session-end" }]).state, "ENDED");
  assert.equal(fold7([edit(1, "a.js")], 1000).state, "QUIET", "nothing written lately is quiet, never a task's word");
  assert.equal(fold7([]).state, "NONE");
});

test("one tool call delivered twice -- two installs of the engine side by side -- is one", () => {
  const a = fold7([edit(1, "a.js"), edit(1, "a.js"), pre(2, "c:2"), post(3, "c:2"), post(3, "c:2")]);
  assert.deepEqual([a.observed, a.recent.length, a.checks.length, a.files], [2, 2, 1, ["a.js"]]);
});

test("what it keeps is bounded, newest first, and a cut tail drops its first, partial line", () => {
  const many = Array.from({ length: 200 }, (_, i) => edit(i, `f${i}.js`));
  const a = fold7(many, 300);
  assert.equal(a.recent.length, SESSION_LIMITS.RECENT);
  assert.equal(a.recent[0].what, "f199.js");
  assert.ok(a.files.length <= SESSION_LIMITS.FILES);
  const text = `${JSON.stringify(edit(1, "x.js")).slice(10)}\n${JSON.stringify(edit(2, "y.js"))}\nnot json\n`;
  assert.deepEqual(sessionLinesOf(text, true).map((l) => l.paths[0]), ["y.js"]);
});

test("found by the independent verification: a command right after another of its kind runs; a capped file claims nothing running", () => {
  assert.equal(fold7([pre(1, null, "test", "npm"), post(2, null, true, "test", "npm"), pre(3, null, "test", "npm")]).running.length, 1, "D2: a post-tool ends one run, never the next");
  assert.equal(fold7([pre(1, null), pre(2, null), post(3, null)]).running.length, 1, "two started, one ended: one runs");
  assert.deepEqual(fold7([pre(1, "c:1"), { t: at(2), ev: "truncated" }]).running, [], "D7: past the size cap no end can be seen");
  assert.deepEqual(fold7([pre(1, null, "diff", "cd"), { t: at(2), ev: "turn-end" }, pre(3, null, "diff", "cd"), post(4, null, true, "diff", "cd")]).running, [], "Run F D1: an end after a turn's end closes the run started after it");
  assert.equal(fold7([edit(1, "a.js"), edit(2, "a.js")]).recent.length, 2, "D6: two real edits a second apart are two");
  assert.equal(sessionActivityOf([edit(1, "a.js")], { nowMs: T0, partial: true, checks: CHECKS }).partial, true, "D5: a tail says it is one");
});

test("D1: a quoted NAME='value with spaces' prefix is cut off whole -- no part of the value becomes the executable", () => {
  const exe = (command) => collect({ event: "post-tool", tool: { kind: "command" }, command, paths: [] }, ["/r"], at(1)).cmd.exe;
  assert.equal(exe("PASSWORD='a b' deploy.sh"), "deploy.sh");
  assert.equal(exe("CANARYPASS='alpha canarytail222' node -e x"), "node");
  assert.equal(exe('A=1 B="x y" npm test'), "npm");
  assert.equal(exe("X='unclosed secretpart"), "", "a broken quote names nothing rather than a piece of the value");
});

test("a command STARTING is not a command the session ran: the engineering fold reads past it and past a turn's end", () => {
  const s = fold([pre(1, "c:1"), post(2, "c:1"), { t: at(3), ev: "turn-end" }]);
  assert.equal(s.commands.length, 1);
});

test("the working set keeps a command's class and bare executable when it starts -- never an argument -- and nothing else starting", () => {
  const event = { event: "pre-tool", tool: { kind: "command" }, command: "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 npm test --password=hunter2", paths: [] };
  const line = collect(event, ["/r"], at(1));
  assert.deepEqual(line.cmd, { class: "test", exe: "npm", ok: null }, "a leading NAME=value is the environment, never the executable");
  assert.doesNotMatch(JSON.stringify(line), /hunter2|ghp_|password/);
  assert.equal(collect({ event: "pre-tool", tool: { kind: "edit" }, paths: ["/r/a.js"] }, ["/r"], at(1)), null, "an edit is kept once it happened");
});

// ---- the whole path: hook → store → pane, in real processes ----------------------------------------------------------

function project(t, withProject = true) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-live-session-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  const env = (over = {}) => sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", ...over });
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  if (withProject) execFileSync(process.execPath, [INIT, repo, "--origin=http://localhost:3000"], { env: env(), stdio: "ignore" });
  return { dir, repo, env };
}

// One Claude Code hook, as the host runs it: the payload on stdin, the project root in CLAUDE_PROJECT_DIR.
const hook = (p, payload, over = {}) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: p.repo, ...payload }), env: p.env({ CLAUDE_PROJECT_DIR: p.repo, ...over }), encoding: "utf8" });
const edited = (p, session, path, id) => hook(p, { hook_event_name: "PostToolUse", session_id: session, tool_use_id: id, tool_name: "Edit", tool_input: { file_path: join(p.repo, path) } });
const started = (p, session, command, id) => hook(p, { hook_event_name: "PreToolUse", session_id: session, tool_use_id: id, tool_name: "Bash", tool_input: { command } });
const ended = (p, session, command, id, ok = true) => hook(p, { hook_event_name: ok ? "PostToolUse" : "PostToolUseFailure", session_id: session, tool_use_id: id, tool_name: "Bash", tool_input: { command } });

// `live pane` as hooks/live-pane.tsx asks it: the session id and the session's PROJECT ROOT on stdin.
function pane(p, session, { argv = [], over = {} } = {}) {
  const r = spawnSync(process.execPath, [LIVE, "pane", "--host=claude", "--columns=70", "--rows=40", ...argv], { cwd: p.repo, input: JSON.stringify({ session_id: session, cwd: p.repo }), env: p.env(over), encoding: "utf8" });
  return JSON.parse(r.stdout);
}

const textOf = (segs) => (segs ?? []).map((s) => s.text).join("");
const rowText = (r) => `${textOf(r.left)} ${textOf(r.right)}`;
const nowOf = (a) => a.current.map(rowText).join("\n");
const viewOf = (a, id) => a.views.find((v) => v.id === id).rows.map(rowText).join("\n");
const everything = (a) => JSON.stringify(a);

test("manual work: the pane opened BEFORE any work says why it is empty, then shows what the session's tools do as they do it", (t) => {
  const p = project(t);
  const before = pane(p, "s-a");
  assert.match(nowOf(before), /nothing observed in this session yet/);
  assert.match(textOf(before.statusBar.right), /NO ACTIVITY/);
  edited(p, "s-a", "src/validate.js", "tu-1");
  started(p, "s-a", "node --test test/validate.test.js", "tu-2");
  const running = pane(p, "s-a");
  assert.equal(running.task, null, "no task was made up for it");
  assert.match(textOf(running.header), /no task · this session's activity/);
  assert.match(nowOf(running), /running\s+● node \(named like a test\)\s+since \d\d:\d\d:\d\d UTC · no result yet/);
  assert.match(nowOf(running), /files\s+src\/validate\.js/);
  assert.match(viewOf(running, "changes"), /M src\/validate\.js/);
  assert.match(viewOf(running, "tests"), /node \(named like a test\)\s+since/);
  assert.match(textOf(running.statusBar.right), /SESSION ACTIVE/);
  ended(p, "s-a", "node --test test/validate.test.js", "tu-2", false);
  const failed = pane(p, "s-a");
  assert.doesNotMatch(nowOf(failed), /^running/m);
  assert.match(nowOf(failed), /last\s+ran node \(named like a test\)\s+✗ ended with an error/);
  assert.match(viewOf(failed, "events"), /ran node \(named like a test\)[^\n]*ended with an error/);
  assert.doesNotMatch(everything(failed), /PASSED|\d+%/, "a command's exit is never a pass, and nothing here has a denominator");
});

test("two sessions in one checkout: each pane shows its own session's tools and never the other's", (t) => {
  const p = project(t);
  edited(p, "s-a", "src/a.js", "a-1");
  edited(p, "s-b", "src/b.js", "b-1");
  started(p, "s-b", "npm run build", "b-2");
  const a = pane(p, "s-a");
  assert.match(viewOf(a, "changes"), /src\/a\.js/);
  assert.doesNotMatch(everything(a), /src\/b\.js|npm \(named like a build\)/);
  assert.match(viewOf(pane(p, "s-b"), "changes"), /src\/b\.js/);
});

test("a shell that moved out of the checkout does not move the session's activity: the hook keeps the host's project root", (t) => {
  const p = project(t);
  hook(p, { hook_event_name: "PreToolUse", session_id: "s-a", tool_use_id: "x-1", tool_name: "Bash", tool_input: { command: "npm test" }, cwd: p.dir });
  assert.match(nowOf(pane(p, "s-a")), /running\s+● npm \(named like a test\)/);
});

test("Run F D2: a shell inside another Orbit project (a task's workspace clone) still writes the session's lines with its own project", (t) => {
  const p = project(t);
  const other = project(t);
  hook(p, { hook_event_name: "PreToolUse", session_id: "s-a", tool_name: "Bash", tool_input: { command: "npm test" }, cwd: other.repo });
  hook(p, { hook_event_name: "PostToolUse", session_id: "s-a", tool_name: "Bash", tool_input: { command: "npm test" }, cwd: other.repo });
  const got = pane(p, "s-a");
  assert.doesNotMatch(nowOf(got), /^running/m);
  assert.match(nowOf(got), /last\s+ran npm \(named like a test\)\s+✓ ended ok/);
});

test("a workflow whose step the host works itself: the task stays shown, and NOW says what the session's own tools are doing", (t) => {
  const p = project(t);
  const mark = hostSession("claude", "s-a");
  const id = JSON.parse(execFileSync(process.execPath, [TASK, "create", "fix the validation bug", "--provider=automation", "--json"], { cwd: p.repo, env: p.env({ ORBIT_SESSION: mark }), encoding: "utf8" })).task;
  execFileSync(process.execPath, [join(ROOT, "test", "fakes", "coordinator-door.mjs"), id, "act-start", JSON.stringify({ type: "agent.dispatch", label: "engineering" })], { cwd: p.repo, env: p.env({ ORBIT_SESSION: mark }), stdio: "ignore" });
  edited(p, "s-a", "src/validate.js", "w-1");
  started(p, "s-a", "node --test", "w-2");
  const got = pane(p, "s-a");
  assert.equal(got.task, id, "the workflow is still what the pane follows");
  assert.match(nowOf(got), /session\s+● node \(named like a test\)\s+since [^\n]*observed/);
  assert.match(viewOf(got, "changes"), /M src\/validate\.js/, "the task changed no file of its own, so the session's edits are shown");
  assert.match(textOf(got.statusBar.right), /ORBITING|IDLE/, "the task's indicator is the task's, never the session's");
});

test("two tasks no session claims are AMBIGUOUS: NOW names them and how to choose, and a pin chooses", (t) => {
  const p = project(t);
  const make = (o) => JSON.parse(execFileSync(process.execPath, [TASK, "create", o, "--json"], { cwd: p.repo, env: p.env({ ORBIT_SESSION: hostSession("claude", `other-${o}`) }), encoding: "utf8" })).task;
  const [a, b] = [make("one"), make("two")];
  const got = pane(p, "s-a");
  assert.equal(got.task, null);
  assert.match(nowOf(got), new RegExp(`2 tasks run in this checkout, none chosen — live pin <task> picks one: ${[a, b].sort().join(", ")}`));
  execFileSync(process.execPath, [LIVE, "pin", a], { cwd: p.repo, env: p.env({ ORBIT_SESSION: hostSession("claude", "s-a") }), stdio: "ignore" });
  assert.equal(pane(p, "s-a").task, a);
});

test("asking again, a hook delivered twice and a pane that closed change nothing that happened: one call is shown once, and the work goes on", (t) => {
  const p = project(t);
  const first = pane(p, "s-a");
  edited(p, "s-a", "src/a.js", "r-1");
  edited(p, "s-a", "src/a.js", "r-1");
  assert.ok(readFileSync(sessionFile(p, "s-a"), "utf8").trim().split("\n").length >= 1);
  assert.equal(viewOf(pane(p, "s-a"), "events").split("\n").length, 1, "the same call delivered twice is one row");
  assert.deepEqual(pane(p, "s-a").current, pane(p, "s-a").current, "a pane asked twice draws the same picture");
  pane(p, "s-a", { argv: [`--lease=${first.lease}`, "--left=person"] });
  edited(p, "s-a", "src/b.js", "r-2");
  assert.match(viewOf(pane(p, "s-a"), "changes"), /src\/b\.js/, "closing the pane stopped nothing the session does");
});

const markOf = (session) => taskSessionMark(hostSession("claude", session));

const sessionFile = (p, session) => ((f) => (f ? join(p.dir, "store", f) : null))(readdirSync(join(p.dir, "store"), { recursive: true }).find((f) => f.endsWith(`${markOf(session)}.jsonl`)));

test("when there is nothing to show the pane says why: hooks off, an unreadable source (and it recovers), no Orbit project", (t) => {
  const p = project(t);
  assert.match(nowOf(pane(p, "s-a", { over: { ORBIT_WORKING_SET: "off" } })), /not recorded here/);
  edited(p, "s-a", "src/a.js", "u-1");
  const broken = join(dirname(sessionFile(p, "s-a")), `${markOf("s-b")}.jsonl`);
  mkdirSync(broken);
  assert.match(nowOf(pane(p, "s-b")), /could not be read just now; asking again/);
  rmSync(broken, { recursive: true });
  edited(p, "s-b", "src/c.js", "u-2");
  assert.match(viewOf(pane(p, "s-b"), "changes"), /src\/c\.js/, "the next ask reads it");
  const bare = project(t, false);
  execFileSync(process.execPath, [TASK, "list"], { cwd: bare.repo, env: bare.env(), stdio: "ignore" });
  assert.match(nowOf(pane(bare, "s-a")), /does not know this checkout yet|no task here yet/);
});

test("a secret on a command line reaches neither the store nor the pane", (t) => {
  const p = project(t);
  const command = "ORBIT_SQL_PASSWORD=hunter2-sekrit npm test -- --token=ghp_abcdefghijklmnopqrstuvwxyz0123";
  started(p, "s-a", command, "k-1");
  ended(p, "s-a", command, "k-1", false);
  const stored = readdirSync(join(p.dir, "store"), { recursive: true }).filter((f) => f.endsWith(".jsonl")).map((f) => readFileSync(join(p.dir, "store", f), "utf8")).join("\n");
  const shown = everything(pane(p, "s-a"));
  for (const text of [stored, shown]) assert.doesNotMatch(text, /hunter2|sekrit|ghp_|--token/);
});

test("Claude Code tells the hooks a Bash call STARTED, in the background so no command waits, and the skill gate is untouched", () => {
  const pre = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse;
  assert.equal(pre[0].matcher, "Skill|Agent|Task");
  assert.equal(pre[0].hooks[0].async, undefined);
  const bash = pre.find((h) => h.matcher === "Bash");
  assert.equal(bash.hooks[0].async, true);
  assert.match(bash.hooks[0].command, /cli\/learn-hook\.mjs/);
});
