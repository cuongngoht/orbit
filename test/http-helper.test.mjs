// The HTTP helper behind orbit.http.read and orbit.http.write (doc §5.2; ADR 0036), against a
// loopback server this test owns: every response is an observation, the endpoint is the
// binding's, a credential echoed back never leaves the helper, a body past its bound is
// incomplete, a redirect leaves the bound origin never, and a write whose answer was lost is
// ambiguous. The last test runs the helper as the engine does -- a process, one line each way.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { HELPER_API } from "../src/capability/helper.mjs";
import { exchange } from "../skills/orbit-api-test/http/exchange.mjs";
import { MASK } from "../skills/orbit-api-test/http/response.mjs";
import { pathProblem } from "../skills/orbit-api-test/http/request.mjs";
import { schemaDigest } from "../skills/orbit-api-test/schema.mjs";
import capabilities from "../skills/orbit-api-test/capabilities.mjs";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = join(ROOT, "skills/orbit-api-test/http/helper.mjs");
const TOKENS = { "token-a": "tenant-a", "token-b": "tenant-b" };
const server = { origin: null, http: null, seen: [] };

const ROUTES = {
  "GET /invoices/inv-a": (req) => (TOKENS[bearer(req)] === "tenant-a" ? [200, { id: "inv-a", tenantId: "tenant-a", name: "canary-a" }] : [404, { error: "not_found" }]),
  "GET /api/invoices/inv-a": (req) => (TOKENS[bearer(req)] === "tenant-a" ? [200, { id: "inv-a", via: "/api" }] : [404, { error: "not_found" }]),
  "GET /echo": (req) => [200, { youSent: req.headers.authorization ?? null }],
  "GET /big": () => [200, "x".repeat(4096)],
  "GET /same": () => [302, null, { location: "/invoices/inv-a" }],
  "GET /away": () => [302, null, { location: "http://elsewhere.invalid/x" }],
  "GET /boom": () => [500, { error: "internal" }],
  "GET /echo-header": (req) => [401, { error: "denied" }, { "www-authenticate": `Bearer error="invalid_token", token="${bearer(req)}"` }],
  "GET /echo-escaped": (req) => [200, `{"t":"${[...bearer(req)].map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}"}`, { "content-type": "application/json" }],
  "GET /echo-hop": (req) => [302, null, { location: `/landing?t=${bearer(req)}` }],
  "GET /landing": () => [200, { landed: true }],
  "POST /invoices": (req) => [201, { created: true, key: req.headers["idempotency-key"] ?? null }],
  "POST /lost": (req) => (req.socket.destroy(), null),
};

const bearer = (req) => String(req.headers.authorization ?? "").replace(/^Bearer /, "");

