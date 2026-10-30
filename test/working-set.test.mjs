import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { collect } from "../src/engineering/working-set/collect.mjs";
import { fold } from "../src/engineering/working-set/fold.mjs";
import { MAX_BYTES, TTL_MS, createWorkingSet } from "../src/engineering/working-set/store.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AT = "2026-09-23T01:00:00.000Z";

const ev = (over = {}) => ({ event: "post-tool", tool: { kind: "command" }, paths: [], pattern: null, command: null, ok: true, ...over });

test("a command is kept as a class, a bare executable and an outcome — never its arguments", () => {
  const line = collect(ev({ command: "/usr/bin/curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y' https://api --password hunter2" }), "/repo", AT);
  assert.deepEqual(line.cmd, { class: "other", exe: "curl", ok: true });
  assert.doesNotMatch(JSON.stringify(line), /hunter2|eyJ|Bearer|api/);
});

test("command classes are generic words, first match wins", () => {
  const cls = (command) => collect(ev({ command }), "/repo", AT).cmd.class;
  assert.equal(cls("git commit -m x"), "commit");
  assert.equal(cls("git diff HEAD"), "diff");
  assert.equal(cls("node --test"), "test");
  assert.equal(cls("npm run lint"), "lint");
  assert.equal(cls("make build"), "build");
  assert.equal(cls("ls -la"), "other");
});

test("paths are repo-relative, and anything outside the checkout is dropped", () => {
  const line = collect(ev({ tool: { kind: "edit" }, paths: ["/repo/src/a.mjs", "/etc/passwd", "../elsewhere.txt", "src/b.mjs"] }), "/repo", AT);
  assert.deepEqual(line.paths, ["src/a.mjs", "src/b.mjs"]);
});

test("a search keeps scrubbed tokens of its pattern, never the pattern and never a secret in it", () => {
  const line = collect(ev({ tool: { kind: "search" }, pattern: "api_key=abc123def456 OR eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig OrderRepository" }), "/repo", AT);
  assert.ok(line.tokens.includes("orderrepository"));
  assert.doesNotMatch(JSON.stringify(line), /abc123def456|eyJ|api_key=/);
});

test("a tool of no known kind that touched no path leaves nothing", () => {
  assert.equal(collect(ev({ tool: { kind: "other" } }), "/repo", AT), null);
});

// 0.2.2, ADR 0044: which agent a line is about, a subagent's start and stop, and a call that STARTED a skill or an agent
// -- names and hashed ids only; an event a subagent raised never brings its prompt, its output or its last message.
test("a line names the subagent that made it; a subagent's start and stop and a skill or agent started are kept, by name", () => {
  const agent = { id: "claude:0123456789abcdef", type: "orbit:satellite-reader" };
  assert.deepEqual(collect(ev({ tool: { kind: "read" }, paths: ["/repo/a.md"], agent }), "/repo", AT), { t: AT, ev: "post-tool", tool: "read", paths: ["a.md"], tokens: [], cmd: null, agent: agent.id, agentType: agent.type });
  assert.deepEqual(collect({ event: "agent-start", agent }, "/repo", AT), { t: AT, ev: "agent-start", agent: agent.id, agentType: agent.type });
  assert.deepEqual(collect({ event: "agent-end", agent }, "/repo", AT), { t: AT, ev: "agent-end", agent: agent.id, agentType: agent.type });
  assert.equal(collect({ event: "agent-end" }, "/repo", AT), null, "a stop that names no agent is no line");
  const launched = collect(ev({ tool: { name: "Agent", kind: "other" }, invokes: { kind: "agent", name: "orbit:satellite-reader" }, launched: "claude:fedcba9876543210", dispatched: "msn-0123456789ab/arn-2", prompt: "SECRET-SENTINEL" }), "/repo", AT);
  assert.deepEqual([launched.invokes, launched.launched, launched.run, launched.cmd], [{ kind: "agent", name: "orbit:satellite-reader" }, "claude:fedcba9876543210", "msn-0123456789ab/arn-2", null]);
  assert.deepEqual(collect(ev({ tool: { name: "Skill", kind: "other" }, invokes: { kind: "skill", name: "orbit:orbit-help" }, agent }), "/repo", AT).invokes, { kind: "skill", name: "orbit:orbit-help" });
  assert.doesNotMatch(JSON.stringify(launched), /SECRET-SENTINEL/);
  assert.equal(collect(ev({ event: "pre-tool", tool: { name: "Skill", kind: "other" }, invokes: { kind: "skill", name: "x" } }), "/repo", AT), null, "only a FINISHED call is kept: a skill has no end to pair a start with");
  assert.equal(fold([collect({ event: "agent-start", agent }, "/repo", AT), launched]).events, 2, "the engineering fold counts them and learns nothing from them");
});

test("the fold knows what changed since the last observation, and whether a check passed AFTER the last edit", () => {
  const lines = [
    { ev: "post-tool", tool: "edit", paths: ["src/a/x.mjs"], tokens: [] },
    { ev: "post-tool", tool: "command", paths: [], tokens: [], cmd: { class: "test", ok: true } },
    { ev: "post-tool", tool: "edit", paths: ["src/b/y.mjs"], tokens: [] },
  ];
  const s = fold(lines);
  assert.deepEqual(s.since.changed, ["src/a/x.mjs", "src/b/y.mjs"]);
  assert.equal(s.since.checked, false, "an edit after the check un-checks it");
  assert.equal(fold([...lines, { ev: "post-tool", tool: "command", cmd: { class: "lint", ok: true } }]).since.checked, true);
  assert.deepEqual(s.scopes, ["src/a", "src/b"]);
});

