// Writing generated tests (ADR 0037, 0038): the fixture-write mode needs proven isolation and a
// fixture of the run's own; a case that creates only through capabilities that write is safe to
// re-run because of its fixture, never because of a skip-if a pageless case cannot even
// evaluate -- and the run refuses unless that fresh fixture is really there.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { blockers } from "../src/investigation/gates.mjs";
import { MODE_IDS, modeOf } from "../src/investigation/vocab.mjs";
import { fixtureGate } from "../src/run/gates/fixture.mjs";
import { Refused } from "../src/errors.mjs";
import { join } from "node:path";
import { UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));

const capabilities = createCapabilityRegistry();
capabilities.register({ id: "orbit.http.write", apiVersion: "orbit.capability/v1", doc: "writes", page: false, mutates: true, effects: ["write"], invoke: () => ({}) }, "pack:orbit-api-test");
capabilities.register({ id: "orbit.http.read", apiVersion: "orbit.capability/v1", doc: "reads", page: false, effects: ["read"], invoke: () => ({}) }, "pack:orbit-api-test");
const capabilityOf = (id) => (capabilities.has(id) ? capabilities.resolve(id) : null);

const CREATES = {
  id: "invoice-create",
  name: "a generated create through the API",
  seen: "src",
  creates: "an invoice in the run's fixture",
  steps: [
    { do: "call", capability: "orbit.http.write", proves: "api", input: { endpointRef: "backend", method: "POST", path: "/invoices", body: { name: "TC-1" } }, expect: "it.status === 201" },
    { do: "call", capability: "orbit.http.read", proves: "api", input: { endpointRef: "backend", method: "GET", path: "/invoices?name=TC-1" }, expect: "it.status === 200" },
    { do: "sql", query: "SELECT COUNT(*) AS n FROM invoices WHERE name = 'TC-1'", expect: "Number(it[0].n) === 1" },
  ],
};

const world = (runtime) => ({ settings: { enabled: true, environments: [{ id: "sbx", kind: "sandbox", modes: ["fixture-write"] }], identities: [], limits: { actions: 10, minutes: 10 } }, environment: { id: "sbx", kind: "sandbox", modes: ["fixture-write"] }, mode: "fixture-write", runtime });

test("fixture-write is a mode that writes, never on production, and only isolated, under grants", () => {
  assert.ok(MODE_IDS.includes("fixture-write"));
  assert.deepEqual([modeOf("fixture-write").mutates, modeOf("fixture-write").production, modeOf("fixture-write").isolated, modeOf("fixture-write").grants], [true, false, true, true]);
});

test("fixture-write is BLOCKED without proven isolation and without a fixture of the run's own", () => {
  const ids = (runtime) => blockers(world(runtime)).map((b) => b.id);
  assert.deepEqual(ids(undefined).filter((id) => ["NOT_ISOLATED", "NO_FIXTURE"].includes(id)), ["NOT_ISOLATED", "NO_FIXTURE"]);
  assert.deepEqual(ids({ environment: "sbx", isolated: false, fixture: { namespace: "orbit-ab12" }, current: true }).filter((id) => id === "NOT_ISOLATED"), ["NOT_ISOLATED"]);
  assert.deepEqual(ids({ environment: "sbx", isolated: true, fixture: { namespace: "orbit-ab12" }, current: true }).filter((id) => ["NOT_ISOLATED", "NO_FIXTURE"].includes(id)), []);
  assert.equal(blockers(world({ environment: "sbx", isolated: true, fixture: { namespace: "orbit-ab12" }, current: true })).some((b) => b.stop === "refused" && b.id === "NOT_ISOLATED"), false, "isolation missing is the machine's news: blocked, never refused");
});

test("a case that creates only through capabilities that write needs no skip-if -- its fixture is its guard", () => {
  assert.deepEqual(validate(CREATES, graph, undefined, undefined, capabilityOf).filter((f) => /skip-if guard/.test(f)), []);
  assert.ok(validate(CREATES, graph).some((f) => /skip-if guard/.test(f)), "without the capabilities in hand nothing is assumed: the guard is still asked for");
});

test("the run refuses such a case unless a fresh fixture namespace is there, and a person's destructive case is the destructive gate's", () => {
  const run = { c: CREATES };
  assert.throws(() => fixtureGate({ capabilities }, run), (e) => e instanceof Refused && /no fresh fixture namespace/.test(e.message));
  assert.doesNotThrow(() => fixtureGate({ capabilities, fixture: { namespace: "orbit-ab12", fresh: true } }, run));
  assert.doesNotThrow(() => fixtureGate({ capabilities }, { c: { ...CREATES, destructive: true } }));
  assert.doesNotThrow(() => fixtureGate({ capabilities }, { c: { ...CREATES, creates: undefined } }));
});

test("fixture-write never writes through the screen: a control the map says writes is refused there, and allowed in explore-write", () => {
  const edge = { from: "list-things", via: "Save", writes: true, why: "saves a thing" };
  const w = (mode) => ({ ...world({ environment: "sbx", isolated: true, fixture: { namespace: "orbit-ab12" }, current: true }), mode, environment: { id: "sbx", kind: "sandbox", modes: ["fixture-write", "explore-write"] }, edge });
  assert.ok(blockers(w("fixture-write")).some((b) => b.id === "WRITES"), "a screen write under fixture-write would escape the grants");
  assert.equal(blockers(w("explore-write")).some((b) => b.id === "WRITES"), false);
});