before(async () => {
  server.http = createServer((req, res) => answer(req, res));
  await new Promise((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  server.origin = `http://127.0.0.1:${server.http.address().port}`;
});

after(() => server.http.close());

function answer(req, res) {
  server.seen.push({ method: req.method, url: req.url, headers: req.headers });
  const route = ROUTES[`${req.method} ${req.url.split("?")[0]}`];
  const out = route ? route(req) : [404, { error: "no route" }];
  if (!out) return;
  const [status, body, headers = {}] = out;
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", "set-cookie": "sid=secret", ...headers });
  res.end(body === null ? "" : typeof body === "string" ? body : JSON.stringify(body));
}

const asked = (request, over = {}) => ({
  v: HELPER_API,
  op: over.op ?? "read",
  request: { method: "GET", ...request },
  bound: { endpointRef: { alias: "backend", origin: server.origin }, identityRef: { alias: "tenant-a-reader", header: "authorization", scheme: "Bearer", env: "ORBIT_IDENTITY_TOKEN" }, ...(over.bound ?? {}) },
  limits: over.limits ?? {},
  deadlineMs: over.deadlineMs ?? 5000,
});

const env = (token = "token-a") => ({ ORBIT_IDENTITY_TOKEN: token });
const deps = (token) => ({ fetch, now: () => performance.now(), env: env(token) });

test("the owner reads its own invoice and another tenant is told not_found -- both are observations", async () => {
  const mine = await exchange(asked({ path: "/invoices/inv-a" }), deps("token-a"));
  assert.equal(mine.value.status, 200);
  assert.deepEqual(mine.value.body, { id: "inv-a", tenantId: "tenant-a", name: "canary-a" });
  assert.equal(mine.value.identity, "tenant-a-reader");
  const theirs = await exchange(asked({ path: "/invoices/inv-a" }), deps("token-b"));
  assert.equal(theirs.value.status, 404);
  assert.equal(JSON.stringify(theirs.value.body).includes("canary-a"), false);
  const boom = await exchange(asked({ path: "/boom" }), deps());
  assert.equal(boom.value.status, 500, "a 500 is what the product answered, not a helper failure");
});

test("a path is relative to the BOUND endpoint: an endpoint bound with a base path keeps it, and the path never climbs out of it", async () => {
  const based = await exchange(asked({ path: "/invoices/inv-a" }, { bound: { endpointRef: { alias: "backend", origin: `${server.origin}/api` } } }), deps("token-a"));
  assert.deepEqual([based.value.status, based.value.body], [200, { id: "inv-a", via: "/api" }]);
  assert.equal(server.seen.at(-1).url, "/api/invoices/inv-a");
  const slashed = await exchange(asked({ path: "/invoices/inv-a" }, { bound: { endpointRef: { alias: "backend", origin: `${server.origin}/api/` } } }), deps("token-a"));
  assert.equal(server.seen.at(-1).url, "/api/invoices/inv-a", "one slash between them, whichever side brought it");
  assert.equal(slashed.value.status, 200);
  assert.match(String(pathProblem("/../../etc/passwd")), /./, "a path that climbs is refused before it is joined to anything");
});

test("headers are an allow-list both ways, and a credential the product echoes never leaves the helper", async () => {
  const r = await exchange(asked({ path: "/echo" }), deps("token-a"));
  assert.equal(r.value.echoedCredential, true);
  assert.equal(JSON.stringify(r.value).includes("token-a"), false);
  assert.match(r.value.body.youSent, new RegExp(MASK.replace(/[[\]]/g, "\\$&")));
  assert.equal("set-cookie" in r.value.headers, false, "a response header nobody declared is not kept");
  assert.ok(r.value.receipt.requestDigest && r.value.receipt.responseDigest);
});

test("an echoed credential is masked in a header, in a JSON escape the raw text hid, and in a redirect hop", async () => {
  const header = await exchange(asked({ path: "/echo-header" }), deps("token-a"));
  assert.equal(header.value.echoedCredential, true);
  assert.equal(JSON.stringify(header.value).includes("token-a"), false);
  const escaped = await exchange(asked({ path: "/echo-escaped" }), deps("token-a"));
  assert.equal(escaped.value.echoedCredential, true, "JSON.parse decodes what the raw text hid -- masked after parsing too");
  assert.equal(JSON.stringify(escaped.value).includes("token-a"), false);
  const hop = await exchange(asked({ path: "/echo-hop", redirects: 1 }), deps("token-a"));
  assert.equal(hop.value.echoedCredential, true);
  assert.equal(JSON.stringify(hop.value).includes("token-a"), false);
});

test("a case cannot route, name a host or carry an identity of its own", async () => {
  for (const [request, re] of [
    [{ path: "/x", headers: { authorization: "Bearer mine" } }, /authorization are never sent from a case/],
    [{ path: "/x", headers: { host: "elsewhere" } }, /host are never sent/],
    [{ path: "/x", headers: { "x-forwarded-host": "elsewhere" } }, /x-forwarded-host are never sent/],
    [{ path: "//elsewhere.invalid/x" }, /would name another host/],
    [{ path: "/a/../../etc" }, /never climbs/],
    [{ path: "http://elsewhere.invalid/x" }, /starts with \//],
    [{ path: "/x", body: { a: 1 } }, /GET carries no body/],
  ]) {
    const r = await exchange(asked(request), deps());
    assert.equal(r.failure?.class, "refused", JSON.stringify(request));
    assert.match(r.failure.message, re);
  }
  assert.equal((await exchange(asked({ path: "/x" }, { bound: { endpointRef: undefined } }), deps())).failure.class, "refused");
  assert.match((await exchange(asked({ path: "/x" }), { ...deps(), env: {} })).failure.message, /has no credential in this helper's environment/);
});

test("a body past its bound is incomplete -- nothing is concluded from part of an answer", async () => {
  const r = await exchange(asked({ path: "/big" }, { limits: { bodyBytes: 1024 } }), deps());
  assert.equal(r.failure.class, "incomplete");
});

test("redirects: none by default, followed inside the bound origin when asked, never to another", async () => {
  const none = await exchange(asked({ path: "/same" }), deps());
  assert.equal(none.value.status, 302);
  const followed = await exchange(asked({ path: "/same", redirects: 1 }), deps());
  assert.equal(followed.value.status, 200);
  assert.deepEqual(followed.value.hops, [{ status: 302, to: "/invoices/inv-a" }]);
  const away = await exchange(asked({ path: "/away", redirects: 2 }), deps());
  assert.equal(away.value.status, 302);
  assert.deepEqual(away.value.hops, [{ status: 302, refused: "another origin" }]);
});

test("nothing reached is transport; a write whose answer was lost is ambiguous, with its operation key", async () => {
  const unreachable = await exchange(asked({ path: "/x" }, { bound: { endpointRef: { alias: "gone", origin: "http://127.0.0.1:1" } } }), deps());
  assert.equal(unreachable.failure.class, "transport");
  const lost = await exchange(asked({ method: "POST", path: "/lost", headers: { "idempotency-key": "k-1" }, body: { a: 1 } }, { op: "write" }), deps());
  assert.equal(lost.failure.class, "ambiguous");
  assert.equal(lost.failure.operationKey, "k-1");
  const made = await exchange(asked({ method: "POST", path: "/invoices", headers: { "idempotency-key": "k-2" }, body: { name: "x" } }, { op: "write" }), deps());
  assert.deepEqual(made.value.body, { created: true, key: "k-2" });
});

test("a pinned schema is held to: valid, invalid, moved, or outside what the validator supports", async () => {
  const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: ["id", "tenantId"], properties: { id: { type: "string" } } };
  const bound = (document, digest = schemaDigest(document)) => ({ schemaRef: { alias: "invoice", document, digest } });
  assert.equal((await exchange(asked({ path: "/invoices/inv-a" }, { bound: bound(schema) }), deps())).value.schema.valid, true);
  assert.equal((await exchange(asked({ path: "/invoices/inv-a" }, { bound: bound({ ...schema, required: ["missing"] }) }), deps())).value.schema.valid, false);
  assert.match((await exchange(asked({ path: "/invoices/inv-a" }, { bound: bound(schema, "0".repeat(64)) }), deps())).failure.message, /has moved since it was pinned/);
  const gap = await exchange(asked({ path: "/invoices/inv-a" }, { bound: bound({ ...schema, unevaluatedProperties: false }) }), deps());
  assert.equal(gap.failure.class, "incomplete");
  assert.equal(gap.failure.gap.capability, "json-schema");
});

test("the pack's capabilities register as the pack, pageless, with the meanings and effects they declare", () => {
  const reg = createCapabilityRegistry();
  for (const cap of capabilities) reg.register(cap, "pack:orbit-api-test");
  assert.deepEqual(reg.ids(), ["orbit.http.read", "orbit.http.write"]);
  assert.equal(reg.resolve("orbit.http.write").mutates, true);
  assert.equal(reg.resolve("orbit.http.read").page, false);
});

test("run as the engine runs it: a process, one request in, one answer line out, the credential only in its environment", async () => {
  const out = await helperRun(asked({ path: "/invoices/inv-a" }), env("token-a"));
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 1);
  const answer = JSON.parse(lines[0]);
  assert.equal(answer.v, HELPER_API);
  assert.equal(answer.ok, true);
  assert.equal(answer.value.status, 200);
  const wrongOp = JSON.parse((await helperRun(asked({ method: "DELETE", path: "/x" }), env())).trim());
  assert.equal(wrongOp.class, "refused");
});

function helperRun(request, childEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HELPER], { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => resolve(out));
    child.stdin.end(JSON.stringify(request));
  });
}
