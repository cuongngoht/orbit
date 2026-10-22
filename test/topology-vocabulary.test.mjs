// The system graph's words (ADR 0033): structural roles in the engine, names as data, and a
// name nobody declared still a name -- kept, shown, deriving nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BOUNDARIES, MEANINGS, NODE_ROLE_IDS, RELATION_ROLES, RELATION_ROLE_IDS, meaningAt } from "../src/topology/vocab.mjs";
import { catalogLayer, kindOf, loadVocabulary, mergeVocabulary, relationOf } from "../src/topology/vocabulary.mjs";
import { LAYERS } from "../src/dsl/verbs.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = JSON.parse(readFileSync(join(ROOT, "catalog/topology.json"), "utf8"));
const realIo = () => ({ exists: () => true, read: (p) => readFileSync(p, "utf8"), list: () => [] });

test("every relation role says which node roles may stand at each end, and only roles that exist", () => {
  for (const r of RELATION_ROLES) {
    assert.ok(r.from.length && r.to.length, `${r.id} names both ends`);
    for (const end of [...r.from, ...r.to]) assert.ok(NODE_ROLE_IDS.includes(end), `${r.id}: ${end} is a node role`);
  }
});

test("a meaning proves at most one DSL layer, and only a layer the DSL has", () => {
  for (const m of MEANINGS) assert.ok(m.layer === null || LAYERS.includes(m.layer), `${m.id}: ${m.layer}`);
  for (const b of BOUNDARIES) for (const m of b.provedBy) assert.ok(MEANINGS.some((x) => x.id === m), `${b.id} is proved by ${m}, which is a meaning`);
  assert.equal(meaningAt("response.body.error").id, "response.body", "a sub-path resolves to its longest known meaning");
  assert.equal(meaningAt("broker.queueDepth"), null, "a provider's field is no meaning");
});

test("the catalog names every node kind and relation with a role the engine knows -- names are data, roles are the engine's", () => {
  const vocab = mergeVocabulary([{ layer: "orbit", from: "catalog/topology.json", doc: CATALOG }]);
  assert.deepEqual(vocab.problems, []);
  for (const k of CATALOG.nodeKinds) assert.ok(NODE_ROLE_IDS.includes(k.role), k.id);
  for (const r of CATALOG.relations) assert.ok(RELATION_ROLE_IDS.includes(r.role), r.id);
  for (const role of RELATION_ROLE_IDS) assert.ok(CATALOG.relations.some((r) => r.role === role), `the starting vocabulary has a relation for ${role}`);
});

test("the catalog's fifteen relations are the document's: the synchronous six and the asynchronous nine", () => {
  const names = CATALOG.relations.map((r) => r.id);
  assert.deepEqual(names, ["calls", "reads", "writes", "authenticates", "authorizes", "crosses-boundary", "schedules", "triggers", "publishes-to", "consumes-from", "routes-to", "retries-via", "dead-letters-to", "checkpoints-at", "compensates"]);
});

test("a later layer adds names, means the same or is refused -- never silently redefines one", () => {
  const vocab = mergeVocabulary([
    { layer: "orbit", from: "catalog", doc: { nodeKinds: [{ id: "queue", role: "channel" }], relations: [{ id: "publishes-to", role: "publish" }] } },
    { layer: "organization", from: "org a.json", doc: { nodeKinds: [{ id: "queue", role: "channel" }, { id: "mailbox", role: "channel" }] } },
    { layer: "project", from: "project b.json", doc: { nodeKinds: [{ id: "queue", role: "data-resource" }, { id: "x", role: "not-a-role" }], relations: [{ role: "publish" }] } },
  ]);
  assert.equal(kindOf(vocab, "mailbox").role, "channel");
  assert.equal(kindOf(vocab, "queue").role, "channel", "the first declaration holds");
  assert.ok(vocab.notes.some((n) => /queue also declared/.test(n)));
  assert.ok(vocab.problems.some((p) => /queue is already declared by catalog with role channel — refused/.test(p)));
  assert.ok(vocab.problems.some((p) => /role "not-a-role"/.test(p)));
  assert.ok(vocab.problems.some((p) => /a row with no id/.test(p)));
});

test("a name no layer declares is answered, with no role, and marked undeclared", () => {
  const vocab = mergeVocabulary([]);
  assert.deepEqual(relationOf(vocab, "fans-out-to"), { id: "fans-out-to", role: null, doc: "", layer: null, from: null, declared: false });
});

test("the layers are read from the catalog, the organisation and the project -- and reading creates nothing", () => {
  const io = fakeIo();
  const base = "/store";
  const root = "/store/repo-1";
  io.files.set(join(base, "organization/topology/vocabulary/a.json"), JSON.stringify({ schema: 1, nodeKinds: [{ id: "ledger", role: "data-resource" }] }));
  io.dirs.add(join(base, "organization/topology/vocabulary"));
  io.files.set(join(root, "topology/vocabulary/b.json"), JSON.stringify({ schema: 2, nodeKinds: [{ id: "ignored", role: "channel" }] }));
  io.dirs.add(join(root, "topology/vocabulary"));
  const before = io.files.size;
  const vocab = loadVocabulary({ pluginRoot: "/nowhere", storeBase: base, storeRoot: root, io });
  assert.equal(kindOf(vocab, "ledger").layer, "organization");
  assert.equal(kindOf(vocab, "ignored").declared, false, "a file of another schema offers nothing");
  assert.ok(vocab.problems.some((p) => /catalog[\\/]topology\.json/.test(p)), "a missing catalog is said, never thrown");
  assert.ok(vocab.problems.some((p) => /not a schema 1 topology vocabulary file/.test(p)));
  assert.equal(io.files.size, before);
});

test("the shipped catalog loads through the real reader", () => {
  const layer = catalogLayer(ROOT, realIo());
  assert.equal(layer.problem, undefined);
  assert.equal(layer.doc.schema, 1);
});
