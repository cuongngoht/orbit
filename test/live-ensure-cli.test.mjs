// `live ensure` as /orbit-help runs it, in real processes: four asks at once from one session open ONE pane; the
// answer is one JSON object; a headless session (claude -p) opens nothing; and the 1.8.4 `open --auto` is now the
// same launcher. The pane is a stub `tmux` on PATH (outside the checkout, as the opener demands) that records what it
// was asked and plays the viewer: it says READY on the lease it was handed, as `live tui --lease` does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = join(ROOT, "cli", "live.mjs");
const POSIX = process.platform !== "win32";

// The stub: one line per call into calls.log, then -- like the viewer it would have started -- ready on its lease.
const STUB = (lease, log) => `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
const { leaseWhere, viewerReady } = await import(${JSON.stringify(lease)});
const { safeName } = await import(${JSON.stringify(join(ROOT, "src", "project", "paths.mjs"))});
const { storeBase } = await import(${JSON.stringify(join(ROOT, "src", "project", "repository.mjs"))});
const { stateRooms } = await import(${JSON.stringify(join(ROOT, "src", "store", "control.mjs"))});
const { realIo } = await import(${JSON.stringify(join(ROOT, "src", "store", "io.mjs"))});
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
const arg = process.argv.find((a) => a.startsWith("--lease="));
if (arg && !process.env.STUB_SILENT) {
  const [key, owner] = arg.slice("--lease=".length).split(".");
  viewerReady(realIo(), leaseWhere(stateRooms(storeBase(process.env)).live, safeName(hostname()), key), { owner }, { at: new Date().toISOString(), pid: null, shows: null });
}
`;

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ensure-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "tmux"), STUB(join(ROOT, "src", "live", "lease.mjs"), join(dir, "calls.log")));
  chmodSync(join(dir, "bin", "tmux"), 0o755);
  return { dir, repo, env: (over = {}) => sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ATTENDED: "1", ORBIT_SESSION: "claude:0123456789abcdef", TMUX: "/tmp/tmux-1/default,1,0", PATH: `${join(dir, "bin")}:${process.env.PATH}`, ...over }), calls: () => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []) };
}

const ensure = (s, argv = [], env = s.env()) => new Promise((resolve) => {
  const child = spawn(process.execPath, [LIVE, "ensure", ...argv, "--json"], { cwd: s.repo, env, stdio: ["ignore", "pipe", "pipe"] });
  const out = [];
  child.stdout.on("data", (b) => out.push(b));
  child.on("close", (code) => resolve({ code, json: JSON.parse(Buffer.concat(out).toString("utf8")) }));
});

test("four asks at once from one session open one pane, and each answers one JSON object", { skip: POSIX ? false : "a POSIX stub opener: NOT TESTED on Windows" }, async (t) => {
  const s = setup(t);
  const got = await Promise.all([ensure(s), ensure(s, ["tsk-0123456789ab"]), ensure(s), ensure(s, ["tsk-0123456789ab"])]);
  assert.ok(got.every((g) => g.code === 0), "a viewer never fails the work it would show");
  assert.equal(s.calls().length, 1, got.map((g) => g.json.status).join(","));
  assert.equal(got.filter((g) => g.json.status === "OPENED").length, 1);
  assert.ok(got.every((g) => ["OPENED", "ALREADY_ATTACHED", "SELECTED", "STARTING"].includes(g.json.status)), got.map((g) => g.json.status).join(","));
  const call = s.calls()[0];
  assert.deepEqual(call.slice(0, 6), ["split-window", "-h", "-d", "-l", "36%", "-c"], "a pane on the right of this one at the share a person set, focus left where it was");
  assert.ok(call.some((a) => /^--lease=[a-f0-9]{16}\.[a-f0-9]{16}$/.test(a)));
  assert.ok(call.includes("ORBIT_SESSION=claude:0123456789abcdef") && !call.some((a) => /^HOME=|^PATH=/.test(a)), "the session's mark passed on by name, nothing else of the environment");
});

