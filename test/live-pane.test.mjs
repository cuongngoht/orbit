// THE PANE a host docks beside its session (1.8.5): `live pane` as Claude Code's pane module (hooks/live-pane.tsx) asks it.
// Pure first -- the full-screen viewer's own sections laid out for a column: one header line, the overview, and NOW
// pinned at the bottom, which keeps its rows when the pane is short. Then in real processes: one JSON object per ask,
// the session's viewer lease held while it asks, `ensure` answering ALREADY_ATTACHED to it even where nothing could
// open a window, a close that lets the lease go, a window a launcher opened keeping it, and `--auto` -- whether
// /orbit-help opens the pane by itself -- reading the person's switches and writing nothing. Last, the module's half of
// the contract, read from its files: it ships in this plugin and asks this engine, and its tests stay out of this suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAutomation } from "../src/automation/settings.mjs";
import { launching, leaseKey, leaseWhere, readLease, updateLease } from "../src/live/lease.mjs";
import { hostSession, taskSessionMark } from "../src/memory/session.mjs";
import { safeName } from "../src/project/paths.mjs";
import { repositoryAt } from "../src/project/boundary.mjs";
import { checkoutId, storeBase } from "../src/project/repository.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { NOW_MAX, paneOf } from "../src/live/tui/pane.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { ENG, ago, engEvents, engView, fed, stateOf } from "./live-tui.fixture.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = join(ROOT, "cli", "live.mjs");
const SESSION_ID = "5f0c2a8e-1111-4222-8333-944455556666";

// ---- the picture: pure -----------------------------------------------------------------------------------------

const counts = (passed, failed) => ({ passed, failed, skipped: 0, todo: 0, cancelled: 0 });

const observation = { version: 1, task: ENG, action: "act-6", attempt: "att-2", check: "chk-6", command: { id: "rt-command-0000a7e5", purpose: "test", component: "node:api", declaredAs: "test" }, why: "required: the change reaches node:api (modified: api/routing.js)", adapter: { id: "tap", framework: "a TAP stream", runner: "TAP", capabilities: { lifecycle: true, cases: "reported", total: "at-end", order: "reported" }, observes: ["passed", "failed"] }, state: "running", startedAt: ago(3), lastAt: ago(1), endedAt: null, counts: counts(33, 1), reported: 34, total: null, totals: null, summaries: 0, recent: [{ key: "1.34", name: "ToolRoutingTests.MissingTool", state: "failed" }], failures: [{ key: "1.34", name: "ToolRoutingTests.MissingTool", category: "assertion", message: "expected 'tool-a' · actual 'tool-b'", location: "test/routing.test.js:41:5", stack: [] }], failuresMore: 0, output: { lines: 412, bytes: { out: 18000, err: 0 }, lastAt: ago(1) }, outcome: null, seq: 40, complete: false, mismatch: false, gaps: [], resets: 0 };

const observed = (size) => reduce(fed(stateOf(size), ENG, engView(), engEvents()), { type: "frames", task: ENG, frames: [{ event: "activity-view", id: "t=9", data: { source: "activity", task: ENG, action: "act-6", revision: 40, view: observation } }] });

const textOf = (segs) => segs.map((s) => s.text).join("");

test("the pane is the viewer's own words as segments: a header line, the overview, and NOW from ACTIVITY", () => {
  const p = paneOf(observed({ columns: 60, rows: 40 }));
  assert.ok(p.header.length > 0 && p.overview.length > 0 && p.now.length > 0);
  assert.ok([p.header, ...p.overview, ...p.now].flat().every((s) => typeof s.text === "string" && !s.text.includes("\u001b") && (s.tone === null || typeof s.tone === "string")), "plain text and a tone: a host's drawer adds no word and no escape");
  const now = p.now.map(textOf).join("\n");
  assert.match(now, /RUNNING · TEST/);
  assert.match(now, /33 passed · 1 failed/);
  assert.ok(p.now.length <= NOW_MAX);
  assert.match(p.overview.map(textOf).join("\n"), /^STAGE$/m, "the overview starts where the dashboard does");
  assert.doesNotMatch(p.overview.map(textOf).join("\n"), /i activity|enter opens|\bq quit/, "a pane has none of the full-screen viewer's keys, so it shows none");
});

test("a short pane gives up the overview first; NOW keeps its rows and everything fits the rows it was given", () => {
  const tall = paneOf(observed({ columns: 60, rows: 40 }));
  const short = paneOf(observed({ columns: 60, rows: 14 }));
  assert.deepEqual(short.now, tall.now, "what runs now is never what a short pane loses");
  assert.ok(short.overview.length < tall.overview.length);
  assert.ok(1 + short.overview.length + 1 + short.now.length <= 14, `header, overview, a rule and NOW in 14 rows: ${short.overview.length} + ${short.now.length}`);
});

// ---- the command: real processes ----------------------------------------------------------------------------------

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pane-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const env = (over = {}) => sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", ...over });
  return { dir, repo, env, base: storeBase(env()) };
}

const run = (s, argv, { input = "", cwd = s.repo, env = s.env() } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [LIVE, ...argv], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const out = [];
  child.stdout.on("data", (b) => out.push(b));
  child.on("close", (code) => resolve({ code, json: JSON.parse(Buffer.concat(out).toString("utf8")) }));
  child.stdin.end(input);
});

const pane = (s, argv = [], cwd = s.repo) => run(s, ["pane", "--host=claude", ...argv], { input: JSON.stringify({ session_id: SESSION_ID, cwd }), cwd });

