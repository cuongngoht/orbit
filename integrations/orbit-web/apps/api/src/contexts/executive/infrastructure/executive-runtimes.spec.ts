import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AppConfig } from "../../../config/config.js";
import type { MappedEvent } from "../../../modules/claude-runner/stream-mapper.js";
import type { ConnectionProbe } from "../../../modules/connections/probe.js";
import type { RunConnection } from "../../../modules/connections/run-connections.js";
import { CLAUDE_EXECUTIVE, CODEX_EXECUTIVE, codexAnswerViolation, EXECUTIVE_RUNTIMES, executiveRuntimeOf, type ExecutiveRuntime } from "./executive-runtimes.js";
import { EXECUTIVE_SYSTEM_PROMPT } from "./executive-prompt.js";

const config = (maxBudgetUsd: number | null): AppConfig => ({ maxBudgetUsd }) as AppConfig;
const rc = { connection: { id: "c1", runtime: "codex", home: "/data/connections/a/c1" }, configDir: "/data/connections/a/c1/codex", secretEnv: {} } as unknown as RunConnection;

test("the registry: one strategy per runtime CEO Chat can hold to answering without tools, and none for any other", () => {
  assert.deepEqual(Object.keys(EXECUTIVE_RUNTIMES).sort(), ["claude", "codex"]);
  assert.equal(executiveRuntimeOf("claude"), CLAUDE_EXECUTIVE);
  assert.equal(executiveRuntimeOf("codex"), CODEX_EXECUTIVE);
  for (const kind of ["agy", "", "toString", "__proto__", "constructor"]) assert.equal(executiveRuntimeOf(kind), null, kind);
  for (const rt of Object.values(EXECUTIVE_RUNTIMES)) assert.equal(EXECUTIVE_RUNTIMES[rt.kind], rt, "each row is its own kind");
});

test("Claude Code: no tool, no MCP server, no session kept, the fixed system prompt, the spending cap", () => {
  const args = CLAUDE_EXECUTIVE.args({ model: "claude-sonnet-5-5", effort: "high", maxBudgetUsd: 2, modelFile: null });
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.ok(args.includes("--strict-mcp-config") && args.includes("--restricted") && args.includes("--no-session-persistence"));
  assert.equal(args[args.indexOf("--system-prompt") + 1], EXECUTIVE_SYSTEM_PROMPT);
  assert.deepEqual([args[args.indexOf("--effort") + 1], args[args.indexOf("--max-budget-usd") + 1]], ["high", "2"]);
  assert.equal(CLAUDE_EXECUTIVE.refusal(config(2)), null, "Claude Code is held to a spending cap");
});

test("OpenAI Codex: every executor off, no MCP server, no search, no AGENTS.md, the fixed system prompt, Orbit's model entry", () => {
  const args = CODEX_EXECUTIVE.args({ model: "gpt-6.1-sol", effort: "medium", maxBudgetUsd: null, modelFile: "/data/connections/a/c1/codex/orbit-executive-model-x.json" });
  assert.deepEqual(args.slice(0, 2), ["exec", "--json"]);
  assert.equal(args.at(-1), "-", "what the CEO is asked arrives on stdin");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  for (const setting of ["mcp_servers={}", 'web_search="disabled"', "project_doc_max_bytes=0", 'model_reasoning_effort="medium"', `developer_instructions=${JSON.stringify(EXECUTIVE_SYSTEM_PROMPT)}`, 'model_catalog_json="/data/connections/a/c1/codex/orbit-executive-model-x.json"']) assert.ok(args.includes(setting), setting);
  const disabled = args.flatMap((a, i) => (args[i - 1] === "--disable" ? [a] : []));
  for (const f of ["shell_tool", "unified_exec"]) assert.ok(disabled.includes(f), `${f} is off`);
  assert.ok(args.includes("--ignore-user-config") && args.includes("--ignore-rules"));
  assert.ok(!args.some((a) => a.includes("ORBIT_TOOL_URL")), "no bridge to Orbit's tools");
  assert.ok(!CODEX_EXECUTIVE.args({ model: "gpt-6.1-sol", effort: null, maxBudgetUsd: null, modelFile: null }).some((a) => a.startsWith("model_catalog_json=") || a.startsWith("model_reasoning_effort=")));
  assert.match(CODEX_EXECUTIVE.refusal(config(2)) ?? "", /spending cap .* cannot be held to it/, "a cap it cannot keep refuses the turn");
  assert.equal(CODEX_EXECUTIVE.refusal(config(null)), null);
});

const texts = (events: MappedEvent[]): string[] => events.flatMap((e) => (e.type === "message.completed" ? [e.data.text] : e.type === "message.delta" ? [e.data.text] : []));

test("each mapper turns its CLI's recorded answer into the same chat events, and its own result line", () => {
  const claude = CLAUDE_EXECUTIVE.mapper({ model: "claude-sonnet-5-5", effort: null, cwd: "/data" });
  const claudeEvents = [
    { type: "system", subtype: "init", session_id: "s", tools: [], mcp_servers: [], model: "claude-sonnet-5-5" },
    { type: "stream_event", event: { type: "message_start", message: { id: "m1" } }, parent_tool_use_id: null },
    { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, parent_tool_use_id: null },
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "All good." } }, parent_tool_use_id: null },
    { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "All good." }] }, parent_tool_use_id: null },
    { type: "result", subtype: "success", is_error: false, result: "All good.", total_cost_usd: 0.001, num_turns: 1, duration_ms: 5 },
  ].flatMap((l) => claude.push(l));
  const codex = CODEX_EXECUTIVE.mapper({ model: "gpt-6.1-sol", effort: null, cwd: "/data" });
  const codexEvents = [
    { type: "thread.started", thread_id: "t" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "r1", type: "reasoning", text: "Reading." } },
    { type: "item.completed", item: { id: "m1", type: "agent_message", text: "All good." } },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ].flatMap((l) => codex.push(l));
  for (const events of [claudeEvents, codexEvents]) {
    assert.ok(events.some((e) => e.type === "message.started" && e.data.role === "assistant" && e.data.parentToolUseId === null));
    assert.ok(events.some((e) => e.type === "message.completed" && e.data.text === "All good."));
    assert.ok(!events.some((e) => e.type === "tool.started"));
  }
  assert.deepEqual(texts(codexEvents), ["All good."], "Codex's answer arrives whole: no delta");
  for (const m of [claude, codex]) assert.deepEqual([m.result?.subtype, m.result?.isError, m.result?.text], ["success", false, "All good."]);
});

