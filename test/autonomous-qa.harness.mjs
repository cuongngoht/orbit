// A world for autonomous QA over the fixture project and fake ports: the
// fixture's map, a fake browser whose request log is a TIMELINE, a fake
// database, and a throwaway machine store with settings a PERSON wrote.
// Nothing spawns, nothing sleeps: `sleep` moves the fake browser's clock.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { begin, readSettings, worldFor, writeSettings, investigationPaths } from "../src/investigation/index.mjs";
import { sandboxEnvironment, sandboxRuntime } from "../src/investigation/sandbox.mjs";
import { realIo } from "../src/store/io.mjs";
import { fakeBrowser, SAVE } from "./fakes/browser.mjs";
import { fakeContext } from "./fakes/context.mjs";

export { SAVE };
export const ADD = "getByRole('button',{name:'Add'})";
export const NAME_BOX = "getByRole('textbox',{name:'Name'})";

export const ENV = { id: "test", origin: "https://app.test", kind: "test", modes: ["observe", "explore-write", "security-test"] };

export const BASE_SETTINGS = { enabled: true, environments: [ENV], identities: ["admin", "tenantA", "tenantB", "both"] };

// A POST the Save click causes, carrying the body the fake prints.
export const post = (n, extra = {}) => ({ n, method: "POST", url: "https://app.test/api/things", status: 201, afterCall: ["click", SAVE], body: '{"name":"TC-x"}', headers: { "content-type": "application/json", authorization: "Bearer SECRET-TOKEN" }, ...extra });

// o: { requests, answers, settings, db, details, consoleLog, mode, sql, env, graph(g) }
// `make(more)` hands `more` to worldFor, so `make({ environment, runtime })` is a task's sandbox
// (see `sandboxWorld`), which wins over the settings' declared environments.
export function aqaWorld(o = {}) {
  const answers = [["location.href", "https://app.test/home"], ...(o.answers ?? [])];
  const browser = o.browser ?? fakeBrowser({ answers, requests: o.requests ?? [], details: o.details ?? true, consoleLog: o.consoleLog ?? [], host: o.host ?? "app.test" });
  const base = fakeContext({ browser, db: o.db ?? null });
  const ctx = { ...base, config: { ...base.config, name: "fixture", sql: { command: o.sql === false ? null : ["fake-sql"] } }, ...(o.identity ? { identity: o.identity } : {}) };
  o.graph?.(ctx.graph);
  const machine = storeWith(browser, o.settings ?? {});
  return { browser, ctx, machine, make: (more = {}) => worldFor({ ctx, machine, env: o.env ?? "test", mode: o.mode ?? "explore-write", on: o.on ?? true, pace: 1000, ...more }) };
}

function storeWith(browser, settings) {
  const root = mkdtempSync(join(tmpdir(), "orbit-aqa-"));
  const io = { ...realIo(), sleep: (ms) => browser.clock.tick(ms) };
  const paths = investigationPaths(root);
  writeSettings(paths, io, { next: { ...readSettings(paths, io).settings, ...BASE_SETTINGS, ...settings }, revision: null, by: "person", now: "2026-09-25T00:00:00Z" });
  return { store: { root }, io };
}

// A started investigation, and the world bound to it.
export function started(o = {}, q = { objective: "check why Save sends two API requests", scope: "thing" }) {
  const t = aqaWorld(o);
  const { id } = begin(t.make(), q);
  return { ...t, id, w: t.make({ id }) };
}

// The chain explore would run for dlg-thing/Save, by hand: home, open the
// dialog, type the synthetic name, save.
export const SAVE_CHAIN = [{ kind: "goto", url: "/home", surface: "home" }, { kind: "click", on: "home/Add" }, { kind: "fill", on: "dlg-thing/Name", value: "TC-1a2b-1" }, { kind: "click", on: "dlg-thing/Save" }];

// A database whose answers come off a list, one per query, the last repeating.
export function scriptedDb(counts) {
  const seen = { i: 0, queries: [] };
  return { seen, query: (q) => { seen.queries.push(q); const n = counts[Math.min(seen.i++, counts.length - 1)]; return n === null ? { ok: false, rows: [], error: "Login failed for user" } : { ok: true, rows: [{ n: String(n) }] }; } };
}

