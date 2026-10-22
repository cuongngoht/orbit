// A PAGE run's browser inside an isolated worker (doc §15.1): a blank session of its own, opened before the case and
// closed after it, and ONE route the engine writes over every request the page makes -- a write goes through only under
// a grant this run was minted, the approved identity's credential goes only to the bound origin and never rides a
// redirect, and the credential is never in an argument, in a file the host reads back, or in what a failure says.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Blocked, Refused } from "../src/errors.mjs";
import { PAGE_BROWSER, closedPage, openedPage, pageRoute, pageSpendRecords, pageSpendsOf, pageWritesOf } from "../src/run/worker.mjs";

const ORIGIN = "http://invoice-a:8080";
const TOKEN = "eyJ.issued-inside-the-worker.sig";
const IDENTITY = { ok: true, value: { alias: "tenant-a-reader", principal: "reader-a", tenant: "tenant-a", header: "Authorization", scheme: "Bearer", env: "ORBIT_BIND_IDENTITY" }, env: { ORBIT_BIND_IDENTITY: TOKEN } };
const RUN = "exe-0123456789abcdef-1";
const NOW = Date.now();
const GRANT = { id: "grt-0000000000000001", run: RUN, principal: "tenant-a-reader", expiresAtMs: NOW + 60_000, capability: { id: "orbit.page.request" }, operation: { class: "write", selectors: { method: "POST", match: "/api/invoices$" } }, input: { digest: "d".repeat(64) }, bounds: { maxUses: 1 } };

function world({ origin = ORIGIN, bound = IDENTITY, fails = null } = {}) {
  const calls = [];
  const files = new Map();
  const scratch = new Map();
  const removed = [];
  const cli = (args) => (fails?.(args) ? (() => { throw new Error(`Command failed: playwright-cli ${args.join(" ")} ${[...scratch.values()].join("")}`); })() : calls.push(args));
  const ctx = { config: { origin }, browser: { dir: () => "/work/out/store/runtime/run", cli }, binder: { resolve: (kind, ref) => (kind === "identity" && ref === "tenant-a-reader" ? bound : { ok: false, why: "not sealed" }) } };
  const io = { now: () => NOW, write: (file, text) => files.set(file, text), scratch: (text) => ((file) => (scratch.set(file, text), file))(`/tmp/orbit-page-${scratch.size}.js`), remove: (file) => removed.push(file) };
  return { ctx, calls, files, scratch, removed, io };
}

const request = (page, grants = [GRANT]) => ({ runId: RUN, grants, page: { origin: ORIGIN, identityRef: "tenant-a-reader", ...page } });

// The engine's script, run the way the CLI runs it: handed a page whose context records the one route it installs.
async function installed(script) {
  const routes = [];
  const sockets = [];
  const context = { route: async (pattern, handler) => routes.push({ pattern, handler }), routeWebSocket: async (pattern, handler) => sockets.push({ pattern, handler }) };
  const page = { context: () => context };
  assert.equal(await (0, eval)(`(${script})`)(page), "ok");
  return Object.assign(routes, { sockets, context });
}

async function decided(handler, method, url) {
  const seen = { action: null };
  const route = { request: () => ({ method: () => method, url: () => url, headers: () => ({ accept: "*/*" }) }), abort: async () => (seen.action = "abort"), continue: async () => (seen.action = "continue"), fetch: async (o) => ((seen.fetched = o), { status: 200 }), fulfill: async () => (seen.action = seen.action ?? "fulfill") };
  await handler(route);
  return seen;
}

test("a blank browser of its own is opened, and the route reaches the CLI as a scratch file -- never an argument, never a file the host reads back", () => {
  const w = world();
  openedPage(w.ctx, request(), w.io);
  assert.deepEqual(JSON.parse(w.files.get("/work/out/store/runtime/run/.playwright/cli.config.json")), PAGE_BROWSER, "headless, a profile of its own, nothing copied in");
  assert.equal([...w.files.values()].join().includes(TOKEN), false, "the run directory is in the scratch store the host reads back");
  assert.deepEqual(w.calls, [["open", "about:blank"], ["run-code", "--filename=/tmp/orbit-page-0.js"]]);
  assert.equal(w.calls.flat().join(" ").includes(TOKEN), false, "no process listing shows the credential");
  assert.deepEqual(w.removed, ["/tmp/orbit-page-0.js"], "the scratch file is gone as soon as the browser has loaded it");
});

test("the route: a credential only on the bound origin's requests, a redirect never followed with it, another host never given it", async () => {
  const [route] = await installed(pageRoute(ORIGIN, { authorization: `Bearer ${TOKEN}` }, pageWritesOf(request(), NOW)));
  assert.equal(route.pattern, "**/*", "every request the page makes is decided here");
  const own = await decided(route.handler, "GET", `${ORIGIN}/invoices`);
  assert.deepEqual([own.action, own.fetched.maxRedirects, own.fetched.headers.authorization], ["fulfill", 0, `Bearer ${TOKEN}`]);
  assert.equal((await decided(route.handler, "GET", "http://broker:15672/")).action, "continue", "another host on the task's network is asked without it");
  assert.equal((await decided(route.handler, "GET", "http://invoice-a:8080.elsewhere/x")).action, "continue", "a host that only begins like the origin is another host");
});

