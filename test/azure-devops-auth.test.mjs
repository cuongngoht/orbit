// How Azure DevOps is READ once a connection says how it gets in: a connection that signs in sends a short-lived Bearer
// token, one that holds a personal access token sends exactly the header it always did, and both go through one client
// that cannot write. What is held to here, with fakes only (an Azure DevOps in memory, an `az` that keeps state where the
// real one does, no network, no sleeps):
//
//   the header      asked for at every request, so a token replaced halfway is the one the next request carries
//   a refusal       a 401 forgets the token and asks ONCE more, and only a token that really is another is tried; a 403 is
//                   the account saying it may not read this, and asks for nothing
//   read-only       a table of what may be asked; a PUT, a PATCH, a DELETE and any other POST never leave
//   a crowd         a dozen reads at once cause one sign-in and one token request
//   a secret        a CANARY token is in no snapshot, no raw page, no message and no connections.json
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAFETY_MS, createAuth } from "../src/connections/auth.mjs";
import { AuthBlocked } from "../src/connections/auth-errors.mjs";
import { createConnections } from "../src/connections/manage.mjs";
import { connectionStore } from "../src/connections/store.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { collect } from "../src/project-report/collect.mjs";
import { freeze } from "../src/project-report/snapshot.mjs";
import { secretSource } from "../src/secrets.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { azureCliAdapter } from "../skills/orbit-report/auth/azure-cli.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";
import { OPERATIONS, clientOf, operationOf, readOnly } from "../skills/orbit-report/sources/azure-devops-client.mjs";
import { azureDevOpsSource } from "../skills/orbit-report/sources/azure-devops.mjs";
import { createHttp } from "../skills/orbit-report/sources/http.mjs";
import { connectionEnvFor, packReaders, readerResources } from "../skills/orbit-requirements/bind.mjs";
import { createFakeAz } from "./fakes/az-cli.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { fakeAdo } from "./project-report/fake-ado.mjs";
import { rctxOf, tempBase } from "./project-report/rctx.mjs";
import { WINDOW } from "./project-report/snapshots.mjs";

const PROVIDERS = providers();
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const REPORT_NOW = Date.parse("2026-09-25T03:00:00Z");
const PAT = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst";
const SIGNED_IN = { id: "ado-acme", provider: "azure-devops", host: "https://dev.azure.com", organization: "acme", auth: { strategy: "azure-cli" } };
const WITH_PAT = { ...SIGNED_IN, auth: { strategy: "credential" }, credential: "ADO_PAT" };
const BASE = "https://dev.azure.com/acme";
const noWait = { sleep: async () => {} };

const A = "tok-A-0123456789abcdefghij";
const B = "tok-B-0123456789abcdefghij";
const C = "tok-C-0123456789abcdefghij";
const bearer = (token) => `Bearer ${token}`;
const basic = (token) => `Basic ${Buffer.from(`:${token}`).toString("base64")}`;

// ---- the machine ---------------------------------------------------------------------------------------------------

const reply = (status, body = { message: "denied" }, headers = {}) => ({ status, headers: new Headers({ "content-type": "application/json", ...headers }), json: async () => body, text: async () => JSON.stringify(body) });
const page = (status) => ({ status, headers: new Headers({ "content-type": "text/html" }), json: async () => { throw new Error("html"); }, text: async () => "<html>Sign in</html>" });

// A sign-in whose tokens are scripted: what the contract asks of an adapter, and how often it was asked. Each token is minted
// when it is asked for, and is good for an hour from THEN.
function broker(tokens, clock = { now: NOW }) {
  const asked = [];
  const adapter = { acquire: async (a) => (asked.push(a.interactive), { token: tokens.shift(), expiresAt: clock.now + HOUR }), status: async () => ({ state: "authenticated" }), signIn: async () => ({ state: "authenticated" }), signOut: async () => ({ state: "sign-in-required" }) };
  const auth = createAuth({ secrets: {}, adapters: { "azure-cli": adapter }, providers: PROVIDERS, nowMs: () => clock.now });
  return { asked, clock, auth, request: (options) => auth.resolve(SIGNED_IN, options) };
}

