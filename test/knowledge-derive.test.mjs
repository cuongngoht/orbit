// From what a change touches to what would prove it -- derived by ROLE, and
// resolved by the engine's own requirement graph and resource resolver.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createKnowledgeParts } from "../src/extensions/knowledge-parts.mjs";
import { derive } from "../src/knowledge/derive.mjs";
import { ingest } from "../src/knowledge/ingest.mjs";
import { resolved } from "../src/knowledge/verify.mjs";
import { tokens } from "../src/tokens.mjs";
import { candidate, knowledgeWorld, registryOf, seenBy } from "./fakes/knowledge.mjs";

const VOCAB = [
  { id: "causes", role: "consequence" },
  { id: "made-with", role: "implementation", cardinality: "one" },
  { id: "seen-in", role: "observation" },
  { id: "proved-by", role: "capability" },
];

const at = (over) => candidate({ evidence: ["src/app/group.ts"], ...over });

function chained(opts = {}) {
  const ctx = knowledgeWorld({ relations: VOCAB, ...opts });
  ingest(ctx, [
    at({ subject: "order.place", relation: "causes", object: "stock.reserved" }),
    at({ subject: "stock.reserved", relation: "made-with", object: "store.one", context: { site: "a" } }),
    at({ subject: "stock.reserved", relation: "made-with", object: "store.two", context: { site: "b" } }),
    at({ subject: "stock.reserved", relation: "seen-in", object: "stock.view" }),
    at({ subject: "stock.view", relation: "proved-by", object: "stock.view.read" }),
  ], { seenBy: seenBy() });
  return ctx;
}

const ask = (words, context = {}) => ({ tokens: tokens(words), subjects: [], context, near: [], changed: [] });

test("consequence → observation → capability, with the proof's slots kept apart", () => {
  const ctx = chained();
  const out = derive(ctx.know.all(), ask("order.place", { site: "a" }), ctx.parts);
  assert.deepEqual(out.subjects, ["order.place"]);
  assert.deepEqual(out.needs.map((n) => [n.capability, n.proves.consequence, n.proves.observation, n.conditional]), [["stock.view.read", "stock.reserved", "stock.view", false]]);
  assert.equal(out.needs[0].because.length, 3, "it cites the claims it rests on");
});

test("an implementation that differs by context never changes WHAT must be proved", () => {
  const ctx = chained();
  const a = derive(ctx.know.all(), ask("order.place", { site: "a" }), ctx.parts).needs.map((n) => n.capability);
  const b = derive(ctx.know.all(), ask("order.place", { site: "b" }), ctx.parts).needs.map((n) => n.capability);
  assert.deepEqual(a, b);
});

test("a consequence nothing observes is UNOBSERVABLE, and a relation nobody understands is UNINTERPRETED -- neither is guessed", () => {
  const ctx = knowledgeWorld({ relations: VOCAB });
  ingest(ctx, [at({ subject: "order.place", relation: "causes", object: "ledger.moved" }), at({ subject: "order.place", relation: "whispers-to", object: "other.thing" })], { seenBy: seenBy() });
  const out = derive(ctx.know.all(), ask("order.place"), ctx.parts);
  assert.deepEqual([out.needs.length, out.unobservable.map((u) => u.consequence), out.uninterpreted], [0, ["ledger.moved"], ["whispers-to"]]);
});

test("a loop is recorded and not followed; a path whose contexts disagree is dropped", () => {
  const ctx = knowledgeWorld({ relations: VOCAB });
  ingest(ctx, [at({ subject: "a.one", relation: "causes", object: "b.two" }), at({ subject: "b.two", relation: "causes", object: "a.one" }), at({ subject: "b.two", relation: "causes", object: "c.three", context: { site: "x" } }), at({ subject: "c.three", relation: "seen-in", object: "c.view", context: { site: "y" } })], { seenBy: seenBy() });
  const out = derive(ctx.know.all(), ask("a.one"), ctx.parts);
  assert.equal(out.cycles.length, 1);
  assert.ok(out.dropped.some((d) => /disagrees/.test(d.why)));
});

