// Connections and PO Reports over HTTP -- a real socket, a real store in a
// temporary directory, a GitHub in memory, an OS secret store in memory. The
// promises: a credential goes in once and never comes back out, in any answer
// or any file; there is no plaintext fallback; a settings change names what it
// read; and the pages are about the checkout Control was started from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { createControlServer, listen } from "../src/server.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { secretSource } from "../../src/secrets.mjs";
import { githubSource } from "../../skills/orbit-report/sources/github.mjs";
import { fakeVault } from "../../test/fakes/vault.mjs";
import { fakeGitHub } from "../../test/project-report/fake-github.mjs";
import { contextFor, fixture, TOKEN, worldFor } from "./fixture.mjs";

const PAT = "github_pat_11CONTROLCANARY0000000000000000000000000000000000000000000000000000";

async function started(t, ctx) {
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const seen = [];
  const send = (method, path, body, headers) => sent(port, method, path, body, headers).then((r) => (seen.push(r.text), r));
  const mutation = (body) => ({ origin: `http://127.0.0.1:${port}`, [TOKEN_HEADER]: TOKEN, ...(body === undefined ? {} : { "content-type": "application/json" }) });
  return { seen, get: (p) => send("GET", p), post: (p, b) => send("POST", p, b, mutation(b)), put: (p, b) => send("PUT", p, b, mutation(b)), del: (p) => send("DELETE", p, undefined, mutation()), bare: (m, p, b) => send(m, p, b, { "content-type": "application/json" }) };
}

function sent(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); resolve({ status: res.statusCode, text, json: text ? JSON.parse(text) : null }); });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const files = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])) : []);

// A Control started from a Git checkout, over this fixture's store, with a
// GitHub in memory behind the report's sources.
function reportWorld(root, { vault = fakeVault(), git = true, prs = [] } = {}) {
  if (git) spawnSync("git", ["init", "-q"], { cwd: root.project });
  const env = { ORBIT_STORE_DIR: root.store, PATH: process.env.PATH ?? "" };
  const gh = fakeGitHub({ repos: { "acme/web": { prs, issues: [] } } });
  return { world: { ...worldFor(root, { env }), env, secrets: secretSource({ env, vault }), reportSources: { github: githubSource({ sleep: async () => {} }) }, fetch: gh.fetch }, vault, gh };
}

test("a connection is created, given a credential, tested and deleted -- and the credential is in no answer and no file", async (t) => {
  const { root } = fixture(t);
  const { world, vault, gh } = reportWorld(root);
  const api = await started(t, contextFor(root, world));
  const made = await api.post("/api/v1/connections", { id: "github-acme", provider: "github", organization: "acme" });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.host, "https://api.github.com");
  const set = await api.put("/api/v1/connections/github-acme/credential", { value: PAT });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual([set.json.connection.credential, set.json.backend], [{ set: true, from: "vault" }, "fake-vault"]);
  assert.equal(vault.items.get("connection-github-acme"), PAT);
  const tested = await api.post("/api/v1/connections/github-acme/test");
  assert.equal(tested.status, 200, tested.text);
  assert.equal(tested.json.checks[0].id, "authentication");
  assert.ok(gh.calls.every((c) => new URL(c.url).host === "api.github.com"));
  const listed = await api.get("/api/v1/connections");
  assert.deepEqual(listed.json.providers.map((p) => p.id), ["github", "azure-devops"]);
  assert.ok(!JSON.stringify(listed.json.providers).includes("shapes"), "token shapes are not the page's");
  assert.equal((await api.del("/api/v1/connections/github-acme")).status, 200);
  assert.equal(vault.items.size, 0, "deleting the connection deletes the credential Orbit kept");
  for (const text of api.seen) assert.ok(!text.includes(PAT), "an answer carried the credential");
  for (const f of files(root.store)) assert.ok(!readFileSync(f, "latin1").includes(PAT), `${f} holds the credential`);
});

test("no OS secret store: 503, and nothing is kept anywhere; a malformed credential body is refused without echo", async (t) => {
  const { root } = fixture(t);
  const { world } = reportWorld(root, { vault: null });
  const api = await started(t, contextFor(root, world));
  await api.post("/api/v1/connections", { id: "github-acme", provider: "github", organization: "acme" });
  const none = await api.put("/api/v1/connections/github-acme/credential", { value: PAT });
  assert.equal(none.status, 503);
  assert.match(none.json.error.message, /reference an environment variable instead/);
  const both = await api.put("/api/v1/connections/github-acme/credential", { value: PAT, env: "X" });
  assert.equal(both.json.error.code, "CREDENTIAL_INVALID");
  const env = await api.put("/api/v1/connections/github-acme/credential", { env: "REPORT_GITHUB_PAT" });
  assert.deepEqual(env.json.connection.credential, { set: true, from: "env", name: "REPORT_GITHUB_PAT" });
  assert.equal((await api.get("/api/v1/connections/nope")).status, 404);
  for (const text of api.seen) assert.ok(!text.includes(PAT));
  for (const f of files(root.store)) assert.ok(!readFileSync(f, "latin1").includes(PAT));
});

test("a change needs the token: without it, nothing about a connection or a report changes", async (t) => {
  const { root } = fixture(t);
  const { world } = reportWorld(root);
  const api = await started(t, contextFor(root, world));
  assert.equal((await api.bare("POST", "/api/v1/connections", { id: "github-acme", provider: "github", organization: "acme" })).status, 403);
  assert.equal((await api.bare("PUT", "/api/v1/reports/settings", { settings: {}, revision: null })).status, 403);
});

test("PO Reports: settings with a revision (a stale one is 409), parts switched and a replacement approved by a person", async (t) => {
  const { root } = fixture(t);
  const { world } = reportWorld(root);
  const api = await started(t, contextFor(root, world));
  const first = await api.get("/api/v1/reports/settings");
  assert.equal(first.json.available, true, first.text);
  assert.deepEqual(first.json.sections.find((s) => s.id === "orbit.report.section.contributors").enabled, false);
  const saved = await api.put("/api/v1/reports/settings", { settings: { ...first.json.settings, provider: "github", timezone: "Asia/Ho_Chi_Minh", scope: { repositories: ["acme/web"] } }, revision: first.json.revision });
  assert.equal(saved.status, 200, saved.text);
  const stale = await api.put("/api/v1/reports/settings", { settings: { ...first.json.settings, period: { months: 3 } }, revision: first.json.revision });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "STALE_REVISION");
  const off = await api.post("/api/v1/reports/parts/disable", { part: "orbit.report.forecast", revision: saved.json.saved.revision });
  assert.equal(off.status, 200, off.text);
  const approved = await api.post("/api/v1/reports/parts/approve", { part: "demo.forecast", revision: off.json.saved.revision });
  assert.deepEqual(approved.json.saved.parts["demo.forecast"], { enabled: true, replace: true });
  const parts = await api.get("/api/v1/reports/parts");
  assert.equal(parts.json.standard.find((p) => p.id === "orbit.report.forecast").enabled, false);
  const overview = await api.get("/api/v1/reports/overview");
  assert.deepEqual([overview.json.available, overview.json.provider, overview.json.runs], [true, "github", []]);
});

test("started anywhere that is not a checkout, the report pages say where to start it", async (t) => {
  const { root } = fixture(t);
  const { world } = reportWorld(root, { git: false });
  const api = await started(t, contextFor(root, { ...world, projectRoot: join(root.base, "outside") }));
  const overview = await api.get("/api/v1/reports/overview");
  assert.deepEqual([overview.json.available, /project's checkout/.test(overview.json.why)], [false, true]);
});
