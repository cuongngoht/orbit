import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeCapabilities } from "@orbit-web/contracts";
import { AGY_RUNTIME, CLAUDE_RUNTIME, CODEX_RUNTIME, codexArgs, codexEnv, codexFold, emptyFacts } from "./employee-runtimes.js";

const caps = (toolPlaneSplit: RuntimeCapabilities["toolPlaneSplit"]): RuntimeCapabilities => ({ start: "yes", stream: "yes", cancel: "yes", resume: "yes", usage: "yes", webSearch: "yes", toolPlaneSplit, pluginObservation: "yes" });
const input = { model: "gpt-5.5", effort: "high", webSearch: false, bridge: { command: "node", args: ["/opt/orbit-web/bridge/main.js"], env: { ORBIT_TOOL_URL: "http://orbit-web/api/runtime/tools", ORBIT_RUN_TOKEN: "t" } }, systemPrompt: "You are Ana.", sessionId: "s" };

test("an employee runs only where the installed CLI was OBSERVED to hold its model plane to Orbit's tools", () => {
  assert.equal(CLAUDE_RUNTIME.refusal({ label: "Claude", capabilities: caps("yes") }), null);
  assert.match(CLAUDE_RUNTIME.refusal({ label: "Claude", capabilities: caps("unknown") }) ?? "", /cannot run an AI employee here/);
  assert.match(CODEX_RUNTIME.refusal({ label: "Codex", capabilities: caps("unknown") }) ?? "", /patch and exec tools/);
  assert.match(AGY_RUNTIME.refusal({ label: "AGY", capabilities: caps("yes") }) ?? "", /no non-interactive mode/);
});

test("Codex's model plane, as documented: exec --json, read-only, never asking, its shell tool off, Orbit's bridge its MCP server", () => {
  const args = codexArgs(input);
  assert.deepEqual(args.slice(0, 3), ["exec", "--json", "--skip-git-repo-check"]);
  assert.ok(args.includes("features.shell_tool=false"));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes("tools.web_search=false"));
  assert.ok(args.includes('mcp_servers.orbit_tools.command="node"'));
  assert.equal(args.at(-1), "-");
  assert.deepEqual(codexEnv({ HOME: "/run" }, "/connection", "sk-x"), { HOME: "/run", CODEX_HOME: "/connection/codex", CODEX_API_KEY: "sk-x" });
});

test("Codex's stream, folded from fixture events: a built-in executor, a foreign MCP server or an unasked search is a violation", () => {
  let f = codexFold(emptyFacts(), { type: "thread.started", thread_id: "th_1" }, false);
  assert.equal(f.init?.sessionId, "th_1");
  f = codexFold(f, { type: "item.completed", item: { id: "i1", type: "mcp_tool_call", server: "orbit_tools", tool: "write_file", status: "completed" } }, false);
  assert.equal(f.toolCalls, 1);
  f = codexFold(f, { type: "item.completed", item: { id: "i2", type: "agent_message", text: "Done." } }, false);
  f = codexFold(f, { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }, false);
  assert.equal(f.result?.isError, false);
  assert.equal(f.result?.text, "Done.");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i3", type: "command_execution", command: "cat auth.json" } }, false).foreignTool, "command_execution");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i4", type: "file_change" } }, false).foreignTool, "file_change");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i5", type: "mcp_tool_call", server: "planted" } }, false).foreignTool, "mcp:planted");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i6", type: "web_search", query: "x" } }, false).foreignTool, "web_search");
  assert.equal(codexFold(f, { type: "turn.failed", error: { message: "quota" } }, false).result?.isError, true);
});
