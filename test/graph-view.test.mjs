// The system graph is a PROJECTION (ADR 0033; doc §4.2): folded from node and relation facts on
// every read, its roles read off the vocabulary and never off a fact, linked to another subject by
// id only, and digested over what it means -- the same digest in any fact or key order, a different
// one when a meaning moves, the same one when only freshness does. An investigation freezes the
// projection it derived from, once, and refuses one edited after it was projected.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GRAPH_VIEW_VERSION, graphDigestOf, graphOf } from "../src/architecture/graph-view.mjs";
import { Refused } from "../src/errors.mjs";
import { freezeGraph } from "../src/investigation/graphs.mjs";
import { createInvestigations } from "../src/investigation/store.mjs";
import { mergeVocabulary } from "../src/topology/vocabulary.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = JSON.parse(readFileSync(join(ROOT, "catalog/topology.json"), "utf8"));
const VOCAB = mergeVocabulary([{ layer: "orbit", from: "catalog/topology.json", doc: CATALOG }]);

const base = { statement: "s", scope: ["src"], evidence: ["src/a.cs"], source: "repository", confidence: "certain", status: "fresh", unknowns: [] };
const node = (nodeKind, name, over = {}) => ({ ...base, kind: "node", id: `arch-node-${nodeKind}${name}`.replace(/[^a-z0-9-]/g, ""), key: `${nodeKind}:${name}`, nodeKind, name, ...over });
const rel = (from, relation, to, over = {}) => ({ ...base, kind: "relation", id: `arch-relation-${from}${to}`.replace(/[^a-z0-9-]/g, ""), key: `${from} ${relation} ${to}`, relation, from, to, ...over });

const FACTS = [
  node("component", "billing"),
  node("worker", "reminder-worker", { of: "component:billing" }),
  node("queue", "billing.reminders", { transport: "amqp-0-9-1", attributes: { routingKey: "invoice.created", durable: true } }),
  node("endpoint", "invoices"),
  node("saga-orchestrator", "refunds"),
  rel("worker:reminder-worker", "consumes-from", "queue:billing.reminders"),
  rel("component:billing", "publishes-to", "unknown", { confidence: "possible", unknowns: ["the topic is configured at run time"] }),
  { kind: "module", id: "arch-module-x", key: "src", statement: "not a graph fact" },
];

test("the projection holds the node and relation facts only, in key order, with roles from the vocabulary", () => {
  const g = graphOf(FACTS, VOCAB);
  assert.equal(g.v, GRAPH_VIEW_VERSION);
  assert.deepEqual(g.nodes.map((n) => n.key), ["component:billing", "endpoint:invoices", "queue:billing.reminders", "saga-orchestrator:refunds", "worker:reminder-worker"]);
  assert.deepEqual(g.nodes.map((n) => n.role), ["component", "interface", "channel", null, "workload"]);
  assert.equal(g.nodes.find((n) => n.nodeKind === "saga-orchestrator").declared, false, "a kind no layer declares is kept and shown");
  assert.deepEqual(g.relations.map((r) => [r.relation, r.role, r.resolved]), [["publishes-to", "publish", { from: true, to: false }], ["consumes-from", "consume", { from: true, to: true }]]);
  assert.deepEqual(g.conflicts, [], "an unknown end is said, never a dangling conflict");
  assert.deepEqual(g.counts, { nodes: 5, relations: 2, undeclared: 1, unknownEnds: 1, notFresh: 0, conflicts: 0 });
  assert.match(g.digest, /^[0-9a-f]{64}$/);
});

