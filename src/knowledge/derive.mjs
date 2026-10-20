// PROOF NEEDS -- from what a change touches, through what it causes, how that is
// implemented here and how it could be observed, to the capabilities that would
// prove it. Derived from claims; never from a list of effects somebody keeps.
//
// The walk knows ROLES, never relation names (src/extensions/knowledge-v1.mjs):
//
//   follows   consequence · implementation · observation -- walked, and each
//             fills its own slot of what the need `proves`, so "what the
//             application does", "how it is built here" and "how it is checked"
//             stay three separate answers a replaced technology cannot merge
//   needs     capability -- the object is a capability id, and a need is emitted
//
// Per (node, relation) the walk follows what the query SETTLES in this context
// (src/knowledge/query.mjs): the prevailing claim, every holder of a relation
// that does not compete, all holders of an ambiguous one (said as such), and
// the claims that are conditional on something the question did not say --
// whose context then narrows the path, so a need derived through them says
// WHEN it holds. Contexts merge along a path, and a path whose claims hold in
// incompatible places is dropped.
//
// What it cannot do, it says: a consequence nothing observes is UNOBSERVABLE, a
// relation no row and no interpreter understands is UNINTERPRETED, a loop is a
// CYCLE, and a walk that hit its bound is TRUNCATED. Nothing is guessed.
import { CAPABILITY_ID } from "../capability/contract-v1.mjs";
import { merged } from "./applies.mjs";
import { interpreted } from "./interpreters.mjs";
import { watched } from "./model.mjs";
import { graded, namedBy, settle } from "./query.mjs";
import { interpretersOf } from "./vocabulary.mjs";
import { roleRow, weaker } from "./vocab.mjs";

export const MAX_SUBJECTS = 8;
export const MAX_DEPTH = 4;
export const MAX_NEEDS = 24;

// Every node the walk may visit, however the claims fan out and join again.
export const MAX_VISITS = 64;

const CAPABILITY = new RegExp(CAPABILITY_ID.source.toLowerCase());

export function derive(claims, ask, parts, status = {}) {
  const state = started(claims, ask, parts, status);
  walk(state);
  return finished(state, interpreted(parts, [...new Map(state.walked.map((c) => [c.id, c])).values()], ask, state.info));
}

function started(claims, ask, parts, status) {
  const rows = graded(claims, ask, parts, status);
  const subjects = subjectsOf(claims, ask);
  const queue = subjects.map((s) => ({ node: s, depth: 0, nodes: [s], context: ask.context ?? {}, conditional: false, tier: "rule", path: [], proves: { subject: s }, session: false }));
  return { ask, parts, rows, info: new Map(rows.map((r) => [r.claim.id, r])), subjects, queue, visits: 0, needs: [], walked: [], consequences: new Map(), uninterpreted: new Set(), unresolvable: [], cycles: [], dropped: [], truncated: false };
}

// Where the walk starts: what the task names outright, the concepts every token
// of whose id the task uses, and what the working set changed -- bounded.
export function subjectsOf(claims, ask) {
  const named = [...new Set(claims.flatMap((c) => [c.subject, c.object]))].filter((id) => namedBy(id, ask));
  const changed = claims.filter((c) => touched(c, ask.changed ?? [])).map((c) => c.subject);
  return [...new Set([...(ask.subjects ?? []), ...named, ...changed])].slice(0, MAX_SUBJECTS);
}

const touched = (claim, changed) => watched(claim).some((s) => changed.some((p) => p === s || p.startsWith(`${s}/`)));

function walk(state) {
  while (state.queue.length && state.needs.length < MAX_NEEDS && state.visits++ < MAX_VISITS) visit(state, state.queue.shift());
  if (state.queue.length) state.truncated = true;
}

function visit(state, item) {
  const groups = settle(state.rows.filter((r) => r.claim.subject === item.node && r.grade !== "excluded"), state.ask.context ?? {});
  state.walked.push(...groups.flatMap((g) => g.rows.map((r) => r.claim)));
  for (const r of groups.flatMap(followedIn)) STEPS.find((s) => s.when(r)).apply(state, item, r);
}

const followedIn = (g) => [...(g.status === "ambiguous" ? g.rivals : g.prevails), ...g.conditional];

const STEPS = [
  { when: (r) => roleRow(r.relation.role)?.needs === true, apply: needed },
  { when: (r) => roleRow(r.relation.role)?.follows === true, apply: followed },
  { when: () => true, apply: (state, item, r) => void state.uninterpreted.add(r.claim.relation) },
];

function followed(state, item, r) {
  const next = nextItem(item, r);
  if (!next.context) return void state.dropped.push({ claim: r.claim.id, why: "its context disagrees with the path that reached it" });
  if (item.nodes.includes(next.node)) return void state.cycles.push([...item.nodes, next.node]);
  if (next.depth > MAX_DEPTH) return void (state.truncated = true);
  consequenceSeen(state, r, next);
}

function consequenceSeen(state, r, next) {
  if (roleRow(r.relation.role).marks === "consequence") state.consequences.set(next.node, { subject: next.proves.subject, because: next.path });
  state.queue.push(next);
}

const nextItem = (item, r) => ({ node: r.claim.object, depth: item.depth + 1, nodes: [...item.nodes, r.claim.object], context: merged(item.context, r.claim.context), conditional: item.conditional || r.grade === "conditional", tier: weaker(item.tier, r.tier), path: [...item.path, r.claim.id], proves: { ...item.proves, [roleRow(r.relation.role).marks]: r.claim.object }, session: item.session || r.claim.layer === "session" });

function needed(state, item, r) {
  const capability = String(r.claim.object).toLowerCase();
  const context = merged(item.context, r.claim.context);
  if (!CAPABILITY.test(capability)) return void state.unresolvable.push({ claim: r.claim.id, object: r.claim.object, why: "the object is not a capability id" });
  if (!context) return void state.dropped.push({ claim: r.claim.id, why: "its context disagrees with the path that reached it" });
  state.needs.push({ capability, proves: item.proves, context, conditional: item.conditional || r.grade === "conditional", tier: weaker(item.tier, r.tier), because: [...item.path, r.claim.id], session: item.session || r.claim.layer === "session", by: "vocabulary" });
}

function finished(state, interp) {
  const needs = distinct([...state.needs, ...interp.needs]).slice(0, MAX_NEEDS);
  const proved = new Set(needs.map((n) => n.proves.consequence).filter(Boolean));
  const unobservable = [...state.consequences].filter(([c]) => !proved.has(c)).map(([consequence, at]) => ({ consequence, subject: at.subject, because: at.because }));
  return { subjects: state.subjects, needs, unobservable, uninterpreted: [...state.uninterpreted].filter((id) => !interpretersOf(state.parts, id).length).sort(), unresolvable: state.unresolvable, cycles: state.cycles, dropped: state.dropped, truncated: state.truncated, notes: interp.notes, problems: interp.problems, understood: interp.understood };
}

const keyOf = (n) => JSON.stringify([n.capability, n.proves, n.context]);

const distinct = (needs) => [...new Map(needs.map((n) => [keyOf(n), n])).values()];
