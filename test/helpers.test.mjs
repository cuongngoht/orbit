// A capability's helper, its bindings and its answer (ADR 0036): the run stays synchronous, a
// promise is never judged, a logical ref is bound by the run and never seen by the capability,
// a secret travels only in the helper's environment, and an answer outside the protocol is the
// tool failing -- never a verdict about the product.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { invokeCapability } from "../src/capability/invoke.mjs";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { HELPER_API } from "../src/capability/helper.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { extensionContextV1 } from "../src/extensions/context-v1.mjs";
import { loadExtensions } from "../src/extensions/index.mjs";
import { packRoom } from "../src/extensions/packs.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { engineVersion } from "../src/version.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeTools } from "./fakes/tools.mjs";

const NODE = "/opt/node/bin/node";
const said = (value) => ({ ok: true, out: `${JSON.stringify({ v: HELPER_API, ok: true, value })}\n`, err: "", status: 0 });
const failed = (answer) => ({ ok: true, out: `${JSON.stringify({ v: HELPER_API, ok: false, ...answer })}\n`, err: "", status: 0 });

const reader = (over = {}) => ({
  id: "orbit.example.read",
  apiVersion: "orbit.capability/v1",
  doc: "reads through its helper",
  page: false,
  inputSchema: { endpointRef: { type: "string", bind: "endpoint", doc: "where" }, identityRef: { type: "string", bind: "identity", doc: "as whom" }, path: { type: "string", doc: "what" } },
  required: ["endpointRef", "path"],
  effects: ["read"],
  outputs: { status: "response.status" },
  helper: { argv: ["helper.mjs"], runIn: "host" },
  invoke: (ext, input) => ext.helper.run("read", { path: input.path }),
  ...over,
});

const BINDER = {
  resolve: (kind, ref) => (ref === "nowhere" ? { ok: false, why: "no component of this task is called nowhere" } : { ok: true, value: { kind, alias: ref, origin: kind === "endpoint" ? "http://app:8080" : undefined }, env: kind === "identity" ? { ORBIT_IDENTITY_TOKEN: "s3cr3t-identity-token" } : {} }),
};

function world({ answer = said({ status: 200 }), binder = BINDER, helpers = { launch: () => ({ file: NODE, args: ["/plugin/skills/example/helper.mjs"], env: { PATH: "/usr/bin" } }) }, cap = reader(), now = 1_000 } = {}) {
  const capabilities = createCapabilityRegistry();
  capabilities.register(cap, "pack:example");
  const process = fakeProcess({ [NODE]: answer });
  const records = [];
  const ctx = { capabilities, process, tools: fakeTools({}), now: () => now, helpers, binder };
  return { ctx, process, records, run: { log: { record: (r) => records.push(r) }, budget: { endsAt: now + 60_000 } } };
}

const step = (input = { endpointRef: "backend", identityRef: "tenant-a-reader", path: "/invoices/a" }) => ({ do: "call", capability: "orbit.example.read", input });

const sent = (process) => JSON.parse(process.calls[0].opts.input);

test("the helper is asked once, with what the binding resolved; the capability only ever sees the answer", () => {
  const w = world();
  assert.deepEqual(invokeCapability(w.ctx, w.run, step()), { status: 200 });
  assert.equal(w.process.calls.length, 1);
  const request = sent(w.process);
  assert.equal(request.v, HELPER_API);
  assert.equal(request.op, "read");
  assert.deepEqual(request.request, { path: "/invoices/a" });
  assert.equal(request.bound.endpointRef.origin, "http://app:8080");
  assert.ok(request.deadlineMs > 0 && request.deadlineMs <= 60_000);
});

test("a secret reaches the helper's environment, and never its request, its arguments or the log", () => {
  const w = world();
  invokeCapability(w.ctx, w.run, step());
  const call = w.process.calls[0];
  assert.equal(call.opts.env.ORBIT_IDENTITY_TOKEN, "s3cr3t-identity-token");
  assert.equal(call.opts.input.includes("s3cr3t"), false);
  assert.equal(call.args.join(" ").includes("s3cr3t"), false);
  assert.equal(JSON.stringify(w.records).includes("s3cr3t"), false);
});

test("a ref nothing binds is Blocked before anything runs, and so is one the binder cannot resolve", () => {
  const unbound = world({ binder: null });
  assert.throws(() => invokeCapability(unbound.ctx, unbound.run, step()), (e) => e instanceof Blocked && /nothing binds them here/.test(e.message));
  assert.equal(unbound.process.calls.length, 0);
  const w = world();
  assert.throws(() => invokeCapability(w.ctx, w.run, step({ endpointRef: "nowhere", path: "/" })), (e) => e instanceof Blocked && /no component of this task is called nowhere/.test(e.message));
  assert.equal(w.process.calls.length, 0);
});

