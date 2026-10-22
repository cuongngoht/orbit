// System graph facts (ADR 0033; doc §4.2): a node and a relation come through the one door every
// architecture fact does, held to keys that make one edge one fact, to `unknown` for an end nobody
// could fix, and to attributes that never keep a secret. A relation nobody's vocabulary declares is
// kept and shown and derives nothing; a stale scope makes a fact stale, never false; and a
// candidate citing a file the repository does not track is refused with the rest of its batch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { judge, parseCandidates, trackedSet } from "../src/architecture/record.mjs";
import { graphOf } from "../src/architecture/graph-view.mjs";
import { UNKNOWN_END, relationKey } from "../src/architecture/relations.mjs";
import { kindRow } from "../src/architecture/vocab.mjs";
import { STALE, factState, measure } from "../src/freshness.mjs";
import { mergeVocabulary } from "../src/topology/vocabulary.mjs";
import { memorySource } from "./fakes/source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VOCAB = mergeVocabulary([{ layer: "orbit", from: "catalog/topology.json", doc: JSON.parse(readFileSync(join(ROOT, "catalog/topology.json"), "utf8")) }]);

const FILES = ["src/worker/consumer.cs", "src/worker/Program.cs", "src/api/routes.cs", "compose.yaml"];
const TRACKED = trackedSet(FILES);
const of = (...facts) => judge(parseCandidates(facts.map((f) => JSON.stringify(f)).join("\n")), { tracked: TRACKED, stamps: { commit: "abc1234" } });

const node = (over = {}) => ({ kind: "node", key: "queue:billing.reminders", nodeKind: "queue", name: "billing.reminders", transport: "amqp-0-9-1", attributes: { routingKey: "invoice.created" }, statement: "billing.reminders is a queue the worker reads", scope: ["src/worker"], evidence: ["src/worker/consumer.cs"], source: "repository", confidence: "certain", unknowns: [], ...over });
const worker = (over = {}) => node({ key: "worker:reminder-worker", nodeKind: "worker", name: "reminder-worker", of: "component:billing", transport: undefined, attributes: undefined, statement: "reminder-worker is a hosted worker", evidence: ["src/worker/Program.cs"], ...over });
const edge = (over = {}) => {
  const base = { kind: "relation", relation: "consumes-from", from: "worker:reminder-worker", to: "queue:billing.reminders", statement: "the reminder worker consumes billing.reminders", scope: ["src/worker"], evidence: ["src/worker/consumer.cs"], source: "repository", confidence: "certain", unknowns: [], ...over };
  return { key: relationKey(base), ...base, ...(over.key ? { key: over.key } : {}) };
};

test("graph facts are architecture kinds, and only they carry the graph's fields", () => {
  assert.deepEqual(kindRow("node").fields, ["nodeKind", "name", "of", "transport", "attributes"]);
  assert.deepEqual(kindRow("relation").fields, ["relation", "from", "to", "attributes"]);
  const v = of(node(), worker(), edge());
  assert.equal(v.refused, false, v.rejected.map((r) => r.why).join("\n"));
  assert.deepEqual(v.accepted.map((f) => f.kind), ["node", "node", "relation"]);
  assert.match(v.accepted[2].id, /^arch-relation-[0-9a-f]+$/);
  assert.match(of({ ...node(), kind: "module", key: "src/worker" }).rejected[0].why, /nodeKind belongs to a node fact, not to a module one/);
});

test("a candidate citing a file the repository does not track is refused, and the whole batch with it", () => {
  const v = of(node(), edge({ evidence: ["src/worker/invented.cs"] }));
  assert.equal(v.refused, true);
  assert.deepEqual(v.accepted, []);
  assert.match(v.rejected[0].why, /evidence "src\/worker\/invented.cs" is not tracked here/);
});

