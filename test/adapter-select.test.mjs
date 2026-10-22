// Which adapter answers a family operation, and what reaches the case (ADR 0035): the selection
// rows choose by a pin or a transport and a stable id -- never by registration order and never by
// falling back to another transport -- a missing one is a named GAP that starts nothing, a shared
// family is answered by the adapter that owns the resource, the answer is held to what the
// adapter DECLARED, and every result says which adapter, at which declaration, saw it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { fingerprintOf } from "../src/adapters/dispatch.mjs";
import { OPERATIONS } from "../src/adapters/families.mjs";
import { createAdapterRegistry } from "../src/adapters/registry.mjs";
import { SELECT, opKeyOf, selectAdapter } from "../src/adapters/select.mjs";
import { mergeSemantics } from "../src/adapters/semantics.mjs";
import { HELPER_API } from "../src/capability/helper.mjs";
import { invokeCapability } from "../src/capability/invoke.mjs";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { Blocked } from "../src/errors.mjs";
import { extensionContextV1 } from "../src/extensions/context-v1.mjs";
import { loadExtensions } from "../src/extensions/index.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { mutatingEffect } from "../src/topology/vocab.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeTools } from "./fakes/tools.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const vocab = mergeSemantics([{ layer: "orbit", from: "catalog/semantics.json", doc: JSON.parse(readFileSync(join(ROOT, "catalog/semantics.json"), "utf8")) }]);
const NODE = "/opt/node/bin/node";

const adapter = (over = {}) => ({
  id: "example.alpha",
  apiVersion: "orbit.adapter/v1",
  version: "1.0.0",
  doc: "an example messaging adapter",
  family: "messaging",
  transports: ["example-mq"],
  operations: {
    publish: { effects: ["publish"], outputs: { messageId: "message.id", outcome: "settlement.outcome" } },
    observe: { effects: ["create-resource", "read"], outputs: { baseline: "cursor.baseline" } },
    "observe.await": { effects: ["read"], outputs: { messages: { each: { id: "message.id", attempt: "delivery.attempt" } }, completeness: "observation.completeness" } },
  },
  semantics: { delivery: "at-least-once" },
  helper: { argv: ["helper.mjs"], runIn: "host" },
  ...over,
});

function registry(...decls) {
  const reg = createAdapterRegistry(vocab);
  for (const d of decls) assert.deepEqual(reg.register(d, "pack:example").problems, [], d.id);
  return reg;
}

const PUBLISH = { family: "messaging", op: "publish" };

test("the selection rows are ordered, and the last one always answers", () => {
  assert.deepEqual(SELECT.map((r) => r.id), ["pinned", "transport", "none"]);
  assert.equal(SELECT.at(-1).when({}), true);
});

test("a transport chooses among the adapters that serve it AND answer the operation, by a stable id -- never registration order", () => {
  const onlyObserves = adapter({ id: "example.aaa", operations: { observe: { effects: ["read"] } } });
  const reg = registry(adapter({ id: "example.beta" }), onlyObserves, adapter(), adapter({ id: "example.other", transports: ["other-mq"] }));
  assert.equal(selectAdapter(reg, { ...PUBLISH, transport: "example-mq" }).adapter.id, "example.alpha", "example.aaa sorts first and does not publish");
  assert.equal(selectAdapter(reg, { ...PUBLISH, transport: "example-mq" }).by, "transport");
  assert.equal(selectAdapter(reg, { ...PUBLISH, transport: "other-mq" }).adapter.id, "example.other");
  assert.match(selectAdapter(reg, { ...PUBLISH, transport: "third-mq" }).gap.why, /no registered adapter serves messaging.publish over third-mq/, "never another transport's adapter");
});

