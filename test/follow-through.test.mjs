// FOLLOW-THROUGH (0.5.0, B22 M3, ADR 0050) through the real hooks, in a real checkout and store, as Claude Code runs
// them: a known checkout's session start opens with ONE capability line (and, resumed or compacted, this session's open
// work); a failed Orbit command under governed work gets its owner's recovery row joined to the diagnosis; one of Orbit's
// agents returning gets one line naming the owner record that settles its work. None of it writes anything, and where
// the session holds no governed work the new lines say nothing. (The Stop hold is test/stop-hold.test.mjs's.)
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CAPABILITY_BYTES } from "../src/lifecycle/owners.mjs";
import { hostSession } from "../src/memory/session.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = "session-raw-follow";

function checkout(t, seated = true) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-follow-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const p = { dir, repo, store: join(dir, "store") };
  if (seated) assert.equal(run(p, "init.mjs", [repo]).status, 0);
  return p;
}

const run = (p, file, args, env = {}, input = undefined) => spawnSync(process.execPath, [join(ROOT, "cli", file), ...args], { cwd: p.repo, env: sealed({ ORBIT_STORE_DIR: p.store, ORBIT_TRACE: "off", ...env }), input, encoding: "utf8", timeout: 60000 });

const hook = (p, file, payload, env = {}) => run(p, file, [], env, JSON.stringify({ session_id: RAW, cwd: p.repo, ...payload }));

function workflow(p) {
  const started = run(p, "automation.mjs", ["start", "--for=implement the refund approval rule and verify it", "--json"], { ORBIT_SESSION: hostSession("claude", RAW) });
  assert.equal(started.status, 0, started.stderr);
  return JSON.parse(started.stdout).task;
}

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

const contents = (p) => Object.fromEntries(walk(p.store).map((f) => [f, readFileSync(f, "utf8")]));

const contextOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null);

// Orbit Live's session start keeps where the host loaded the plugin from (src/lifecycle/subscribers/live-session.mjs);
// switched off here, so what is measured is the digest alone.
test("a known checkout's session starts with ONE capability line, first and at most 300 bytes -- and it writes nothing", (t) => {
  const p = checkout(t);
  const before = contents(p);
  const r = hook(p, "learn-hook.mjs", { hook_event_name: "SessionStart", source: "startup" }, { ORBIT_LIVE: "off" });
  assert.equal(r.status, 0, r.stderr);
  const [line, ...rest] = contextOf(r).split("\n\n");
  assert.match(line, /^Orbit here: skills \d+\/\d+ · agents \d+\/\d+ .*usable.*; project STATUS (BOOTSTRAPPED|PARTIAL|READY|STALE)\.$/);
  assert.ok(Buffer.byteLength(line) <= CAPABILITY_BYTES, `${Buffer.byteLength(line)} bytes`);
  assert.equal(rest.some((x) => x.includes("open work")), false, "a fresh session has no open work to say");
  assert.deepEqual(contents(p), before, "the digest reads the registry, the memory and the owners -- and writes nothing");
});

test("what a person switched off is said, and the line leaves when the prompt router is switched off", (t) => {
  const p = checkout(t);
  assert.match(contextOf(hook(p, "learn-hook.mjs", { hook_event_name: "SessionStart" }, { CLAUDE_PLUGIN_OPTION_SKILL_PROJECT_REPORTER: "false" })), /switched off: [^;]*orbit-report/);
  const off = contextOf(hook(p, "learn-hook.mjs", { hook_event_name: "SessionStart" }, { ORBIT_PROMPT_ROUTER: "off" }));
  assert.equal(String(off ?? "").includes("Orbit here:"), false, "the capability line is the router's registry: off with it");
});

