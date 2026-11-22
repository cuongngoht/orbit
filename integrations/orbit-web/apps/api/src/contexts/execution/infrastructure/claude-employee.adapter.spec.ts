import assert from "node:assert/strict";
import { test } from "node:test";
import { BRIDGE_PREFIX, closedTools, emptyFacts, employeeArgs, employeeEnv, foldLine, initViolation } from "./claude-employee.adapter.js";

const input = (webSearch = false) => ({ model: "sonnet", effort: "medium", webSearch, bridge: { command: "node", args: ["/opt/orbit-web/bridge/main.js"], env: { ORBIT_TOOL_URL: "http://orbit-web/api/runtime/tools", ORBIT_RUN_TOKEN: "t" } }, systemPrompt: "You are Ana.", sessionId: "11111111-2222-3333-4444-555555555555" });
const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

test("the model plane is given no tool that executes, reads or fetches anything locally", () => {
  for (const web of [false, true]) {
    const args = employeeArgs(input(web));
    const tools = (after(args, "--tools") ?? "").split(",");
    assert.deepEqual(tools, web ? ["TodoWrite", "WebSearch"] : ["TodoWrite"]);
    for (const forbidden of ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit", "WebFetch", "Agent", "Skill"]) assert.equal(tools.includes(forbidden), false, forbidden);
    for (const flag of ["--restricted", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) assert.ok(args.includes(flag), flag);
    assert.equal(after(args, "--permission-mode"), "dontAsk");
    assert.equal(after(args, "--allowedTools"), `${BRIDGE_PREFIX}*`);
    assert.deepEqual(JSON.parse(after(args, "--settings") ?? "{}"), { disableAllHooks: true });
    const mcp = JSON.parse(after(args, "--mcp-config") ?? "{}") as { mcpServers: Record<string, unknown> };
    assert.deepEqual(Object.keys(mcp.mcpServers), ["orbit_tools"]);
  }
});

test("its environment points the CLI at the connection's own home; an API key only for an API-key connection", () => {
  const sub = employeeEnv({ HOME: "/run" }, "/connection", null);
  assert.equal(sub.CLAUDE_CONFIG_DIR, "/connection/claude");
  assert.equal(sub.ANTHROPIC_API_KEY, undefined);
  assert.equal(sub.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  const key = employeeEnv({ HOME: "/run" }, "/connection", "sk-test");
  assert.equal(key.ANTHROPIC_API_KEY, "sk-test");
  assert.equal(key.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test("an init line without Orbit's hand-in tool stops the run before the model acts: the bridge listed nothing", () => {
  // What Claude Code 2.1.328 printed when the bridge's tool list was refused (421 host_not_allowed): the server
  // `connected`, none of its tools -- the employee could neither work nor hand in, and the run looked like a success.
  const refused = { type: "system", subtype: "init", tools: ["WebSearch"], mcp_servers: [{ name: "orbit_tools", status: "connected" }], plugins: [] };
  assert.match(initViolation(refused, true) ?? "", /orbit_tools.*connected.*none of its tools/);
  assert.match(initViolation({ ...refused, mcp_servers: [{ name: "orbit_tools", status: "failed" }] }, true) ?? "", /orbit_tools: failed/);
  assert.match(initViolation({ ...refused, mcp_servers: [] }, true) ?? "", /orbit_tools: missing/);
  // The hand-in tool is the one every attempt needs: the others alone are not enough.
  assert.match(initViolation({ ...refused, tools: ["WebSearch", "mcp__orbit_tools__shell"] }, true) ?? "", /submit_handoff/);
  assert.equal(initViolation({ ...refused, tools: ["WebSearch", "mcp__orbit_tools__shell", "mcp__orbit_tools__submit_handoff"] }, true), null);
});

test("the init line's MCP servers are kept with the facts: the next failure names its cause on the run", () => {
  const f = foldLine(emptyFacts(), { type: "system", subtype: "init", tools: ["WebSearch"], mcp_servers: [{ name: "orbit_tools", status: "connected" }, { name: 7 }], plugins: [] }, true);
  assert.deepEqual(f.init?.mcpServers, [{ name: "orbit_tools", status: "connected" }]);
});

test("the CLI's own init line is held to what it was given: any other tool, MCP server or plugin stops the run", () => {
  const bridge = ["mcp__orbit_tools__shell", "mcp__orbit_tools__submit_handoff"];
  const ok = { type: "system", subtype: "init", tools: [...closedTools(false), ...bridge], mcp_servers: [{ name: "orbit_tools" }], plugins: [] };
  assert.equal(initViolation(ok, false), null);
  assert.match(initViolation({ ...ok, tools: [...ok.tools, "Bash"] }, false) ?? "", /Bash/);
  assert.match(initViolation({ ...ok, tools: [...ok.tools, "WebSearch"] }, false) ?? "", /WebSearch/);
  assert.equal(initViolation({ ...ok, tools: [...closedTools(true), ...bridge] }, true), null);
  assert.match(initViolation({ ...ok, mcp_servers: [{ name: "orbit_tools" }, { name: "planted" }] }, false) ?? "", /planted/);
  assert.match(initViolation({ ...ok, plugins: [{ name: "x", path: "/home/a/.claude/plugins/x", source: "x@market" }] }, false) ?? "", /plugin from disk/);
  // What 2.1.330 reports for the plugins compiled into it: part of the unmodified binary.
  const builtins = [{ name: "cc-plugin-agents-md", path: "builtin", source: "cc-plugin-agents-md@builtin" }, { name: "cc-plugin-privacy", path: "builtin", source: "cc-plugin-privacy@builtin" }];
  assert.equal(initViolation({ ...ok, plugins: builtins }, false), null);
  assert.match(initViolation({ ...ok, plugins: [...builtins, { name: "sneaky", path: "builtin", source: "sneaky@market" }] }, false) ?? "", /sneaky/);
});

test("the stream is folded into facts: Orbit's tool calls and searches counted, a foreign tool caught, the result kept", () => {
  let f = emptyFacts();
  f = foldLine(f, { type: "system", subtype: "init", model: "claude-sonnet-x", claude_code_version: "2.1.330", session_id: "s", tools: ["TodoWrite"], plugins: [] }, true);
  f = foldLine(f, { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__orbit_tools__shell" }, { type: "tool_use", name: "WebSearch" }, { type: "server_tool_use", name: "web_search" }] } }, true);
  assert.equal(f.toolCalls, 1);
  assert.equal(f.webSearches, 2);
  assert.equal(f.foreignTool, null);
  assert.equal(foldLine(f, { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }, true).foreignTool, "Bash");
  f = foldLine(f, { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.5, num_turns: 3, duration_ms: 1000, result: "done" }, true);
  assert.deepEqual(f.result, { costUsd: 0.5, turns: 3, durationMs: 1000, isError: false, subtype: "success", text: "done" });
  assert.equal(f.init?.version, "2.1.330");
});
