// A PAGE run's browser inside an isolated worker (doc §15.1): a blank session of its own, opened before the case and
// closed after it; the identity the design approved carried as its credential header on the bound origin's requests
// alone; and the credential never in a file the host reads back, never in what a failure says.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Blocked, Refused } from "../src/errors.mjs";
import { PAGE_BROWSER, closedPage, openedPage } from "../src/run/worker.mjs";

const ORIGIN = "http://invoice-a:8080";
const TOKEN = "eyJ.issued-inside-the-worker.sig";
const IDENTITY = { ok: true, value: { alias: "tenant-a-reader", principal: "reader-a", tenant: "tenant-a", header: "Authorization", scheme: "Bearer", env: "ORBIT_BIND_IDENTITY" }, env: { ORBIT_BIND_IDENTITY: TOKEN } };

function world({ origin = ORIGIN, bound = IDENTITY, fails = null } = {}) {
  const calls = [];
  const files = new Map();
  const ctx = { config: { origin }, browser: { dir: () => "/work/out/store/runtime/run", cli: (args) => (fails?.(args) ? (() => { throw new Error(`Command failed: playwright-cli ${args.join(" ")}`); })() : calls.push(args)) }, binder: { resolve: (kind, ref) => (kind === "identity" && ref === "tenant-a-reader" ? bound : { ok: false, why: "not sealed" }) } };
  return { ctx, calls, files, write: (file, text) => files.set(file, text) };
}

const request = (page) => ({ runId: "exe-0123456789abcdef-1", page: { origin: ORIGIN, identityRef: "tenant-a-reader", ...page } });

test("a blank browser of its own is opened, and the identity's credential is routed onto the bound origin's requests alone", () => {
  const w = world();
  openedPage(w.ctx, request(), w.write);
  assert.deepEqual([...w.files.keys()], ["/work/out/store/runtime/run/.playwright/cli.config.json"]);
  assert.deepEqual(JSON.parse(w.files.get("/work/out/store/runtime/run/.playwright/cli.config.json")), PAGE_BROWSER, "headless, a profile of its own, nothing copied in");
  assert.equal([...w.files.values()].join().includes(TOKEN), false, "the credential is never in a file: the run directory is in the scratch store the host reads back");
  assert.deepEqual(w.calls[0], ["open", "about:blank"]);
  const [verb, script] = w.calls[1];
  assert.equal(verb, "run-code");
  assert.match(script, new RegExp(`route\\(${JSON.stringify(`${ORIGIN}/**`).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`), "only the bound origin's requests carry it");
  assert.match(script, /"authorization":"Bearer eyJ\.issued-inside-the-worker\.sig"/);
  assert.doesNotMatch(script, /setExtraHTTPHeaders/, "never a header on every request the page makes to any host");
});

test("a page with no identity is a browser that acts as nobody: nothing is issued or routed", () => {
  const w = world();
  openedPage(w.ctx, request({ identityRef: null }), w.write);
  assert.deepEqual(w.calls, [["open", "about:blank"]]);
});

test("an origin that is not the project's is refused, and an identity that cannot be bound or issued is BLOCKED -- never a browser acting as nobody", () => {
  assert.throws(() => openedPage(world({ origin: "http://elsewhere:8080" }).ctx, request(), () => {}), (e) => e instanceof Refused);
  assert.throws(() => openedPage(world({ bound: { ok: false, why: "nothing named tenant-a-reader is bound" } }).ctx, request(), () => {}), (e) => e instanceof Blocked && /could not be bound/.test(e.message));
  assert.throws(() => openedPage(world({ bound: { ...IDENTITY, env: {} } }).ctx, request(), () => {}), (e) => e instanceof Blocked && /no credential was issued/.test(e.message));
});

test("a browser that fails while it is given the credential says only that it failed -- what the CLI echoed of the script is never repeated", () => {
  const w = world({ fails: (args) => args[0] === "run-code" });
  assert.throws(() => openedPage(w.ctx, request(), w.write), (e) => e instanceof Blocked && !e.message.includes(TOKEN) && /could not be given its identity's credential/.test(e.message));
});

test("the browser is closed after the run, whatever the run came to", () => {
  const w = world();
  closedPage(w.ctx);
  assert.deepEqual(w.calls, [["close"]]);
});