test("the route: a write goes through only under a grant this run was minted, for its method and path, as many times as it allows", async () => {
  const routes = await installed(pageRoute(ORIGIN, {}, pageWritesOf(request(), NOW)));
  const [route] = routes;
  assert.equal((await decided(route.handler, "POST", `${ORIGIN}/api/invoices`)).action, "fulfill");
  assert.deepEqual(routes.context.__orbitPageSpends, [{ grant: GRANT.id, method: "POST" }], "the spend is kept where the worker reads it back");
  assert.equal((await decided(route.handler, "POST", `${ORIGIN}/api/invoices`)).action, "abort", "a grant used once is spent");
  assert.equal((await decided(route.handler, "DELETE", `${ORIGIN}/api/invoices/inv-a`)).action, "abort", "a write no grant covers");
  assert.equal((await decided(route.handler, "POST", "http://broker:15672/api/queues")).action, "abort", "a write to another host, whatever its path");
  assert.equal((await decided(route.handler, "OPTIONS", `${ORIGIN}/api/invoices`)).action, "fulfill", "a read is not a write");
  assert.deepEqual(pageWritesOf(request({}, [GRANT, { ...GRANT, capability: { id: "orbit.state.read" } }]), NOW), [{ grant: GRANT.id, method: "POST", match: "/api/invoices$", uses: 1, until: GRANT.expiresAtMs }], "only the page's own grants");
});

test("a page is offered only the grants the ledger would honour: this run's, unexpired, for the identity it acts as", () => {
  const offered = (grant, page = {}) => pageWritesOf(request(page, [grant]), NOW).length;
  assert.equal(offered(GRANT), 1);
  assert.equal(offered({ ...GRANT, run: "exe-another-run-1" }), 0, "another run's");
  assert.equal(offered({ ...GRANT, expiresAtMs: NOW - 1 }), 0, "one that expired");
  assert.equal(offered(GRANT, { identityRef: "tenant-b-reader" }), 0, "one minted for another principal");
  assert.equal(offered({ ...GRANT, principal: null }, { identityRef: null }), 1, "a page that acts as nobody, a grant minted for nobody");
});

test("a websocket is refused outright, and a service worker never answers before the route", async () => {
  const routes = await installed(pageRoute(ORIGIN, {}, []));
  const closed = [];
  await routes.sockets[0].handler({ close: (o) => closed.push(o.code) });
  assert.deepEqual([routes.sockets[0].pattern, closed], ["**/*", [1008]]);
  assert.equal(PAGE_BROWSER.browser.contextOptions.serviceWorkers, "block");
});

test("what the page's writes spent is read back off the browser and recorded as the ledger records a call's spend", () => {
  const ctx = { browser: { cli: (args) => (args.includes("--raw") ? JSON.stringify(JSON.stringify([{ grant: GRANT.id, method: "POST" }])) : "") } };
  const spends = pageSpendsOf(ctx);
  assert.deepEqual(pageSpendRecords(spends, [GRANT]), [{ kind: "grant", grant: GRANT.id, capability: "orbit.page.request", operation: "write", use: 1, input_digest: GRANT.input.digest }]);
  assert.deepEqual(pageSpendsOf({ browser: { cli: () => "ERROR: not open" } }), [], "nothing read is nothing spent");
});

test("a page with no identity is a browser that acts as nobody: nothing is issued, and its writes are still held to its grants", async () => {
  const w = world();
  openedPage(w.ctx, request({ identityRef: null }), w.io);
  const [route] = await installed(w.scratch.get("/tmp/orbit-page-0.js"));
  const asked = await decided(route.handler, "GET", `${ORIGIN}/invoices`);
  assert.equal(asked.fetched.headers.authorization, undefined);
});

test("an origin that is not the project's is refused, and an identity that cannot be bound or issued is BLOCKED -- never a browser acting as nobody", () => {
  assert.throws(() => openedPage(world({ origin: "http://elsewhere:8080" }).ctx, request(), world().io), (e) => e instanceof Refused);
  const unbound = world({ bound: { ok: false, why: "nothing named tenant-a-reader is bound" } });
  assert.throws(() => openedPage(unbound.ctx, request(), unbound.io), (e) => e instanceof Blocked && /could not be bound/.test(e.message));
  const unissued = world({ bound: { ...IDENTITY, env: {} } });
  assert.throws(() => openedPage(unissued.ctx, request(), unissued.io), (e) => e instanceof Blocked && /no credential was issued/.test(e.message));
});

test("a browser that fails while it is given its route says only that it failed, and the scratch file is removed all the same", () => {
  const w = world({ fails: (args) => args[0] === "run-code" });
  assert.throws(() => openedPage(w.ctx, request(), w.io), (e) => e instanceof Blocked && !e.message.includes(TOKEN) && /could not be given its route/.test(e.message));
  assert.deepEqual(w.removed, ["/tmp/orbit-page-0.js"]);
});

test("the browser is closed after the run, whatever the run came to", () => {
  const w = world();
  closedPage(w.ctx);
  assert.deepEqual(w.calls, [["close"]]);
});
