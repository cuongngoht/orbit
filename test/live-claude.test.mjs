// Orbit Live in Claude Code: the session mark exported once at session start (so a task names the session that
// made it), the plugin root kept as the host's observation, one owned key in the person's own settings with
// theirs refused, replaced or kept -- and restored on remove -- and a shim that prints nothing rather than an
// error. All against a throwaway config directory and store; nothing of this machine's Claude Code is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportedSession, exportLine } from "../skills/orbit-learn/hosts/claude-session.mjs";
import { keptCommand, room, sessionOf } from "../skills/orbit-learn/hosts/claude-statusline.mjs";
import { dispatch } from "../src/lifecycle/dispatch.mjs";
import { liveSession } from "../src/lifecycle/subscribers/live-session.mjs";
import { hostSession, taskSessionMark } from "../src/memory/session.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = (name) => join(ROOT, "cli", name);

function machine(t, settings = null) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-live-claude-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  mkdirSync(join(dir, "claude"), { recursive: true });
  if (settings) writeFileSync(join(dir, "claude", "settings.json"), JSON.stringify(settings));
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store"), CLAUDE_CONFIG_DIR: join(dir, "claude"), ORBIT_TRACE: "off" });
  return { dir, repo, env, settings: () => JSON.parse(readFileSync(join(dir, "claude", "settings.json"), "utf8")), hostDir: join(dir, "store", "control", "hosts", "claude") };
}

const node = (m, file, args, extra = {}) => spawnSync(process.execPath, [file, ...args], { cwd: m.repo, env: { ...m.env, ...extra.env }, input: extra.input ?? "", encoding: "utf8" });
const sessionStart = (m, id, envFile, extra = {}) => node(m, cli("learn-hook.mjs"), [], { input: JSON.stringify({ hook_event_name: "SessionStart", session_id: id, cwd: m.repo, source: "startup" }), env: { CLAUDE_ENV_FILE: envFile, ...extra } });
const hostCli = (m, ...args) => node(m, cli("host.mjs"), [...args, "--host=claude", "--kind=statusline"]);
const json = (r) => JSON.parse(r.stdout);

// ---- the session ---------------------------------------------------------------------------------

test("a status line's session JSON gives the session's mark, its directory and its width -- nothing else is read", () => {
  const got = sessionOf({ session_id: "s-1", workspace: { current_dir: "/w" }, cwd: "/c", transcript_path: "/t.jsonl", cost: { total_cost_usd: 1 } }, { COLUMNS: "120" });
  assert.deepEqual(got, { sessionId: "s-1", cwd: "/w", columns: 120, mark: taskSessionMark(hostSession("claude", "s-1")) });
  assert.equal(sessionOf({ session_id: "s-1", cwd: "/c" }).cwd, "/c");
  assert.equal(sessionOf(null), null);
  assert.equal(sessionOf({}).mark, null);
  assert.equal(room(100), 84);
  assert.equal(room(10), 20);
});

test("the session mark is exported once, quoted, and only when it has the mark's shape", (t) => {
  const file = join(mkdtempSync(join(tmpdir(), "orbit-env-")), "env.sh");
  t.after(() => rmSync(dirname(file), { recursive: true, force: true }));
  assert.equal(exportLine("claude:0123456789abcdef"), "export ORBIT_SESSION='claude:0123456789abcdef'");
  assert.equal(exportLine("claude:$(rm -rf /)"), null);
  assert.equal(exportedSession(file, "claude:0123456789abcdef"), true);
  assert.equal(exportedSession(file, "claude:0123456789abcdef"), true);
  assert.equal(readFileSync(file, "utf8"), "export ORBIT_SESSION='claude:0123456789abcdef'\n");
  assert.equal(exportedSession(null, "claude:0123456789abcdef"), false);
});

