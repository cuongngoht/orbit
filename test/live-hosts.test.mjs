// Orbit Live on every host (1.8.6, ADR 0022): Codex CLI and the Antigravity CLI have no pane API, so what `live
// --host=<name>` loads for them is the session's mark and the surfaces the host HAS -- measured, never assumed --
// and `live pane` answers them the same view model Claude Code's pane draws. Every host says, in five words, where it
// can show Live, and which one `live open` reaches from here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as antigravity from "../skills/orbit-learn/hosts/antigravity-statusline.mjs";
import * as claude from "../skills/orbit-learn/hosts/claude-statusline.mjs";
import * as codex from "../skills/orbit-learn/hosts/codex-statusline.mjs";
import { SURFACES, SURFACE_WORDS, surfaceOfOpener, surfaceRows } from "../skills/orbit-learn/hosts/live-surfaces.mjs";
import { OPENERS } from "../cli/live-open.mjs";
import { hostSession, taskSessionMark } from "../src/memory/session.mjs";
import { sealed } from "./home.mjs";

const LIVE = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "live.mjs");

test("every host says where it can show Live, in the five words, best first -- and only Claude Code has a pane to dock in", () => {
  assert.deepEqual(Object.keys(SURFACES).sort(), ["antigravity", "claude", "codex", "grok"]);
  for (const [host, rows] of Object.entries(SURFACES)) {
    assert.deepEqual(rows.map((r) => r.surface), SURFACE_WORDS, host);
    assert.ok(rows.every((r) => typeof r.available === "boolean" && r.how.length > 20), host);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(SURFACES).map(([h, rows]) => [h, rows[0].available])), { claude: true, codex: false, antigravity: false, grok: false });
});

test("what `live open` reaches is a surface for every opener there is", () => {
  for (const o of OPENERS) assert.ok(SURFACE_WORDS.includes(surfaceOfOpener(o.id)), o.id);
  assert.deepEqual(["tmux", "vscode", "macos-terminal", "print"].map(surfaceOfOpener), ["TERMINAL_SPLIT", "COMPANION", "WINDOW", "CLI"]);
  assert.match(surfaceRows("codex", "tmux").at(-1).says, /^TERMINAL_SPLIT/);
});

test("a Codex or Antigravity session's task is found by the mark its bound ORBIT_SESSION makes, as the task's writer made it", () => {
  for (const host of [codex, antigravity]) {
    const session = hostSession(host.name, "abc-123");
    assert.equal(host.sessionOf({ cwd: "/work" }, { ORBIT_SESSION: session }).mark, taskSessionMark(session), host.name);
    assert.equal(host.sessionOf({ session_id: "abc-123" }, {}).mark, taskSessionMark(session), `${host.name}: a drawer's session id comes to the same mark`);
    assert.equal(host.sessionOf({}, { PWD: "/work" }).cwd, "/work");
    assert.match(host.PANE_HINTS.inline, /no (pane|panel) API/);
    for (const key of ["name", "sessionOf", "room", "enabled", "PANE_HINTS", "doctor"]) assert.ok(key in host, `${host.name} exports ${key}`);
  }
  for (const key of ["name", "sessionOf", "room", "enabled", "PANE_HINTS", "doctor"]) assert.ok(key in claude, `claude exports ${key}`);
});

// ---- real processes --------------------------------------------------------------------------------------------

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-hosts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  return { repo, env: (over = {}) => sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", ...over }) };
}

const run = (s, argv, input = "", env = s.env()) => new Promise((resolve) => {
  const child = spawn(process.execPath, [LIVE, ...argv], { cwd: s.repo, env, stdio: ["pipe", "pipe", "pipe"] });
  const out = [];
  child.stdout.on("data", (b) => out.push(b));
  child.on("close", (code) => resolve({ code, text: Buffer.concat(out).toString("utf8") }));
  child.stdin.end(input);
});

test("`live pane --host=codex|antigravity|grok --protocol=2` answers the version-2 view model, for any drawer", async (t) => {
  const s = setup(t);
  for (const host of ["codex", "antigravity", "grok"]) {
    const got = await run(s, ["pane", `--host=${host}`, "--protocol=2", "--columns=60", "--rows=30"], JSON.stringify({ cwd: s.repo }), s.env({ ORBIT_SESSION: hostSession(host, "s-1") }));
    assert.equal(got.code, 0, host);
    const doc = JSON.parse(got.text);
    assert.equal(doc.version, 2, host);
    assert.equal(doc.task, null, "no task yet in a fresh checkout");
    assert.equal(doc.indicator.state, "NONE", "nothing to show is said, never drawn as idle work");
    assert.match(doc.hints.inline, /no (pane|panel) API/);
  }
});

test("`live doctor --host=<name>` says the host's surfaces and what `live open` reaches here; --claude keeps its 1.8.5 rows", async (t) => {
  const s = setup(t);
  const codexSays = await run(s, ["doctor", "--host=codex", "--protocol=2"], "", s.env({ ORBIT_SESSION: hostSession("codex", "s-1") }));
  assert.equal(codexSays.code, 0);
  assert.match(codexSays.text, /surface +NATIVE_PANE no — Codex CLI has hooks and plugins but no pane/);
  assert.match(codexSays.text, /session +bound/);
  assert.match(codexSays.text, /here +(TERMINAL_SPLIT|COMPANION|WINDOW|CLI) — what `live open` reaches/);
  const claudeSays = await run(s, ["doctor", "--claude"]);
  assert.match(claudeSays.text, /statusLine /, "the status line rows it always had");
  assert.match(claudeSays.text, /surface +NATIVE_PANE yes/);
});
