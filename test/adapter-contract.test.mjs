// What an adapter may declare (ADR 0035): the families are a table, a declaration is judged
// whole before it registers, semantics are vocabulary rows where "unknown" is always allowed,
// and a support level is never something an adapter can say about itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CAPABILITY_ID } from "../src/capability/contract-v1.mjs";
import { ADAPTER_FIELDS, declarationFindings } from "../src/adapters/contract-v1.mjs";
import { BIND_KIND_IDS, EFFECT_IDS, FAMILIES, OPERATIONS, operationFor } from "../src/adapters/families.mjs";
import { createAdapterRegistry } from "../src/adapters/registry.mjs";
import { loadSemantics, meets, mergeSemantics, semanticsFindings } from "../src/adapters/semantics.mjs";
import { meaningAt } from "../src/topology/vocab.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMANTICS = JSON.parse(readFileSync(join(ROOT, "catalog/semantics.json"), "utf8"));
const vocab = mergeSemantics([{ layer: "orbit", from: "catalog/semantics.json", doc: SEMANTICS }]);

const declaration = (over = {}) => ({
  id: "example.reference",
  apiVersion: "orbit.adapter/v1",
  version: "1.0.0",
  doc: "an example messaging adapter",
  family: "messaging",
  transports: ["example-mq"],
  operations: {
    publish: { effects: ["publish"], outputs: { messageId: "message.id", outcome: "settlement.outcome" } },
    observe: { effects: ["create-resource", "read"], outputs: { baseline: "cursor.baseline" } },
  },
  semantics: { delivery: "at-least-once", publishAck: "broker-confirm", observation: ["shadow-subscription"], retryLimit: "unknown" },
  helper: { argv: ["helper.mjs"], runIn: "worker" },
  conformance: { kit: "messaging", params: {} },
  ...over,
});

test("every family operation is a capability id a case can name, binding only known ref kinds, with known effects and meanings", () => {
  for (const o of OPERATIONS) {
    assert.ok(CAPABILITY_ID.test(o.capability), o.capability);
    for (const r of o.refs) assert.ok(BIND_KIND_IDS.includes(r), `${o.capability} binds ${r}`);
    for (const e of o.effects) assert.ok(EFFECT_IDS.includes(e), `${o.capability} may ${e}`);
    for (const m of o.outputs) assert.ok(meaningAt(m), `${o.capability} outputs ${m}`);
    for (const n of o.needs) assert.ok(vocab.fields.has(n), `${o.capability} needs semantics.${n}, a declared field`);
  }
  assert.equal(new Set(OPERATIONS.map((o) => o.capability)).size, OPERATIONS.length, "one family operation per capability id");
});

test("the document's capability names are the family operations, exactly", () => {
  for (const id of ["orbit.messaging.publish", "orbit.messaging.observe", "orbit.job.enqueue", "orbit.job.observe", "orbit.scheduler.trigger", "orbit.scheduler.observe", "orbit.clock.advance", "orbit.observe.await", "orbit.workload.control", "orbit.worker.observe", "orbit.state.read", "orbit.fixture.prepare", "orbit.fixture.cleanup", "orbit.http.read", "orbit.http.write"]) assert.ok(operationFor(id), id);
});

test("batch, stream, workflow, webhook and file are in the model from the start, as contract only", () => {
  assert.deepEqual(FAMILIES.filter((f) => f.contractOnly).map((f) => f.id), ["rpc", "batch", "stream", "workflow", "webhook", "file"]);
});

test("a declaration is judged whole: the example is clean, and every field it holds is one the contract declares", () => {
  assert.deepEqual(declarationFindings(declaration(), vocab).problems, []);
  for (const k of Object.keys(declaration())) assert.ok(k in ADAPTER_FIELDS, k);
});

