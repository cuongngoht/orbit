import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModelCatalog, PROBE_ARGS, PROBE_REQUEST } from "./claude-models.js";

const answer = (models: unknown[], wrap = true) => JSON.stringify({ type: "control_response", response: wrap ? { subtype: "success", request_id: "r", response: { models } } : { subtype: "success", models } });

test("the account's catalog is read from the CLI's control response: its models, their efforts and auto mode", () => {
  const stdout = [
    JSON.stringify({ type: "system", subtype: "status" }),
    answer([
      { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
      { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", description: "For complex work", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAutoMode: true },
      { value: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", supportsThinkingOff: true },
      { value: "sonnet[1m]", displayName: "Sonnet (1M context)", supportsEffort: true, supportsAutoMode: true },
      { value: "--evil", displayName: "an option" },
      { value: "opus", displayName: "twice" },
    ]),
  ].join("\n");
  const catalog = parseModelCatalog(stdout);
  assert.equal(catalog?.source, "account");
  assert.deepEqual(catalog?.models, [
    { id: "opus", label: "Opus 5.5", description: "For complex work", efforts: ["low", "medium", "high", "xhigh", "max"], autoMode: true },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", description: null, efforts: [], autoMode: false },
    { id: "sonnet[1m]", label: "Sonnet (1M context)", description: null, efforts: ["low", "medium", "high", "xhigh", "max"], autoMode: true },
  ]);
  assert.equal(catalog?.recommended, "opus", "the model the CLI's default resolves to");
  assert.equal(parseModelCatalog(answer([{ value: "sonnet" }], false))?.models[0]?.id, "sonnet", "an unwrapped answer too");
});

test("no control response, an error, or no usable model is no catalog", () => {
  assert.equal(parseModelCatalog(""), null);
  assert.equal(parseModelCatalog("not json\n{}"), null);
  assert.equal(parseModelCatalog(JSON.stringify({ type: "control_response", response: { subtype: "error", error: "nope" } })), null);
  assert.equal(parseModelCatalog(answer([{ value: "default" }, { value: "-x" }])), null);
});

test("the probe is restricted, calls no model and persists nothing; it sends one initialize request", () => {
  assert.equal(PROBE_ARGS[0], "--input-format", "never read as a run");
  for (const flag of ["--restricted", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) assert.ok(PROBE_ARGS.includes(flag), flag);
  assert.equal(PROBE_ARGS[PROBE_ARGS.indexOf("--tools") + 1], "");
  assert.deepEqual(JSON.parse(PROBE_REQUEST), { type: "control_request", request_id: "orbit-web-models", request: { subtype: "initialize" } });
});