// An Azure DevOps that takes only the authorization it is told to take: any other is refused as `refusal` says.
function gated(fake, { takes = () => true, refusal = () => reply(401) } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const at = new URL(url);
    calls.push({ host: at.host, url: at.pathname, method: init.method ?? "GET", authorization: init.headers?.authorization ?? null });
    return takes(init.headers?.authorization ?? null) ? fake.fetch(url, init) : refusal();
  };
  return { fetch, calls };
}

const collecting = (net, auth, over = {}) => azureDevOpsSource(noWait).collect({ connection: SIGNED_IN, scope: { project: "portal" }, window: WINDOW, auth, fetch: net.fetch, nowMs: () => REPORT_NOW, log: () => {}, ...over });

// The whole chain: the real adapter over an `az` that keeps its state where the real one does.
function chain({ people = [{ name: "orbit-B", tenant: "tenant-b" }] } = {}) {
  const az = createFakeAz({ parentEnv: { PATH: "/usr/bin", HOME: "/fake/dev" }, people });
  const launcher = { file: "/fake/az", args: [], env: { AZURE_CONFIG_DIR: "/fake/orbit/auth/azure-cli", PATH: "/usr/bin" }, profileDir: "/fake/orbit/auth/azure-cli" };
  const tools = { ensure: async () => ({ launcher: () => launcher }), find: () => ({ found: { launcher: () => launcher }, tried: [], acquirable: null }) };
  const adapter = azureCliAdapter({ tools, process: az.process, io: az.io, nowMs: () => NOW, cwd: "/tmp", next: { signIn: (c) => `sign in ${c.id}` } });
  const auth = createAuth({ secrets: {}, adapters: { "azure-cli": adapter }, providers: PROVIDERS, nowMs: () => NOW });
  const ops = () => az.state.calls.map((c) => (c.argv[0] === "account" ? `${c.argv[0]} ${c.argv[1]}` : c.argv[0]));
  return { az, auth, ops, count: (op) => ops().filter((o) => o === op).length };
}

// ---- Bearer or Basic -----------------------------------------------------------------------------------------------

test("a connection that signs in sends a Bearer token, and one that holds a personal access token sends the same Basic header as before", async () => {
  const b = broker([A]);
  const net = gated(fakeAdo());
  await collecting(net, b.request());
  assert.ok(net.calls.length > 8, "a whole collection was read");
  assert.ok(net.calls.every((c) => c.authorization === bearer(A)), "every request, the release service's host included, carried the signed-in token");
  assert.ok(net.calls.some((c) => c.host === "vsrm.dev.azure.com"));
  assert.equal(b.asked.length, 1, "one token for the whole run");
  const pat = gated(fakeAdo());
  const request = createAuth({ secrets: { read: async () => PAT }, adapters: {}, providers: PROVIDERS, nowMs: () => 0 }).resolve(WITH_PAT);
  await collecting(pat, request, { connection: WITH_PAT });
  assert.ok(pat.calls.length > 8 && pat.calls.every((c) => c.authorization === basic(PAT)), "the header a personal access token has always been sent in");
});

// ---- the header is asked for at every hop --------------------------------------------------------------------------

test("an HTTP client asks for its headers at the top of every hop -- never inside the retry loop -- and an authorization that cannot be had is not a network failure", async () => {
  const asked = [];
  const headers = async () => (asked.push(asked.length + 1), { Authorization: `Bearer hop-${asked.length}`, "User-Agent": "test" });
  const seen = [];
  const make = (answers) => createHttp({ fetch: async (url, init) => (seen.push(init.headers), answers.shift()), origin: BASE, headers, sleep: async () => {}, nowMs: () => 0 });
  await make([reply(503), reply(503), reply(200, { ok: true })]).request(`${BASE}/_apis/x`);
  assert.deepEqual([asked.length, seen.length], [1, 3], "one hop sent three times: the headers were asked for once");
  assert.deepEqual(Object.keys(seen[0]).sort(), ["accept", "authorization", "user-agent"], "names are one spelling, so a header never travels twice");
  asked.length = 0;
  await make([reply(302, {}, { location: "/acme/_apis/y" }), reply(200, {})]).request(`${BASE}/_apis/x`);
  assert.equal(asked.length, 2, "a redirect is a hop of its own: a token spent on the way is replaced");
  asked.length = 0;
  await make([reply(429, {}, { "retry-after": "1" }), reply(200, {})]).request(`${BASE}/_apis/x`);
  assert.equal(asked.length, 2, "so is a request made again after a rate-limit wait, which may be a long one");
  const blocked = new AuthBlocked("AUTH_LOGIN_REQUIRED", "a sign-in is needed", "sign in");
  const http = createHttp({ fetch: async () => { throw new Error("must not be asked"); }, origin: BASE, headers: async () => { throw blocked; }, sleep: async () => {}, nowMs: () => 0 });
  assert.equal(await http.request(`${BASE}/_apis/x`).catch((e) => e), blocked, "it stops as itself, BLOCKED -- never turned into 'the source could not be reached'");
  assert.equal(http.used().requests, 0, "and no request was counted, nor was anything sent");
});

