// Autonomous QA in Orbit Control, over HTTP -- a real socket, a real store in a
// temporary directory, a Git checkout to be "the project". The promises: the
// page is about the checkout Control was started from; approving a mode is a
// person's write that names the revision it read; production can never be
// approved for a mode that writes; an investigation's page is redacted; and
// reading starts nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { join } from "node:path";
import { createControlServer, listen } from "../src/server.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { createInvestigations, reportProject } from "../src/core.mjs";
import { contextFor, fixture, TOKEN, worldFor } from "./fixture.mjs";

async function started(t, ctx) {
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const send = (method, path, body, headers) => sent(port, method, path, body, headers);
  const mutation = { origin: `http://127.0.0.1:${port}`, [TOKEN_HEADER]: TOKEN, "content-type": "application/json" };
  return { get: (p) => send("GET", p), put: (p, b) => send("PUT", p, b, mutation), bare: (m, p, b) => send(m, p, b, { "content-type": "application/json" }) };
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

function checkoutWorld(root) {
  spawnSync("git", ["init", "-q"], { cwd: root.project });
  const env = { ORBIT_STORE_DIR: root.store, PATH: process.env.PATH ?? "" };
  return { ...worldFor(root, { env }), env };
}

const ENV = { id: "test", origin: "https://app.test", kind: "test", modes: ["observe", "explore-write"] };

test("outside a checkout the page says so, and has nothing to show", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, { ...worldFor(root, { env: { ORBIT_STORE_DIR: root.store } }), projectRoot: join(root.base, "outside") }));
  const got = await api.get("/api/v1/autonomous-qa");
  assert.equal(got.status, 200);
  assert.equal(got.json.available, false);
});

test("the overview: ON by default (autonomous, 0.2.0), every blocker the gates would raise, the modes and no investigation yet", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, checkoutWorld(root)));
  const got = (await api.get("/api/v1/autonomous-qa")).json;
  assert.equal(got.available, true);
  assert.equal(got.settings.enabled, true);
  assert.equal(got.exists, false);
  assert.deepEqual(got.modes.map((m) => m.id), ["observe", "explore-write", "security-test", "regression", "fixture-write"]);
  assert.deepEqual(got.blockers[0].blockers.map((b) => b.id), ["NO_ENVIRONMENT"], "what is left is what only a person can say: which environment to look at");
  assert.deepEqual(got.investigations, []);
  assert.equal(got.switchedOn, true);
});

test("approving is a person's write: the token is required, the revision is named, a stale one is a 409", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, checkoutWorld(root)));
  const first = (await api.get("/api/v1/autonomous-qa")).json;
  const next = { ...first.settings, enabled: true, environments: [ENV], identities: ["admin"] };
  assert.equal((await api.bare("PUT", "/api/v1/autonomous-qa/settings", { settings: next, revision: first.revision })).status, 403);
  const saved = await api.put("/api/v1/autonomous-qa/settings", { settings: next, revision: first.revision });
  assert.equal(saved.status, 200, saved.text);
  const after = (await api.get("/api/v1/autonomous-qa")).json;
  assert.equal(after.settings.enabled, true);
  assert.deepEqual(after.blockers[0].blockers, []);
  const stale = await api.put("/api/v1/autonomous-qa/settings", { settings: { ...next, identities: [] }, revision: first.revision ?? "stale" });
  assert.equal(stale.status, 409, stale.text);
});

test("no approval buys a writing mode on production, and a credential is never a setting", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, checkoutWorld(root)));
  const first = (await api.get("/api/v1/autonomous-qa")).json;
  const prod = await api.put("/api/v1/autonomous-qa/settings", { settings: { ...first.settings, environments: [{ ...ENV, kind: "production" }] }, revision: first.revision });
  assert.equal(prod.status, 400);
  assert.match(prod.json.error.message, /production/);
  const secret = await api.put("/api/v1/autonomous-qa/settings", { settings: { ...first.settings, password: "hunter2" }, revision: first.revision });
  assert.equal(secret.status, 400);
});