test("what a declaration may not say", () => {
  const problems = (over) => declarationFindings(declaration(over), vocab).problems.join("\n");
  assert.match(problems({ support: "supported" }), /unknown field "support"/, "a support level is computed, never declared");
  assert.match(problems({ family: "teleport" }), /family must be/);
  assert.match(problems({ operations: { enqueue: { effects: ["enqueue"] } } }), /enqueue is not an operation of the messaging family/);
  assert.match(problems({ operations: { publish: { effects: ["delete-resource"] } } }), /publish may not declare effect "delete-resource"/);
  assert.match(problems({ operations: { publish: { outputs: { depth: "broker.queueDepth" } } } }), /means "broker.queueDepth", which is not a meaning/);
  assert.match(problems({ transports: ["Example MQ"] }), /transport "Example MQ" is not a token/);
  assert.match(problems({ helper: { argv: ["/usr/bin/helper"] } }), /leaves its directory/);
  assert.match(problems({ helper: { argv: ["../helper.mjs"] } }), /leaves its directory/);
  assert.match(problems({ helper: { argv: ["helper.mjs"], runIn: "image" } }), /no image is pinned/);
  assert.match(problems({ helper: { argv: ["helper.mjs"], runIn: "image", image: "example/helper:latest" } }), /image does not look like/);
  assert.match(problems({ semantics: { delivery: "exactly-once" } }), /semantics.delivery is "exactly-once" — one of/);
});

test("a semantics field nobody declared is kept and reported as undeclared, never refused, and derives nothing", () => {
  const found = declarationFindings(declaration({ semantics: { delivery: "at-least-once", poisonQuarantine: "yes" } }), vocab);
  assert.deepEqual(found.problems, []);
  assert.deepEqual(found.undeclared, ["poisonQuarantine"]);
});

test("meets: any one wanted value does, an absent or unknown field is UNKNOWN -- never met, never refused", () => {
  const sem = { delivery: "at-least-once", redeliveryTriggers: ["nack", "connection-loss"], retryLimit: "unknown" };
  const r = meets(sem, { delivery: ["at-least-once", "effectively-once-within-window"], redeliveryTriggers: ["crash-before-settle", "connection-loss"], deadLetter: ["broker-routed"], orderingScope: ["key"] });
  assert.deepEqual(r.met, ["delivery", "redeliveryTriggers"]);
  assert.deepEqual(r.unknown, ["deadLetter", "orderingScope"]);
  assert.deepEqual(meets({ delivery: "at-most-once" }, { delivery: ["at-least-once"] }).unmet, [{ field: "delivery", wanted: ["at-least-once"], have: "at-most-once" }]);
});

test("the registry judges before it records: a refusal is kept with its reasons, and nothing of it is registered", () => {
  const reg = createAdapterRegistry(vocab);
  assert.equal(reg.register(declaration(), "pack:example").ok, true);
  const bad = reg.register(declaration({ id: "example.broken", family: "nope" }), "project");
  assert.equal(bad.ok, false);
  assert.equal(reg.get("example.broken"), null);
  assert.equal(reg.register(declaration(), "project").ok, false, "one id, one adapter");
  assert.deepEqual(reg.refused().map((r) => r.id), ["example.broken", "example.reference"]);
  assert.deepEqual(reg.serving("messaging", "example-mq").map((a) => a.id), ["example.reference"]);
  assert.deepEqual(reg.serving("messaging", "another-mq"), []);
});

test("the semantics catalog is rows of known kinds, and a later layer may only add a field or repeat one exactly", () => {
  assert.deepEqual(vocab.problems, []);
  const merged = mergeSemantics([
    { layer: "orbit", from: "catalog", doc: SEMANTICS },
    { layer: "project", from: "project a.json", doc: { fields: [{ id: "delivery", kind: "enum", values: ["whatever"] }, { id: "sessionAffinity", kind: "enum", values: ["sticky", "none"] }, { id: "odd", kind: "colour" }] } },
  ]);
  assert.ok(merged.fields.has("sessionAffinity"));
  assert.ok(merged.problems.some((p) => /delivery is already declared by catalog differently — refused/.test(p)));
  assert.ok(merged.problems.some((p) => /kind "colour"/.test(p)));
  assert.deepEqual(semanticsFindings(merged, { sessionAffinity: "sticky" }, "a").problems, []);
});

test("the semantics layers are read without creating anything", () => {
  const io = fakeIo();
  const before = io.files.size;
  const sem = loadSemantics({ pluginRoot: ROOT.replace(/.*/, "/nowhere"), storeBase: "/s", storeRoot: "/s/r", io });
  assert.ok(sem.problems.some((p) => /catalog[\\/]semantics\.json/.test(p)));
  assert.equal(io.files.size, before);
});