test("a pinned resource is answered by the adapter that armed it, or by no one", () => {
  const reg = registry(adapter(), adapter({ id: "example.beta" }));
  assert.equal(selectAdapter(reg, { ...PUBLISH, transport: "example-mq", pinned: "example.beta" }).adapter.id, "example.beta", "the pin wins over the stable id");
  const gone = selectAdapter(reg, { ...PUBLISH, transport: "example-mq", pinned: "example.gone" });
  assert.equal(gone.adapter, undefined, "no fallback to the adapter that sorts first");
  assert.match(gone.gap.why, /example.gone this resource was bound to is not registered here/);
});

test("a shared family is answered by the adapter that owns the resource, under its qualified key", () => {
  const reg = registry(adapter());
  const a = reg.get("example.alpha");
  assert.equal(opKeyOf(a, { family: "observe", op: "await" }), "observe.await");
  assert.equal(opKeyOf(a, PUBLISH), "publish");
  assert.equal(selectAdapter(reg, { family: "observe", op: "await", transport: "example-mq" }).adapter.id, "example.alpha");
  assert.ok(selectAdapter(reg, { family: "fixture", op: "cleanup", transport: "example-mq" }).gap, "it declared no fixture.cleanup, so it does not answer one");
});

test("nothing to choose by is a named gap, scoped to the capability the case needed and the transport it was on", () => {
  assert.deepEqual(selectAdapter(registry(adapter()), PUBLISH).gap, { need: "capability", capability: "orbit.messaging.publish", context: { family: "messaging", transport: null }, why: "the bound resource names no transport to choose an adapter by" });
  assert.deepEqual(selectAdapter(registry(), { ...PUBLISH, transport: "example-mq" }).gap.context, { family: "messaging", transport: "example-mq" });
});

test("the family capabilities: one per operation an adapter answers -- never HTTP's own, never one Orbit computes itself", () => {
  const caps = familyCapabilities();
  assert.deepEqual(caps.map((c) => c.id), OPERATIONS.filter((o) => o.selects && o.family !== "http").map((o) => o.capability));
  assert.equal(caps.some((c) => c.id === "orbit.schedule.expect" || c.id.startsWith("orbit.http.")), false);
  const reg = createCapabilityRegistry();
  for (const cap of caps) {
    const row = OPERATIONS.find((o) => o.capability === cap.id);
    assert.doesNotThrow(() => reg.register(cap, "pack:orbit-backend-test"), cap.id);
    assert.equal(cap.page, false, `${cap.id} needs no browser`);
    assert.equal(cap.mutates, row.effects.some(mutatingEffect), `${cap.id} mutates exactly when an effect it allows does`);
    assert.deepEqual(cap.required, [`${row.refs[0]}Ref`]);
    assert.deepEqual(Object.keys(cap.inputSchema), [...row.refs.map((k) => `${k}Ref`), "request"]);
  }
  assert.equal(caps.find((c) => c.id === "orbit.messaging.publish").mutates, true);
  assert.equal(caps.find((c) => c.id === "orbit.worker.observe").mutates, false);
});

const said = (value) => ({ ok: true, out: `${JSON.stringify({ v: HELPER_API, ok: true, value })}\n`, err: "", status: 0 });

const BOUND = {
  channel: { alias: "invoice-events", transport: "example-mq", address: "orbit-ab12.invoices" },
  identity: { alias: "tenant-a-publisher", transport: "other-mq" },
  observer: { alias: "obs-1", transport: "example-mq", adapter: "example.beta", address: "orbit-ab12.obs-1" },
};

function world({ answer = said({}), adapters = registry(adapter(), adapter({ id: "example.beta" })), bound = BOUND } = {}) {
  const capabilities = createCapabilityRegistry();
  for (const cap of familyCapabilities()) capabilities.register(cap, "pack:orbit-backend-test");
  const process = fakeProcess({ [NODE]: answer });
  const launched = [];
  const helpers = { launch: (cap, op) => (launched.push({ id: cap.id, from: cap.from, argv: cap.helper.argv, op }), { file: NODE, args: ["/plugin/skills/example/helper.mjs"], env: {} }) };
  const binder = { resolve: (kind, ref) => ({ ok: true, value: bound[kind] ?? { alias: ref }, env: kind === "identity" ? { EXAMPLE_TOKEN: "s3cr3t-publisher" } : {} }) };
  const ctx = { capabilities, adapters, process, helpers, binder, tools: fakeTools({}), now: () => 1_000, grants: { check: () => null, spend: () => null } };
  return { ctx, process, launched, run: { c: { id: "generated" }, log: { record: () => {} }, budget: { endsAt: 61_000 } } };
}

