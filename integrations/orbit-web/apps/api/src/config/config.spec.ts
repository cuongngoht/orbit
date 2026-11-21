import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigError, loadConfig as load } from "./config.js";

// Orbit Web keeps its records in PostgreSQL: every configuration names it.
const DATABASE = "postgres://orbit:secret@postgres:5432/orbit";
const loadConfig = (env: Readonly<Record<string, string | undefined>>) => load({ ORBIT_WEB_DATABASE_URL: DATABASE, ...env });

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

test("the database is required, a postgres:// URL naming a database -- or a file holding one -- and never a fallback", () => {
  assert.throws(() => load({}), (err: unknown) => err instanceof ConfigError && /ORBIT_WEB_DATABASE_URL is required/.test(err.message));
  assert.throws(() => load({ ORBIT_WEB_DATABASE_URL: "sqlite:///data/app/orbit-web.db" }), /postgres:\/\/ URL/);
  assert.throws(() => load({ ORBIT_WEB_DATABASE_URL: "postgres://orbit@postgres:5432" }), /name a database/);
  assert.throws(() => load({ ORBIT_WEB_DATABASE_URL: "not a url" }), ConfigError);
  const c = loadConfig({});
  assert.equal(c.database.url, DATABASE);
  assert.equal(c.database.poolMax, 10);
  assert.equal(loadConfig({ ORBIT_WEB_DATABASE_POOL_MAX: "25" }).database.poolMax, 25);
  assert.throws(() => loadConfig({ ORBIT_WEB_DATABASE_POOL_MAX: "0" }), ConfigError);
  const dir = mkdtempSync(join(tmpdir(), "orbit-web-config-"));
  try {
    const file = join(dir, "database-url");
    writeFileSync(file, `${DATABASE}\n`);
    assert.equal(load({ ORBIT_WEB_DATABASE_URL_FILE: file }).database.url, DATABASE);
    assert.throws(() => load({ ORBIT_WEB_DATABASE_URL_FILE: file, ORBIT_WEB_DATABASE_URL: DATABASE }), /not both/);
    assert.throws(() => load({ ORBIT_WEB_DATABASE_URL_FILE: join(dir, "missing") }), /cannot be read/);
    assert.throws(() => load({ ORBIT_WEB_DATABASE_URL_FILE: "relative/file" }), /absolute path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a browser session lasts a week and ends after a day idle unless a person sets otherwise, within bounds", () => {
  const c = loadConfig({});
  assert.deepEqual([c.session.lifetimeMs, c.session.idleMs], [7 * 24 * 3_600_000, 24 * 3_600_000]);
  const set = loadConfig({ ORBIT_WEB_SESSION_HOURS: "12", ORBIT_WEB_SESSION_IDLE_HOURS: "2" });
  assert.deepEqual([set.session.lifetimeMs, set.session.idleMs], [12 * 3_600_000, 2 * 3_600_000]);
  assert.throws(() => loadConfig({ ORBIT_WEB_SESSION_HOURS: "2", ORBIT_WEB_SESSION_IDLE_HOURS: "3" }), /not be longer/);
  assert.throws(() => loadConfig({ ORBIT_WEB_SESSION_HOURS: "0" }), ConfigError);
});

test("there is no governance directory: governance's records are in the database", () => {
  assert.equal("governance" in loadConfig({}).data, false);
});

test("the password hash's cost is production's, read from no variable; a connection's home and keys have rooms of their own", () => {
  const c = loadConfig({ ORBIT_WEB_KDF_N: "2", ORBIT_WEB_SCRYPT_N: "2" });
  assert.deepEqual([c.identity.kdf.N, c.identity.kdf.r, c.identity.kdf.p], [2 ** 17, 8, 1]);
  assert.equal(c.data.connections, "/data/connections");
  assert.equal("claude" in c.data, false, "no Claude sign-in of the installation's own");
  assert.equal(c.identity.trial, false);
});

test("a trial starts only where nobody else can reach it -- and says which condition failed", () => {
  const trial = (env: Record<string, string>) => () => loadConfig({ ORBIT_WEB_TRIAL: "1", ...env });
  assert.equal(trial({})().identity.trial, true, "loopback, no token, single, nothing public: a trial");
  assert.equal(loadConfig({ ORBIT_WEB_TRIAL: "0" }).identity.trial, false);
  assert.throws(() => loadConfig({ ORBIT_WEB_TRIAL: "yes" }), /ORBIT_WEB_TRIAL must be 1/);
  const refused: [Record<string, string>, RegExp][] = [
    [{ ORBIT_WEB_ALLOWED_HOSTS: "orbit.example.com", ORBIT_WEB_ACCESS_TOKEN: "a-long-and-random-access-token" }, /ORBIT_WEB_ALLOWED_HOSTS names orbit\.example\.com: a trial answers loopback host names only/],
    [{ ORBIT_WEB_ACCESS_TOKEN: "a-long-and-random-access-token" }, /ORBIT_WEB_ACCESS_TOKEN is set: a trial has no access token/],
    [{ ORBIT_WEB_DEPLOYMENT: "governed", ORBIT_WEB_RUNNER: "orbit-agent:7070", ORBIT_WEB_AGENT_NETWORKS: "172.30.0.0/24", ORBIT_WEB_AGENT_CONTROL_HOST: "orbit-web" }, /ORBIT_WEB_DEPLOYMENT is governed: a trial is the single deployment only/],
    [{ ORBIT_WEB_PUBLIC_ORIGIN: "https://orbit.example.com" }, /ORBIT_WEB_PUBLIC_ORIGIN is set: a trial has no public origin/],
    [{ ORBIT_WEB_COOKIE_SECURE: "1" }, /ORBIT_WEB_COOKIE_SECURE is set/],
  ];
  for (const [env, why] of refused) {
    assert.throws(trial(env), (err: unknown) => err instanceof ConfigError && why.test(err.message) && /ORBIT_WEB_TRIAL=1 refused/.test(err.message), JSON.stringify(env));
  }
  assert.equal(trial({ ORBIT_WEB_ALLOWED_HOSTS: "localhost,127.0.0.1" })().identity.trial, true, "naming loopback names again widens nothing");
});