test("a token replaced halfway through a run is the one the next request carries", async () => {
  const clock = { now: NOW };
  const b = broker([A, B], clock);
  const fake = fakeAdo();
  let n = 0;
  const net = gated({ fetch: async (url, init) => (++n === 3 && (clock.now += HOUR - SAFETY_MS + 1), fake.fetch(url, init)) });
  await collecting(net, b.request());
  const used = net.calls.map((c) => c.authorization);
  const switched = used.indexOf(bearer(B));
  assert.equal(switched, 3, "the first token served the first three requests, and the new one the very next");
  assert.ok(used.length - switched >= 5, "and several more on the same host -- not one request that happened to start a new client");
  assert.ok(used.slice(0, switched).every((a) => a === bearer(A)) && used.slice(switched).every((a) => a === bearer(B)), "from the first request after it ran out, the new token -- never the old one again");
  assert.equal(b.asked.length, 2);
});

// ---- a refusal -----------------------------------------------------------------------------------------------------

test("a 401 forgets the token and asks again ONCE; the new token is used, and the run goes on", async () => {
  const b = broker([A, B]);
  const net = gated(fakeAdo(), { takes: (a) => a === bearer(B) });
  const got = await collecting(net, b.request());
  assert.equal(got.completeness.workItems.status, "complete");
  assert.deepEqual(net.calls.filter((c) => c.url.includes("/_apis/projects/")).map((c) => c.authorization), [bearer(A), bearer(B)], "the same request, again, with the fresh token");
  assert.ok(net.calls.slice(2).every((c) => c.authorization === bearer(B)));
  assert.equal(b.asked.length, 2);
});

test("a token the source refuses even when it is a fresh one stops the run with AUTH_REJECTED -- after one retry, and never a loop", async () => {
  const b = broker([A, B, C]);
  const net = gated(fakeAdo(), { takes: () => false });
  const stop = await collecting(net, b.request()).catch((e) => e);
  assert.ok(stop instanceof AuthBlocked && stop instanceof Blocked, "a BLOCKED answer: the product is not wrong, nobody got in");
  assert.deepEqual([stop.code, net.calls.length, b.asked.length], ["AUTH_REJECTED", 2, 2], "the request, one retry with the fresh token, and nothing more: the third token was never asked for");
  assert.match(stop.message, /the sign-in was refused: the source did not accept it \(HTTP 401\)/);
  assert.match(stop.next, /sign in again/);
  for (const t of [A, B, C]) assert.equal(`${stop.message} ${stop.next}`.includes(t), false, "no message holds a token");
});

test("a sign-in page where data should be is a refusal too, told as the status it came with", async () => {
  const b = broker([A, B]);
  const net = gated(fakeAdo(), { takes: () => false, refusal: () => page(203) });
  const stop = await collecting(net, b.request()).catch((e) => e);
  assert.deepEqual([stop.code, net.calls.length, b.asked.length], ["AUTH_REJECTED", 2, 2]);
  assert.match(stop.message, /\(HTTP 203\)/);
});

test("the same token again is the same answer: a credential the source refuses is not retried unless a person replaced it, and then it is", async () => {
  const read = { n: 0 };
  const auth = createAuth({ secrets: { read: async () => (read.n += 1, PAT) }, adapters: {}, providers: PROVIDERS, nowMs: () => 0 });
  const stale = gated(fakeAdo(), { takes: () => false });
  const stop = await collecting(stale, auth.resolve(WITH_PAT), { connection: WITH_PAT }).catch((e) => e);
  assert.deepEqual([stop.code, stale.calls.length, read.n], ["AUTH_REJECTED", 1, 2], "read again to see whether it changed -- and it had not, so nothing was asked twice");
  assert.match(stop.message, /the credential was refused/);
  const rotated = { n: 0 };
  const replaced = createAuth({ secrets: { read: async () => (rotated.n += 1, rotated.n === 1 ? PAT : `${PAT}x`) }, adapters: {}, providers: PROVIDERS, nowMs: () => 0 });
  const fresh = gated(fakeAdo(), { takes: (a) => a === basic(`${PAT}x`) });
  const got = await collecting(fresh, replaced.resolve(WITH_PAT), { connection: WITH_PAT });
  assert.equal(got.completeness.workItems.status, "complete", "a credential a person replaced while the run went on is picked up");
});