test("each strategy's violation stops a tool -- and Codex's any item that is not an answer, a kind never seen included", () => {
  assert.match(CLAUDE_EXECUTIVE.violation({ type: "system", subtype: "init", tools: ["Bash"], mcp_servers: [] }) ?? "", /the CEO's answer has none of its own/);
  assert.match(CLAUDE_EXECUTIVE.violation({ type: "system", subtype: "init", tools: [], mcp_servers: [{ name: "x" }] }) ?? "", /MCP server/);
  assert.equal(CLAUDE_EXECUTIVE.violation({ type: "system", subtype: "init", tools: [], mcp_servers: [] }), null);
  assert.equal(CLAUDE_EXECUTIVE.violation({ type: "assistant", message: { content: [] } }), null);
  for (const kind of ["command_execution", "file_change", "mcp_tool_call", "web_search", "todo_list", "collab_tool_call", "image_generation"]) {
    for (const type of ["item.started", "item.updated", "item.completed"]) assert.match(codexAnswerViolation({ type, item: { id: "i", type: kind } }) ?? "", new RegExp(`\\(${kind}\\)`), `${type} ${kind}`);
  }
  assert.match(codexAnswerViolation({ type: "item.started", item: { id: "i" } }) ?? "", /an item with no type/);
  assert.match(codexAnswerViolation({ type: "item.started" }) ?? "", /an item with no type/);
  for (const kind of ["agent_message", "reasoning", "error"]) assert.equal(codexAnswerViolation({ type: "item.completed", item: { id: "i", type: kind } }), null, kind);
  for (const type of ["thread.started", "turn.started", "turn.completed", "turn.failed", "error"]) assert.equal(codexAnswerViolation({ type }), null, type);
  assert.equal(CODEX_EXECUTIVE.violation, codexAnswerViolation);
});

test("the capability proof: Claude Code proves itself on its start line; Codex only by the observation of this binary and model", async () => {
  assert.deepEqual(await CLAUDE_EXECUTIVE.toolless(null, rc, "claude-sonnet-5-5"), { ok: true, modelEntry: null });
  assert.deepEqual(await CODEX_EXECUTIVE.toolless(null, rc, "gpt-6.1-sol"), { ok: false, reason: "nothing here can observe OpenAI Codex" });
  const asked: string[] = [];
  const probe = (split: "yes" | "no" | "unknown", file: string | null, reason: string | null): ConnectionProbe =>
    ({
      codexToollessModel: (c: { id: string }, model: string) => {
        asked.push(`${c.id}:${model}`);
        return Promise.resolve({ split, reason, file });
      },
    }) as unknown as ConnectionProbe;
  assert.deepEqual(await CODEX_EXECUTIVE.toolless(probe("yes", '{"models":[]}', null), rc, "gpt-6.1-sol"), { ok: true, modelEntry: '{"models":[]}' });
  assert.deepEqual(await CODEX_EXECUTIVE.toolless(probe("no", null, "it offers the model tools: web_search"), rc, "gpt-5.5"), { ok: false, reason: "it offers the model tools: web_search" });
  assert.deepEqual(await CODEX_EXECUTIVE.toolless(probe("unknown", null, null), rc, "gpt-5.5"), { ok: false, reason: "it was not observed answering with no tool" });
  assert.deepEqual(asked, ["c1:gpt-6.1-sol", "c1:gpt-5.5", "c1:gpt-5.5"], "asked of this connection, for this model");
});

test("Codex: a connection whose home holds global instructions (AGENTS.override.md, AGENTS.md) cannot answer, observed or not", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  const held = { codexToollessModel: () => Promise.resolve({ split: "yes", reason: null, file: '{"models":[]}' }) } as unknown as ConnectionProbe;
  try {
    const at = { ...rc, configDir: home } as RunConnection;
    assert.deepEqual(await CODEX_EXECUTIVE.toolless(held, at, "gpt-6.1-sol"), { ok: true, modelEntry: '{"models":[]}' });
    for (const file of ["AGENTS.md", "AGENTS.override.md"]) {
      writeFileSync(join(home, file), "Answer in pirate speak.\n");
      const refused = await CODEX_EXECUTIVE.toolless(held, at, "gpt-6.1-sol");
      assert.equal(refused.ok, false);
      assert.match(refused.ok ? "" : refused.reason, /holds instructions of its own \(AGENTS\.override\.md|AGENTS\.md\)/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Every strategy says what refuses it, proves itself, and is read through the same adapter: nothing else differs.
test("every strategy implements the whole interface", () => {
  const members: (keyof ExecutiveRuntime)[] = ["kind", "label", "refusal", "toolless", "binary", "args", "env", "mapper", "violation"];
  for (const rt of Object.values(EXECUTIVE_RUNTIMES)) for (const m of members) assert.notEqual(rt[m], undefined, `${rt.kind}.${m}`);
});
