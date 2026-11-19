import assert from "node:assert/strict";
import { test } from "node:test";
import { StreamMapper, toolTitle, type MappedEvent } from "./stream-mapper.js";

const CWD = "/data/workspaces/s/repository";
const mapper = () => new StreamMapper({ requestedModel: "sonnet", resumed: false, cwd: CWD });
const run = (m: StreamMapper, lines: unknown[]): MappedEvent[] => lines.flatMap((l) => m.push(l));
const types = (es: MappedEvent[]) => es.map((e) => e.type);

const INIT = { type: "system", subtype: "init", cwd: CWD, session_id: "sess-1", model: "claude-sonnet-5-5", permissionMode: "dontAsk", claude_code_version: "2.1.328", plugins: [{ name: "orbit", path: "/opt/orbit/plugin", source: "orbit@inline", version: "0.6.0" }] };
const se = (event: unknown, parent: string | null = null) => ({ type: "stream_event", event, parent_tool_use_id: parent, session_id: "sess-1" });
const assistant = (id: string, block: unknown, parent: string | null = null) => ({ type: "assistant", message: { id, content: [block] }, parent_tool_use_id: parent, session_id: "sess-1" });
const toolResult = (id: string, content: unknown, isError = false, parent: string | null = null) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] }, parent_tool_use_id: parent, tool_use_result: { stdout: "", interrupted: false } });

test("the init line says which CLI ran, with which model, and whether Orbit loaded", () => {
  const m = mapper();
  const [e] = run(m, [{ type: "system", subtype: "hook_started" }, INIT]);
  assert.equal(e?.type, "session.started");
  if (e?.type !== "session.started") return;
  assert.equal(e.data.claudeSessionId, "sess-1");
  assert.equal(e.data.claudeCodeVersion, "2.1.328");
  assert.equal(e.data.orbitLoaded, true);
  assert.equal(e.data.orbitVersion, "0.6.0");
  assert.equal(m.init?.orbitLoaded, true);
  const without = mapper();
  const [e2] = run(without, [{ ...INIT, plugins: [] }]);
  assert.equal(e2?.type === "session.started" && e2.data.orbitLoaded, false);
});

test("partial text streams as deltas with offsets, then completes with the block's whole text", () => {
  const m = mapper();
  const out = run(m, [
    se({ type: "message_start", message: { id: "msg_1" } }),
    se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Looking at " } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "sum.mjs now.\n" } }),
    se({ type: "content_block_stop", index: 0 }),
    assistant("msg_1", { type: "text", text: "Looking at sum.mjs now.\n" }),
  ]);
  assert.deepEqual(types(out), ["message.started", "message.delta", "message.delta", "message.completed"]);
  const deltas = out.filter((e) => e.type === "message.delta").map((e) => (e.type === "message.delta" ? e.data : null));
  assert.deepEqual(deltas, [{ messageId: "msg_1:1", offset: 0, text: "Looking at " }, { messageId: "msg_1:1", offset: 11, text: "sum.mjs now.\n" }]);
  const done = out.at(-1);
  assert.equal(done?.type === "message.completed" && done.data.text, "Looking at sum.mjs now.\n");
});

test("without partial messages a text block still starts and completes", () => {
  const out = run(mapper(), [assistant("msg_9", { type: "text", text: "Done." })]);
  assert.deepEqual(types(out), ["message.started", "message.completed"]);
});

test("tools start from the assistant's tool_use and finish from the user's tool_result, with their real output", () => {
  const m = mapper();
  const out = run(m, [
    assistant("msg_2", { type: "thinking", thinking: "hidden" }),
    assistant("msg_2", { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "node --test\nmore", description: "run tests" } }),
    toolResult("toolu_1", "✔ adds (1ms)\nℹ pass 1"),
    assistant("msg_3", { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: `${CWD}/sum.mjs` } }),
    toolResult("toolu_2", [{ type: "text", text: "File does not exist." }], true),
  ]);
  assert.deepEqual(types(out), ["tool.started", "tool.completed", "tool.started", "tool.failed"]);
  const started = out[0];
  assert.equal(started?.type === "tool.started" && started.data.title, "$ node --test");
  const read = out[2];
  assert.equal(read?.type === "tool.started" && read.data.title, "Read sum.mjs");
  const completed = out[1];
  assert.equal(completed?.type === "tool.completed" && completed.data.output, "✔ adds (1ms)\nℹ pass 1");
  const failed = out[3];
  assert.equal(failed?.type === "tool.failed" && failed.data.isError, true);
});

