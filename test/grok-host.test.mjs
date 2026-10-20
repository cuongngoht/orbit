// Grok Build as a protocol-2 host (1.8.9): an adapter mapped from payloads measured on grok 1.0.62
// (test/fixtures/hooks/grok-v2/), a hooks file of its own, and a shell that binds itself -- Grok hands its agent's tools
// GROK_SESSION_ID, so a Orbit command run there knows its session without the agent typing a binding.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as grok from "../skills/orbit-learn/hosts/grok.mjs";
import { SUPPORTED, commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { lifecycleEvent } from "../src/lifecycle/event.mjs";
import { hostSession } from "../src/memory/session.mjs";
import { coverageOf } from "../src/work/track/coverage.mjs";
import { sealed } from "./home.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "hooks", "grok-v2", name), "utf8")).input;
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-grok-host-")));
// A SessionEnd hook starts a detached drain that may still be writing into the store when the file ends.
after(() => rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

test("a Grok tool's shell binds a Orbit command to its session; anything that names a host wins", () => {
  const env = commandEnvironment(sealed({ GROK_SESSION_ID: "01a14dd3-d031-7442-9f2b-1f3ed917291a" }), []);
  assert.equal(env.ORBIT_HOST, "grok");
  assert.equal(env.ORBIT_HOST_PROTOCOL, "2");
  assert.equal(env.ORBIT_SESSION, hostSession("grok", "01a14dd3-d031-7442-9f2b-1f3ed917291a"), "the same mark the hooks derive from session_id");
  assert.equal(env.ORBIT_ENGINEERING_OBSERVE, "on", "a host's settings apply as they do for every protocol-2 host");
  assert.equal(commandEnvironment(sealed({ GROK_SESSION_ID: "01a14dd3-d031-7442", ORBIT_HOST: "codex", ORBIT_HOST_PROTOCOL: "2" }), []).ORBIT_HOST, "codex", "an explicit host is never overruled");
  assert.equal(commandEnvironment(sealed({ GROK_SESSION_ID: "01a14dd3-d031-7442" }), ["--host=claude"]).ORBIT_HOST, undefined, "nor is a --host flag");
  for (const id of ["", "x", "has space in it", "../../etc/passwd"]) assert.equal(commandEnvironment(sealed({ GROK_SESSION_ID: id }), []).ORBIT_HOST, undefined, `${JSON.stringify(id)} is no session id`);
  assert.ok(SUPPORTED.includes("grok:2"));
  assert.throws(() => commandEnvironment(sealed({}), ["--host=grok"]), /unsupported host\/protocol/, "Grok has no legacy protocol");
});

test("what Grok cannot carry answers nothing; what it can is shaped as Grok reads it", () => {
  assert.equal(grok.formatSessionStart("recall"), null, "SessionStart output reaches only a person, never the model");
  assert.equal(grok.formatPromptContext("advice"), null, "an allowing UserPromptSubmit hook's output is dropped by Grok");
  assert.deepEqual(grok.formatFailure("why"), { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "why" } });
  assert.equal(grok.formatDeny("off").hookSpecificOutput.permissionDecision, "deny");
  assert.equal(grok.isWatched({ tool_name: "run_terminal_command", tool_input: { command: "node cli/run-case.mjs x" } }, ["run-case.mjs"]), true);
  assert.equal(grok.isWatched({ tool_name: "search_replace", tool_input: { file_path: "run-case.mjs" } }, ["run-case.mjs"]), false);
});

test("only measured tools are mapped, a dispatch failure fails, and a teardown or a child's end is no event of this session", () => {
  const read = fixture("PreToolUse-read_file.json");
  const unseen = lifecycleEvent(grok, { ...read, tool_name: "hashline_edit", tool_input: { file_path: "/fixture/a.mjs" } });
  assert.deepEqual([unseen.tool.kind, unseen.paths], ["other", []], "a tool whose payload was never seen is `other`");
  const failed = lifecycleEvent(grok, { ...read, hook_event_name: "PostToolUseFailure", error: "dispatch failed" });
  assert.deepEqual([failed.event, failed.ok], ["post-tool-failure", false]);
  assert.equal(lifecycleEvent(grok, fixture("Stop-teardown.json")), null);
  assert.equal(lifecycleEvent(grok, { ...fixture("SessionEnd.json"), subagentType: "explore" }), null);
  assert.equal(lifecycleEvent(grok, { ...fixture("Stop.json"), reason: "end_turn" }).event, "turn-end");
  assert.equal(lifecycleEvent(grok, { ...read, cwd: "relative/dir" }), null, "no absolute working directory, no event");
});

test("work tracking says what Grok lets Orbit see, and nothing more", () => {
  const coverage = coverageOf("grok");
  assert.equal(coverage.observation, "automatic");
  assert.match(coverage.outcome, /exit/);
  assert.ok(coverage.limits.some((l) => /measured/.test(l)) && coverage.limits.some((l) => /SessionEnd/.test(l)));
});

// End to end, with real processes: a Grok edit and the session's end reach the hooks; the checkpoint is drained by a
// process bound to the session ONLY through GROK_SESSION_ID, and the session is learned from.
const FILES = ["src/Infrastructure/OrderRepository.cs", "src/Infrastructure/CustomerRepository.cs", "src/Infrastructure/InvoiceRepository.cs", "src/Domain/IRepository.cs", "README.md"];

function checkout(name) {
  const dir = join(temp, name);
  for (const f of FILES) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), "//\n");
  }
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "init"]);
  return dir;
}