test("a 403 says the account is known and may not read this: AUTH_FORBIDDEN, and nothing is asked for again", async () => {
  const b = broker([A, B]);
  const net = gated(fakeAdo(), { takes: () => false, refusal: () => reply(403, { message: "TF401027: you need a permission" }) });
  const stop = await collecting(net, b.request()).catch((e) => e);
  assert.ok(stop instanceof AuthBlocked);
  assert.deepEqual([stop.code, net.calls.length, b.asked.length], ["AUTH_FORBIDDEN", 1, 1], "a new token would not change who the account is");
  assert.match(stop.message, /project portal could not be read in acme/);
  assert.match(stop.next, /another account/);
});

test("what an account may not read in ONE area is that collection's status, with the permission named -- the report still stands", async () => {
  const b = broker([A]);
  const got = await collecting(gated(fakeAdo({ fail: { "/_apis/build/builds": { status: 403, body: { message: "TF401444: denied" } } } })), b.request());
  assert.equal(got.completeness.builds.status, "forbidden");
  assert.equal(got.completeness.workItems.status, "complete");
  assert.equal(b.asked.length, 1);
});

test("a person's test never starts a sign-in, and a refusal of who is asking is an answer of the test, in words and with its next step", async () => {
  const c = chain();
  const m = createConnections({ store: connectionStore(stateRooms("/base"), fakeIo()), secrets: secretSource({ env: {} }), providers: PROVIDERS, auth: c.auth, now: () => "2026-10-29T00:00:00Z" });
  m.create({ id: "ado-acme", provider: "azure-devops", organization: "acme" });
  const asking = (net) => (rec, auth) => azureDevOpsSource(noWait).probe({ connection: rec, scope: { project: "portal" }, auth, fetch: net.fetch, nowMs: () => REPORT_NOW });
  const before = await m.test("ado-acme", asking(gated(fakeAdo())));
  assert.deepEqual([before.ok, before.checks[0].id, before.checks[0].status], [false, "authentication", "missing"]);
  assert.match(before.checks[0].message, /no one has signed in to Microsoft for Orbit on this machine -- sign in ado-acme/);
  assert.equal(c.ops().includes("login"), false, "asking whether it works is not a reason to sign in");
  await m.signIn("ado-acme", { notify: () => {} });
  const refused = await m.test("ado-acme", asking(gated(fakeAdo(), { takes: () => false })));
  assert.deepEqual([refused.ok, refused.checks[0].status], [false, "unauthorized"]);
  assert.match(refused.checks[0].message, /the sign-in was refused: the source did not accept it \(HTTP 401\) -- sign in again/);
  const ok = await m.test("ado-acme", asking(gated(fakeAdo())));
  assert.deepEqual([ok.ok, ok.checks[0].status, ok.identity], [true, "ok", "Lan Nguyen"]);
});

// ---- read-only by construction -------------------------------------------------------------------------------------

test("the table says what may be asked, by what each request means: reads, and two POSTs that only ask", () => {
  assert.deepEqual(OPERATIONS.map((o) => [o.id, o.method, o.kind]), [["wiql", "POST", "query"], ["workitemsbatch", "POST", "query"], ["read", "GET", "read"]]);
  assert.ok(OPERATIONS.every((o) => ["read", "query"].includes(o.kind) && typeof o.doc === "string"));
  assert.equal(operationOf("post", "/acme/portal/_apis/wit/wiql")?.kind, "query");
  assert.equal(operationOf("POST", "/acme/_apis/wit/workitems/$Task"), null, "creating a work item is a POST too, and is no query");
});