test("a background launch or a failed check is never a check that passed", () => {
  const edit = { ev: "post-tool", tool: "edit", paths: ["src/x.mjs"], tokens: [] };
  assert.equal(fold([edit, { ev: "post-tool", tool: "command", cmd: { class: "test", ok: true }, bg: true }]).since.checked, false);
  assert.equal(fold([edit, { ev: "post-tool-failure", tool: "command", cmd: { class: "test", ok: false } }]).since.checked, false);
});

test("an observation resets what is 'since'", () => {
  const s = fold([{ ev: "post-tool", tool: "edit", paths: ["src/x.mjs"] }, { ev: "observe", t: AT }]);
  assert.deepEqual(s.since.changed, []);
  assert.equal(s.observes, 1);
  assert.equal(s.lastObserve, AT);
});

test("the store appends, drops a torn line on read, and stops growing at its bound — saying so once", () => {
  const io = fakeIo();
  const ws = createWorkingSet("/ws", io);
  ws.append("s1", { ev: "post-tool", n: 1 });
  io.append(join("/ws", readdirOf(io)[0]), "{ torn");
  assert.equal(ws.read("s1").length, 1);
  io.files.set(join("/ws", readdirOf(io)[0]), "x".repeat(MAX_BYTES));
  ws.append("s1", { ev: "post-tool" });
  ws.append("s1", { ev: "post-tool" });
  assert.equal(io.files.get(join("/ws", readdirOf(io)[0])).split('"ev":"truncated"').length - 1, 1);
});

const readdirOf = (io) => io.list("/ws");

test("a new session prunes sessions older than the TTL, and nothing younger", () => {
  const [old, young] = [join("/ws", "old.jsonl"), join("/ws", "young.jsonl")];
  const io = fakeIo({ nowMs: TTL_MS * 3, mtimes: { [old]: 0, [young]: TTL_MS * 3 - 1000 } });
  io.files.set(old, "{}\n");
  io.files.set(young, "{}\n");
  createWorkingSet("/ws", io).append("new-session", { ev: "post-tool" });
  assert.ok(!io.files.has(old));
  assert.ok(io.files.has(young));
});

// ── end to end, through the real hook ──────────────────────────────────────
const UI_TESTS = join(ROOT, "test", "fixtures", "ui-tests");

function hook(input, env = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "orbit-wstest-"));
  const store = mkdtempSync(join(tmpdir(), "orbit-wsstore-"));
  const r = spawnSync(process.execPath, [join(ROOT, "cli", "learn-hook.mjs")], { encoding: "utf8", input: JSON.stringify(input), env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store, TMPDIR: tmp, TMP: tmp, TEMP: tmp, ...env }) });
  return { r, tmp, store, lines: wsLines(store) };
}

function wsLines(store) {
  return readdirSync(store, { recursive: true }).map(String).filter((f) => f.includes("working-set") && f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(store, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}

test("session start writes no working set at all", () => {
  const { r, lines } = hook({ hook_event_name: "SessionStart", session_id: "s", cwd: ROOT });
  assert.equal(r.status, 0);
  assert.deepEqual(lines, []);
});

test("a Read after a tool call is one line of metadata, and the learning store is untouched", () => {
  // The session trail is its own room under the store base (test/trace.test.mjs);
  // this asserts the WORKING SET never reaches the store, so the trail is off.
  const { r, lines, store } = hook({ hook_event_name: "PostToolUse", session_id: "s", cwd: ROOT, tool_name: "Read", tool_input: { file_path: join(ROOT, "AGENTS.md") }, tool_response: { content: "SECRET FILE BODY" } }, { ORBIT_TRACE: "off" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "", "a background hook prints nothing into the transcript");
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].paths, ["AGENTS.md"]);
  assert.doesNotMatch(JSON.stringify(lines), /SECRET FILE BODY/);
  assert.ok(readdirSync(store, { recursive: true }).every((f) => !/runs|notes|engineering/.test(String(f))), "working sets do not write learning records");
});

test("a failed tool is recorded as not ok, and never as anything more", () => {
  const { lines } = hook({ hook_event_name: "PostToolUseFailure", session_id: "s", cwd: ROOT, tool_name: "Bash", tool_input: { command: "node --test" } });
  assert.equal(lines[0].cmd.ok, false);
});

test("ORBIT_WORKING_SET=off records nothing", () => {
  const { lines, tmp } = hook({ hook_event_name: "PostToolUse", session_id: "s", cwd: ROOT, tool_name: "Read", tool_input: { file_path: join(ROOT, "AGENTS.md") } }, { ORBIT_WORKING_SET: "off" });
  assert.deepEqual(lines, []);
  assert.ok(!readdirSync(tmp).some((n) => n.startsWith("orbit-ws-")));
});

test("the plugin-settings toggle switches the working set off too", () => {
  const { lines } = hook({ hook_event_name: "PostToolUse", session_id: "s", cwd: ROOT, tool_name: "Read", tool_input: { file_path: join(ROOT, "AGENTS.md") } }, { CLAUDE_PLUGIN_OPTION_WORKING_SET: "false" });
  assert.deepEqual(lines, []);
});

test("no working-set write ever lands in the repository", () => {
  const before = existsSync(join(ROOT, "working-set"));
  hook({ hook_event_name: "PostToolUse", session_id: "s", cwd: ROOT, tool_name: "Edit", tool_input: { file_path: join(ROOT, "src", "x.mjs") } });
  assert.equal(existsSync(join(ROOT, "working-set")), before);
});
