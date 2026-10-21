// Whether a control applies is read off the System Graph's structural roles (ADR 0040; doc §7):
// a role the graph holds is APPLICABLE with the refs that made it hold, an absence is NOT-APPLICABLE
// only on a graph complete for its scope and says why, everything else is UNKNOWN with what would
// settle it -- and a person's own mark is the one other way a control does not apply.
import assert from "node:assert/strict";
import { test } from "node:test";
import { APPLICABLE, BOUNDARY_SUBJECTS, NOT_APPLICABLE, UNKNOWN, applicabilityOf, predicateFindings } from "../src/qa/security/applicability.mjs";
import { BOUNDARY_IDS, NODE_ROLE_IDS, RELATION_ROLE_IDS } from "../src/topology/vocab.mjs";

const graph = (complete) => ({ nodes: [{ id: "orders-api", role: "interface" }, { id: "buyer", role: "principal" }], relations: [{ id: "buyer-may-read", role: "permission", from: "buyer", to: "orders-api" }], complete });
const control = (applies) => ({ id: "c-1", summary: "x", methods: ["runtime-test"], applies });

test("a role the graph holds is applicable, with the refs that made it hold", () => {
  const a = applicabilityOf(control({ all: [{ role: "interface" }, { relation: "permission" }] }), graph(false));
  assert.equal(a.state, APPLICABLE);
  assert.deepEqual(a.refs, ["orders-api", "buyer-may-read"]);
  assert.match(a.why, /role interface and relation permission/);
});

test("an absence is not-applicable only on a graph complete for its scope; otherwise unknown, with what would settle it", () => {
  const none = control({ role: "data-resource" });
  assert.deepEqual([applicabilityOf(none, graph(true)).state, applicabilityOf(none, graph(true)).why], [NOT_APPLICABLE, "the graph, complete for its scope, holds no role data-resource"]);
  const partial = applicabilityOf(none, graph(false));
  assert.deepEqual([partial.state, partial.settles], [UNKNOWN, "a graph that covers role data-resource"]);
  const noGraph = applicabilityOf(none, null);
  assert.equal(noGraph.state, UNKNOWN);
  assert.match(noGraph.settles, /System Graph/);
});

test("all and any are three-valued: one false sinks all, one true carries any, and an unknown stays unknown", () => {
  const partial = graph(false);
  assert.equal(applicabilityOf(control({ all: [{ role: "interface" }, { role: "schedule" }] }), partial).state, UNKNOWN);
  assert.equal(applicabilityOf(control({ all: [{ role: "interface" }, { role: "schedule" }] }), graph(true)).state, NOT_APPLICABLE);
  assert.equal(applicabilityOf(control({ any: [{ role: "schedule" }, { role: "interface" }] }), partial).state, APPLICABLE);
  assert.equal(applicabilityOf(control({ any: [{ role: "schedule" }, { role: "channel" }] }), partial).state, UNKNOWN);
  assert.equal(applicabilityOf(control({ any: [{ role: "schedule" }, { role: "channel" }] }), graph(true)).state, NOT_APPLICABLE);
});

test("an evidence boundary is read as what a result there is about, and every boundary has a subject", () => {
  assert.deepEqual(Object.keys(BOUNDARY_SUBJECTS).sort(), [...BOUNDARY_IDS].sort());
  for (const p of Object.values(BOUNDARY_SUBJECTS)) assert.deepEqual(predicateFindings(p), []);
  assert.equal(applicabilityOf(control({ boundary: "synchronous" }), graph(true)).state, APPLICABLE);
  assert.equal(applicabilityOf(control({ boundary: "publication" }), graph(true)).state, NOT_APPLICABLE);
});

test("a person's not-applicable mark wins, and says it was a person's", () => {
  const a = applicabilityOf(control({ role: "interface" }), graph(true), { why: "this interface is retired next sprint" });
  assert.deepEqual([a.state, a.by, a.why], [NOT_APPLICABLE, "person", "this interface is retired next sprint"]);
  assert.equal(applicabilityOf(control(undefined), null).state, APPLICABLE, "a control that states no condition applies everywhere");
});

test("unknown is never not-applicable: on a graph that is not complete, no predicate over any role comes out not-applicable", () => {
  const terms = [...NODE_ROLE_IDS.map((role) => ({ role })), ...RELATION_ROLE_IDS.map((relation) => ({ relation })), ...BOUNDARY_IDS.map((boundary) => ({ boundary }))];
  const predicates = [...terms, ...terms.map((t) => ({ all: [t, { role: "interface" }] })), ...terms.map((t) => ({ any: [t, { role: "cursor" }] }))];
  for (const p of predicates) assert.notEqual(applicabilityOf(control(p), graph(false)).state, NOT_APPLICABLE, JSON.stringify(p));
});

test("a predicate is held to its grammar: structural roles only, bounded", () => {
  assert.match(predicateFindings({ role: "rabbitmq" }).join(), /role "rabbitmq" is not a node role/);
  assert.match(predicateFindings({ product: "x" }).join(), /"product" is not a term/);
  assert.match(predicateFindings({ all: [] }).join(), /a list of predicates, one at least/);
  assert.match(predicateFindings({ role: "interface", relation: "permission" }).join(), /exactly one of/);
  const deep = (n) => (n ? { all: [deep(n - 1)] } : { role: "interface" });
  assert.match(predicateFindings(deep(6)).join(), /deep/);
});
