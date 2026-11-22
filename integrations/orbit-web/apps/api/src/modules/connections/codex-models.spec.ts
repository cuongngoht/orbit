import assert from "node:assert/strict";
import { test } from "node:test";
import { CODEX_MODELS_REQUEST, codexModelsOf, parseBundledCodexModels } from "./codex-models.js";

// What codex-cli 0.169.0's app server answers to model/list (descriptions shortened; one model hidden, one named with a
// control character, one repeated).
const effort = (reasoningEffort: string) => ({ reasoningEffort, description: `${reasoningEffort} reasoning` });
const entry = (model: string, over: Record<string, unknown> = {}) => ({
  id: model,
  model,
  displayName: model.toUpperCase(),
  description: `The ${model} model.`,
  hidden: false,
  isDefault: false,
  supportedReasoningEfforts: ["low", "medium", "high"].map(effort),
  defaultReasoningEffort: "medium",
  inputModalities: ["text", "image"],
  ...over,
});
const answer = (data: unknown[], id = 2) => JSON.stringify({ id, result: { data, nextCursor: null } });

test("the app server is asked for its picker's models alone -- after initialize, nothing else, no model called", () => {
  const asked = CODEX_MODELS_REQUEST.trim().split("\n").map((l) => JSON.parse(l) as { method: string; id?: number; params?: Record<string, unknown> });
  assert.deepEqual(asked.map((m) => m.method), ["initialize", "initialized", "model/list"]);
  assert.deepEqual(asked[2]?.params, { includeHidden: false });
});

test("its answer is the connection's catalog: in its order, the default recommended, each model's own effort levels", () => {
  const catalog = codexModelsOf(
    answer([
      entry("gpt-6.1-sol", { displayName: "GPT-6.1-Sol", isDefault: true, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map(effort) }),
      entry("gpt-6-astra", { displayName: "GPT-6\u0007Astra" }),
      entry("gpt-secret", { hidden: true }),
      entry("gpt-5.5", { supportedReasoningEfforts: [] }),
      entry("gpt-6-astra"),
    ]),
  );
  assert.ok(catalog);
  assert.equal(catalog.source, "account");
  assert.equal(catalog.recommended, "gpt-6.1-sol");
  assert.deepEqual(
    catalog.models.map((m) => [m.id, m.label, m.efforts.join("/")]),
    [
      ["gpt-6.1-sol", "GPT-6.1-Sol", "low/medium/high/xhigh/max/ultra"],
      ["gpt-6-astra", "GPT-6 Astra", "low/medium/high"],
      ["gpt-5.5", "GPT-5.5", ""],
    ],
    "a hidden model is not offered, a repeated one once, a control character never shown",
  );
  assert.equal(catalog.models[0]?.description, "The gpt-6.1-sol model.");
  assert.ok(catalog.models.every((m) => m.autoMode), "Autonomous runs in Codex's own sandbox with every model");
});

test("only the model/list answer counts; an error or an empty list is no catalog", () => {
  assert.equal(codexModelsOf('{"id":0,"result":{"userAgent":"codex"}}'), undefined, "initialize's answer");
  assert.equal(codexModelsOf('{"method":"account/updated","params":{}}'), undefined, "a notification");
  assert.equal(codexModelsOf("not json"), undefined);
  assert.equal(codexModelsOf('{"id":2,"error":{"code":-32603,"message":"boom"}}'), null);
  assert.equal(codexModelsOf(answer([])), null);
  assert.equal(codexModelsOf(answer([entry("gpt-x", { hidden: true })])), null);
  // No model marked default: the first is recommended.
  assert.equal(codexModelsOf(answer([entry("gpt-a"), entry("gpt-b")]))?.recommended, "gpt-a");
});

test("the catalog bundled in the binary (`codex debug models --bundled`) is a labelled fallback: listed models by priority", () => {
  const level = (e: string) => ({ effort: e, description: e });
  const stdout = JSON.stringify({
    models: [
      { slug: "gpt-6-astra", display_name: "GPT-6-Astra", description: "Frontier.", visibility: "list", priority: 2, supported_reasoning_levels: ["low", "high"].map(level), base_instructions: "x".repeat(5000) },
      { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide", priority: 43, supported_reasoning_levels: [] },
      { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", description: "Workhorse.", visibility: "list", priority: 1, supported_reasoning_levels: ["low", "medium"].map(level) },
    ],
  });
  const catalog = parseBundledCodexModels(stdout);
  assert.ok(catalog);
  assert.equal(catalog.source, "fallback");
  assert.deepEqual(catalog.models.map((m) => [m.id, m.efforts.join("/")]), [["gpt-6.1-sol", "low/medium"], ["gpt-6-astra", "low/high"]]);
  assert.equal(catalog.recommended, "gpt-6.1-sol");
  assert.equal(parseBundledCodexModels("Error: no"), null);
  assert.equal(parseBundledCodexModels('{"models":[]}'), null);
});