test("the timeout is the narrowest of the capability's own and what is left of the run, and a spent run starts nothing", () => {
  const w = world({ cap: reader({ timeoutSec: 30 }) });
  w.run.budget.endsAt = 1_000 + 10_000;
  invokeCapability(w.ctx, w.run, step());
  assert.equal(w.process.calls[0].opts.timeoutMs, 10_000);
  const spent = world();
  spent.run.budget.endsAt = 1_000;
  assert.throws(() => invokeCapability(spent.ctx, spent.run, step()), (e) => e instanceof Blocked && /deadline is spent — nothing was started/.test(e.message));
  assert.equal(spent.process.calls.length, 0);
});

test("an answer outside the protocol, or a helper that ran out of room or time, is the tool failing -- never a FAIL", () => {
  const cases = [
    [{ ok: true, out: "not json\n", err: "", status: 0 }, "protocol"],
    [{ ok: true, out: `${JSON.stringify({ v: HELPER_API, ok: true, value: 1 })}\n${JSON.stringify({ v: HELPER_API, ok: true, value: 2 })}\n`, status: 0 }, "protocol"],
    [{ ok: true, out: `${JSON.stringify({ v: "other/v9", ok: true, value: 1 })}\n`, status: 0 }, "protocol"],
    [{ ok: false, out: "", error: "killed", timedOut: true }, "timeout"],
    [{ ok: false, out: "", error: "too much", overflow: true }, "incomplete"],
    [failed({ class: "transport", message: "connection refused" }), "transport"],
    [failed({ class: "incomplete", message: "the observer lost its subscription" }), "incomplete"],
    [failed({ class: "made-up", message: "?" }), "protocol"],
  ];
  for (const [answer, cls] of cases) {
    const w = world({ answer });
    assert.throws(() => invokeCapability(w.ctx, w.run, step()), (e) => e instanceof Blocked && e.helperClass === cls, cls);
  }
});

test("a request the helper cannot make is the case's mistake; a write whose outcome is unknown carries its operation key", () => {
  const refused = world({ answer: failed({ class: "refused", message: "no such operation" }) });
  assert.throws(() => invokeCapability(refused.ctx, refused.run, step()), (e) => e instanceof Refused && e.helperClass === "refused");
  const ambiguous = world({ answer: failed({ class: "ambiguous", message: "the connection closed before the confirm", operationKey: "op-7" }) });
  assert.throws(() => invokeCapability(ambiguous.ctx, ambiguous.run, step()), (e) => e instanceof Blocked && e.ambiguous === "op-7");
});

test("a helper's own words are scrubbed before anybody reads them", () => {
  const w = world({ answer: failed({ class: "transport", message: "auth failed: password=hunter2 for Bearer abc.def" }) });
  assert.throws(() => invokeCapability(w.ctx, w.run, step()), (e) => !/hunter2|abc\.def/.test(e.message));
});

test("with no launcher bound, a helper is never started", () => {
  const w = world({ helpers: {} });
  assert.throws(() => invokeCapability(w.ctx, w.run, step()), (e) => e instanceof Blocked && /nothing here can launch one/.test(e.message));
  assert.equal(w.process.calls.length, 0);
});

test("a capability that answers with a promise is Blocked, never judged as {} -- so Boolean(it) can never pass", () => {
  const w = world({ cap: reader({ id: "orbit.example.sneaky", inputSchema: undefined, required: undefined, helper: undefined, invoke: () => Promise.resolve({ status: 201 }) }) });
  assert.throws(() => invokeCapability(w.ctx, w.run, { do: "call", capability: "orbit.example.sneaky", input: {} }), (e) => e instanceof Blocked && /answered with a promise/.test(e.message));
});

test("an async invoke is refused when it registers", () => {
  const reg = createCapabilityRegistry();
  assert.throws(() => reg.register({ id: "project.x.y", apiVersion: "orbit.capability/v1", doc: "d", invoke: async () => ({}) }, "acme"), /invoke is async/);
});

test("the log keeps a scrubbed answer; the verdict judges the answer as given", () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
  const w = world({ answer: said({ status: 200, body: { token } }) });
  assert.equal(invokeCapability(w.ctx, w.run, step()).body.token, token);
  assert.equal(JSON.stringify(w.records).includes(token), false);
});