test("the live-session subscriber speaks to no host, records nothing, and does nothing without its port", () => {
  const calls = [];
  const port = { exportSession: (m) => calls.push(["export", m]), observeRoot: () => calls.push(["root"]) };
  assert.equal(dispatch({ event: "session-start", session: "claude:0123456789abcdef" }, { liveSession: () => port }, [liveSession]), null);
  assert.deepEqual(calls, [["export", "claude:0123456789abcdef"], ["root"]]);
  assert.equal(dispatch({ event: "session-start", session: "x" }, { liveSession: () => null }, [liveSession]), null);
  assert.equal(liveSession.records, false);
  assert.deepEqual(liveSession.on, ["session-start"]);
});

test("a Claude session start exports its mark and keeps the plugin root; a task made in that shell carries the mark", (t) => {
  const m = machine(t);
  const envFile = join(m.dir, "env.sh");
  writeFileSync(envFile, "");
  sessionStart(m, "session-A", envFile);
  const line = readFileSync(envFile, "utf8").trim();
  assert.equal(line, `export ORBIT_SESSION='${hostSession("claude", "session-A")}'`);
  assert.equal(JSON.parse(readFileSync(join(m.hostDir, "observed.json"), "utf8")).root, ROOT);
  const created = json(node(m, cli("task.mjs"), ["create", "refund", "--json"], { env: { ORBIT_SESSION: hostSession("claude", "session-A") } }));
  const shown = json(node(m, cli("live.mjs"), ["status", "--json"], { env: { ORBIT_SESSION: hostSession("claude", "session-A") } }));
  assert.deepEqual([shown.association.how, shown.association.task], ["session", created.task]);
});

test("with Live switched off, a session start exports nothing and keeps nothing", (t) => {
  const m = machine(t);
  const envFile = join(m.dir, "env.sh");
  writeFileSync(envFile, "");
  sessionStart(m, "session-A", envFile, { ORBIT_LIVE: "off" });
  assert.equal(readFileSync(envFile, "utf8"), "");
  assert.equal(existsSync(join(m.hostDir, "observed.json")), false);
});

// ---- the person's settings ----------------------------------------------------------------------

test("render shows what is there and what would be written, and writes nothing", (t) => {
  const m = machine(t, { statusLine: { type: "command", command: "echo mine" }, theme: "dark" });
  const r = json(hostCli(m, "render"));
  assert.deepEqual(r.existing, { type: "command", command: "echo mine" });
  assert.equal(r.owned, false);
  assert.match(r.entry.command, /^node ".*\/control\/hosts\/claude\/statusline\.mjs"$/);
  assert.equal(r.entry.refreshInterval, 1);
  assert.deepEqual(m.settings(), { statusLine: { type: "command", command: "echo mine" }, theme: "dark" });
});

test("apply is a person's, refuses to overwrite a status line they have, and remove gives theirs back", (t) => {
  const m = machine(t, { statusLine: { type: "command", command: "echo mine" }, theme: "dark" });
  const revision = json(hostCli(m, "render")).revision;
  assert.equal(hostCli(m, "apply", `--revision=${revision}`).status, 2, "no --human");
  const refused = hostCli(m, "apply", `--revision=${revision}`, "--human");
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /already have a status line/);
  assert.equal(m.settings().statusLine.command, "echo mine");
  assert.equal(hostCli(m, "apply", `--revision=${revision}`, "--replace", "--human").status, 0);
  assert.match(m.settings().statusLine.command, /statusline\.mjs/);
  assert.equal(m.settings().theme, "dark", "no other key is touched");
  assert.equal(json(hostCli(m, "apply", `--revision=${revision}`, "--human")).unchanged, true, "applying again changes nothing");
  assert.equal(hostCli(m, "remove", `--revision=${json(hostCli(m, "inspect")).revision}`, "--human").status, 0);
  assert.deepEqual(m.settings(), { theme: "dark", statusLine: { type: "command", command: "echo mine" } });
});

// --keep-existing runs the person's command through /bin/sh, so Windows is refused it (keptCommand): there the CLI's
// own answer is the refusal, and nothing is kept.
const WINDOWS = process.platform === "win32";