test("a second /orbit-help in the same session reuses the pane; a headless run (claude -p) and a switched-off Live open nothing", { skip: POSIX ? false : "a POSIX stub opener: NOT TESTED on Windows" }, async (t) => {
  const s = setup(t);
  assert.equal((await ensure(s)).json.status, "OPENED");
  assert.equal((await ensure(s)).json.status, "ALREADY_ATTACHED");
  const headless = await ensure(s, [], s.env({ CLAUDE_CODE_SESSION_ATTENDED: "0", ORBIT_SESSION: "claude:fedcba9876543210" }));
  assert.equal(headless.json.status, "HEADLESS_FALLBACK");
  assert.match(headless.json.command, /'tui'$/, "the command a person can run in a second terminal");
  assert.equal((await ensure(s, [], s.env({ ORBIT_LIVE: "off", ORBIT_SESSION: "claude:aaaabbbbccccdddd" }))).json.status, "DISABLED_BY_POLICY");
  assert.equal(s.calls().length, 1);
});

test("a viewer that never says it is ready is STARTING, never OPENED, and is not opened twice while it starts", { skip: POSIX ? false : "a POSIX stub opener: NOT TESTED on Windows" }, async (t) => {
  const s = setup(t);
  const env = s.env({ STUB_SILENT: "1" });
  assert.equal((await ensure(s, [], env)).json.status, "STARTING");
  assert.equal((await ensure(s, [], env)).json.status, "STARTING");
  assert.equal(s.calls().length, 1);
});

test("`open --auto` (what a 1.8.4 workflow ran) is the same launcher, quiet: one pane per session, nothing printed", { skip: POSIX ? false : "a POSIX stub opener: NOT TESTED on Windows" }, (t) => {
  const s = setup(t);
  const out = execFileSync(process.execPath, [LIVE, "open", "tsk-0123456789ab", "--auto"], { cwd: s.repo, env: s.env(), encoding: "utf8" });
  assert.equal(out, "", "a workflow's own call prints nothing into its caller's output");
  assert.equal(s.calls().length, 1);
  execFileSync(process.execPath, [LIVE, "open", "tsk-0123456789ab", "--auto"], { cwd: s.repo, env: s.env(), encoding: "utf8" });
  assert.equal(s.calls().length, 1, "asked again: the session's pane is reused");
});

// A host with no mark of its own (Codex, Antigravity) is attended only on a person's word: `attendedHosts` in the live
// settings. The shell is what Codex gives a command: its own variables, and no CLAUDECODE.
const codexEnv = (s, over = {}) => ((env) => { delete env.CLAUDECODE; delete env.CLAUDE_CODE_SESSION_ATTENDED; return env; })(s.env({ ORBIT_HOST: "codex", ORBIT_HOST_PROTOCOL: "2", ORBIT_SESSION: "codex:0123456789abcdef", CODEX_CI: "1", ...over }));

const declare = (s, hosts) => execFileSync(process.execPath, [LIVE, "settings", `--apply=${JSON.stringify({ attendedHosts: hosts })}`], { cwd: s.repo, env: s.env(), encoding: "utf8" });

test("Codex opens nothing by itself until a person declares it interactive; Antigravity needs its own word; Claude is unchanged", { skip: POSIX ? false : "a POSIX stub opener: NOT TESTED on Windows" }, async (t) => {
  const s = setup(t);
  assert.equal((await ensure(s, [], codexEnv(s))).json.status, "HEADLESS_FALLBACK", "no word of a person: not attended");
  declare(s, ["codex"]);
  assert.equal((await ensure(s, [], codexEnv(s))).json.status, "OPENED", "a person said Codex is used interactively here");
  assert.equal(s.calls().length, 1);
  const agy = await ensure(s, [], codexEnv(s, { ORBIT_HOST: "antigravity", ORBIT_SESSION: "antigravity:0123456789abcdef" }));
  assert.equal(agy.json.status, "HEADLESS_FALLBACK", "declaring one host says nothing of another");
  assert.equal((await ensure(s)).json.status, "OPENED", "Claude's own mark decides for Claude, as before");
});

test("a person's list never overrides a verified host: a headless Claude stays headless, and a bad host id is refused", { skip: POSIX ? false : "a POSIX stub opener: NOT TESTED on Windows" }, async (t) => {
  const s = setup(t);
  assert.throws(() => declare(s, ["Not A Host"]), (e) => /host ids/.test(String(e.stderr)), "refused, never clamped");
  declare(s, ["claude", "codex"]);
  const headless = await ensure(s, [], s.env({ CLAUDE_CODE_SESSION_ATTENDED: "0", ORBIT_HOST: "claude" }));
  assert.equal(headless.json.status, "HEADLESS_FALLBACK", "claude -p is decided by Claude's mark, never by the list");
});