test("the integration cannot write: a PUT, a PATCH, a DELETE or any other POST is refused before a header is built or a byte leaves", async () => {
  const sent = [];
  const http = { origin: "https://dev.azure.com", request: async (url, opts = {}) => (sent.push(`${opts.method ?? "GET"} ${new URL(url).pathname}`), { status: 200 }) };
  const guarded = readOnly(http);
  for (const [method, path] of [[undefined, "/acme/_apis/connectionData"], ["GET", "/acme/_apis/projects/portal"], ["POST", "/acme/portal/_apis/wit/wiql"], ["post", "/acme/_apis/wit/workitemsbatch"]]) await guarded.request(`${BASE.replace("/acme", "")}${path}?api-version=7.1`, method ? { method } : {});
  assert.equal(sent.length, 4, "the reads and the two queries go through");
  const writes = [["PUT", "/acme/portal/_apis/wit/workitems/9"], ["PATCH", "/acme/_apis/wit/workitems/9"], ["DELETE", "/acme/_apis/wit/workitems/9"], ["POST", "/acme/portal/_apis/wit/workitems/$Task"], ["POST", "/acme/portal/_apis/wit/workItems/9/comments"], ["POST", "/acme/portal/_apis/git/repositories/r1/pullrequests"], ["POST", "/acme/portal/_apis/build/builds"], ["patch", "/acme/_apis/wit/workitemsbatch"], ["GET", "/acme/portal/_git/web"]];
  for (const [method, path] of writes) await assert.rejects(guarded.request(`https://dev.azure.com${path}`, { method, body: { op: "add" } }), (e) => e instanceof Refused && /never changes it/.test(e.message), `${method} ${path}`);
  assert.equal(sent.length, 4, "not one refused request reached the client");
});

test("the client every reader gets refuses a write before it asks for authorization, and a whole collection and a whole read use nothing else", async () => {
  const b = broker([A]);
  const net = gated(fakeAdo({ items: [{ id: 1, type: "User Story", createdAt: "2026-07-01T02:00:00Z", revisions: [{ at: "2026-07-01T02:00:00Z", state: "New" }] }], repos: [{ id: "r1", name: "web", prs: [] }] }));
  const client = clientOf({ fetch: net.fetch, origin: BASE, auth: b.request(), headers: {}, sleep: async () => {}, nowMs: () => NOW });
  await assert.rejects(client.request(`${BASE}/portal/_apis/wit/workitems/1?api-version=7.1`, { method: "PATCH", body: [{ op: "add", path: "/fields/System.Title", value: "x" }] }), Refused);
  assert.deepEqual([net.calls.length, b.asked.length], [0, 0], "no request, and no token was even asked for");
  await collecting(net, b.request());
  assert.ok(net.calls.length > 8);
  const writes = net.calls.filter((c) => !(c.method === "GET" || (c.method === "POST" && /\/_apis\/wit\/(wiql|workitemsbatch)$/.test(c.url))));
  assert.deepEqual(writes, [], "every request a collection made is a read, or one of the two queries");
  assert.ok(net.calls.some((c) => c.method === "POST"), "and the queries were made");
});

// ---- the requirement reader ----------------------------------------------------------------------------------------

const IDENTITY = { provider: "azure-devops", organization: "acme", project: "Web Shop", id: "4312" };
const ITEM = { id: 4312, rev: 7, fields: { "System.Title": "Refund limit", "System.WorkItemType": "Product Backlog Item", "System.State": "Active", "System.ChangedDate": "2026-09-29T10:00:00Z", "System.TeamProject": "Web Shop" }, relations: [] };
const itemServer = (options) => gated({ fetch: async (url) => (/workitems\/4312/.test(url) ? reply(200, ITEM) : reply(404, {})) }, options);

function readerOver(auth, net) {
  const connections = createConnections({ store: connectionStore(stateRooms("/base"), fakeIo()), secrets: secretSource({ env: {} }), providers: PROVIDERS, now: () => "2026-10-29T00:00:00Z" });
  connections.create({ id: "ado-acme", provider: "azure-devops", host: "https://dev.azure.com", organization: "acme" });
  const reader = packReaders({ connections, auth, fetch: net.fetch, nowMs: () => NOW, sleep: async () => {}, limits: { retries: 0 } }).find((r) => r.key.endsWith("/azure-devops"));
  return { connections, reader };
}