test("on Windows keep-existing is refused by the CLI itself, and nothing is kept", { skip: !WINDOWS && "POSIX keeps it: the next test" }, (t) => {
  const m = machine(t, { statusLine: { type: "command", command: "echo mine" } });
  const r = hostCli(m, "apply", `--revision=${json(hostCli(m, "render")).revision}`, "--keep-existing", "--human");
  assert.deepEqual([r.status, /not offered on Windows/.test(r.stderr)], [2, true]);
  assert.equal(existsSync(join(m.hostDir, "keep.json")), false);
  assert.equal(m.settings().statusLine.command, "echo mine", "the person's status line is left as it was");
});

test("keep-existing keeps the person's command to run first, and is not offered on Windows", { skip: WINDOWS && "not offered on Windows: the test above holds the refusal" }, (t) => {
  const m = machine(t, { statusLine: { type: "command", command: "echo mine" } });
  assert.equal(hostCli(m, "apply", `--revision=${json(hostCli(m, "render")).revision}`, "--keep-existing", "--human").status, 0);
  assert.equal(JSON.parse(readFileSync(join(m.hostDir, "keep.json"), "utf8")).command, "echo mine");
  assert.throws(() => keptCommand({ command: "echo mine" }, "win32"), /not offered on Windows/);
  hostCli(m, "remove", `--revision=${json(hostCli(m, "inspect")).revision}`, "--human");
  assert.equal(existsSync(join(m.hostDir, "keep.json")), false);
});

// ---- the shim -----------------------------------------------------------------------------------

function installed(t, settings) {
  const m = machine(t, settings);
  hostCli(m, "apply", `--revision=${json(hostCli(m, "render")).revision}`, settings ? "--keep-existing" : "--replace", "--human");
  return { ...m, shim: join(m.hostDir, "statusline.mjs") };
}

const shimRun = (m, session, extra = {}) => spawnSync(process.execPath, [m.shim], { cwd: tmpdir(), env: { ...m.env, COLUMNS: "120", ...extra }, input: JSON.stringify({ session_id: session, workspace: { current_dir: m.repo } }), encoding: "utf8" });

test("the shim prints nothing and exits 0 until a session start has told it where the engine is", (t) => {
  const m = installed(t, null);
  const r = shimRun(m, "session-A");
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
});

test("the shim runs the engine the host last loaded, and shows this session's task", (t) => {
  const m = installed(t, null);
  const envFile = join(m.dir, "env.sh");
  writeFileSync(envFile, "");
  sessionStart(m, "session-A", envFile);
  const task = json(node(m, cli("task.mjs"), ["create", "refund", "--json"], { env: { ORBIT_SESSION: hostSession("claude", "session-A") } })).task;
  const r = shimRun(m, "session-A");
  assert.equal(r.status, 0);
  assert.match(r.stdout.replace(/\u001b\[[0-9;]*m/g, ""), new RegExp(`^Orbit .* ORBITING {2}${task}`));
  assert.ok(r.stdout.split("\n").filter(Boolean).length <= 3);
});

test("the shim keeps a person's own line above Orbit's, and with Live off shows only theirs", { skip: WINDOWS && "keep-existing is not offered on Windows: the refusal test holds it" }, (t) => {
  const m = installed(t, { statusLine: { type: "command", command: "echo mine" } });
  sessionStart(m, "session-A", join(m.dir, "none.sh"));
  node(m, cli("task.mjs"), ["create", "refund", "--json"]);
  assert.match(shimRun(m, "session-A").stdout.replace(/\u001b\[[0-9;]*m/g, ""), /^mine\nOrbit /);
  writeFileSync(join(m.hostDir, "settings.json"), JSON.stringify({ revision: 1, settings: { live: false }, schema: 1 }));
  assert.equal(shimRun(m, "session-A").stdout, "mine\n");
});
