// Whether a security CONTROL applies to this system, read off its System Graph (ADR 0040; doc §7).
//
// A control's `applies` is a predicate over STRUCTURAL ROLES only (src/topology/vocab.mjs): a node
// role, a relation role, or an evidence boundary -- never a product, a framework or a route. So
// "an interface that a principal is permitted on" is the whole of what a control needs to say to
// be owed wherever such an interface exists, whatever the system behind it is called.
//
//   { "role": "<node role>" }          the graph holds a node of that role
//   { "relation": "<relation role>" }  the graph holds an edge of that relation role
//   { "boundary": "<boundary>" }       the graph holds what a result at that boundary is about
//   { "all": [ … ] }  { "any": [ … ] } every one of them, or any one
//
// THREE answers, never two. A role the graph holds is APPLICABLE, with the refs that made it hold.
// A role it does not hold is NOT-APPLICABLE only when the graph says it is complete for its scope
// -- a scan that covered the system -- and says why. Otherwise it is UNKNOWN, with what would
// settle it: an absence nobody looked for is never a reason a control does not apply. A person's
// own mark (Orbit Control) is the one other way a control is not applicable, and it says who.
import { BOUNDARY_IDS, NODE_ROLE_IDS, RELATION_ROLE_IDS } from "../../topology/vocab.mjs";
import { isObject } from "../../walk.mjs";

export const APPLICABLE = "applicable";
export const NOT_APPLICABLE = "not-applicable";
export const UNKNOWN = "unknown";

const MAX_DEPTH = 4;
const MAX_TERMS = 24;

// What a result at each evidence boundary is ABOUT, in the graph's own roles: a control about what
// a synchronous interface answers is owed where there is an interface to ask.
export const BOUNDARY_SUBJECTS = {
  synchronous: { role: "interface" },
  screen: { role: "interface" },
  publication: { relation: "publish" },
  delivery: { relation: "consume" },
  processing: { any: [{ relation: "consume" }, { relation: "activation" }] },
  state: { role: "data-resource" },
  "scheduler-timing": { role: "schedule" },
  chain: { all: [{ relation: "publish" }, { relation: "data-write" }] },
};

// ── the predicate, held to its grammar ─────────────────────────────────────

const TERMS = [
  { key: "role", ids: NODE_ROLE_IDS, what: "a node role" },
  { key: "relation", ids: RELATION_ROLE_IDS, what: "a relation role" },
  { key: "boundary", ids: BOUNDARY_IDS, what: "an evidence boundary" },
];

export function predicateFindings(p, at = "applies", count = { terms: 0 }, depth = 0) {
  count.terms += 1;
  if (!isObject(p) || Object.keys(p).length !== 1) return [`${at}: a predicate is an object with exactly one of role, relation, boundary, all, any`];
  if (depth > MAX_DEPTH || count.terms > MAX_TERMS) return [`${at}: a predicate holds at most ${MAX_TERMS} terms, ${MAX_DEPTH} deep`];
  const [key, value] = Object.entries(p)[0];
  return key === "all" || key === "any" ? listFindings(value, `${at}.${key}`, count, depth) : termFindings(key, value, at);
}

function listFindings(list, at, count, depth) {
  if (!Array.isArray(list) || !list.length) return [`${at}: a list of predicates, one at least`];
  return list.flatMap((q, i) => predicateFindings(q, `${at}[${i + 1}]`, count, depth + 1));
}

function termFindings(key, value, at) {
  const term = TERMS.find((t) => t.key === key);
  if (!term) return [`${at}: "${String(key).slice(0, 40)}" is not a term — role, relation, boundary, all or any`];
  return term.ids.includes(value) ? [] : [`${at}: ${key} "${String(value).slice(0, 40)}" is not ${term.what} (${term.ids.join(", ")})`];
}

// ── the predicate, over a graph ────────────────────────────────────────────

// A graph is { nodes: [{ id, role }], relations: [{ id, role }], complete } -- the System Graph's
// projection, handed in. No graph at all is the same as one that covers nothing.
const listOf = (v) => (Array.isArray(v) ? v : []);
// A part is named by its id, or -- in the System Graph's own projection (src/architecture/graph-view.mjs) -- its key.
const held = (graph, key, value) => listOf(key === "role" ? graph?.nodes : graph?.relations).filter((x) => x?.role === value).map((x) => String(x.id ?? x.key));

const EVALUATE = {
  role: (graph, value) => termOf(graph, "role", value),
  relation: (graph, value) => termOf(graph, "relation", value),
  boundary: (graph, value) => ({ ...evaluated(BOUNDARY_SUBJECTS[value], graph), term: `boundary ${value}` }),
  all: (graph, list) => allOf(list.map((q) => evaluated(q, graph))),
  any: (graph, list) => anyOf(list.map((q) => evaluated(q, graph))),
};

export const evaluated = (p, graph) => ((key) => EVALUATE[key](graph, p[key]))(Object.keys(p)[0]);

function termOf(graph, key, value) {
  const refs = held(graph, key, value);
  if (refs.length) return { value: true, refs, term: `${key} ${value}` };
  return { value: graph?.complete === true ? false : null, refs: [], term: `${key} ${value}` };
}

// all: one false is false; else one unknown is unknown. any: one true is true; else one unknown is
// unknown. The refs are the parts that HELD -- what a person can open to see why.
function allOf(parts) {
  const refs = parts.flatMap((r) => r.refs);
  if (parts.some((r) => r.value === false)) return { value: false, refs: [], term: parts.filter((r) => r.value === false).map((r) => r.term).join(" and ") };
  return { value: parts.some((r) => r.value === null) ? null : true, refs, term: parts.filter((r) => r.value === null).map((r) => r.term).join(" and ") || parts.map((r) => r.term).join(" and ") };
}

function anyOf(parts) {
  const hit = parts.filter((r) => r.value === true);
  if (hit.length) return { value: true, refs: hit.flatMap((r) => r.refs), term: hit.map((r) => r.term).join(" or ") };
  return { value: parts.some((r) => r.value === null) ? null : false, refs: [], term: parts.map((r) => r.term).join(" or ") };
}

// ── the answer, in the sidecar's applicability shape ───────────────────────

const ANSWERS = [
  { when: (r) => r.value === true, as: (r) => ({ state: APPLICABLE, why: `the graph holds ${r.term}`, refs: r.refs }) },
  { when: (r) => r.value === false, as: (r) => ({ state: NOT_APPLICABLE, why: `the graph, complete for its scope, holds no ${r.term}`, refs: [] }) },
  { when: () => true, as: (r, graph) => ({ state: UNKNOWN, why: graph ? `the graph does not cover ${r.term}` : "there is no System Graph of this system yet", refs: [], settles: graph ? `a graph that covers ${r.term}` : "the System Graph of this project, from its reverse engineering" }) },
];

const EVERYWHERE = { value: true, refs: [], term: "anything at all — the control states no condition" };

// `mark` is a person's not-applicable decision for this control, from Orbit Control: it wins, and
// says it was a person's.
export function applicabilityOf(control, graph, mark = null) {
  if (mark) return { state: NOT_APPLICABLE, why: mark.why, refs: [], by: "person" };
  const r = control?.applies ? evaluated(control.applies, graph) : EVERYWHERE;
  return ANSWERS.find((a) => a.when(r)).as(r, graph);
}