test("the requirement reader of a connection that signs in sends the Bearer token, asks for it once however many reads, and only reads", async () => {
  const c = chain();
  const net = itemServer();
  const { reader } = readerOver(c.auth, net);
  const got = await Promise.all(Array.from({ length: 12 }, () => reader.read(IDENTITY, "workitem.read")));
  assert.ok(got.every((item) => item.title === "Refund limit"));
  assert.deepEqual([c.count("login"), c.count("account get-access-token")], [1, 1], "a dozen reads at once: one sign-in and one token request, not a dozen of either");
  assert.equal(new Set(net.calls.map((x) => x.authorization)).size, 1);
  assert.match(net.calls[0].authorization, /^Bearer tok\.orbit-B\./);
  assert.ok(net.calls.every((x) => x.method === "GET"));
  await reader.read(IDENTITY, "workitem.read");
  assert.deepEqual([c.count("login"), c.count("account get-access-token")], [1, 1], "and a later read of the same connection asks for nothing: the token is kept until it nearly ends");
});

test("the requirement reader refreshes once on a 401, and a refusal is BLOCKED with a code and a next step -- a 403 is AUTH_FORBIDDEN", async () => {
  const b = broker([A, B]);
  const fresh = itemServer({ takes: (a) => a === bearer(B) });
  const item = await readerOver(b.auth, fresh).reader.read(IDENTITY, "workitem.read");
  assert.equal(item.title, "Refund limit");
  assert.deepEqual(fresh.calls.map((x) => x.authorization), [bearer(A), bearer(B)]);
  const refusing = (status) => readerOver(broker([A, B]).auth, itemServer({ takes: () => false, refusal: () => reply(status) })).reader.read(IDENTITY, "workitem.read").catch((e) => e);
  const [rejected, forbidden] = [await refusing(401), await refusing(403)];
  assert.deepEqual([rejected.code, forbidden.code], ["AUTH_REJECTED", "AUTH_FORBIDDEN"]);
  assert.ok(rejected instanceof Blocked && forbidden instanceof Blocked);
  assert.match(forbidden.next, /another account/);
});

test("a connection that signs in is configured without a credential, and listing it starts nothing: no process, no secret, no network", async () => {
  const c = chain();
  const { connections } = readerOver(c.auth, itemServer());
  const reads = [];
  const spied = { ...connections, record: (id) => (reads.push(id), connections.record(id)) };
  const [github, ado] = readerResources(spied);
  assert.deepEqual([github.state, ado.state, ado.eligible], ["needs-attention", "ready", true], "a sign-in needs nothing until it is used");
  assert.deepEqual([connections.list()[0].credential, connections.list()[0].configured], [{ set: false, from: null }, true]);
  assert.deepEqual([reads, c.az.state.calls], [[], []], "no credential was read and no program was started to say so");
});

test("a connection that signs in hands a capability's child nothing but what a child needs to start -- no token, no PAT variable -- and one that reads a credential hands it as before", async () => {
  const secrets = secretSource({ env: { ADO_TOKEN_REF: PAT } });
  const reads = [];
  const spy = { ...secrets, read: async (ref) => (reads.push(ref), secrets.read(ref)) };
  const connections = createConnections({ store: connectionStore(stateRooms("/base"), fakeIo()), secrets: spy, providers: PROVIDERS, now: () => "2026-10-29T00:00:00Z" });
  connections.create({ id: "ado-signed-in", provider: "azure-devops", organization: "acme" });
  const env = { PATH: "/usr/bin", HOME: "/home/x", SECRET_ELSEWHERE: "no" };
  const signedIn = await connectionEnvFor({ providerId: "azure-devops", organization: "acme", connections, secrets: spy, env });
  assert.deepEqual(signedIn.connectionEnv("azure-devops"), { PATH: "/usr/bin", HOME: "/home/x" });
  assert.deepEqual(reads, [], "nothing was read");
  connections.update("ado-signed-in", { auth: { strategy: "credential" } });
  await connections.setCredential("ado-signed-in", { env: "ADO_TOKEN_REF" });
  const withToken = await connectionEnvFor({ providerId: "azure-devops", organization: "acme", connections, secrets: spy, env });
  assert.deepEqual(withToken.connectionEnv("azure-devops"), { PATH: "/usr/bin", HOME: "/home/x", AZURE_DEVOPS_EXT_PAT: PAT });
  assert.deepEqual(reads, ["ADO_TOKEN_REF"]);
});

// ---- a canary --------------------------------------------------------------------------------------------------------

