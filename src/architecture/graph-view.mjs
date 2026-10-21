// The SYSTEM GRAPH, as a PROJECTION of node and relation facts (ADR 0033; doc §4.2).
//
// There is no second graph store: the graph is what the `node` and `relation` facts say, folded
// on every read, with a DIGEST over what it means -- each node's kind, role, name, owner,
// transport, attributes and confidence, each relation's ends, name, role, attributes and
// confidence -- so a frozen graph (artifacts/graphs, src/investigation/graphs.mjs) says which
// graph an obligation was derived from, and two reads of one snapshot agree byte for byte in
// whatever order the facts were listed. Freshness is SHOWN and never digested: a scope that moved
// says "re-read it", and does not make the graph a different graph.
//
// A role is READ off the vocabulary handed in (src/topology/vocabulary.mjs), never off a fact: a
// kind or a relation no layer declares is shown with no role and derives nothing. What the graph
// cannot settle is said beside the edge it is about, and never resolved here: an end that names no
// node this graph holds, and a declared relation whose role does not fit the roles at its ends.
//
// It knows no UI map and no runtime. The composition root hands in `joins` -- `{ id, roles, ids }`,
// the ids another subject knows its things by -- and a node whose role is one of `roles` and whose
// name is one of `ids` is linked to that subject by id. Nothing is imported to do it.
import { canonicalJson, sha } from "../hash.mjs";
import { relationRoleOf } from "../topology/vocab.mjs";
import { kindOf, mergeVocabulary, relationOf } from "../topology/vocabulary.mjs";
import { UNKNOWN_END } from "./relations.mjs";

export const GRAPH_VIEW_VERSION = 1;

export function graphOf(facts, vocab = mergeVocabulary([]), joins = []) {
  const nodes = viewsOf(facts, "node", (f) => nodeView(f, vocab));
  const index = new Map(nodes.map((n) => [n.key, n]));
  const relations = viewsOf(facts, "relation", (f) => relationView(f, vocab, index));
  const graph = { v: GRAPH_VIEW_VERSION, nodes: linked(nodes, joins), relations, conflicts: relations.flatMap((r) => r.conflicts), counts: countsOf(nodes, relations) };
  return { ...graph, digest: graphDigestOf(graph) };
}

// One view per key, in key order, whatever order the facts came in: a key is the subject, so a
// second fact with the same one is the same thing said twice, and the first by id is kept.
function viewsOf(facts, kind, view) {
  const mine = (facts ?? []).filter((f) => f?.kind === kind).sort((a, b) => order(a.id, b.id));
  const firsts = [...new Map(mine.reverse().map((f) => [f.key, f])).values()];
  return firsts.map(view).sort((a, b) => order(a.key, b.key));
}

const order = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

const factPart = (f) => ({ attributes: f.attributes ?? {}, confidence: f.confidence, status: f.status ?? "unknown", evidence: f.evidence ?? [], unknowns: f.unknowns ?? [], id: f.id });

function nodeView(f, vocab) {
  const kind = kindOf(vocab, f.nodeKind);
  return { key: f.key, nodeKind: f.nodeKind, role: kind.role, declared: kind.declared, name: f.name, of: f.of ?? null, transport: f.transport ?? null, ...factPart(f) };
}

function relationView(f, vocab, index) {
  const rel = relationOf(vocab, f.relation);
  const ends = { from: index.get(f.from) ?? null, to: index.get(f.to) ?? null };
  const view = { key: f.key, relation: f.relation, role: rel.role, declared: rel.declared, from: f.from, to: f.to, resolved: { from: Boolean(ends.from), to: Boolean(ends.to) }, ...factPart(f) };
  return { ...view, conflicts: conflictsOf(view, ends) };
}

// ── what the graph cannot settle ───────────────────────────────────────────

const ENDS = ["from", "to"];

const conflictsOf = (view, ends) => ENDS.flatMap((end) => CONFLICTS.flatMap((row) => (row.when(view, ends, end) ? [{ relation: view.key, end, kind: row.kind, says: row.says(view, ends, end) }] : [])));

const CONFLICTS = [
  { kind: "dangling", when: (v, ends, end) => v[end] !== UNKNOWN_END && !ends[end], says: (v, ends, end) => `its ${end} names ${v[end]}, and no node fact this graph holds has that key` },
  { kind: "role", when: (v, ends, end) => misfit(v, ends[end], end), says: (v, ends, end) => `a ${v.relation} (${v.role}) may not ${end === "from" ? "start at" : "end at"} a ${ends[end].role} — its role allows ${relationRoleOf(v.role)[end].join(", ")}` },
];

// Only a DECLARED relation, between nodes whose kinds are declared, can misfit: what nobody
// declared derives nothing, a misfit included.
const misfit = (v, node, end) => Boolean(v.role && node?.role && !relationRoleOf(v.role)?.[end].includes(node.role));

// ── what another subject knows by id ───────────────────────────────────────

const linked = (nodes, joins) => ((ready) => nodes.map((n) => ({ ...n, links: linksOf(n, ready) })))((joins ?? []).map((j) => ({ id: j.id, roles: j.roles ?? [], ids: new Set(j.ids ?? []) })));

const linksOf = (n, joins) => Object.fromEntries(joins.filter((j) => j.roles.includes(n.role) && j.ids.has(n.name)).map((j) => [j.id, n.name]));

const countsOf = (nodes, relations) => ({
  nodes: nodes.length,
  relations: relations.length,
  undeclared: [...nodes, ...relations].filter((x) => !x.declared).length,
  unknownEnds: relations.filter((r) => r.from === UNKNOWN_END || r.to === UNKNOWN_END).length,
  notFresh: [...nodes, ...relations].filter((x) => x.status !== "fresh").length,
  conflicts: relations.reduce((n, r) => n + r.conflicts.length, 0),
});

// ── the digest: what the graph MEANS, and nothing a read adds ──────────────

const nodePart = (n) => ({ key: n.key, nodeKind: n.nodeKind, role: n.role, name: n.name, of: n.of, transport: n.transport, attributes: n.attributes, confidence: n.confidence });

const relationPart = (r) => ({ key: r.key, relation: r.relation, role: r.role, from: r.from, to: r.to, attributes: r.attributes, confidence: r.confidence });

export const graphDigestOf = (graph) => sha(canonicalJson({ v: GRAPH_VIEW_VERSION, nodes: (graph?.nodes ?? []).map(nodePart), relations: (graph?.relations ?? []).map(relationPart) }));