test("an investigation the engine kept: listed, opened, and its page REDACTED", async (t) => {
  const { root } = fixture(t);
  const world = checkoutWorld(root);
  const found = reportProject(world.env, world.projectRoot);
  const store = createInvestigations(found.store.root, found.io);
  const id = store.create({ objective: "why Save sends two requests", scope: "thing", mode: "observe", environment: ENV, by: "session" });
  store.append(id, "check", { id: "chk-1", action: "act-1", layer: "data", state: "observed", query: "SELECT COUNT(*) AS n FROM Things WHERE Name='TC-secret-1'", tables: ["Things"], provenance: "map", expect: 1, rows: 2, attempts: 1, ms: 1, within: 0 });
  store.append(id, "finding", { id: "fnd-1", key: "k", family: "duplicate", outcome: "CONFIRMED_DEFECT", confidence: "high", evidence: ["chk-1"], say: "two POSTs", oracle: "contradiction", alternatives: [], needs: [], missing: [] });
  const api = await started(t, contextFor(root, world));
  const list = (await api.get("/api/v1/autonomous-qa")).json.investigations;
  assert.deepEqual([list[0].id, list[0].findings], [id, { CONFIRMED_DEFECT: 1 }]);
  const one = (await api.get(`/api/v1/autonomous-qa/investigations/${id}`)).json.investigation;
  assert.equal(one.findings[0].outcome, "CONFIRMED_DEFECT");
  const page = (await api.get(`/api/v1/autonomous-qa/investigations/${id}/report`)).json.html;
  assert.equal(page.includes("TC-secret-1"), false);
  assert.ok(page.includes("Name='…'"));
  assert.equal((await api.get("/api/v1/autonomous-qa/investigations/..%2F..%2Fetc")).status, 400);
  assert.equal((await api.get("/api/v1/autonomous-qa/investigations/inv-20990101-000000-abcd")).status, 404);
});

test("a generated test's tree, its artifacts by digest and its frozen versions are read off the journal -- and only the kinds a page may open", async (t) => {
  const { root } = fixture(t);
  const world = checkoutWorld(root);
  const found = reportProject(world.env, world.projectRoot);
  const store = createInvestigations(found.store.root, found.io);
  const id = store.create({ objective: "generated tests", scope: "", mode: "fixture-write", environment: ENV, by: "session" });
  store.appendOnce(id, "obligation", { id: "obr-1", eventId: "e-obl", obligation: "tob-0123456789ab", revision: "r1", shape: "response-conforms", target: "endpoint:x", bindings: ["bnd-1"], expected: ["AC/E1"], authority: "accepted", method: "runtime-test" });
  const kept = store.putArtifact(id, "designs", { id: "tds-1", obligation: "tob-0123456789ab", skeleton: { steps: [] } });
  store.appendOnce(id, "designed", { id: "dsg-1", eventId: "e-dsg", obligation: "tob-0123456789ab", design: "tds-1", digest: kept.digest, state: "designed" });
  const api = await started(t, contextFor(root, world));
  const got = await api.get(`/api/v1/autonomous-qa/investigations/${id}/tests`);
  assert.equal(got.status, 200, got.text);
  const tests = got.json.tests;
  assert.deepEqual([tests[0].obligation, tests[0].current.shape, tests[0].designs[0].design], ["tob-0123456789ab", "response-conforms", "tds-1"]);
  const art = (await api.get(`/api/v1/autonomous-qa/investigations/${id}/artifacts/designs/${kept.digest}`)).json;
  assert.equal(art.artifact.id, "tds-1");
  assert.equal((await api.get(`/api/v1/autonomous-qa/investigations/${id}/artifacts/journal/${kept.digest}`)).status, 400, "only what a test was made from and froze");
  assert.equal((await api.get(`/api/v1/autonomous-qa/investigations/${id}/artifacts/designs/..%2F..%2Fx`)).status, 400);
  assert.equal((await api.get(`/api/v1/autonomous-qa/investigations/${id}/versions/nope@0000000000000000`)).status, 404);
});
