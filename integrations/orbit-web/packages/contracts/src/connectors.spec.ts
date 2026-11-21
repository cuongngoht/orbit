import assert from "node:assert/strict";
import { test } from "node:test";
import { CONNECTOR_DEFAULTS, connectorKindOf, connectorLabelOf, connectorToolPrefix } from "./connectors.js";
import { checkUpdateConnectors } from "./validate.js";

test("a connector's tools are named as the CLI names them; what a person reads is its own name", () => {
  assert.equal(connectorToolPrefix("claude.ai Claude Docs"), "mcp__claude_ai_Claude_Docs");
  assert.equal(connectorToolPrefix("plugin:microsoft-docs:microsoft-learn"), "mcp__plugin_microsoft-docs_microsoft-learn");
  assert.equal(connectorToolPrefix("plugin:design:google calendar"), "mcp__plugin_design_google_calendar");
  assert.deepEqual([connectorKindOf("claude.ai Gmail"), connectorKindOf("plugin:design:figma"), connectorKindOf("mine")], ["claude.ai", "plugin", "other"]);
  assert.deepEqual([connectorLabelOf("claude.ai Claude Docs"), connectorLabelOf("plugin:design:figma")], ["Claude Docs", "design · figma"]);
  assert.deepEqual(CONNECTOR_DEFAULTS, { chat: true, research: true }, "research as chats are, until a person unchecks one");
});

test("a person's choices name connectors, each with chat and/or research, true or false -- nothing else", () => {
  assert.deepEqual(checkUpdateConnectors({ connectors: { "claude.ai Claude Docs": { research: true }, "claude.ai Gmail": { chat: false, research: false } } }), {
    ok: true,
    value: { connectors: { "claude.ai Claude Docs": { research: true }, "claude.ai Gmail": { chat: false, research: false } } },
  });
  for (const bad of [{ connectors: { x: { write: true } } }, { connectors: { x: { chat: "yes" } } }, { connectors: { x: {} } }, { connectors: { "": { chat: true } } }, { connectors: { "a\u0000b": { chat: true } } }, { connectors: [] }, { connectors: {}, extra: 1 }, null])
    assert.equal(checkUpdateConnectors(bad).ok, false, JSON.stringify(bad));
  assert.equal(checkUpdateConnectors({ connectors: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`c${i}`, { chat: true }])) }).ok, false);
});