const publish = (request = { payload: { invoice: "inv-1" }, messageId: "m-1" }) => ({ do: "call", capability: "orbit.messaging.publish", input: { channelRef: "invoice-events", identityRef: "tenant-a-publisher", request } });

test("a family operation reaches the adapter its bound resource resolves to, through the helper protocol, with the secret only in its environment", () => {
  const w = world({ answer: said({ messageId: "m-1", outcome: "confirmed" }) });
  invokeCapability(w.ctx, w.run, publish());
  assert.deepEqual(w.launched, [{ id: "example.alpha", from: "pack:example", argv: ["helper.mjs"], op: "publish" }], "the channel chose it; the identity's transport chose nothing");
  const sent = JSON.parse(w.process.calls[0].opts.input);
  assert.deepEqual([sent.v, sent.op, sent.request], [HELPER_API, "publish", { payload: { invoice: "inv-1" }, messageId: "m-1" }]);
  assert.equal(sent.bound.channelRef.address, "orbit-ab12.invoices");
  assert.equal(w.process.calls[0].opts.env.EXAMPLE_TOKEN, "s3cr3t-publisher");
  assert.equal(w.process.calls[0].opts.input.includes("s3cr3t"), false);
});

test("the answer is held to what the adapter declared -- inside a list too -- and stamped with the adapter that saw it", () => {
  const w = world({ answer: said({ messageId: "m-1", outcome: "confirmed", brokerSaid: "anything at all" }) });
  const out = invokeCapability(w.ctx, w.run, publish());
  assert.deepEqual(Object.keys(out), ["messageId", "outcome", "adapter"]);
  assert.deepEqual(out.adapter, { id: "example.alpha", version: "1.0.0", fingerprint: fingerprintOf(w.ctx.adapters.get("example.alpha")), transport: "example-mq" });
  const awaited = world({ answer: said({ messages: [{ id: "m-1", attempt: 2, payload: { tenant: "b" } }], completeness: "complete", depth: 0 }) });
  const seen = invokeCapability(awaited.ctx, awaited.run, { do: "call", capability: "orbit.observe.await", input: { observerRef: "obs-1", request: { until: { count: 1 } } } });
  assert.deepEqual(seen.messages, [{ id: "m-1", attempt: 2 }]);
  assert.equal(seen.completeness, "complete");
  assert.equal(seen.depth, undefined, "a depth nobody declared is never a meaning");
  assert.equal(awaited.launched[0].id, "example.beta", "the observer is awaited through the adapter that armed it");
  assert.equal(awaited.launched[0].op, "observe.await");
});

test("a gap is BLOCKED before anything starts, and names the capability and the transport", () => {
  const w = world({ bound: { ...BOUND, channel: { alias: "invoice-events", transport: "third-mq" } } });
  assert.throws(() => invokeCapability(w.ctx, w.run, publish()), (e) => e instanceof Blocked && e.gap?.capability === "orbit.messaging.publish" && e.gap.context.transport === "third-mq" && /nothing about the product was observed/.test(e.message));
  assert.equal(w.process.calls.length, 0, "nothing was launched");
  const none = world({ bound: { ...BOUND, channel: { alias: "invoice-events" } } });
  assert.throws(() => invokeCapability(none.ctx, none.run, publish()), (e) => e instanceof Blocked && /names no transport/.test(e.message));
});