// `live ensure` from the same Claude Code session, where nothing could open a window: no tmux, no Windows Terminal,
// and on macOS a remote shell.
const ensure = (s) => run(s, ["ensure", "--json"], { env: s.env({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ATTENDED: "1", ORBIT_SESSION: hostSession("claude", SESSION_ID), SSH_CONNECTION: "10.0.0.1 50000 10.0.0.2 22" }) });

const LEASE = /^[a-f0-9]{16}\.[a-f0-9]{16}$/;

test("an open pane holds this session's viewer lease while it asks, and /orbit-help's ensure finds it, wherever it runs", async (t) => {
  const s = setup(t);
  const first = await pane(s);
  assert.equal(first.code, 0);
  assert.equal(first.json.version, 2, "1.8.6: additive, a drawer that knows 1 still reads it");
  assert.equal(first.json.held, true);
  assert.match(first.json.lease, LEASE);
  assert.ok(Array.isArray(first.json.header) && Array.isArray(first.json.overview) && Array.isArray(first.json.now));
  const again = await pane(s, [`--lease=${first.json.lease}`, "--columns=48", "--rows=20"]);
  assert.deepEqual([again.json.lease, again.json.held], [first.json.lease, true], "the same pane keeps the same lease");
  const ensured = await ensure(s);
  assert.equal(ensured.json.status, "ALREADY_ATTACHED", "a docked pane is a viewer: no window is opened beside it, and none is refused for want of an opener");
  assert.equal(ensured.json.lease.opener, "pane");
});

test("a pane closed by a person lets the lease go; ensure then says what it can do here, and opens nothing", async (t) => {
  const s = setup(t);
  const first = await pane(s);
  const left = await pane(s, [`--lease=${first.json.lease}`, "--left=person"]);
  assert.deepEqual([left.json.lease, left.json.held], [null, false]);
  const ensured = await ensure(s);
  assert.equal(ensured.json.status, "UNSUPPORTED_TERMINAL");
  assert.equal(ensured.json.opened, false);
  assert.match(ensured.json.command, /'tui'$/, "the command for a second terminal");
});

test("a window a launcher opened, still answering, keeps the lease: the pane shows the task and holds nothing", async (t) => {
  const s = setup(t);
  const checkout = checkoutId(repositoryAt(s.repo));
  const key = leaseKey({ host: "claude", session: taskSessionMark(hostSession("claude", SESSION_ID)), checkout });
  const where = leaseWhere(stateRooms(s.base).live, safeName(hostname()), key);
  const at = new Date().toISOString();
  updateLease(realIo(), where, (current) => ({ ...launching(current, { key, host: "claude", session: "m", checkout, machine: safeName(hostname()), owner: "a".repeat(16), opener: "tmux", at }), state: "ready", readyAt: at, heartbeatAt: at }));
  const shown = await pane(s);
  assert.deepEqual([shown.json.lease, shown.json.held], [null, false]);
  assert.ok(shown.json.header.length > 0, "it still shows");
  assert.equal(readLease(realIo(), where).owner, "a".repeat(16), "the window's lease is untouched");
});

test("--auto says whether /orbit-help opens the pane by itself -- the person's switches -- and writes nothing", async (t) => {
  const s = setup(t);
  const on = await pane(s, ["--auto"]);
  assert.deepEqual(on.json, { version: 2, opens: true, why: null });
  const live = join(stateRooms(s.base).live, "viewers");
  assert.equal(existsSync(live) ? readdirSync(live, { recursive: true }).filter((f) => f.endsWith(".json")).length : 0, 0, "asking took no lease");
  writeAutomation(realIo(), join(stateRooms(s.base).automation, "settings.json"), { live: { open: false } }, { revision: null, door: "control", at: new Date().toISOString() });
  const off = await pane(s, ["--auto"]);
  assert.equal(off.json.opens, false);
  assert.match(off.json.why, /switched off \(Orbit Control/);
  const elsewhere = await pane(s, ["--auto"], s.dir);
  assert.equal(elsewhere.json.opens, undefined, "outside a repository there is nothing to open it for");
  assert.match(textOf(elsewhere.json.header), /no repository here/);
});

// ---- the module's half of the contract, read from its files ---------------------------------------------------------

const json = (path) => JSON.parse(readFileSync(path, "utf8"));

test("the pane ships in THIS plugin: one marketplace entry, the module beside the command hooks, `live pane` asked of its own root", () => {
  const hooks = json(join(ROOT, "hooks", "hooks.json"));
  const source = readFileSync(join(ROOT, "hooks", "live-pane.tsx"), "utf8");
  assert.deepEqual(json(join(ROOT, ".claude-plugin", "marketplace.json")).plugins.map((p) => p.name), ["orbit"], "no second plugin to install");
  assert.deepEqual(hooks.modules, ["./live-pane.tsx"]);
  assert.ok(hooks.hooks.SessionStart.length > 0, "the command hooks stay beside it");
  assert.equal(json(join(ROOT, ".claude-plugin", "plugin.json")).types, undefined, "a host refuses a manifest key it does not know (1.8.9): the state the pane keeps is declared in types/index.d.ts, which tsconfig reads");
  assert.ok(existsSync(join(ROOT, "types", "index.d.ts")));
  assert.ok(source.includes("$.plugin.root") && source.includes("`${root}/cli/live.mjs`, 'pane', '--host=claude'"), "the command the pane asks is this plugin's own, by path");
});

test("the module's tests never join this suite", () => {
  const tests = readdirSync(join(ROOT, "hooks", "tests"));
  assert.ok(tests.length > 0 && tests.every((f) => f.endsWith(".test.tsx")), "a .test.ts would be run by a bare `node --test` (Node 22.18 and later), and it imports what only `claude plugin test` provides");
});