const CANARY = "canary-7f3a9c";
const spellings = (value) => [value, Buffer.from(value).toString("base64"), Buffer.from(`:${value}`).toString("base64"), encodeURIComponent(value)];
const everyFile = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? everyFile(join(dir, n)) : [join(dir, n)]));

// A source that ECHOES what it was given -- the defect the leak scan exists for -- in the two places data leaves it: who is
// asking, and the title of a work item.
function echoing(fake) {
  const fetch = async (url, init = {}) => {
    const answer = await fake.fetch(url, init);
    const given = init.headers?.authorization ?? "";
    if (/connectionData$/.test(new URL(url).pathname)) return reply(200, { authenticatedUser: { providerDisplayName: given } });
    return /workitemsbatch$/.test(new URL(url).pathname) ? { ...answer, json: async () => ({ value: (await answer.json()).value.map((w) => ({ ...w, fields: { ...w.fields, "System.Title": `oops ${given}` } })) }) } : answer;
  };
  return { fetch };
}

const STORY = { id: 1, type: "User Story", createdAt: "2026-07-01T02:00:00Z", revisions: [{ at: "2026-07-01T02:00:00Z", state: "New" }, { at: "2026-07-20T02:00:00Z", state: "Active" }] };
const RECORD = { id: "ado-acme", provider: "azure-devops", host: "https://dev.azure.com", organization: "acme", auth: { strategy: "azure-cli" } };

function collectOver(t, fetch) {
  const base = tempBase(t);
  const rctx = rctxOf(base, null, { connection: RECORD, settings: { provider: "azure-devops", connection: "ado-acme", scope: { project: "portal" } } });
  const c = chain({ people: [{ name: CANARY, tenant: "tenant-b" }] });
  const ctx = { ...rctx, root: base, runId: "20260925T030000Z-0001", window: WINDOW, parts: [], facts: {}, entryOf: () => null };
  const deps = { sources: { "azure-devops": azureDevOpsSource(noWait) }, auth: c.auth, interactive: "when-required", notify: () => {}, fetch, nowMs: () => REPORT_NOW, log: () => {} };
  return { base, rctx, ctx, deps, chain: c };
}

test("a CANARY token is in no snapshot and no raw page: a source that echoes it freezes NOTHING, and one that does not leaves it in no file, in any spelling", async (t) => {
  const echo = collectOver(t, echoing(fakeAdo({ items: [STORY] })).fetch);
  const leaked = await collect(echo.ctx, echo.deps);
  assert.match(JSON.stringify(leaked.snapshot), /oops Bearer tok\.canary-7f3a9c\./, "the echo did reach the data");
  assert.ok(leaked.secrets.length >= 1 && leaked.secrets.every((s) => s.includes(CANARY)), "and every token that was issued is known to the scan");
  const refused = () => freeze({ room: echo.rctx.room, io: echo.rctx.io, id: echo.ctx.runId, snapshot: leaked.snapshot, raw: leaked.raw, secrets: leaked.secrets });
  assert.throws(refused, (e) => e instanceof Blocked && /carried the credential/.test(e.message));
  assert.equal(existsSync(join(echo.base, "store")) && everyFile(join(echo.base, "store")).some((f) => f.endsWith("snapshot.json")), false, "no snapshot was written");
  const honest = collectOver(t, gated(fakeAdo({ items: [STORY], repos: [{ id: "r1", name: "web", prs: [] }] })).fetch);
  const got = await collect(honest.ctx, honest.deps);
  freeze({ room: honest.rctx.room, io: honest.rctx.io, id: honest.ctx.runId, snapshot: got.snapshot, raw: got.raw, secrets: got.secrets });
  const files = everyFile(honest.base);
  assert.ok(files.some((f) => f.includes(join("snapshot", "raw"))) && got.secrets.length >= 1, "the snapshot and its raw pages were kept");
  for (const f of files) for (const s of [CANARY, ...got.secrets.flatMap(spellings)]) assert.equal(readFileSync(f, "latin1").includes(s), false, `${f} holds the token`);
});

