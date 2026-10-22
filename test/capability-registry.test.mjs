// The capability registry, and the pipeline every invocation goes through.
//
// The pipeline is the point. A generated QC script that spawned a client itself
// would have no input check, no mutation guard, no tool check, no typed outcome,
// nothing in the log — and, worst of all, would report its own crash as the
// product misbehaving.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { invokeCapability } from "../src/capability/invoke.mjs";
import { Blocked, Refused, StepError } from "../src/errors.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeTools } from "./fakes/tools.mjs";

const ROWS = { id: "acme.registry", apiVersion: "orbit.capability/v1", doc: "rows", inputSchema: { q: { type: "string", esc: "sql", doc: "a statement" }, limit: { type: "integer", minimum: 1, doc: "at most" } }, required: ["q"], invoke: (ext, input) => ({ asked: input.q }) };

const refusal = (fn) => {
  try { fn(); } catch (e) { return e; }
  return null;
};

function registryWith(...caps) {
  const registry = createCapabilityRegistry();
  for (const c of caps) registry.register(c, "acme");
  return registry;
}

function contextWith(cap, { tools, destructive = false } = {}) {
  const base = fakeContext();
  const proc = fakeProcess();
  const ctx = { ...base, capabilities: registryWith(cap), process: proc, tools: tools ?? fakeTools({ psql: { ok: true, said: "16" } }), proc };
  return { ctx, run: { c: { id: "x", destructive }, values: {}, log: { record: () => {} } } };
}

const ask = (cap, input, opts) => {
  const { ctx, run } = contextWith(cap, opts);
  return invokeCapability(ctx, run, { capability: cap.id, input });
};

test("an id must be namespaced — a bare word is a name two providers would both claim", () => {
  const registry = createCapabilityRegistry();
  for (const id of ["query", "get", "Verify", "a.", ".b"]) {
    assert.match(refusal(() => registry.register({ ...ROWS, id }, "acme")).message, /id does not look like/, id);
  }
  assert.doesNotThrow(() => registry.register({ ...ROWS, id: "postgres.query" }, "acme"));
  assert.doesNotThrow(() => registry.register({ ...ROWS, id: "msgraph.driveItem.get" }, "acme"));
  assert.doesNotThrow(() => registry.register({ ...ROWS, id: "project.orders.find" }, "acme"));
});

test("a duplicate id is REFUSED and names the owner — never last-one-wins", () => {
  const registry = registryWith(ROWS);
  const e = refusal(() => registry.register(ROWS, "someone-else"));
  assert.ok(e instanceof Refused, String(e));
  assert.match(e.message, /already registered by acme/);
  assert.match(e.message, /two definitions of one id is two answers to one question/);
});

test("a malformed capability is a sentence, not a TypeError on .invoke", () => {
  const registry = createCapabilityRegistry();
  const { invoke, ...noInvoke } = ROWS;
  assert.match(refusal(() => registry.register(noInvoke, "acme")).message, /has no invoke\(ext, input\)/);
  assert.match(refusal(() => registry.register({ ...ROWS, doc: undefined }, "acme")).message, /no doc/);
  assert.match(refusal(() => registry.register({ ...ROWS, nonesuch: 1 }, "acme")).message, /unknown key "nonesuch"/);
  assert.match(refusal(() => registry.register({ ...ROWS, apiVersion: "orbit.capability/v9" }, "acme")).message, /apiVersion must be/);
  assert.match(refusal(() => registry.register("postgres.query", "acme")).message, /a capability is an object/);
});

test("resolving one nobody registered names what this project DOES offer", () => {
  const registry = registryWith(ROWS);
  assert.match(refusal(() => registry.resolve("redis.get")).message, /this project offers acme\.registry/);
  assert.match(refusal(() => createCapabilityRegistry().resolve("redis.get")).message, /has registered none at all/);
});

test("the answer comes back untouched, and the input reaches invoke as declared", () => {
  assert.deepEqual(ask(ROWS, { q: "SELECT 1" }), { asked: "SELECT 1" });
});

// The first gate. A case asking for something the capability cannot accept is
// the CASE being wrong — bad usage, an obvious fix, REFUSED.
test("an input the capability cannot accept is REFUSED, with every problem at once", () => {
  const e = refusal(() => ask(ROWS, { limit: "many", nonesuch: 1 }));
  assert.ok(e instanceof Refused, String(e));
  assert.match(e.message, /no q/);
  assert.match(e.message, /limit must be a whole number/);
  assert.match(e.message, /unknown key "nonesuch" — it accepts q, limit/);
});

test("a capability that declares no inputSchema is asked nothing — silence is not a licence to invent a rule", () => {
  const loose = { id: "acme.loose", apiVersion: "orbit.capability/v1", doc: "x", invoke: (ext, input) => input };
  assert.deepEqual(ask(loose, { whatever: 1 }), { whatever: 1 });
});

