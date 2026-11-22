import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeCapabilities } from "@orbit-web/contracts";
import { AGY_RUNTIME, CLAUDE_RUNTIME, CODEX_EMPLOYEE_FEATURES_OFF, CODEX_RUNTIME, codexArgs, codexEnv, codexFold, emptyFacts, employeeReadiness, neutralizedCodexModel } from "./employee-runtimes.js";

const caps = (toolPlaneSplit: RuntimeCapabilities["toolPlaneSplit"]): RuntimeCapabilities => ({ start: "yes", stream: "yes", cancel: "yes", resume: "yes", usage: "yes", webSearch: "yes", toolPlaneSplit, pluginObservation: "yes" });
const input = { model: "gpt-5.5", effort: "high", webSearch: false, bridge: { command: "node", args: ["/opt/orbit-web/bridge/main.js"], env: { ORBIT_TOOL_URL: "http://orbit-web/api/runtime/tools", ORBIT_RUN_TOKEN: "t" } }, systemPrompt: "You are Ana.", sessionId: "s" };

test("an employee runs only where the installed CLI was OBSERVED to hold its model plane to Orbit's tools", () => {
  assert.equal(CLAUDE_RUNTIME.refusal({ label: "Claude", capabilities: caps("yes") }), null);
  assert.match(CLAUDE_RUNTIME.refusal({ label: "Claude", capabilities: caps("unknown") }) ?? "", /cannot run an AI employee here/);
  assert.match(CODEX_RUNTIME.refusal({ label: "Codex", capabilities: caps("unknown") }) ?? "", /not observed to be Orbit's alone; observed: unknown/);
  assert.equal(CODEX_RUNTIME.refusal({ label: "Codex", capabilities: caps("yes") }), null, "observed held: it runs");
  assert.match(AGY_RUNTIME.refusal({ label: "AGY", capabilities: caps("yes") }) ?? "", /no non-interactive mode/);
});

test("whether a connection can run employees is ONE answer, with the reason a person acts on: connected, read from the account, held to Orbit's tools", () => {
  const catalog = { source: "account" as const, models: [{ id: "m", label: "M", description: null, efforts: [], autoMode: true }], recommended: "m", checkedAt: null };
  const of = (over: Partial<Parameters<typeof employeeReadiness>[0]>) => employeeReadiness({ runtime: "claude", label: "Claude", auth: "connected", reason: null, catalog, capabilities: caps("yes"), ...over });
  assert.deepEqual(of({}), { ready: true, reason: null });
  assert.deepEqual(of({ auth: "auth_required", reason: "The login expired." }), { ready: false, reason: "not connected (The login expired.)" });
  assert.deepEqual(of({ catalog: { ...catalog, source: "fallback" } }), { ready: false, reason: "its models were not read from the account" });
  assert.deepEqual(of({ catalog: { ...catalog, models: [] } }), { ready: false, reason: "its account offers no model" });
  assert.deepEqual(of({ capabilities: caps("unknown") }), { ready: false, reason: "its model plane is not held to Orbit's tools (Run without local tools: unknown)" });
  assert.deepEqual(of({ runtime: "codex", label: "ChatGPT", capabilities: caps("unknown") }), { ready: false, reason: "its model plane is not held to Orbit's tools (Run without local tools: unknown)" });
  assert.equal(of({ runtime: "agy", label: "Gemini" }).ready, false, "Antigravity runs no employee, whatever it says");
});

test("Codex's model plane, as observed on codex-cli 0.169.0: every local executor off, Orbit's bridge required and approved, the model's own entry Orbit's", () => {
  const args = codexArgs({ ...input, modelFile: "/workdir/.orbit-codex-model.json" });
  assert.deepEqual(args.slice(0, 8), ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only"]);
  const disabled: string[] = args.flatMap((a, i) => (a === "--disable" ? [args[i + 1] as string] : []));
  for (const f of ["shell_tool", "unified_exec", "code_mode_host", "multi_agent", "multi_agent_v2", "hooks", "plugins", "apps", "browser_use", "computer_use", "image_generation"]) assert.ok(disabled.includes(f), f);
  assert.deepEqual(disabled, [...CODEX_EMPLOYEE_FEATURES_OFF]);
  assert.ok(args.includes('web_search="disabled"'), "0.169.0 ignores tools.web_search: the mode is web_search");
  assert.ok(codexArgs({ ...input, webSearch: true, modelFile: "/m.json" }).includes('web_search="live"'));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('model_catalog_json="/workdir/.orbit-codex-model.json"'));
  const mcp = args.find((a) => a.startsWith("mcp_servers="));
  assert.equal(mcp, 'mcp_servers={orbit_tools={command="node",args=["/opt/orbit-web/bridge/main.js"],env={ORBIT_TOOL_URL="http://orbit-web/api/runtime/tools",ORBIT_RUN_TOKEN="t"},required=true,default_tools_approval_mode="approve"}}', "the whole table: no other server, the bridge required and its tools approved");
  assert.equal(args.at(-1), "-");
  assert.deepEqual(codexEnv({ HOME: "/run" }, "/connection", "sk-x"), { HOME: "/run", CODEX_HOME: "/connection/codex", CODEX_API_KEY: "sk-x" });
});

test("the model's own catalog entry is Orbit's for an employee: no patch tool, no code mode, no sub-agents, no search tool, text only", () => {
  const entry = { slug: "gpt-6.1-sol", base_instructions: "You are Codex.", apply_patch_tool_type: "freeform", tool_mode: "code_mode_only", multi_agent_version: "v2", experimental_supported_tools: ["clock"], node_repl_disabled: false, input_modalities: ["text", "image"], supports_search_tool: true, shell_type: "unified_exec" };
  const made = neutralizedCodexModel(entry);
  assert.deepEqual(made, { slug: "gpt-6.1-sol", base_instructions: "You are Codex.", experimental_supported_tools: [], node_repl_disabled: true, input_modalities: ["text"], supports_search_tool: false, shell_type: "unified_exec" });
  assert.equal(entry.tool_mode, "code_mode_only", "the entry read is left as it was");
});

test("Codex's stream fails closed: only Orbit's tools, the messages and the asked search pass; a warning is no violation", () => {
  let f = codexFold(emptyFacts(), { type: "thread.started", thread_id: "th_1" }, false);
  assert.equal(f.init?.sessionId, "th_1");
  f = codexFold(f, { type: "item.completed", item: { id: "w", type: "error", message: "Codex is ignoring 1 unrecognized configuration setting." } }, false);
  assert.equal(f.foreignTool, null, "an error item is Codex's warning");
  f = codexFold(f, { type: "item.started", item: { id: "r", type: "reasoning", text: "" } }, false);
  f = codexFold(f, { type: "item.completed", item: { id: "i1", type: "mcp_tool_call", server: "orbit_tools", tool: "write_file", status: "completed" } }, false);
  assert.equal(f.toolCalls, 1);
  f = codexFold(f, { type: "item.completed", item: { id: "i2", type: "agent_message", text: "Done." } }, false);
  f = codexFold(f, { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }, false);
  assert.equal(f.result?.isError, false);
  assert.equal(f.result?.text, "Done.");
  assert.equal(f.foreignTool, null);
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i3", type: "command_execution", command: "cat auth.json" } }, false).foreignTool, "command_execution");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i4", type: "file_change" } }, false).foreignTool, "file_change");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i5", type: "mcp_tool_call", server: "planted" } }, false).foreignTool, "mcp:planted");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i6", type: "web_search", query: "x" } }, false).foreignTool, "web_search");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i7", type: "collab_tool_call", tool: "spawn_agent" } }, false).foreignTool, "collab_tool_call", "a sub-agent would run tools of its own");
  assert.equal(codexFold(f, { type: "item.started", item: { id: "i8", type: "a_new_kind" } }, false).foreignTool, "a_new_kind", "an item nobody has seen is refused");
  assert.equal(codexFold(f, { type: "turn.failed", error: { message: "quota" } }, false).result?.isError, true);
});