test("a CANARY token is in no message, whatever the source did and however the tool failed", async () => {
  const messages = [];
  const failing = (fake, takes, refusal) => async () => {
    const c = chain({ people: [{ name: CANARY, tenant: "t" }] });
    const net = gated(fake, { takes, refusal });
    const stop = await collecting(net, c.auth.resolve(SIGNED_IN, { notify: () => {} })).catch((e) => e);
    messages.push([stop.message, stop.next, stop.code, JSON.stringify(stop), String(stop.stack)].join(" "));
  };
  await failing(fakeAdo(), () => false, () => reply(401))();
  await failing(fakeAdo(), () => false, () => reply(403, { message: `denied ${CANARY}` }))();
  await failing(fakeAdo(), () => false, () => reply(500, { message: `boom ${CANARY}` }))();
  await failing(fakeAdo(), () => false, () => page(203))();
  await failing({ fetch: async (url, init) => { throw new Error(`socket hang up while sending ${init.headers.authorization}`); } }, () => true)();
  const cancelled = chain({ people: [] });
  const stop = await collecting(gated(fakeAdo()), cancelled.auth.resolve(SIGNED_IN, { notify: () => {} })).catch((e) => e);
  messages.push([stop.message, stop.next, stop.code].join(" "));
  assert.equal(messages.length, 6);
  for (const m of messages) for (const s of [CANARY, "tok.", "Bearer ", "Basic "]) assert.equal(m.includes(s), false, `a message holds ${s}: ${m.slice(0, 200)}`);
});

test("a CANARY token is in no connections.json and no answer about a connection, even when the source echoes it into the test", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ado-auth-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = chain({ people: [{ name: CANARY, tenant: "tenant-b" }] });
  const store = connectionStore(stateRooms(dir), realIo());
  const m = createConnections({ store, secrets: secretSource({ env: {} }), providers: PROVIDERS, auth: c.auth, now: () => "2026-10-29T00:00:00Z" });
  m.create({ id: "ado-acme", provider: "azure-devops", organization: "acme" });
  await m.signIn("ado-acme", { notify: () => {} });
  const net = echoing(fakeAdo({ items: [STORY] }));
  const kept = await m.test("ado-acme", (rec, auth) => azureDevOpsSource(noWait).probe({ connection: rec, scope: { project: "portal" }, auth, fetch: net.fetch, nowMs: () => REPORT_NOW }));
  assert.equal(kept.ok, true);
  assert.match(kept.checks[0].message, /signed in as Bearer \[redacted\]/, "the source echoed the token as the name of whoever asked, and it was masked before it was kept");
  const seen = [readFileSync(store.file, "utf8"), JSON.stringify(m.list()), JSON.stringify(m.get("ado-acme")), JSON.stringify(kept)];
  assert.ok(c.az.state.issued.length >= 1, "a token was issued");
  for (const text of seen) for (const s of [CANARY, ...c.az.state.issued.flatMap(spellings)]) assert.equal(text.includes(s), false, "a record or an answer holds the token");
  assert.deepEqual(m.get("ado-acme").auth, { strategy: "azure-cli" }, "the record says how it signs in, and nothing else of it");
});

// ---- who may be disturbed ------------------------------------------------------------------------------------------

test("what a run may ask of a person who must sign in is its root's to say: `never` starts nothing and names the way, and a sign-in's prompt reaches `notify`", async (t) => {
  const quiet = collectOver(t, gated(fakeAdo()).fetch);
  const stop = await collect(quiet.ctx, { ...quiet.deps, interactive: "never" }).catch((e) => e);
  assert.deepEqual([stop.code, quiet.chain.ops().length], ["AUTH_LOGIN_REQUIRED", 0], "nothing was started: nobody has signed in, and that is known from a profile that is not there");
  assert.match(stop.next, /sign in ado-acme/, "and the one thing to do is named");
  const byCtx = collectOver(t, gated(fakeAdo()).fetch);
  const again = await collect({ ...byCtx.ctx, interactive: "never" }, { ...byCtx.deps, interactive: undefined }).catch((e) => e);
  assert.equal(again.code, "AUTH_LOGIN_REQUIRED", "the root may say so on its ctx as well as on its deps");
  const shown = [];
  const loud = collectOver(t, gated(fakeAdo()).fetch);
  await collect(loud.ctx, { ...loud.deps, notify: (line) => shown.push(line) });
  assert.equal(loud.chain.count("login"), 1);
  assert.match(shown.join(" "), /Opening Microsoft sign-in/, "the person is shown what is happening, in words the engine wrote");
  assert.match(shown.join(" "), /A web browser has been opened/, "and what the tool itself said");
});