test("each limit is the narrowest of the adapter's and the operation's, and a wider one never widens it", () => {
  const narrow = adapter({ limits: { timeoutMs: 5_000, answerBytes: 4_096 }, operations: { ...adapter().operations, publish: { effects: ["publish"], outputs: {}, limits: { timeoutMs: 90_000, answerBytes: 1_024 } } } });
  const w = world({ adapters: registry(narrow) });
  invokeCapability(w.ctx, w.run, publish());
  assert.deepEqual(JSON.parse(w.process.calls[0].opts.input).limits, { timeoutMs: 5_000, answerBytes: 1_024 });
  assert.ok(w.process.calls[0].opts.timeoutMs <= 5_000);
  assert.equal(w.process.calls[0].opts.maxBuffer, 1_024);
});

test("a fingerprint changes with anything an adapter declares, and never with who registered it", () => {
  assert.notEqual(fingerprintOf(adapter()), fingerprintOf(adapter({ version: "1.0.1" })));
  assert.notEqual(fingerprintOf(adapter()), fingerprintOf(adapter({ semantics: { delivery: "at-most-once" } })));
  assert.equal(fingerprintOf({ ...adapter(), from: "pack:a" }), fingerprintOf({ ...adapter(), from: "pack:b" }));
  assert.match(fingerprintOf(adapter()), /^[0-9a-f]{64}$/);
});

test("only a family operation the engine or one of its packs registered is handed the adapters surface", () => {
  const ctx = world().ctx;
  const surface = (cap) => "adapters" in extensionContextV1(ctx, { page: false }, cap);
  assert.equal(surface({ id: "orbit.messaging.publish", from: "pack:orbit-backend-test" }), true);
  assert.equal(surface({ id: "orbit.messaging.publish", from: "core" }), true);
  assert.equal(surface({ id: "orbit.messaging.publish", from: "acme-tool" }), false, "a project's own capability never sees it");
  assert.equal(surface({ id: "acme.rows", from: "pack:orbit-backend-test" }), false, "nor a pack's capability that is not a family operation");
});

function room(manifest, files) {
  const root = mkdtempSync(join(tmpdir(), "orbit-adapters-"));
  const dir = join(qcToolPaths(root).root, manifest.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extension.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return root;
}

const MANIFEST = { id: "acme-queue", version: "1.0.0", apiVersion: "orbit.extension/v2", status: "verified", adapters: "./adapters.json" };

test("an extension declares adapters as DATA: parsed, judged whole before anything of it registers, and counted", async () => {
  const good = room(MANIFEST, { "adapters.json": JSON.stringify({ adapters: [adapter({ id: "acme.queue", transports: ["acme-mq"] })] }) });
  const ctx = { ...fakeContext(), store: () => good, process: fakeProcess() };
  const out = await loadExtensions(ctx);
  assert.deepEqual(out.refused, []);
  assert.deepEqual(out.loaded[0].adapters, ["acme.queue"]);
  assert.equal(ctx.adapters.get("acme.queue").from, "acme-queue");
  const bad = room(MANIFEST, { "adapters.json": JSON.stringify({ adapters: [adapter({ id: "acme.queue", support: "supported" })] }) });
  const badCtx = { ...fakeContext(), store: () => bad, process: fakeProcess() };
  const refused = await loadExtensions(badCtx);
  assert.match(refused.refused[0].why, /what it declares as adapters does not hold — .*unknown field "support"/);
  assert.equal(badCtx.adapters.list().length, 0, "nothing of it registered");
  const shapeless = room(MANIFEST, { "adapters.json": JSON.stringify({ adapter: adapter() }) });
  assert.match((await loadExtensions({ ...fakeContext(), store: () => shapeless, process: fakeProcess() })).refused[0].why, /adapters: needs \{ adapters: \[\.\.\.\] \}/);
  for (const r of [good, bad, shapeless]) rmSync(r, { recursive: true, force: true });
});
