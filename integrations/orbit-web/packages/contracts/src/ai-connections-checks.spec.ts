// AN ACCOUNT'S AI CONNECTIONS, as the API holds every request body to them: what is accepted (and as what), and what is
// refused with which words.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_STATE_TEXT, AUTH_STATES, checkCreateConnection, checkPluginGrant, checkUpdateConnection, isRuntimeKind, PLUGIN_USE_CASES, RUNTIME_KINDS, RUNTIME_LABELS } from "./ai-connections.js";
import type { Checked } from "./validate.js";

const errorsOf = <T>(c: Checked<T>): string[] => (c.ok ? [] : c.errors);

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

test("three CLIs, each named, and every status word said", () => {
  assert.deepEqual([...RUNTIME_KINDS], ["claude", "codex", "agy"]);
  assert.deepEqual(RUNTIME_LABELS, { claude: "Claude Code", codex: "OpenAI Codex", agy: "Google Antigravity" });
  for (const r of RUNTIME_KINDS) assert.equal(isRuntimeKind(r), true, r);
  for (const bad of ["Claude", "gemini", "", null, 1]) assert.equal(isRuntimeKind(bad), false, String(bad));
  assert.deepEqual(Object.keys(AUTH_STATE_TEXT), [...AUTH_STATES]);
  assert.deepEqual([...PLUGIN_USE_CASES], ["chat", "employee"]);
});

test("a subscription connection takes no key; an API-key one takes the key, trimmed; a cloud one names its provider", () => {
  assert.deepEqual(checkCreateConnection({ runtime: "claude", method: "subscription", label: "  Team   Max " }), { ok: true, value: { runtime: "claude", method: "subscription", label: "Team Max" } });
  assert.deepEqual(checkCreateConnection({ runtime: "codex", method: "api_key", apiKey: ` ${KEY} ` }), { ok: true, value: { runtime: "codex", method: "api_key", apiKey: KEY } });
  assert.deepEqual(checkCreateConnection({ runtime: "agy", method: "subscription" }), { ok: true, value: { runtime: "agy", method: "subscription" } });
  assert.deepEqual(checkCreateConnection({ runtime: "claude", method: "cloud", cloud: { provider: "bedrock" } }), { ok: true, value: { runtime: "claude", method: "cloud", cloud: { provider: "bedrock" } } });
  assert.deepEqual(checkCreateConnection({ runtime: "claude", method: "cloud", cloud: { provider: "vertex", region: "europe-west4", project: "acme-ai" } }), { ok: true, value: { runtime: "claude", method: "cloud", cloud: { provider: "vertex", region: "europe-west4", project: "acme-ai" } } });
});

test("a new connection is refused for whatever it does not say correctly, each problem named", () => {
  const e = (body: unknown) => errorsOf(checkCreateConnection(body));
  assert.deepEqual(e([]), ["the body must be a JSON object"]);
  assert.deepEqual(e({ runtime: "gemini", method: "password", token: "x" }), ["token is not a field of this request", "runtime must be one of claude, codex, agy", "method must be one of subscription, api_key, cloud"]);
  for (const apiKey of [undefined, "short", "has a space inside the key value", 42]) assert.deepEqual(e({ runtime: "claude", method: "api_key", apiKey }), ["apiKey must be the provider's API key"], String(apiKey));
  assert.deepEqual(e({ runtime: "claude", method: "subscription", apiKey: KEY }), ["apiKey is only for the api_key method"], "a key is never taken for a subscription");
  assert.deepEqual(e({ runtime: "claude", method: "subscription", cloud: { provider: "bedrock" } }), ["cloud is only for the cloud method"]);
  for (const cloud of [undefined, { provider: "azure" }, "bedrock"]) assert.deepEqual(e({ runtime: "claude", method: "cloud", cloud }), ["cloud.provider must be bedrock, vertex or foundry"], JSON.stringify(cloud));
  for (const label of ["", "   ", "x".repeat(61), "Team\u0007"]) assert.deepEqual(e({ runtime: "claude", method: "subscription", label }), ["label must be 1-60 printable characters"], label);
});

test("a change of a connection names its label, makes it the default, or replaces its key", () => {
  assert.deepEqual(checkUpdateConnection({ label: " Main ", isDefault: true, apiKey: ` ${KEY}` }), { ok: true, value: { label: "Main", isDefault: true, apiKey: KEY } });
  assert.deepEqual(checkUpdateConnection({ isDefault: true }), { ok: true, value: { isDefault: true } });
  assert.deepEqual(errorsOf(checkUpdateConnection({})), ["nothing to change"]);
  assert.deepEqual(errorsOf(checkUpdateConnection({ isDefault: false })), ["isDefault can only be set to true (another connection becomes the default by being chosen)"]);
  assert.deepEqual(errorsOf(checkUpdateConnection({ apiKey: "nope", method: "api_key" })), ["method is not a field of this request", "apiKey must be the provider's API key"]);
  assert.deepEqual(errorsOf(checkUpdateConnection({ label: "" })), ["label must be 1-60 printable characters"]);
  assert.deepEqual(checkUpdateConnection(null), { ok: false, errors: ["the body must be a JSON object"] });
});

test("a plugin grant is for one use case, a yes or a no, and exactly the digest the page showed", () => {
  const digest = "a".repeat(64);
  for (const useCase of PLUGIN_USE_CASES) assert.deepEqual(checkPluginGrant({ useCase, approved: false, digest }), { ok: true, value: { useCase, approved: false, digest } });
  assert.deepEqual(errorsOf(checkPluginGrant({ useCase: "research", approved: "yes", digest: "A".repeat(64), note: 1 })), ["note is not a field of this request", "useCase must be one of chat, employee", "approved must be true or false", "digest must be the plugin digest the page showed"]);
  assert.deepEqual(checkPluginGrant(undefined), { ok: false, errors: ["the body must be a JSON object"] });
});