test("the digest is the same in any fact order and any key order, and moves only when a meaning does", () => {
  const g = graphOf(FACTS, VOCAB);
  const shuffled = [...FACTS].reverse().map((f) => Object.fromEntries(Object.entries(f).reverse()));
  assert.equal(graphOf(shuffled, VOCAB).digest, g.digest);
  assert.equal(graphOf(FACTS.map((f) => ({ ...f, status: "stale", at: "2026-10-22T00:00:00Z", evidence: ["src/b.cs"] })), VOCAB).digest, g.digest, "freshness, a date and where it was read are not what the graph means");
  const moved = FACTS.map((f) => (f.key === "queue:billing.reminders" ? { ...f, attributes: { routingKey: "invoice.paid", durable: true } } : f));
  assert.notEqual(graphOf(moved, VOCAB).digest, g.digest, "an attribute is what the graph means");
  assert.notEqual(graphOf(FACTS.map((f) => (f.relation === "consumes-from" ? { ...f, confidence: "possible" } : f)), VOCAB).digest, g.digest, "so is how sure an edge is");
  const renamed = mergeVocabulary([{ layer: "orbit", from: "c", doc: CATALOG }, { layer: "project", from: "p.json", doc: { nodeKinds: [{ id: "saga-orchestrator", role: "workload" }] } }]);
  assert.notEqual(graphOf(FACTS, renamed).digest, g.digest, "a vocabulary row that gives a name a role changes what the graph means");
  assert.equal(graphOf(FACTS, renamed).nodes.find((n) => n.nodeKind === "saga-orchestrator").role, "workload");
});

test("a key said twice is one view, the first by id", () => {
  const twice = [...FACTS, node("component", "billing", { id: "arch-node-zzz", attributes: { image: "other" } })];
  const g = graphOf(twice, VOCAB);
  assert.equal(g.nodes.filter((n) => n.key === "component:billing").length, 1);
  assert.deepEqual(g.nodes.find((n) => n.key === "component:billing").attributes, {});
});

test("another subject's ids link a node by id only -- the right role and the same name -- and never enter the digest", () => {
  const joins = [{ id: "ui-map", roles: ["interface"], ids: ["invoices", "billing"] }, { id: "runtime", roles: ["component"], ids: ["billing"] }];
  const g = graphOf(FACTS, VOCAB, joins);
  assert.deepEqual(g.nodes.find((n) => n.key === "endpoint:invoices").links, { "ui-map": "invoices" });
  assert.deepEqual(g.nodes.find((n) => n.key === "component:billing").links, { runtime: "billing" }, "the ui map's id `billing` names no interface here");
  assert.deepEqual(g.nodes.find((n) => n.key === "queue:billing.reminders").links, {});
  assert.equal(g.digest, graphOf(FACTS, VOCAB).digest);
});

test("an empty snapshot is an empty graph with a digest of its own, and no vocabulary means every name undeclared", () => {
  const g = graphOf([], VOCAB);
  assert.deepEqual([g.nodes, g.relations, g.counts.nodes], [[], [], 0]);
  assert.equal(graphOf(FACTS).nodes.every((n) => n.role === null), true);
});

const ID = "inv-20261021-120000-abcd";

function investigation() {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "derive the reminder obligations", mode: "observe" });
  return { io, store, w: { store, io, id: ID } };
}

test("an investigation freezes the graph it derived from once, under its digest, and refuses one edited after it was projected", () => {
  const t = investigation();
  const g = graphOf(FACTS, VOCAB);
  const kept = freezeGraph(t.w, g);
  assert.equal(kept.kind, "graphs");
  assert.equal(kept.graph, g.digest);
  assert.match(kept.path, /^artifacts\/graphs\/[0-9a-f]{64}\.json$/);
  assert.deepEqual(t.store.readArtifact(ID, "graphs", kept.digest).nodes.map((n) => n.key), g.nodes.map((n) => n.key));
  assert.deepEqual(freezeGraph(t.w, g), kept, "the same graph again is nothing new");
  const edited = { ...g, nodes: g.nodes.map((n) => (n.key === "queue:billing.reminders" ? { ...n, name: "billing.paid" } : n)) };
  assert.throws(() => freezeGraph(t.w, edited), (e) => e instanceof Refused && /changed after it was projected/.test(e.message));
  assert.equal(graphDigestOf(edited) === g.digest, false);
});