test("a subagent is attributed by the Agent call's own input and the CLI's parent link, nothing guessed", () => {
  const out = run(mapper(), [
    assistant("msg_4", { type: "tool_use", id: "toolu_a", name: "Agent", input: { subagent_type: "Explore", description: "find the adder", prompt: "..." } }),
    assistant("msg_5", { type: "tool_use", id: "toolu_b", name: "Grep", input: { pattern: "sum" } }, "toolu_a"),
    toolResult("toolu_b", "sum.mjs", false, "toolu_a"),
  ]);
  const agent = out[0];
  assert.deepEqual(agent?.type === "tool.started" && agent.data.agent, { subagentType: "Explore", description: "find the adder" });
  const inner = out[1];
  assert.equal(inner?.type === "tool.started" && inner.data.parentToolUseId, "toolu_a");
  const innerDone = out[2];
  assert.equal(innerDone?.type === "tool.completed" && innerDone.data.parentToolUseId, "toolu_a");
});

test("the result line is kept for the runner and each permission denial becomes an event", () => {
  const m = mapper();
  const out = run(m, [{ type: "result", subtype: "success", is_error: false, result: "Fixed.", total_cost_usd: 0.12, num_turns: 4, duration_ms: 9000, permission_denials: [{ tool_name: "Bash", tool_use_id: "toolu_9", tool_input: { command: "git push origin HEAD" } }] }]);
  assert.deepEqual(types(out), ["permission.denied"]);
  assert.deepEqual(m.result, { subtype: "success", isError: false, text: "Fixed.", costUsd: 0.12, turns: 4, durationMs: 9000, permissionDenials: 1 });
  const denied = out[0];
  assert.match(denied?.type === "permission.denied" ? denied.data.input : "", /git push/);
});

test("a usage limit is a notice; an allowed one says nothing", () => {
  assert.deepEqual(run(mapper(), [{ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }]), []);
  const [n] = run(mapper(), [{ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1794502800 } }]);
  assert.equal(n?.type, "run.notice");
});

test("when the run ends, a message still being written completes as partial and an open tool fails as interrupted", () => {
  const m = mapper();
  run(m, [
    se({ type: "message_start", message: { id: "msg_6" } }),
    se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Halfway thro" } }),
    assistant("msg_7", { type: "tool_use", id: "toolu_x", name: "Bash", input: { command: "sleep 100" } }),
  ]);
  const out = m.finish();
  assert.deepEqual(types(out), ["message.completed", "tool.failed"]);
  const msg = out[0];
  assert.equal(msg?.type === "message.completed" && msg.data.partial, true);
  assert.equal(msg?.type === "message.completed" && msg.data.text, "Halfway thro");
  const tool = out[1];
  assert.equal(tool?.type === "tool.failed" && tool.data.interrupted, true);
  assert.deepEqual(m.finish(), []);
});

test("secrets in tool input and output are masked", () => {
  const out = run(mapper(), [
    assistant("msg_8", { type: "tool_use", id: "toolu_s", name: "Bash", input: { command: "echo GH_TOKEN=abc123" } }),
    toolResult("toolu_s", `gho_${"q".repeat(36)}`),
  ]);
  assert.doesNotMatch(JSON.stringify(out), /abc123|gho_q/);
});

test("titles come from the tool's own input", () => {
  assert.equal(toolTitle("Write", { file_path: `${CWD}/a/b.ts` }, CWD), "Write a/b.ts");
  assert.equal(toolTitle("Skill", { skill: "orbit-engineer" }, CWD), "Skill orbit-engineer");
  assert.equal(toolTitle("Mystery", {}, CWD), "Mystery");
});