test("an interpreter receives exactly the relations it understands, frozen, and its needs are held to the contract", () => {
  const parts = createKnowledgeParts();
  let handed = null;
  parts.register({ interpreters: [{ id: "test.whispers", doc: "reads whispers", understands: ["whispers-to"], interpret: ({ claims }) => ((handed = claims), { needs: [{ capability: "Whisper.Check", because: [claims[0].id] }, { capability: "no", because: [claims[0].id] }, { capability: "whisper.other", because: ["k-000000000000"] }], notes: ["password=hunter2 was here"] }) }] }, "test-extension");
  const ctx = knowledgeWorld({ relations: VOCAB, parts });
  ingest(ctx, [at({ subject: "order.place", relation: "whispers-to", object: "other.thing" }), at({ subject: "order.place", relation: "causes", object: "x.y" })], { seenBy: seenBy() });
  const out = derive(ctx.know.all(), ask("order.place"), ctx.parts);
  assert.deepEqual(handed.map((c) => c.relation), ["whispers-to"]);
  assert.ok(Object.isFrozen(handed[0]));
  assert.deepEqual(out.needs.map((n) => [n.capability, n.by]), [["whisper.check", "test.whispers"]], "lower-cased; a non-id and an unhanded citation are dropped");
  assert.equal(out.problems.length, 2);
  assert.doesNotMatch(out.notes.join(), /hunter2/);
  assert.deepEqual(out.uninterpreted, [], "a relation an interpreter declares is understood");
});

test("a throwing interpreter reports its own defect and costs nothing else", () => {
  const parts = createKnowledgeParts();
  parts.register({ interpreters: [{ id: "test.broken", doc: "throws", understands: ["causes"], interpret: () => { throw new Error("boom"); } }] }, "broken-extension");
  const ctx = chainedWith(parts);
  const out = derive(ctx.know.all(), ask("order.place", { site: "a" }), ctx.parts);
  assert.equal(out.needs.length, 1, "the vocabulary still derives");
  assert.match(out.problems.join(), /test\.broken \(broken-extension\) threw/);
});

function chainedWith(parts) {
  const ctx = knowledgeWorld({ relations: VOCAB, parts });
  ingest(ctx, [at({ subject: "order.place", relation: "causes", object: "stock.reserved" }), at({ subject: "stock.reserved", relation: "seen-in", object: "stock.view" }), at({ subject: "stock.view", relation: "proved-by", object: "stock.view.read" })], { seenBy: seenBy() });
  return ctx;
}

// ---- resolution: the resolver stays authoritative --------------------------------

const need = (capability) => ({ capability, proves: { subject: "order.place" }, context: {}, conditional: false, tier: "source", because: ["k-1"], session: false, by: "vocabulary" });

test("a registered capability is PROVIDED; with none it is a GAP to prepare -- decided by the engine's own graph", () => {
  const provided = resolved([need("stock.view.read")], registryOf([{ id: "stock.view.read", doc: "reads the stock view", from: "a-project" }])).results[0];
  assert.deepEqual([provided.outcome, provided.provider.kind, provided.provider.id], ["provided", "capability", "stock.view.read"]);
  const gap = resolved([need("stock.view.read")], registryOf([])).results[0];
  assert.deepEqual([gap.outcome, gap.gap, gap.remedy, gap.status], ["gap", true, "prepare", "unprovided"]);
});

test("a provider whose own command is missing is IMPAIRED, never a gap: its health is doctor's business", () => {
  const impaired = resolved([need("stock.view.read")], registryOf([{ id: "stock.view.read", doc: "d", from: "p", tools: ["psql"] }])).results[0];
  assert.equal(impaired.outcome, "impaired");
  assert.equal(impaired.gap, false);
});
