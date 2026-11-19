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