// The second gate, and it reuses the guard a destructive case already has rather
// than inventing a second one.
test("a capability that can change the world may only be reached from a case that said so", () => {
  const writer = { ...ROWS, id: "acme.write", mutates: true };
  const e = refusal(() => ask(writer, { q: "x" }));
  assert.ok(e instanceof Refused, String(e));
  assert.match(e.message, /declares that it can change external state, and nothing allows this run to — no test grant was minted for this run\. A person's case that writes declares "destructive": true/);
  assert.deepEqual(ask(writer, { q: "x" }, { destructive: true }), { asked: "x" });
});

// The third gate. The same answer the sql verb already gives for a database
// behind a VPN, and it has to be the same or a team learns to ignore red.
test("a declared tool this machine lacks is BLOCKED and says nothing was proved wrong", () => {
  const needy = { ...ROWS, id: "acme.needy", tools: ["psql", "pg_dump"] };
  const e = refusal(() => ask(needy, { q: "x" }, { tools: fakeTools({ psql: { ok: true, said: "16" } }) }));
  assert.ok(e instanceof Blocked, String(e));
  assert.match(e.message, /needs pg_dump \(not found on PATH\)/);
  assert.match(e.message, /nothing about it was proved wrong/);
  assert.match(e.message, /query doctor/);
});

// The one this engine is least willing to get wrong.
test("a capability that crashes is the TOOL failing — BLOCKED, never a product defect", () => {
  const broken = { ...ROWS, id: "acme.broken", invoke: () => { throw new TypeError("cannot read x of undefined"); } };
  const e = refusal(() => ask(broken, { q: "x" }));
  assert.ok(e instanceof Blocked, String(e));
  assert.match(e.message, /That is the tool failing, not the product/);
});

test("a capability may still say the PRODUCT is wrong, and that stays a failure", () => {
  const strict = { ...ROWS, id: "acme.strict", invoke: () => { throw new StepError("the row is not there"); } };
  const e = refusal(() => ask(strict, { q: "x" }));
  assert.ok(e instanceof StepError, String(e));
  assert.equal(e.message, "the row is not there");
});

test("the gates run in order — an input problem is reported before a missing tool", () => {
  const needy = { ...ROWS, id: "acme.needy", tools: ["nothing-here"] };
  const e = refusal(() => ask(needy, {}, { tools: fakeTools({}) }));
  assert.ok(e instanceof Refused, "the case's own mistake comes first");
  assert.match(e.message, /no q/);
});

test("the invocation is recorded, so a report can show what was asked and of whom", () => {
  const { ctx, run } = contextWith(ROWS);
  const recorded = [];
  invokeCapability(ctx, { ...run, log: { record: (r) => recorded.push(r) } }, { capability: ROWS.id, input: { q: "SELECT 1" } });
  assert.deepEqual(recorded, [{ kind: "capability", id: "acme.registry", by: "acme", mutates: false, result: { asked: "SELECT 1" } }]);
});

// ---- what a capability provides, and the connection it needs ---------------------------

const READER = { ...ROWS, id: "tracker.read", provides: ["workitem.read", "workitem.comments.read"], connection: "tracker-a", inputSchema: { id: { type: "string", esc: "text", doc: "the item" } }, required: ["id"], invoke: (ext, input) => ({ asked: input.id }) };

const withConnections = ({ ctx, run }, connections) => ({ ctx: { ...ctx, ...(connections ? { connections } : {}) }, run });

const askWith = (cap, input, connections, opts) => {
  const { ctx, run } = withConnections(contextWith(cap, opts), connections);
  return invokeCapability(ctx, run, { capability: cap.id, input });
};

test("a capability may say what it provides and which connection it needs, and the registry keeps both", () => {
  const registry = registryWith(READER);
  assert.deepEqual(registry.resolve("tracker.read").provides, ["workitem.read", "workitem.comments.read"]);
  assert.equal(registry.resolve("tracker.read").connection, "tracker-a");
  assert.deepEqual(registryWith(ROWS).resolve("acme.registry").provides, undefined, "both are optional: a capability that says neither is what it always was");
});

test("what it provides is held to capability ids, and the connection to a provider slug -- before anything registers", () => {
  const registry = createCapabilityRegistry();
  const wrong = (over) => refusal(() => registry.register({ ...READER, ...over }, "acme"))?.message ?? "";
  assert.match(wrong({ provides: ["workitem.read", "Not An Id"] }), /provides "Not An Id" is not a capability id/);
  assert.match(wrong({ provides: ["query"] }), /provides "query" is not a capability id/);
  assert.match(wrong({ provides: "workitem.read" }), /provides must be an array/);
  assert.match(wrong({ connection: "Tracker A" }), /connection does not look like/);
  assert.equal(registry.ids().length, 0, "nothing half-registered");
});

test("a capability that needs a connection nobody set up is BLOCKED, and says nothing was proved wrong", () => {
  for (const connections of [undefined, { has: () => false }]) {
    const e = refusal(() => askWith(READER, { id: "88" }, connections));
    assert.ok(e instanceof Blocked, String(e));
    assert.match(e.message, /needs a connection for tracker-a, and none is set up here/);
    assert.match(e.message, /nothing about it was proved wrong/);
    assert.match(e.message, /Orbit Control/);
  }
});

test("with the connection there, it runs; and a capability that names none is not asked about connections at all", () => {
  assert.deepEqual(askWith(READER, { id: "88" }, { has: (provider) => provider === "tracker-a" }), { asked: "88" });
  assert.deepEqual(ask(ROWS, { q: "SELECT 1" }), { asked: "SELECT 1" }, "no connections bound, none needed");
});

test("the connection gate is the last: input, then mutation, then tools, then connection", () => {
  const needy = { ...READER, mutates: true, tools: ["psql", "pg_dump"] };
  const first = refusal(() => askWith(needy, {}, undefined, { tools: fakeTools({ psql: { ok: true } }) }));
  assert.ok(first instanceof Refused && /no id/.test(first.message), String(first));
  const second = refusal(() => askWith(needy, { id: "1" }, undefined, { tools: fakeTools({ psql: { ok: true } }) }));
  assert.match(second.message, /declares that it can change external state/);
  const third = refusal(() => askWith({ ...needy, mutates: false }, { id: "1" }, undefined, { tools: fakeTools({ psql: { ok: true } }) }));
  assert.match(third.message, /needs pg_dump/);
  const fourth = refusal(() => askWith({ ...needy, mutates: false }, { id: "1" }, undefined, { tools: fakeTools({ psql: { ok: true }, pg_dump: { ok: true } }) }));
  assert.match(fourth.message, /needs a connection for tracker-a/);
});
