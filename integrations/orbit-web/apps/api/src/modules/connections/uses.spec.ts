import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionCatalog, RuntimeCapabilities } from "@orbit-web/contracts";
import { activationOf, connectionUses, type UseFacts } from "./uses.js";

const caps = (split: "yes" | "no" | "unknown"): RuntimeCapabilities => ({ start: "yes", stream: "yes", cancel: "yes", resume: "yes", usage: "yes", webSearch: "yes", toolPlaneSplit: split, pluginObservation: "no" });
const catalog: ConnectionCatalog = { source: "account", models: [{ id: "sonnet", label: "Sonnet", description: null, efforts: ["medium"], autoMode: true }], recommended: "sonnet", checkedAt: null };
const facts = (over: Partial<UseFacts> = {}): UseFacts => ({ runtime: "claude", label: "Claude", auth: "connected", reason: null, isDefault: true, catalog, capabilities: caps("yes"), ...over });

test("three answers kept apart: a connected default Claude Code connection is usable for chat, research and employees", () => {
  const u = connectionUses(facts());
  assert.deepEqual([u.chat.ready, u.research.ready, u.employee.ready], [true, true, true]);
});

test("a use the runtime does not have here is said as that -- never as 'off' -- so a page leaves it out", () => {
  const codex = connectionUses(facts({ runtime: "codex", label: "ChatGPT" }));
  assert.equal(codex.chat.ready, true);
  assert.equal(codex.research.reasonCode, "runtime_not_supported", "research runs on Claude Code");
  const agy = connectionUses(facts({ runtime: "agy", label: "Gemini", catalog: { ...catalog, models: [] } }));
  assert.deepEqual([agy.chat.reasonCode, agy.research.reasonCode, agy.employee.reasonCode], ["runtime_not_supported", "runtime_not_supported", "runtime_not_supported"], "Antigravity runs nothing in Orbit Web");
});

test("research is the DEFAULT Claude Code connection's; chat needs the models its CLI listed; an employee needs them read from the account and its model plane held", () => {
  assert.equal(connectionUses(facts({ isDefault: false })).research.reasonCode, "not_default");
  assert.equal(connectionUses(facts({ isDefault: false })).chat.ready, true, "another Claude Code connection still runs chats");
  const fallback = connectionUses(facts({ catalog: { ...catalog, source: "fallback" } }));
  assert.equal(fallback.chat.ready, true, "a labelled fallback list serves a chat");
  assert.equal(fallback.employee.reasonCode, "catalog_not_from_account", "and never an employee");
  assert.equal(connectionUses(facts({ catalog: { ...catalog, models: [] } })).chat.reasonCode, "no_models");
  assert.equal(connectionUses(facts({ capabilities: caps("unknown") })).employee.reasonCode, "not_held");
  const signedOut = connectionUses(facts({ auth: "auth_required", reason: "The login expired." }));
  assert.deepEqual([signedOut.chat.reasonCode, signedOut.research.reasonCode, signedOut.employee.reasonCode], ["not_connected", "not_connected", "not_connected"]);
  assert.match(signedOut.chat.reason ?? "", /The login expired/);
});

test("a company is activated by ONE connection usable for chat, research or an employee -- a chat-only one is enough", () => {
  const none = activationOf([]);
  assert.equal(none.ready, false);
  assert.match(none.reason ?? "", /Connect an AI CLI first/);
  assert.equal(none.where, "#/settings/ai-connections");
  const unusable = activationOf([connectionUses(facts({ auth: "disconnected" })), connectionUses(facts({ runtime: "agy", label: "Gemini" }))]);
  assert.equal(unusable.ready, false);
  assert.match(unusable.reason ?? "", /None of this account's AI connections/);
  const chatOnly = activationOf([connectionUses(facts({ runtime: "codex", label: "ChatGPT", capabilities: caps("no") }))]);
  assert.deepEqual([chatOnly.ready, chatOnly.uses], [true, { chat: true, research: false, employee: false }], "chat alone activates a company that cannot run an employee yet");
});
