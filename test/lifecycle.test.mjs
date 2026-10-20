import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveHookHost, resolveHost } from "../skills/orbit-learn/hosts/index.mjs";
import { dispatch } from "../src/lifecycle/dispatch.mjs";
import { EVENT_NAMES, lifecycleEvent } from "../src/lifecycle/event.mjs";
import { hostSession, knownIn, sessionMarks } from "../src/memory/session.mjs";

const event = (input, argv = []) => lifecycleEvent(resolveHost(input, argv), input, argv);

test("a Claude Code payload becomes one normalized event, and its session id is never kept raw", () => {
  const e = event({ hook_event_name: "PostToolUse", session_id: "raw-session-123", cwd: "/repo", tool_name: "Edit", tool_input: { file_path: "/repo/src/a.mjs" }, tool_response: { secret: "x" } });
  assert.equal(e.event, "post-tool");
  assert.equal(e.host, "claude");
  assert.equal(e.tool.kind, "edit");
  assert.deepEqual(e.paths, ["/repo/src/a.mjs"]);
  assert.equal(e.ok, true);
  assert.match(e.session, /^claude:[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(e), /raw-session-123|secret/, "neither the raw id nor the tool's output travels on");
});

test("a failure is a failure event with ok false; a background launch says so", () => {
  assert.equal(event({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "x" } }).ok, false);
  assert.equal(event({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "x", run_in_background: true } }).background, true);
});

test("an Antigravity protocol-2 payload becomes the same lifecycle shape", async () => {
  const host = await resolveHookHost(null, ["--host=antigravity", "--protocol=2"]);
  const e = lifecycleEvent(host, { conversationId: "conv-1", workspacePaths: ["/repo"], toolCall: { name: "run_command", args: { CommandLine: "node x.mjs", Cwd: "/repo" } } }, ["--event=PostToolUse"]);
  assert.equal(e.event, "post-tool");
  assert.equal(e.host, "antigravity");
  assert.equal(e.tool.kind, "command");
  assert.equal(e.command, "node x.mjs");
  assert.match(e.session, /^antigravity:/);
});

// Grok Build (1.8.9, measured on 1.0.62): a Claude-shaped envelope with its own tool names, so it is chosen by the
// identity its hooks file names, never by shape -- and what it carries of a command's end is used, not guessed.
test("a Grok Build payload becomes the same shape, and its raw session id never travels", async () => {
  const host = await resolveHookHost(null, ["--host=grok", "--protocol=2"]);
  const e = lifecycleEvent(host, { hook_event_name: "PostToolUse", session_id: "raw-grok-session", cwd: "/repo", tool_name: "search_replace", tool_use_id: "call-1", tool_input: { file_path: "/repo/src/a.mjs", old_string: "a", new_string: "b" }, tool_response: { type: "SearchReplace", EditsApplied: { absolute_path: "/repo/src/a.mjs" } } });
  assert.equal(e.event, "post-tool");
  assert.equal(e.host, "grok");
  assert.equal(e.tool.kind, "edit");
  assert.deepEqual(e.paths, ["/repo/src/a.mjs"]);
  assert.equal(e.ok, true);
  assert.match(e.session, /^grok:[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(e), /raw-grok-session|"b"/, "neither the raw id nor the edit's text travels on");
  const failed = lifecycleEvent(host, { hook_event_name: "PostToolUse", session_id: "s", cwd: "/repo", tool_name: "run_terminal_command", tool_input: { command: "node --test" }, tool_response: { type: "Bash", exit_code: 1 } });
  assert.deepEqual([failed.event, failed.ok, failed.command], ["post-tool-failure", false, "node --test"]);
});

test("an unknown host or an unheard event is no event at all", () => {
  assert.equal(event({ something: "else" }), null);
  assert.equal(event({ hook_event_name: "Unheard" }), null);
  assert.equal(event(null), null);
  assert.equal(dispatch(null, {}, [{ name: "x", on: EVENT_NAMES, run: () => ({ spoke: true }) }]), null);
});

test("one subscriber throwing costs nobody else, and only a recording one reports it", () => {
  const failures = [];
  const world = { failed: (name) => failures.push(name) };
  const subs = [
    { name: "boom", on: ["post-tool"], records: true, run: () => { throw new Error("x"); } },
    { name: "quiet-boom", on: ["post-tool"], records: false, run: () => { throw new Error("y"); } },
    { name: "speaks", on: ["post-tool"], run: () => ({ said: 1 }) },
    { name: "later", on: ["post-tool"], run: () => ({ said: 2 }) },
  ];
  assert.deepEqual(dispatch({ event: "post-tool" }, world, subs), { said: 1 }, "the first payload in table order is what the host hears");
  assert.deepEqual(failures, ["boom"]);
});

test("a failing failure report is swallowed too", () => {
  const subs = [{ name: "boom", on: ["post-tool"], records: true, run: () => { throw new Error("x"); } }];
  assert.equal(dispatch({ event: "post-tool" }, { failed: () => { throw new Error("again"); } }, subs), null);
});

// src/memory/session.mjs's independence table, row by row.
test("real sessions are independent by id; a synthetic one is not independent of a real one that day", () => {
  const a = { host: "laptop", at: "2026-09-23T01:00:00Z", session: hostSession("claude", "one") };
  const b = { host: "laptop", at: "2026-09-23T02:00:00Z", session: hostSession("claude", "two") };
  const typed = { host: "laptop", at: "2026-09-23T03:00:00Z" };
  const otherDay = { host: "laptop", at: "2026-09-24T03:00:00Z" };
  assert.equal(knownIn(sessionMarks(a), b), false, "two sessions on one laptop are two");
  assert.equal(knownIn(sessionMarks(a), a), true);
  assert.equal(knownIn(sessionMarks(a), typed), true, "a hand-typed record the same day is the same sitting");
  assert.equal(knownIn(sessionMarks(typed), b), true, "and in the other order");
  assert.equal(knownIn(sessionMarks(a), otherDay), false);
});
