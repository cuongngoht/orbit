import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CHECKS, CLASSES, WORKS, collect } from "../src/engineering/working-set/collect.mjs";
import { CHECK_PURPOSES } from "../src/orchestration/vocab.mjs";
import { MAX_RAN, fold } from "../src/engineering/working-set/fold.mjs";
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

// 0.6.0 (P3b): a test the host runs clears what its edits owe, whatever runner its project uses -- so a program NAMED for
// testing is a test run, in this one table, and no row names a runner.
test("a program named for testing is a test run: the executable, or the program a launcher is told to run -- never an argument", () => {
  const cls = (command) => collect(ev({ command }), "/repo", AT).cmd.class;
  for (const command of ["pytest", "pytest -x tests/checkers/unittest_variables.py", "python -m pytest -q", "python3 -m unittest discover", "uv run pytest", "poetry run python -m pytest", ".venv/bin/pytest -x", "PYTHONPATH=src pytest", "npx vitest run", "ctest --output-on-failure", "cargo nextest run", "npm test", "npm run test:unit", "node --test", "go test ./...", "cargo test", "make test"]) assert.equal(cls(command), "test", command);
  for (const command of ["npm install foo@latest", "docker pull image:latest", "cat src/latest.txt", "python -m http.server", "pip install pytest==8.0.0"]) assert.equal(cls(command), "other", command);
  assert.equal(cls("git commit -m 'add a pytest'"), "commit", "first match wins");
  assert.deepEqual(collect(ev({ command: "PYTEST_ADDOPTS='-k secret' .venv/bin/pytest tests/x.py" }), "/repo", AT).cmd, { class: "test", exe: "pytest", ok: true }, "still a class and a bare executable, never an argument");
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

test("a subagent's call that touched no path is kept by its tool's name, the session's own is not; an Agent call is kept while it launches", () => {
  const agent = { id: "claude:0123456789abcdef", type: "orbit:satellite-reader" };
  assert.equal(collect(ev({ tool: { name: "SubagentHandback", kind: "other" }, agent }), "/repo", AT).name, "SubagentHandback", "an agent's lines are the whole of what it was seen doing");
  assert.equal(collect(ev({ tool: { name: "TodoWrite", kind: "other" } }), "/repo", AT), null, "the session's own tool with no path stays out, as before");
  const launching = collect(ev({ event: "pre-tool", tool: { name: "Agent", kind: "other" }, invokes: { kind: "agent", name: "orbit:satellite-reader" }, dispatched: "msn-0123456789ab/arn-1" }), "/repo", AT);
  assert.deepEqual([launching.ev, launching.invokes.name, launching.run], ["pre-tool", "orbit:satellite-reader", "msn-0123456789ab/arn-1"]);
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

// 0.6.0 (P1, P5): what the session's checks came to -- the last one, and one check failing again and again with nothing
// changed between it. The same check is its class and its bare executable; only an edit or that check passing ends a run.
test("the fold keeps the last check and counts one check failing in a row with no edit between", () => {
  const edit = { ev: "post-tool", tool: "edit", paths: ["src/x.mjs"], tokens: [] };
  const fail = (exe = "npm", cls = "test") => ({ ev: "post-tool-failure", tool: "command", paths: [], tokens: [], cmd: { class: cls, exe, ok: false } });
  const pass = (exe = "npm") => ({ ev: "post-tool", tool: "command", paths: [], tokens: [], cmd: { class: "test", exe, ok: true } });
  const other = { ev: "post-tool", tool: "command", paths: [], tokens: [], cmd: { class: "other", exe: "cat", ok: true } };
  assert.deepEqual(fold([]).checks, { last: null, repeats: null });
  assert.deepEqual(fold([fail()]).checks, { last: { class: "test", exe: "npm", ok: false, afterEdit: false }, repeats: { class: "test", exe: "npm", n: 1 } });
  assert.deepEqual(fold([edit, fail(), other, fail(), fail()]).checks, { last: { class: "test", exe: "npm", ok: false, afterEdit: true }, repeats: { class: "test", exe: "npm", n: 3 } }, "a command that changed nothing does not break the run");
  assert.equal(fold([fail(), fail(), edit, fail()]).checks.repeats.n, 1, "an edit between starts the count again");
  assert.equal(fold([fail(), fail(), pass(), fail()]).checks.repeats.n, 1, "the check passing ends the run");
  assert.equal(fold([fail(), fail("pytest"), fail()]).checks.repeats.n, 1, "another check failing is not the same check");
  assert.equal(fold([fail(), fail(), fail("x", "build")]).checks.repeats.class, "build");
  assert.equal(fold([fail(), { ...pass(), bg: true }]).checks.repeats.n, 1, "a background launch ended nothing");
  assert.equal(fold([fail(), { ev: "pre-tool", tool: "command", cmd: { class: "test", exe: "npm", ok: null } }]).checks.repeats.n, 1, "a check starting is not a check that ended");
});

test("an observation resets what is 'since'", () => {
  const s = fold([{ ev: "post-tool", tool: "edit", paths: ["src/x.mjs"] }, { ev: "observe", t: AT }]);
  assert.deepEqual(s.since.changed, []);
  assert.equal(s.observes, 1);
  assert.equal(s.lastObserve, AT);
});

// 0.6.0 (P3): what a Stop may still owe a check for -- every file edited since the last check that PASSED, whoever
// looked since. An observation resets `since` and leaves this alone; a failed check, a background launch or a command
// that is not a check clears nothing.
test("unverified: the files edited since the last PASSING test -- never reset by an observation, a failure, a background launch, a lint or a build", () => {
  const edit = (path) => ({ ev: "post-tool", tool: "edit", paths: [path], tokens: [] });
  const cmd = (klass, ok, more = {}) => ({ ev: ok ? "post-tool" : "post-tool-failure", tool: "command", paths: [], tokens: [], cmd: { class: klass, ok }, ...more });
  assert.deepEqual(fold([]).unverified, { changed: [], ran: [] });
  assert.deepEqual(fold([edit("src/a.mjs"), cmd("test", true), edit("src/b.mjs"), edit("src/b.mjs")]).unverified.changed, ["src/b.mjs"], "a pass clears what came before it; an edit after it is owed again");
  assert.deepEqual(fold([edit("src/a.mjs"), { ev: "observe", t: AT }]).unverified.changed, ["src/a.mjs"], "the observer looking is not a check");
  assert.deepEqual(fold([edit("src/a.mjs"), cmd("test", false)]).unverified.changed, ["src/a.mjs"], "a failed check verifies nothing");
  assert.deepEqual(fold([edit("src/a.mjs"), cmd("test", true, { bg: true })]).unverified.changed, ["src/a.mjs"], "a background launch is reported the moment it starts");
  assert.deepEqual(fold([edit("src/a.mjs"), cmd("other", true), cmd("diff", true), cmd("commit", true)]).unverified.changed, ["src/a.mjs"], "only a class that shows the change works clears it");
  assert.deepEqual(fold([edit("src/a.mjs"), cmd("test", true)]).unverified.changed, [], "a test passing shows it works");
  for (const klass of ["lint", "build"]) assert.deepEqual(fold([edit("src/a.mjs"), cmd(klass, true)]).unverified.changed, ["src/a.mjs"], `a ${klass} passing says it reads well or compiles, never that it works`);
  for (const klass of ["lint", "build"]) assert.equal(fold([edit("src/a.mjs"), cmd(klass, true)]).since.checked, true, "the observer's milestone is unchanged: a passing check of any CHECKS class");
  assert.deepEqual(fold([edit("src/a.mjs"), { ev: "pre-tool", tool: "command", paths: [], tokens: [], cmd: { class: "test", ok: null } }]).unverified.changed, ["src/a.mjs"], "a check STARTING is not one that passed");
});

// 0.6.0 (P3b): which classes show a change WORKS is decided once, by CHECK_PURPOSES (a purpose that verifies and builds
// nothing); the working set reads no orchestration, so its `works` column is held equal to it here.
test("WORKS is CHECK_PURPOSES' own word: a generic class shows the change works only when the purpose it names verifies and builds nothing", () => {
  const derived = CHECK_PURPOSES.filter((p) => p.verifies && !p.building).map((p) => p.name).filter((name) => CLASSES.some((c) => c.name === name));
  assert.deepEqual(WORKS, derived);
  assert.deepEqual(WORKS, ["test"]);
  for (const c of CLASSES.filter((x) => !x.works)) assert.equal(CHECK_PURPOSES.some((p) => p.name === c.name && p.verifies && !p.building), false, c.name);
  assert.ok(WORKS.every((w) => CHECKS.includes(w)), "what shows a change works is a check too");
});

test("unverified.ran: the runs that passed since the last edit, a class and a bare executable, bounded -- what tells a declared verifying check", () => {
  const edit = { ev: "post-tool", tool: "edit", paths: ["src/a.mjs"], tokens: [] };
  const cmd = (klass, exe, ok = true, more = {}) => ({ ev: ok ? "post-tool" : "post-tool-failure", tool: "command", paths: [], tokens: [], cmd: { class: klass, exe, ok }, ...more });
  assert.deepEqual(fold([edit, cmd("lint", "make"), cmd("lint", "make"), cmd("build", "npm"), cmd("other", "python", false), cmd("lint", "x", true, { bg: true })]).unverified.ran, [{ class: "lint", exe: "make" }, { class: "build", exe: "npm" }], "passed, once each, never a failure or a background launch");
  assert.deepEqual(fold([cmd("lint", "make"), edit]).unverified.ran, [], "a run before the last edit verified the code as it was then");
  assert.deepEqual(fold([edit, cmd("lint", "make"), cmd("test", "npm")]).unverified, { changed: [], ran: [] });
  assert.equal(fold([edit, ...Array.from({ length: MAX_RAN + 4 }, (_, i) => cmd("other", `x${i}`))]).unverified.ran.length, MAX_RAN);
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