test("what a capability may declare, and who may own an orbit.* id", () => {
  const reg = createCapabilityRegistry();
  const bad = (over, from = "pack:example") => reg.check({ ...reader(), id: "orbit.example.other", ...over }, from).join("\n");
  assert.equal(bad({}), "");
  assert.match(bad({}, "acme-probe"), /orbit\.\* ids belong to the engine and the packs it ships/);
  assert.match(bad({ effects: ["teleport"] }), /effect "teleport" is not one of/);
  assert.match(bad({ effects: ["publish"] }), /declares a mutating effect and not mutates: true/);
  assert.match(bad({ outputs: { depth: "broker.queueDepth" } }), /means "broker.queueDepth", which is not a meaning/);
  assert.match(bad({ inputSchema: { where: { type: "string", bind: "galaxy" } } }), /binds "galaxy", which is not a bind kind/);
  assert.match(bad({ helper: { argv: ["/bin/sh", "-c", "x"] } }), /leaves its directory/);
});

test("the facade offers a helper only to a capability that declared one, and clips a child to the run's deadline", () => {
  const ctx = { ...fakeContext(), now: () => 5_000 };
  const run = { budget: { endsAt: 7_000 } };
  assert.equal("helper" in extensionContextV1(ctx, run, { id: "project.a.b" }), false);
  assert.equal(typeof extensionContextV1(ctx, run, reader()).helper.run, "function");
  const process = fakeProcess();
  extensionContextV1({ ...ctx, process }, run, { id: "project.a.b", timeoutSec: 60 }).process.run("tool", []);
  assert.equal(process.calls[0].opts.timeoutMs, 2_000);
  assert.throws(() => extensionContextV1({ ...ctx, process }, { budget: { endsAt: 5_000 } }, { id: "project.a.b" }).process.run("tool", []), Blocked);
});

// ── packs (ADR 0034) ─────────────────────────────────────────────────────────
function plugin() {
  const root = mkdtempSync(join(tmpdir(), "orbit-pack-"));
  mkdirSync(join(root, "catalog"), { recursive: true });
  writeFileSync(join(root, "catalog", "packs.json"), JSON.stringify({ schema: 1, packs: [{ id: "example", dir: "skills/example", doc: "an example pack" }] }));
  const dir = join(root, "skills", "example");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extension.json"), JSON.stringify({ id: "example", version: engineVersion(), apiVersion: "orbit.extension/v2", status: "active", capabilities: "./capabilities.mjs" }));
  writeFileSync(join(dir, "capabilities.mjs"), `export default [{ id: "orbit.example.ping", apiVersion: "orbit.capability/v1", doc: "answers pong", page: false, effects: ["none"], invoke: () => ({ pong: true }) }];`);
  return root;
}

function store() {
  const root = mkdtempSync(join(tmpdir(), "orbit-pack-store-"));
  mkdirSync(qcToolPaths(root).root, { recursive: true });
  return root;
}

test("a pack the project names is loaded where the plugin keeps it, and registers as the pack", async () => {
  const pluginRoot = plugin();
  const root = store();
  const ctx = { ...fakeContext(), store: () => root, config: { ...fakeContext().config, packs: ["example", "missing"] } };
  const out = await loadExtensions(ctx, { pluginRoot });
  assert.deepEqual(out.loaded.map((e) => [e.id, e.from]), [["example", "pack:example"]]);
  assert.equal(ctx.capabilities.sourceOf("orbit.example.ping"), "pack:example");
  assert.match(out.refused.find((r) => r.id === "pack:missing").why, /is not a pack this plugin ships/);
  rmSync(pluginRoot, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("a pack nobody named is inert, and a project's own tool cannot take an orbit.* id", async () => {
  const pluginRoot = plugin();
  const root = store();
  const dir = join(qcToolPaths(root).root, "acme-probe");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extension.json"), JSON.stringify({ id: "acme-probe", version: "1.0.0", apiVersion: "orbit.extension/v2", status: "verified", capabilities: "./capabilities.mjs" }));
  writeFileSync(join(dir, "capabilities.mjs"), `export default [{ id: "orbit.example.ping", apiVersion: "orbit.capability/v1", doc: "an impostor", invoke: () => ({}) }];`);
  const ctx = { ...fakeContext(), store: () => root };
  const out = await loadExtensions(ctx, { pluginRoot });
  assert.equal(ctx.capabilities.has("orbit.example.ping"), false);
  assert.match(out.refused.find((r) => r.id === "acme-probe").why, /orbit\.\* ids belong to the engine and the packs it ships/);
  rmSync(pluginRoot, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("a pack room refuses an id that is not a pack id or not in the catalog, before any manifest is read", () => {
  const pluginRoot = plugin();
  const { room, refused } = packRoom(pluginRoot, ["example", "../etc", "nope"], { read: (p) => readFileSync(p, "utf8") });
  assert.deepEqual(room.ids(), ["example"]);
  assert.deepEqual(refused.map((r) => r.id).sort(), ["pack:../etc", "pack:nope"]);
  rmSync(pluginRoot, { recursive: true, force: true });
});
