// How a connection gets in, over HTTP -- a real socket, a real store in a temporary directory, an OS secret store in
// memory, and a FAKE adapter behind the real descriptor (skills/orbit-report/providers.json), so nothing here starts a
// program or opens a browser. The promises: look, sign in and sign out are POSTs behind the token and no GET starts
// anything; a blocked sign-in is a 503 that carries the engine's own code, a sentence made safe and the one next step;
// what a sign-in takes is held to the descriptor; and no token and no credential is in an answer or in a file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { connectionsOf } from "../src/core.mjs";
import { ROUTES } from "../src/router.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { createControlServer, listen } from "../src/server.mjs";
import { Blocked } from "../../src/errors.mjs";
import { createAuth } from "../../src/connections/auth.mjs";
import { AuthBlocked } from "../../src/connections/auth-errors.mjs";
import { createConnections } from "../../src/connections/manage.mjs";
import { connectionStore } from "../../src/connections/store.mjs";
import { secretSource } from "../../src/secrets.mjs";
import { realIo } from "../../src/store/io.mjs";
import { providers } from "../../skills/orbit-report/pack.mjs";
import { fakeVault } from "../../test/fakes/vault.mjs";
import { contextFor, fixture, TOKEN, worldFor } from "./fixture.mjs";

const PAT = "github_pat_11AUTHCANARY00000000000000000000000000000000000000000000000000000";
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlc2lnbmF0dXJl";
const TOOL = { found: true, version: "2.91.0", source: "orbit-managed", acquirable: null, tried: [] };

// The adapter a descriptor's strategy id is answered by -- scripted, and counting what it was asked.
function fakeAdapter() {
  const adapter = { calls: [], script: {}, gates: {} };
  const DEFAULT = { status: { state: "sign-in-required", tool: TOOL }, "sign-in": { state: "authenticated", tool: TOOL }, "sign-out": { state: "sign-in-required", tool: TOOL } };
  const run = (op) => async (a) => {
    adapter.calls.push({ op, tenant: a.tenant, deviceCode: a.deviceCode });
    if (op === "sign-in") await prompted(adapter, a);
    const planned = adapter.script[op];
    if (planned instanceof Error) throw planned;
    return planned ?? DEFAULT[op];
  };
  return Object.assign(adapter, { status: run("status"), signIn: run("sign-in"), signOut: run("sign-out") });
}

// What the tool prints while a person signs in goes to `notify`; the gate holds the sign-in open until a test lets it finish.
async function prompted(adapter, a) {
  a.notify?.("Opening the sign-in. Finish it in the browser.");
  a.notify?.("To sign in, open https://login.example/device and enter the code ABCD-1234");
  adapter.entered?.();
  await adapter.gates["sign-in"];
}