// ------------------------------------------------------------ tenant fakes
// A controlled tenant A / tenant B product. Each identity is its own session
// directory with its own token claims -- the fake identity port reads the
// claims of whichever session the browser currently drives.
export const TENANT_CLAIMS = {
  "/tmp/run-tenantA": { tid: "tid-A", oid: "oid-a", roles: [], upn: "a@a.test" },
  "/tmp/run-tenantB": { tid: "tid-B", oid: "oid-b", roles: [], upn: "b@b.test" },
  "/tmp/run-both": { tid: "tid-B", oid: "oid-both", roles: [], upn: "both@b.test" },
};

const MARKER = "Orbit-TENANT-A-MARKER";

export const tenantContract = (matrix, more = {}) => ({
  claim: "tid",
  tenants: { A: "tid-A", B: "tid-B" },
  identities: { tenantA: ["A"], tenantB: ["B"], both: ["A", "B"] },
  resources: { "a-thing": { tenant: "A", marker: MARKER, route: "/things/42", api: "/api/things/42", search: "/api/things?q=Orbit", data: { query: "SELECT Name FROM Things WHERE Id=42", table: "Things" }, write: { method: "PUT", api: "/api/things/42", body: { name: "TC-probe" } } } },
  matrix,
  ...more,
});

// product(who, path, method, data) -> { status, contains } -- what the server does.
export function tenantWorld(matrix, product, { claims = TENANT_CLAIMS, db = true, more = {} } = {}) {
  const data = { name: "TC-original" };
  const holder = {};
  const answers = [
    [/^fetch\(/, (js) => { const [, path, method] = /^fetch\("([^"]+)",\{method:"(\w+)"/.exec(js); return JSON.stringify(product(holder.browser.dir(), path, method, data)); }],
    [/innerText\.includes\("Orbit-TENANT-A-MARKER"\)/, () => product(holder.browser.dir(), "/things/42", "UI", data).contains === true],
  ];
  const identity = { sessionFor: (as) => `/tmp/run-${as}`, claims: () => (claims[holder.browser.dir()] ? { claims: claims[holder.browser.dir()] } : { problem: "no token in this session" }), resolve: () => ({ profile: null, from: null }), mapFile: "/tmp/identities.json" };
  const t = started({ mode: "security-test", answers, identity, sql: db ? undefined : false, db: { query: () => ({ ok: true, rows: [{ Name: data.name }] }) }, settings: { tenancy: tenantContract(matrix, more) } });
  holder.browser = t.browser;
  return { ...t, data };
}

// A product that keeps its tenants apart: A reads (and may write) its own
// thing, anyone else is told it does not exist.
const inA = (dir) => dir.endsWith("tenantA") || dir.endsWith("both");
export const correctTenancy = (dir, path, method) => (inA(dir) ? { status: method === "PUT" ? 204 : 200, contains: method !== "PUT" } : { status: 404, contains: false });

// ----------------------------------------------------------------- sandbox
// The runtime's `sandbox` view (docs/plans/release-1.7.9-task-sandbox-runtime.md section 5), as much of it as
// src/investigation/sandbox.mjs reads. Overrides replace whole fields.
export const TREE_A = "a".repeat(40);
export const TREE_B = "b".repeat(40);
export const SANDBOX_PORT = 42001;

export const sandboxView = (over = {}) => ({
  environment: "env-0123456789ab",
  owner: { kind: "task", id: "tsk-20261007-aaaa" },
  state: "RUNNING",
  tree: TREE_A,
  currentTree: TREE_A,
  stale: false,
  components: [{ component: "node:web", endpoint: { component: "node:web", kind: "http", port: SANDBOX_PORT } }, { component: "node:db", endpoint: null }],
  qa: { modes: ["observe", "explore-write"], entry: null, browser: "isolated" },
  ...over,
});

// A world over a task's sandbox: the projection and the runtime answer the composition root would hand in, and
// a browser that is on the sandbox's loopback host.
export function sandboxWorld(o = {}) {
  const view = sandboxView(o.view);
  const t = aqaWorld({ host: "127.0.0.1", mode: "observe", ...o.world });
  const projection = { environment: sandboxEnvironment(view), runtime: sandboxRuntime(view, o.served ?? true) };
  const make = (more = {}) => t.make({ ...projection, ...more });
  const { id } = begin(make(), { objective: "verify the task's change", scope: "thing" });
  return { ...t, view, projection, make, id, w: make({ id }) };
}
