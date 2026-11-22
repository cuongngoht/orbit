import assert from "node:assert/strict";
import { test } from "node:test";
import { codexChatArgs, CodexStreamMapper } from "./codex-chat.js";
import { lostConversation } from "./outcome.js";

const base = { model: "gpt-6.1-sol", effort: "medium", mode: "autonomous" as const, webTools: true, execute: true, note: null, threadId: null, images: [] };
const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

test("a chat's codex: exec --json in Codex's own sandbox -- writes in the workspace when Autonomous, read-only when Plan", () => {
  const args = codexChatArgs(base);
  assert.deepEqual(args.slice(0, 3), ["exec", "--sandbox", "workspace-write"]);
  for (const f of ["--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules"]) assert.ok(args.includes(f), f);
  assert.equal(after(args, "--model"), "gpt-6.1-sol");
  assert.ok(args.includes('model_reasoning_effort="medium"'));
  assert.ok(args.includes('web_search="live"'));
  assert.ok(args.includes("mcp_servers={}"), "no MCP server of anybody's: Claude's connectors are Claude's");
  const off = args.flatMap((a, i) => (a === "--disable" ? [args[i + 1]] : []));
  for (const f of ["apps", "plugins", "remote_plugin", "hooks", "browser_use", "browser_use_external", "computer_use", "skill_mcp_dependency_install"]) assert.ok(off.includes(f), f);
  assert.ok(!off.includes("shell_tool"), "a chat may run commands in its workspace");
  assert.equal(args.at(-1), "-", "the message on stdin");
  assert.equal(codexChatArgs({ ...base, mode: "plan" })[2], "read-only");
  assert.ok(codexChatArgs({ ...base, webTools: false }).includes('web_search="disabled"'));
  assert.ok(!codexChatArgs({ ...base, effort: null }).some((a) => a.startsWith("model_reasoning_effort")));
});

test("what the policy does not allow, the chat's codex does not have: no execution means no shell and read-only", () => {
  const args = codexChatArgs({ ...base, execute: false });
  assert.equal(args[2], "read-only");
  const off = args.flatMap((a, i) => (a === "--disable" ? [args[i + 1]] : []));
  for (const f of ["shell_tool", "unified_exec"]) assert.ok(off.includes(f), f);
  assert.ok(codexChatArgs({ ...base, note: "Push through the gateway." }).includes('developer_instructions="Push through the gateway."'));
});

test("the next message resumes the thread (the sandbox is the parent's option), with the images it carries", () => {
  const args = codexChatArgs({ ...base, threadId: "019a1b2c-0000-7000-8000-000000000001", images: ["/data/tmp/a.png", "/data/tmp/b.jpg"] });
  assert.deepEqual(args.slice(0, 4), ["exec", "--sandbox", "workspace-write", "resume"]);
  assert.deepEqual(args.slice(-2), ["019a1b2c-0000-7000-8000-000000000001", "-"]);
  assert.deepEqual(args.flatMap((a, i) => (a === "-i" ? [args[i + 1]] : [])), ["/data/tmp/a.png", "/data/tmp/b.jpg"]);
  assert.ok(args.indexOf("--json") > args.indexOf("resume"), "the rest are resume's own options");
});

test("Codex's events become the chat's: its thread, its commands and edits as tools, its message, its turn's end", () => {
  const m = new CodexStreamMapper({ requestedModel: "gpt-6.1-sol", requestedEffort: "medium", requestedMode: "autonomous", resumed: false });
  const events = [
    { type: "thread.started", thread_id: "th_1" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "w0", type: "error", message: "Codex is ignoring 1 unrecognized configuration setting." } },
    { type: "item.started", item: { id: "c1", type: "command_execution", command: "npm test", aggregated_output: "", exit_code: null, status: "in_progress" } },
    { type: "item.completed", item: { id: "c1", type: "command_execution", command: "npm test", aggregated_output: "ok 3 tests\n", exit_code: 0, status: "completed" } },
    { type: "item.completed", item: { id: "c2", type: "command_execution", command: "false", aggregated_output: "", exit_code: 1, status: "failed" } },
    { type: "item.completed", item: { id: "f1", type: "file_change", changes: [{ path: "src/a.ts", kind: "update" }, { path: "src/b.ts", kind: "add" }], status: "completed" } },
    { type: "item.completed", item: { id: "s1", type: "web_search", query: "node 24 release" } },
    { type: "item.completed", item: { id: "r1", type: "reasoning", text: "thinking" } },
    { type: "item.completed", item: { id: "m1", type: "agent_message", text: "All tests pass." } },
    { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } },
  ].flatMap((e) => m.push(e));
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["session.started", "run.notice", "tool.started", "tool.completed", "tool.started", "tool.failed", "tool.started", "tool.completed", "tool.started", "tool.completed", "message.started", "message.completed"]);
  const started = events[0] as { data: { claudeSessionId: string; requestedModel: string; orbitLoaded: boolean } };
  assert.deepEqual([started.data.claudeSessionId, started.data.requestedModel, started.data.orbitLoaded], ["th_1", "gpt-6.1-sol", false]);
  assert.equal((events[2] as { data: { title: string } }).data.title, "$ npm test");
  assert.equal((events[3] as { data: { output: string } }).data.output, "ok 3 tests\n");
  assert.equal((events[6] as { data: { title: string } }).data.title, "Edit src/a.ts, src/b.ts");
  assert.equal((events[8] as { data: { title: string } }).data.title, "Search the web: node 24 release");
  assert.equal((events[11] as { data: { text: string } }).data.text, "All tests pass.");
  assert.equal(m.init?.sessionId, "th_1");
  assert.deepEqual(m.result, { subtype: "success", isError: false, text: "All tests pass.", costUsd: null, turns: 1, durationMs: null, permissionDenials: 0 });
});

test("a failed turn is the run's error; a tool still running at the end is said to have been cut off", () => {
  const m = new CodexStreamMapper({ requestedModel: "gpt-6.1-sol", requestedEffort: "medium", requestedMode: "autonomous", resumed: true });
  m.push({ type: "thread.started", thread_id: "th_2" });
  m.push({ type: "item.started", item: { id: "c1", type: "command_execution", command: "sleep 100", status: "in_progress" } });
  m.push({ type: "turn.failed", error: { message: "You've hit your usage limit." } });
  assert.deepEqual([m.result?.isError, m.result?.subtype, m.result?.text], [true, "error", "You've hit your usage limit."]);
  const end = m.finish();
  assert.deepEqual(end.map((e) => e.type), ["tool.failed"]);
  assert.equal((end[0] as { data: { interrupted: boolean } }).data.interrupted, true);
});

test("a thread Codex can no longer find is a lost conversation: the next message starts a new one", () => {
  assert.equal(lostConversation("Error: thread/resume: thread/resume failed: no rollout found for thread id 019a0000-0000-7000-8000-000000000000 (code -32600)"), true);
  assert.equal(lostConversation("No conversation found with session ID: x"), true);
  assert.equal(lostConversation("rate limited"), false);
});