async function serve(t, ctx) {
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const seen = [];
  const send = (method, path, body, headers) => sent(port, method, path, body, headers).then((r) => (seen.push(r.text), r));
  const mutation = (body) => ({ origin: `http://127.0.0.1:${port}`, [TOKEN_HEADER]: TOKEN, ...(body === undefined ? {} : { "content-type": "application/json" }) });
  return { port, seen, get: (p) => send("GET", p), post: (p, b) => send("POST", p, b, mutation(b)), put: (p, b) => send("PUT", p, b, mutation(b)), bare: (m, p, b) => send(m, p, b, b === undefined ? {} : { "content-type": "application/json" }), foreign: (m, p) => send(m, p, undefined, { origin: "https://evil.example", [TOKEN_HEADER]: TOKEN }) };
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

// A Control whose world hands in a manager over the store's rooms with the fake adapter as the auth of the descriptor's
// `azure-cli` strategy -- exactly where the real binding puts the real one.
async function control(t, { vault = fakeVault() } = {}) {
  const { root } = fixture(t);
  const adapter = fakeAdapter();
  const env = { ORBIT_STORE_DIR: root.store, PATH: process.env.PATH ?? "" };
  const base = worldFor(root, { env });
  const secrets = secretSource({ env, vault });
  const auth = createAuth({ secrets, adapters: { "azure-cli": adapter }, providers: providers(), nowMs: Date.now });
  const manager = createConnections({ store: connectionStore(base.rooms, realIo()), secrets, providers: providers(), auth, now: () => new Date().toISOString() });
  const logged = [];
  const world = { ...base, env, secrets, connections: manager };
  const api = await serve(t, { ...contextFor(root, world), log: (line) => logged.push(line) });
  return { api, adapter, logged, root, world, vault };
}

const ACME = { id: "azure-acme", provider: "azure-devops", organization: "acme" };
const PATH = (id, tail) => `/api/v1/connections/${id}/auth/${tail}`;

test("check, sign in and sign out are POSTs behind the token, and nothing that is a GET starts a program or a sign-in", async (t) => {
  const { api, adapter } = await control(t);
  const rows = ROUTES.filter((r) => r.path.source.includes("connections") && r.path.source.includes("auth"));
  assert.deepEqual(rows.map((r) => [r.method, r.mutates]), [["POST", true], ["POST", true], ["POST", true]], "the three rows, each a mutation");
  assert.equal((await api.post("/api/v1/connections", ACME)).status, 200);
  for (const tail of ["check", "sign-in", "sign-out"]) {
    const path = PATH(ACME.id, tail);
    assert.equal((await api.bare("POST", path, tail === "sign-in" ? {} : undefined)).json.error.code, "MUTATION_TOKEN_REQUIRED", `${tail}: no token`);
    assert.equal((await api.foreign("POST", path)).json.error.code, "ORIGIN_NOT_ALLOWED", `${tail}: a foreign origin`);
    assert.equal((await api.get(path)).status, 405, `${tail}: a GET is not a route`);
  }
  for (const path of ["/api/v1/connections", `/api/v1/connections/${ACME.id}`, "/api/v1/tools", "/api/v1/reports/overview"]) await api.get(path);
  assert.deepEqual(adapter.calls, [], "no refused request and no GET reached the adapter");
});

test("check, sign in and sign out reach the connection's manager and answer the END STATE -- the prompt goes to the terminal, never to the page", async (t) => {
  const { api, adapter, logged } = await control(t);
  const made = await api.post("/api/v1/connections", ACME);
  assert.deepEqual(made.json.auth, { strategy: "azure-cli" }, "a new connection spells out the descriptor's preferred way in");
  const checked = await api.post(PATH(ACME.id, "check"));
  assert.deepEqual(checked.json, { strategy: "azure-cli", state: "sign-in-required", tool: TOOL });
  const signed = await api.post(PATH(ACME.id, "sign-in"), { tenant: "contoso.example", deviceCode: true });
  assert.deepEqual([signed.status, signed.json.state, signed.json.strategy], [200, "authenticated", "azure-cli"]);
  assert.ok(logged.some((l) => l === "sign-in azure-acme: To sign in, open https://login.example/device and enter the code ABCD-1234"), "the person's terminal is shown the prompt");
  assert.ok(!signed.text.includes("ABCD-1234") && !signed.text.includes("login.example"), "and the page is told only how it ended");
  await api.post(PATH(ACME.id, "sign-in"), {});
  const out = await api.post(PATH(ACME.id, "sign-out"));
  assert.deepEqual([out.json.state, out.json.strategy], ["sign-in-required", "azure-cli"]);
  assert.deepEqual(adapter.calls, [{ op: "status", tenant: undefined, deviceCode: undefined }, { op: "sign-in", tenant: "contoso.example", deviceCode: true }, { op: "sign-in", tenant: undefined, deviceCode: undefined }, { op: "sign-out", tenant: undefined, deviceCode: undefined }]);
  assert.equal((await api.post(PATH("nope", "check"))).json.error.code, "CONNECTION_NOT_FOUND", "a connection that is not here is asked nothing");
});

test("a sign-in waits for the person to finish it, and shows them the prompt while it waits", async (t) => {
  const { api, adapter, logged } = await control(t);
  await api.post("/api/v1/connections", ACME);
  let release = () => {};
  adapter.gates["sign-in"] = new Promise((done) => { release = done; });
  const entered = new Promise((done) => { adapter.entered = done; });
  const pending = api.post(PATH(ACME.id, "sign-in"), {});
  await entered;
  let early = false;
  pending.then(() => { early = true; });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual([early, logged.length >= 2], [false, true], "the prompt reached the terminal while the request still waited");
  release();
  assert.equal((await pending).json.state, "authenticated");
});

test("a blocked sign-in is a 503 with the engine's own code, a sentence made safe, and the one next step", async (t) => {
  const { api, adapter } = await control(t);
  await api.post("/api/v1/connections", ACME);
  adapter.script["sign-in"] = new AuthBlocked("AUTH_LOGIN_FAILED", `the sign-in failed: ${JWT} password=hunter2hunter2 \u001b[31mred\u0007\nsecond line`, "sign in again\nwith another account");
  const blocked = await api.post(PATH(ACME.id, "sign-in"), {});
  assert.deepEqual([blocked.status, blocked.json.error.code, blocked.json.error.next], [503, "AUTH_LOGIN_FAILED", "sign in again with another account"]);
  for (const leak of [JWT, "hunter2", "\u001b", "\u0007", "\n"]) assert.ok(!blocked.json.error.message.includes(leak), `the message carried ${JSON.stringify(leak)}`);
  assert.match(blocked.json.error.message, /^the sign-in failed: /);
  adapter.script.status = new AuthBlocked("AUTH_TOOL_MISSING", "no usable tool is available", "install it, or use a personal access token instead");
  const missing = await api.post(PATH(ACME.id, "check"));
  assert.deepEqual([missing.status, missing.json.error.code, Object.keys(missing.json.error)], [503, "AUTH_TOOL_MISSING", ["code", "message", "next"]]);
  adapter.script["sign-out"] = new Blocked("a tool the contract has no word for");
  assert.deepEqual([(await api.post(PATH(ACME.id, "sign-out"))).json.error.code], ["AUTH_BLOCKED"], "any other BLOCKED is still a 503");
});

test("anything else that goes wrong is the server's: logged there, and the page is told no more than the generic sentence", async (t) => {
  const { api, adapter, logged } = await control(t);
  await api.post("/api/v1/connections", ACME);
  adapter.script.status = new Error("EACCES: permission denied, mkdir '/Users/someone/.orbit/profile'");
  const broken = await api.post(PATH(ACME.id, "check"));
  assert.deepEqual([broken.status, broken.json], [500, { error: { code: "INTERNAL_ERROR", message: "the server could not complete that request" } }]);
  assert.ok(logged.some((l) => l.includes("/Users/someone")), "the path is in the server's own log");
});

test("what a sign-in takes is held to the descriptor, and a refused body starts nothing", async (t) => {
  const { api, adapter } = await control(t);
  await api.post("/api/v1/connections", ACME);
  const refused = async (body) => (await api.post(PATH(ACME.id, "sign-in"), body));
  for (const [what, body] of [["a tenant in the wrong form", { tenant: "Not A Tenant!" }], ["a tenant that is an option of another program", { tenant: "--use-device-code" }], ["a flag that is not a boolean", { deviceCode: "yes" }], ["a field the contract does not have", { strategy: "credential" }], ["an array", []], ["null", null]]) {
    const answer = await refused(body);
    assert.deepEqual([answer.status, answer.json.error.code], [400, "CONNECTION_AUTH_INVALID"], what);
    assert.ok(!answer.text.includes("Not A Tenant") && !answer.text.includes("--use-device-code"), `${what}: the sentence repeated what it was given`);
  }
  assert.deepEqual(adapter.calls, []);
  assert.equal((await api.post(PATH(ACME.id, "sign-in"), { tenant: "contoso.example", deviceCode: false })).status, 200);
});

test("a connection that reads a credential has nothing to sign in to, and says what it has instead", async (t) => {
  const { api, adapter } = await control(t);
  await api.post("/api/v1/connections", { ...ACME, id: "azure-pat", auth: { strategy: "credential" } });
  assert.deepEqual((await api.post(PATH("azure-pat", "check"))).json, { strategy: "credential", state: "credential-missing" });
  await api.put("/api/v1/connections/azure-pat/credential", { env: "ORBIT_TEST_PAT" });
  assert.equal((await api.post(PATH("azure-pat", "check"))).json.state, "credential-set");
  const signed = await api.post(PATH("azure-pat", "sign-in"), {});
  assert.deepEqual([signed.status, signed.json.error.code, /nothing to sign in to/.test(signed.json.error.message)], [400, "CONNECTION_AUTH_INVALID", true]);
  assert.equal((await api.post(PATH("azure-pat", "sign-out"))).status, 400);
  assert.deepEqual(adapter.calls, [], "the credential strategy never reaches an adapter");
});

test("`auth` is held to the provider's descriptor on create and on update, and a refusal repeats nothing it was given", async (t) => {
  const { api } = await control(t);
  const bad = await api.post("/api/v1/connections", { ...ACME, auth: { strategy: "magic-wand" } });
  assert.deepEqual([bad.status, bad.json.error.code, /azure-cli, credential/.test(bad.json.error.message), bad.text.includes("magic-wand")], [400, "CONNECTION_INVALID", true, false]);
  assert.equal((await api.post("/api/v1/connections", { id: "github-acme", provider: "github", organization: "acme", auth: { strategy: "azure-cli" } })).status, 400, "a provider that does not offer a strategy takes none of its options");
  assert.deepEqual((await api.post("/api/v1/connections", ACME)).json.auth, { strategy: "azure-cli" });
  const set = await api.put(`/api/v1/connections/${ACME.id}`, { auth: { strategy: "azure-cli", tenant: "contoso.example", deviceCode: true } });
  assert.deepEqual([set.status, set.json.auth], [200, { strategy: "azure-cli", tenant: "contoso.example", deviceCode: true }]);
  for (const auth of [{ strategy: "azure-cli", tenant: "Not A Tenant!" }, { strategy: "azure-cli", nope: 1 }, { strategy: "credential", tenant: "contoso.example" }, "azure-cli"]) assert.equal((await api.put(`/api/v1/connections/${ACME.id}`, { auth })).status, 400, JSON.stringify(auth));
  assert.deepEqual((await api.get(`/api/v1/connections/${ACME.id}`)).json.auth, { strategy: "azure-cli", tenant: "contoso.example", deviceCode: true }, "a refused change leaves the record as it was");
  assert.deepEqual((await api.put(`/api/v1/connections/${ACME.id}`, { label: "Acme" })).json.auth, { strategy: "azure-cli", tenant: "contoso.example", deviceCode: true }, "a change of something else leaves the way in alone");
  assert.deepEqual((await api.put(`/api/v1/connections/${ACME.id}`, { auth: { strategy: "credential" } })).json.auth, { strategy: "credential" });
});

test("a connection made before `auth` existed is read as a credential connection, with no migration", async (t) => {
  const { api, world } = await control(t);
  connectionStore(world.rooms, realIo()).change(() => [{ id: "github-old", provider: "github", organization: "acme", host: "https://api.github.com", credential: "OLD_PAT" }]);
  const read = await api.get("/api/v1/connections/github-old");
  assert.deepEqual([read.json.auth, read.json.credential], [{ strategy: "credential" }, { set: true, from: "env", name: "OLD_PAT" }]);
  assert.deepEqual((await api.post(PATH("github-old", "check"))).json, { strategy: "credential", state: "credential-set" });
});

test("the providers a page reads say how each can be signed in to -- by allow-list: its words and its options, never how a request is made", async (t) => {
  const { api } = await control(t);
  const listed = (await api.get("/api/v1/connections")).json.providers;
  const ado = listed.find((p) => p.id === "azure-devops").authentication;
  assert.equal(ado.default, "azure-cli");
  assert.deepEqual(ado.strategies.map((s) => [s.id, s.kind, s.preferred ?? false]), [["azure-cli", "broker", true], ["credential", "credential", false]]);
  const broker = ado.strategies[0];
  assert.deepEqual(broker.options.map((o) => [o.name, o.type]), [["tenant", "string"], ["deviceCode", "boolean"]]);
  assert.ok(broker.options[0].pattern && broker.sessionOwner && broker.tools.length && broker.label, "what a page draws it from");
  assert.deepEqual(listed.find((p) => p.id === "github").authentication.strategies.map((s) => s.id), ["credential"]);
  const text = JSON.stringify(listed);
  for (const never of ["shapes", "\"request\"", "\"resource\"", "499b84ac"]) assert.ok(!text.includes(never), `a page was sent ${never}`);
});

test("nothing a sign-in handles is in an answer or a file: no token, no credential -- and what an adapter reports is re-masked on the way out", async (t) => {
  const vault = fakeVault();
  const { api, adapter, root } = await control(t, { vault });
  await api.post("/api/v1/connections", ACME);
  await api.post("/api/v1/connections", { id: "github-acme", provider: "github", organization: "acme" });
  assert.equal((await api.put("/api/v1/connections/github-acme/credential", { value: PAT })).status, 200);
  adapter.script.status = { state: "failed", tool: { ...TOOL, found: false, version: null, source: null, tried: [{ id: "azure-cli", reason: `answered Bearer ${JWT}`, path: "/Users/someone/bin/az" }] }, token: JWT, accessToken: JWT };
  const checked = await api.post(PATH(ACME.id, "check"));
  assert.deepEqual(Object.keys(checked.json), ["strategy", "state", "tool"], "an allow-list: what an adapter adds beyond the state is its own");
  assert.deepEqual(Object.keys(checked.json.tool.tried[0]), ["id", "reason"]);
  await api.post(PATH("github-acme", "check"));
  await api.post(PATH(ACME.id, "sign-in"), {});
  await api.get("/api/v1/connections");
  for (const text of api.seen) for (const secret of [PAT, JWT, "/Users/someone"]) assert.ok(!text.includes(secret), `an answer carried ${secret}`);
  for (const f of files(root.store)) for (const secret of [PAT, JWT]) assert.ok(!readFileSync(f, "latin1").includes(secret), `${f} holds ${secret}`);
});

test("a world's connections are bound ONCE and kept: one manager for every request, a world's own when it hands one in, and another for another world", (t) => {
  const { root } = fixture(t);
  const env = { ORBIT_STORE_DIR: root.store, PATH: process.env.PATH ?? "" };
  const [a, b] = [worldFor(root, { env }), worldFor(root, { env })];
  const [first, other] = [{ ...a, env, secrets: secretSource({ env }) }, { ...b, env, secrets: secretSource({ env }) }];
  assert.equal(connectionsOf(first), connectionsOf(first), "bound over the world's rooms, secret port and environment -- once");
  assert.notEqual(connectionsOf(first), connectionsOf(other));
  const given = { list: () => [] };
  assert.equal(connectionsOf({ ...first, connections: given }), given, "a manager a world hands in is the one it uses");
});