test("one edge recorded twice is ONE fact: a relation's key is exactly its from, its relation and its to; a node's is its kind and its name", () => {
  assert.match(of(edge({ key: "the worker reads the queue" })).rejected[0].why, /a relation's key is exactly "worker:reminder-worker consumes-from queue:billing.reminders"/);
  assert.match(of(node({ key: "billing.reminders" })).rejected[0].why, /a node's key is its kind and its name — "queue:billing.reminders"/);
  assert.equal(of(node({ key: "queue:broker-a/billing.reminders" })).refused, false, "qualified in between is still its kind and its name");
  assert.equal(of(node({ key: "queue:xbilling.reminders" })).refused, true, "a name that only ends the same is another name");
  const long = "w".repeat(200);
  assert.equal(of(node({ key: `worker:${long}`, nodeKind: "worker", name: long }), edge({ from: `worker:${long}`, to: `queue:${"q".repeat(200)}` })).rejected.some((r) => /key/.test(r.why)), false, "a relation between two long keys is not refused for its length");
  const twice = of(edge(), edge({ statement: "said another way" }));
  assert.equal(new Set(twice.accepted.map((f) => f.id)).size, 1, "the same subject is the same id");
});

test("an end the source does not fix is unknown -- never certain, always said -- and two unknown ends say nothing", () => {
  const open = edge({ to: UNKNOWN_END, confidence: "possible", unknowns: ["the queue name is read from configuration at run time"] });
  assert.equal(of(open).refused, false);
  assert.match(of({ ...open, confidence: "certain" }).rejected[0].why, /an edge with an unknown end is never certain/);
  assert.match(of({ ...open, unknowns: [] }).rejected[0].why, /says, in unknowns, what is unknown/);
  assert.match(of(edge({ from: UNKNOWN_END, to: UNKNOWN_END, confidence: "unknown", unknowns: ["x"] })).rejected[0].why, /two unknown ends says nothing/);
});

test("an attribute is a flat value a file declared, and never a secret or a URL carrying one", () => {
  const says = (attributes) => of(node({ attributes })).rejected.map((r) => r.why).join("\n");
  assert.match(says({ password: "hunter2" }), /attribute password is named like a secret/);
  assert.match(says({ connectionString: "x" }), /attribute connectionString is named like a secret/);
  assert.match(says({ url: "amqp://orbit:s3cret@broker:5672/" }), /a URL that carries a credential/);
  assert.match(says({ nested: { a: 1 } }), /a string, a number or true\/false/);
  assert.match(says({ "two words": "x" }), /is not a name/);
  assert.match(says(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`a${i}`, i]))), /at most 32 attributes/);
  assert.equal(of(node({ attributes: { exchange: "billing", durable: true, prefetch: 10 } })).refused, false);
});

test("a relation nobody's vocabulary declares is kept, shown with no role, and derives nothing -- not even a conflict", () => {
  const unknownName = edge({ relation: "mirrors" });
  const v = of(node(), worker(), unknownName);
  assert.equal(v.refused, false, "an undeclared relation is legal");
  const g = graphOf(v.accepted, VOCAB);
  const r = g.relations.find((x) => x.relation === "mirrors");
  assert.deepEqual([r.role, r.declared, r.conflicts], [null, false, []]);
  assert.equal(g.counts.undeclared, 1);
});

test("a declared relation whose role does not fit its ends, and an end no node holds, are conflicts -- shown, never resolved", () => {
  const db = node({ key: "database:billing", nodeKind: "database", name: "billing", transport: undefined, attributes: undefined, statement: "billing is a database" });
  const g = graphOf(of(db, worker(), edge({ relation: "publishes-to", to: "database:billing" }), edge({ relation: "reads", from: "worker:ghost", to: "database:billing" })).accepted, VOCAB);
  const kinds = g.conflicts.map((c) => [c.kind, c.end]);
  assert.deepEqual(kinds.sort(), [["dangling", "from"], ["role", "to"]].sort());
  assert.match(g.conflicts.find((c) => c.kind === "role").says, /a publishes-to \(publish\) may not end at a data-resource — its role allows channel/);
});

test("a stale scope makes a graph fact stale -- re-read it -- never false, and never another graph", () => {
  const source = memorySource({ "src/worker/consumer.cs": "consume(\"billing.reminders\")", "src/worker/Program.cs": "worker" });
  const accepted = of(node(), worker(), edge()).accepted;
  const scopes = measure(accepted, null, source);
  const model = { scopes: Object.fromEntries(Object.entries(scopes).map(([k, v]) => [k, { hash: v.hash }])) };
  source.write("src/worker/consumer.cs", "consume(queueFromSettings())");
  const now = measure(accepted, model, source);
  const relation = accepted.find((f) => f.kind === "relation");
  assert.equal(factState(relation, now), STALE);
  const before = graphOf(accepted, VOCAB);
  const after = graphOf(accepted.map((f) => ({ ...f, status: "stale" })), VOCAB);
  assert.equal(after.digest, before.digest, "freshness is shown, never digested");
  assert.equal(after.relations.length, 1, "a stale fact is still in the graph");
  assert.equal(after.counts.notFresh, 3);
});