test("a resumed or compacted session hears its open work and the next step, through the owner's own command", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  for (const source of ["resume", "compact"]) {
    const parts = contextOf(hook(p, "learn-hook.mjs", { hook_event_name: "SessionStart", source })).split("\n\n");
    assert.match(parts[0], /^Orbit here: /, source);
    assert.match(parts[1], new RegExp(`^Orbit: this session's open work is workflow ${task} \\(EXECUTING\\), next: context -- node \\S+cli[\\\\/]automation\\.mjs context ${task} says where it stands\\.$`), source);
  }
  assert.equal(contextOf(hook(p, "learn-hook.mjs", { hook_event_name: "SessionStart", source: "startup" })).includes("open work"), false, "a fresh start says no open work");
  const other = run(p, "learn-hook.mjs", [], {}, JSON.stringify({ session_id: "another-session", cwd: p.repo, hook_event_name: "SessionStart", source: "resume" }));
  assert.equal(contextOf(other).includes("open work"), false, "another session's workflow is not this one's");
});

test("an Orbit command that failed under this session's workflow gets its owner's recovery row, joined to the diagnosis in ONE payload", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  const failed = (command) => hook(p, "learn-hook.mjs", { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "toolu_f", tool_input: { command } });
  const step = contextOf(failed(`node ${join(ROOT, "cli", "automation.mjs")} step ${task} --json`));
  assert.match(step, new RegExp(`^Orbit: this command ran under workflow ${task} \\(EXECUTING\\)\\. An action that did not settle is read back with node \\S+cli[\\\\/]automation\\.mjs reconcile ${task} -- never sent again\\.$`));
  const watched = contextOf(failed(`node ${join(ROOT, "cli", "run-case.mjs")} create-thing`)).split("\n");
  assert.deepEqual([watched.length, /^A orbit command exited non-zero/.test(watched[0]), /reconcile/.test(watched[1])], [2, true, true], "the diagnosis, then the row: one payload");
  assert.equal(failed("git push origin main").stdout, "", "a command that is not Orbit's gets nothing");
  const noWork = checkout(t);
  assert.equal(hook(noWork, "learn-hook.mjs", { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: `node ${join(ROOT, "cli", "automation.mjs")} step tsk-0123456789ab` } }).stdout, "", "no governed work: nothing, as before");
});

test("after one of Orbit's agents returns, ONE line names the owner record that settles its work -- and nothing otherwise", (t) => {
  const p = checkout(t);
  const agent = (subagent, env = {}, session = RAW) => run(p, "follow-hook.mjs", [], env, JSON.stringify({ session_id: session, cwd: p.repo, hook_event_name: "PostToolUse", tool_name: "Agent", tool_use_id: "toolu_a", tool_input: { subagent_type: subagent, prompt: "SECRET-SENTINEL instructions" }, tool_response: { agentId: "a-1", content: "SECRET-SENTINEL report" } }));
  assert.equal(agent("orbit:orbit-qa-agent").stdout, "", "no governed work yet: nothing");
  const task = workflow(p);
  const before = contents(p);
  const said = contextOf(agent("orbit:orbit-qa-agent"));
  assert.match(said, new RegExp(`^Orbit: orbit:orbit-qa-agent returned -- what it says is its report, not evidence\\. Its work is settled by workflow ${task} \\(EXECUTING\\): node \\S+cli[\\\\/]automation\\.mjs context ${task} says where its work stands\\.$`));
  assert.doesNotMatch(said, /SECRET-SENTINEL/, "the agent's words and its instructions are never read");
  assert.deepEqual(contents(p), before, "it writes nothing");
  for (const other of ["Explore", "general-purpose", "another-plugin:qa-agent"]) assert.equal(agent(other).stdout, "", other);
  assert.equal(agent("orbit:orbit-qa-agent", {}, "another-session").stdout, "", "another session's workflow is not this one's");
  const bash = run(p, "follow-hook.mjs", [], {}, JSON.stringify({ session_id: RAW, cwd: p.repo, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } }));
  assert.equal(bash.stdout, "", "no other tool's return is followed");
});

test("an unknown checkout's session start says nothing at all, with or without the digest", (t) => {
  const p = checkout(t, false);
  const r = hook(p, "learn-hook.mjs", { hook_event_name: "SessionStart", source: "resume" });
  assert.deepEqual([r.status, r.stdout], [0, ""]);
  assert.equal(walk(p.dir).some((f) => /[\\/]repo-[0-9a-f]+[\\/]/.test(f)), false, "nothing was written about it");
});