const store = join(temp, "store");
const envOf = (extra = {}) => Object.fromEntries(Object.entries(sealed({ ORBIT_STORE_DIR: store, ...extra })).filter(([k]) => k !== "CLAUDE_PROJECT_DIR"));
const GROK = ["--host=grok", "--protocol=2"];
const hook = (dir, input) => spawnSync(process.execPath, [join(ROOT, "cli", "learn-hook.mjs"), ...GROK], { cwd: dir, env: envOf(), input: JSON.stringify({ ...input, session_id: "grok-e2e-session", sessionId: "grok-e2e-session", cwd: dir, workspaceRoot: dir }), encoding: "utf8" });
const cli = (dir, env, name, args = []) => spawnSync(process.execPath, [join(ROOT, "cli", `${name}.mjs`), ...args], { cwd: dir, env, encoding: "utf8" });

test("a Grok session is learned from: its edit, its end, and a drain bound by GROK_SESSION_ID alone", async () => {
  const dir = checkout("grok");
  assert.equal(cli(dir, envOf(), "help").status, 0, "the person's /orbit-help binds the checkout");
  const edit = fixture("PostToolUse-search_replace.json");
  const target = join(dir, "src/Infrastructure/OrderRepository.cs");
  const r = hook(dir, { ...edit, tool_input: { ...edit.tool_input, file_path: target }, tool_response: { ...edit.tool_response, EditsApplied: { ...edit.tool_response.EditsApplied, absolute_path: target } } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "an edit's hook answers Grok nothing");
  assert.equal(hook(dir, fixture("SessionEnd.json")).status, 0);
  const drained = cli(dir, envOf({ GROK_SESSION_ID: "grok-e2e-session" }), "finalize", ["--hook"]);
  assert.equal(drained.status, 0);
  let facts = "";
  for (let i = 0; i < 50 && !/repository is a pattern/.test(facts); i += 1) {
    facts = cli(dir, envOf(), "engineering", ["facts"]).stdout;
    if (!/repository is a pattern/.test(facts)) await new Promise((done) => setTimeout(done, 200));
  }
  assert.match(facts, /observed\s+fresh\s+possible\s+pattern\s+repository is a pattern/, "the session's end was the milestone");
});

test("the host catalog Orbit Control shows lists Grok with what it can and cannot carry", () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, "catalog", "hosts.json"), "utf8")).hosts.find((h) => h.id === "grok");
  assert.deepEqual(catalog.protocols, ["2"]);
  assert.deepEqual(catalog.capabilities, { promptRouter: false, sessionEnd: true, nativeMemory: false, nativeAgents: false, statusLine: false });
});
