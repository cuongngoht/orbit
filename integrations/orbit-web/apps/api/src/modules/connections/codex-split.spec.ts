import assert from "node:assert/strict";
import { test } from "node:test";
import { offeredTools, splitVerdict, TOOLLESS_AGENTS_MARKER, TOOLLESS_PROMPT, toollessVerdict } from "./codex-split.js";

// What codex-cli 0.169.0 sent the stand-in model (descriptions cut to what is read): held as an employee's model plane
// is -- every local executor off, Orbit's entry for the model -- and as it is by default.
const HELD = { model: "gpt-6.1-sol", tools: [], input: [{ type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [{ type: "function", name: "list_mcp_resources" }, { type: "function", name: "list_mcp_resource_templates" }, { type: "function", name: "read_mcp_resource" }, { type: "function", name: "request_user_input" }, { type: "function", name: "view_image" }] }, { type: "namespace", name: "mcp__orbit_tools", tools: [{ type: "function", name: "shell" }, { type: "function", name: "submit_handoff" }] }] }] };
const DEFAULT = { model: "gpt-6.1-sol", tools: [], input: [{ type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec", description: "### `apply_patch`\n### `exec_command`\n### `view_image`\n### `write_stdin`" }, { type: "function", name: "wait" }, { type: "function", name: "request_user_input" }] }, { type: "namespace", name: "collaboration", tools: [{ type: "function", name: "spawn_agent" }] }] }] };

const REFUSED = "view_image is not allowed because you do not support image inputs";

test("the tools a request offers a model, wherever they are: its tools, its additional tools, namespaces, code mode's nested ones", () => {
  assert.deepEqual(offeredTools(HELD), ["functions.list_mcp_resources", "functions.list_mcp_resource_templates", "functions.read_mcp_resource", "functions.request_user_input", "functions.view_image", "mcp__orbit_tools.shell", "mcp__orbit_tools.submit_handoff"]);
  assert.deepEqual(offeredTools(DEFAULT), ["functions.exec", "functions.exec→apply_patch", "functions.exec→exec_command", "functions.exec→view_image", "functions.exec→write_stdin", "functions.wait", "functions.request_user_input", "collaboration.spawn_agent"]);
  assert.deepEqual(offeredTools({ tools: [{ type: "web_search" }, { type: "function", name: "view_image" }] }), ["web_search", "view_image"]);
  assert.deepEqual(offeredTools("nothing"), []);
});

test("held to Orbit's tools only when every tool offered is Orbit's or inert, and Orbit's are there", () => {
  assert.deepEqual(splitVerdict({ offered: offeredTools(HELD), viewImage: REFUSED }), { split: "yes", reason: null });
  const read = splitVerdict({ offered: offeredTools(HELD), viewImage: "unable to process image: invalid or unsupported image data" });
  assert.equal(read.split, "no");
  assert.match(read.reason ?? "", /view_image read a file/);
  assert.equal(splitVerdict({ offered: offeredTools(HELD), viewImage: null }).split, "no", "a viewer never asked is not known to refuse");
  const open = splitVerdict({ offered: offeredTools(DEFAULT), viewImage: null });
  assert.equal(open.split, "no");
  assert.match(open.reason ?? "", /functions\.exec.*exec_command.*collaboration\.spawn_agent/);
  const none = splitVerdict({ offered: ["functions.request_user_input"], viewImage: null });
  assert.deepEqual(none, { split: "no", reason: "none of Orbit's tools reached the model" });
  assert.equal(splitVerdict({ offered: [...offeredTools(HELD), "web_search"], viewImage: REFUSED }).split, "no", "the provider's search only where a run asks for it");
});

// A CEO's answer: what the model is offered with no MCP server and every local executor off -- the inert readers and a
// viewer that refuses -- and the developer instructions the run was given.
const TOOLLESS = { model: "gpt-6.1-sol", tools: [], input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: TOOLLESS_PROMPT }] }, { type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [{ type: "function", name: "list_mcp_resources" }, { type: "function", name: "list_mcp_resource_templates" }, { type: "function", name: "read_mcp_resource" }, { type: "function", name: "request_user_input" }, { type: "function", name: "view_image" }] }] }] };

test("a tool-less answer is held only with no tool that acts, the fixed prompt reaching the model, and no AGENTS.md read", () => {
  const request = JSON.stringify(TOOLLESS);
  assert.deepEqual(toollessVerdict({ offered: offeredTools(TOOLLESS), viewImage: REFUSED, request }), { split: "yes", reason: null });
  const bridged = toollessVerdict({ offered: offeredTools(HELD), viewImage: REFUSED, request });
  assert.equal(bridged.split, "no", "an MCP server's tool -- even Orbit's own -- is a tool that acts");
  assert.match(bridged.reason ?? "", /mcp__orbit_tools\.shell/);
  assert.equal(toollessVerdict({ offered: offeredTools(DEFAULT), viewImage: null, request }).split, "no", "code mode and sub-agents");
  assert.equal(toollessVerdict({ offered: [...offeredTools(TOOLLESS), "web_search"], viewImage: REFUSED, request }).split, "no", "the provider's search");
  assert.match(toollessVerdict({ offered: offeredTools(TOOLLESS), viewImage: "unable to process image", request }).reason ?? "", /view_image read a file/);
  assert.equal(toollessVerdict({ offered: offeredTools(TOOLLESS), viewImage: null, request }).split, "no", "a viewer never asked is not known to refuse");
  assert.deepEqual(toollessVerdict({ offered: offeredTools(TOOLLESS), viewImage: REFUSED, request: request.replace(TOOLLESS_PROMPT, "something else") }), { split: "no", reason: "the fixed system prompt did not reach the model" });
  assert.deepEqual(toollessVerdict({ offered: offeredTools(TOOLLESS), viewImage: REFUSED, request: `${request}${TOOLLESS_AGENTS_MARKER}` }), { split: "no", reason: "it read a project's AGENTS.md into what the model is told" });
  assert.deepEqual(toollessVerdict({ offered: [], viewImage: null, request }), { split: "yes", reason: null }, "nothing offered at all is held");
});

// The same observation on the codex binary installed here is the native tier's (tests/native/codex-split.spec.ts).
