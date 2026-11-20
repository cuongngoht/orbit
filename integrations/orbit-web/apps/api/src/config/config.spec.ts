import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "./config.js";

test("defaults: loopback only, port 3000, /data, the bundled plugin", () => {
  const c = loadConfig({});
  assert.equal(c.port, 3000);
  assert.equal(c.bind, "127.0.0.1");
  assert.equal(c.data.github, "/data/github");
  assert.equal(c.pluginDir, "/opt/orbit/plugin");
  assert.deepEqual(c.allowedHosts, ["localhost", "127.0.0.1", "::1"]);
  assert.equal(c.accessToken, null);
});

test("answering another host name needs an access token", () => {
  assert.throws(() => loadConfig({ ORBIT_WEB_ALLOWED_HOSTS: "orbit.example.com" }), ConfigError);
  assert.throws(() => loadConfig({ ORBIT_WEB_ALLOWED_HOSTS: "orbit.example.com", ORBIT_WEB_ACCESS_TOKEN: "short" }), ConfigError);
  const c = loadConfig({ ORBIT_WEB_ALLOWED_HOSTS: "orbit.example.com", ORBIT_WEB_ACCESS_TOKEN: "a-long-enough-token-value" });
  assert.ok(c.allowedHosts.includes("orbit.example.com"));
});

test("a budget cap is a positive number; paths are absolute", () => {
  assert.equal(loadConfig({ ORBIT_WEB_MAX_BUDGET_USD: "2.5" }).maxBudgetUsd, 2.5);
  assert.throws(() => loadConfig({ ORBIT_WEB_MAX_BUDGET_USD: "-1" }), ConfigError);
  assert.throws(() => loadConfig({ ORBIT_WEB_DATA_DIR: "relative/data" }), ConfigError);
});

test("research keeps its files in /data/research, within bounds a person may set and nothing else", () => {
  const c = loadConfig({});
  assert.equal(c.data.research, "/data/research");
  assert.deepEqual([c.research.maxUploadBytes, c.research.maxUrlBytes, c.research.urlImport, c.research.ingestConcurrency, c.research.contextChars], [25 * 1024 * 1024, 10 * 1024 * 1024, true, 2, 24_000]);
  const set = loadConfig({ ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB: "50", ORBIT_WEB_RESEARCH_MAX_URL_MB: "5", ORBIT_WEB_RESEARCH_URL_IMPORT: "off", ORBIT_WEB_RESEARCH_INGEST_CONCURRENCY: "4", ORBIT_WEB_RESEARCH_CONTEXT_CHARS: "40000" });
  assert.deepEqual([set.research.maxUploadBytes, set.research.maxUrlBytes, set.research.urlImport, set.research.ingestConcurrency, set.research.contextChars], [50 * 1024 * 1024, 5 * 1024 * 1024, false, 4, 40_000]);
  for (const env of [{ ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB: "0" }, { ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB: "1e3" }, { ORBIT_WEB_RESEARCH_URL_IMPORT: "yes" }, { ORBIT_WEB_RESEARCH_INGEST_CONCURRENCY: "64" }, { ORBIT_WEB_RESEARCH_CONTEXT_CHARS: "12.5" }]) assert.throws(() => loadConfig(env), ConfigError, JSON.stringify(env));
});
