import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../config/config.js";
import { azureEnv, azureGitEnv, claudeEnv, ghEnv, gitEnv, orbitEnv, TELEMETRY_DEFAULTS } from "./env.js";

const ENDPOINT = "https://collector.example:4318";
const HEADERS = "Authorization=Bearer abcdefghijklmnopqrstuvwxyz0123456789";

const config = (env: Record<string, string> = {}) => loadConfig({ ORBIT_WEB_DATA_DIR: "/srv/orbit-web", ...env });

const telemetryOf = (env: Record<string, string>) => Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith("OTEL_") || name === "CLAUDE_CODE_ENABLE_TELEMETRY"));

test("Claude Code's telemetry is off until the container names a collector, whatever else it sets", () => {
  assert.deepEqual(telemetryOf(claudeEnv(config())), {});
  assert.deepEqual(telemetryOf(claudeEnv(config({ OTEL_EXPORTER_OTLP_HEADERS: HEADERS, OTEL_LOG_USER_PROMPTS: "1", CLAUDE_CODE_ENABLE_TELEMETRY: "1" }))), {});
});

test("with a collector, every Claude Code process exports as a person's own does: the fixed attributes, the container's endpoint and token", () => {
  const env = claudeEnv(config({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS: HEADERS }), { azure: true, github: true });
  assert.deepEqual(telemetryOf(env), { ...TELEMETRY_DEFAULTS, OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS: HEADERS });
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, "1");
  assert.equal(env.OTEL_EXPORTER_OTLP_PROTOCOL, "http/protobuf");
  for (const never of ["OTEL_LOG_USER_PROMPTS", "OTEL_LOG_ASSISTANT_RESPONSES", "OTEL_LOG_TOOL_CONTENT", "OTEL_LOG_RAW_API_BODIES"]) assert.equal(env[never], "0", never);
  assert.equal(claudeEnv(config({ OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: ENDPOINT })).CLAUDE_CODE_ENABLE_TELEMETRY, "1", "a signal's own endpoint names a collector too");
});

test("an OTEL_* variable the container sets wins over its default; nothing else of the container's passes", () => {
  const env = claudeEnv(config({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_LOG_TOOL_DETAILS: "0", OTEL_RESOURCE_ATTRIBUTES: "deployment.environment.name=orbit-web", CLAUDE_CODE_USE_BEDROCK: "1", OTEL_lower: "x" }));
  assert.equal(env.OTEL_LOG_TOOL_DETAILS, "0");
  assert.equal(env.OTEL_RESOURCE_ATTRIBUTES, "deployment.environment.name=orbit-web");
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(env.OTEL_lower, undefined);
});

test("the collector's token reaches Claude Code alone: never git, gh, az or Orbit's own commands", () => {
  const c = config({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS: HEADERS });
  for (const env of [gitEnv(c), ghEnv(c), azureEnv(c), azureGitEnv(c), orbitEnv(c, null)]) assert.deepEqual(telemetryOf(env), {});
});

test("the image declares every telemetry attribute as the code does -- but where it goes, its token and the switch that turns it on", () => {
  const lines = readFileSync(resolve(import.meta.dirname, "../../../../../../docker/Dockerfile"), "utf8").split("\n");
  const dockerfile = lines.filter((l) => !l.trimStart().startsWith("#")).join("\n").replace(/\\\n/g, " ");
  const declared = new Map([...dockerfile.matchAll(/\b((?:OTEL_|CLAUDE_CODE_ENABLE_TELEMETRY)[A-Z0-9_]*)=(\S+)/g)].map((m) => [m[1] as string, m[2] as string]));
  const { CLAUDE_CODE_ENABLE_TELEMETRY: _on, ...attributes } = TELEMETRY_DEFAULTS;
  assert.deepEqual(Object.fromEntries(declared), attributes);
  for (const never of ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "CLAUDE_CODE_ENABLE_TELEMETRY"]) assert.equal(declared.has(never), false, never);
});
