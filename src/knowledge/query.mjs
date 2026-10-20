// What project knowledge says about a TASK -- queried, bounded, and never a dump.
//
// Pure: claims in (stored, an organisation's declared ones, and this
// invocation's host-memory ones), a question in, answers out. The question is
// `ask = { tokens, subjects, context, near }`: the words the task used, the
// concept ids it names outright, the context it is asked in, and the scopes the
// session is working in.
//
// Every claim is GRADED against the context (src/knowledge/applies.mjs), ranked
// by AUTHORITY (derived, with freshness measured now), and scored for how
// directly the task touches it. Then claims about one (subject, relation) are
// settled into ONE answer by the WINNER table -- and this is where rivals are
// decided, at read time, never written into anybody's support:
//
//   unknown    nothing holds here (only claims conditional on something the
//              question did not say) -- said as UNKNOWN, with the condition
//   many       the relation does not compete: every holder is an answer
//   known      one object among the strongest holders -- or one holder whose
//              context NESTS every other strongest holder's
//   ambiguous  anything else: two answers nobody can rank. UNKNOWN, not a coin
//
// Support and recency only order what is shown; they never pick a winner.
import { factState, measure } from "../freshness.mjs";
import { tokens } from "../tokens.mjs";
import { applies, narrower, unmet } from "./applies.mjs";
import { watched } from "./model.mjs";
import { AUTHORITY, authorityOf, competes, rankOf, roleRow } from "./vocab.mjs";
import { interpretersOf, relationOf } from "./vocabulary.mjs";

export const LIMIT = 7;
export const MAX_HOPS = 12;

const SUBJECT = 3;
const OBJECT = 2;
const NEAR = 2;
const WORD = 1;

// Freshness as the tree measures it NOW: one fingerprint call for every scope
// the claims watch. A claim that watches nothing (a host's hint, a
// declaration) is `unknown`, which is the truth about it.
export function measured(ctx, claims) {
  const scopes = measure(claims.map((c) => ({ scope: watched(c) })), ctx.know.model().model, ctx.source);
  return Object.fromEntries(claims.map((c) => [c.id, watched(c).length ? factState({ scope: watched(c) }, scopes) : "unknown"]));
}

export function graded(claims, ask, parts, status = {}) {
  return claims.map((claim) => rowOf(claim, ask, parts, status[claim.id] ?? claim.status));
}

function rowOf(claim, ask, parts, measuredStatus) {
  const relation = relationOf(parts, claim.relation);
  const tier = authorityOf({ ...claim, measured: measuredStatus });
  return { claim, relation, measured: measuredStatus, grade: applies(claim.context, ask.context), tier: tier.tier, binding: tier.binding, minScore: tier.minScore, score: scoreOf(claim, ask) };
}

// A concept is NAMED when every token of its id is among the task's -- so
// "…the ledger entries…" names neither `acme.ledger` nor anything else by
// accident -- or when the task names its id outright.
export const namedBy = (id, ask) => (ask.subjects ?? []).includes(id) || fullyIn(tokens(id), ask.tokens ?? []);

const fullyIn = (want, asked) => want.length > 0 && want.every((t) => asked.includes(t));

const scoreOf = (claim, ask) => (namedBy(claim.subject, ask) ? SUBJECT : 0) + (namedBy(claim.object, ask) ? OBJECT : 0) + nearness(claim, ask.near ?? []) * NEAR + words(claim, ask.tokens ?? []) * WORD;

const words = (claim, asked) => [...tokens(claim.relation), ...Object.values(claim.context ?? {}).flatMap(tokens)].filter((t) => asked.includes(t)).length;

const nearness = (claim, near) => watched(claim).filter((s) => near.some((n) => inside(n, s) || inside(s, n))).length;

const inside = (a, b) => a === b || a.startsWith(`${b}/`);

// One hop out from what the task names: the objects of its claims become
// subjects worth answering too, so "the operation" brings "what it results in"
// along -- bounded, and never further.
export function widened(claims, ask) {
  const hop = [...new Set(claims.filter((c) => namedBy(c.subject, ask)).map((c) => c.object))].slice(0, MAX_HOPS);
  return { ...ask, subjects: [...new Set([...(ask.subjects ?? []), ...hop])] };
}

// With a task, each tier's own threshold decides; with none, only what binds.
const shown = (row, asked) => row.grade !== "excluded" && (asked ? row.score >= row.minScore : row.binding);

const asking = (ask) => Boolean((ask.tokens ?? []).length || (ask.subjects ?? []).length || (ask.near ?? []).length);

export function answers(rows, ask) {
  const relevant = rows.filter((r) => shown(r, asking(ask)));
  const groups = [...groupsOf(relevant).values()].map((g) => settledGroup(g, ask.context ?? {}));
  return groups.sort(byWeight);
}

// Every row, settled per (subject, relation) -- with NO relevance filter: a
// derivation follows what holds, whether or not the task's words named it.
export const settle = (rows, context = {}) => [...groupsOf(rows).values()].map((g) => settledGroup(g, context));

function groupsOf(rows) {
  const groups = new Map();
  for (const r of rows) groups.set(`${r.claim.subject}\u0000${r.claim.relation}`, [...(groups.get(`${r.claim.subject}\u0000${r.claim.relation}`) ?? []), r]);
  return groups;
}

const best = (holding) => holding.filter((r) => rankOf(r.tier) === Math.min(...holding.map((x) => rankOf(x.tier))));

const objectsOf = (rows) => [...new Set(rows.map((r) => r.claim.object))];

// The one strongest holder whose context nests every other's -- or null.
function nestedWinner(rows) {
  const winners = rows.filter((r) => rows.every((o) => o === r || o.claim.object === r.claim.object || narrower(r.claim.context, o.claim.context)));
  return winners.length && objectsOf(winners).length === 1 ? winners[0] : null;
}

const WINNER = [
  { status: "unknown", when: (g) => !g.holding.length, prevails: () => [] },
  { status: "many", when: (g) => !competes(g.relation.cardinality), prevails: (g) => g.holding },
  { status: "known", when: (g) => objectsOf(best(g.holding)).length === 1, prevails: (g) => best(g.holding) },
  { status: "known", when: (g) => nestedWinner(best(g.holding)) !== null, prevails: (g) => [nestedWinner(best(g.holding))] },
  { status: "ambiguous", when: () => true, prevails: () => [] },
];

function settledGroup(rows, context) {
  const g = { rows, relation: rows[0].relation, holding: rows.filter((r) => r.grade === "holds") };
  const row = WINNER.find((w) => w.when(g));
  const prevails = row.prevails(g);
  return { subject: rows[0].claim.subject, relation: rows[0].relation, role: roleRow(rows[0].relation.role), status: row.status, rows, prevails, rivals: g.holding.filter((r) => !objectsOf(prevails).includes(r.claim.object)), conditional: rows.filter((r) => r.grade === "conditional").map((r) => ({ ...r, unmet: unmet(r.claim.context, context) })), score: Math.max(...rows.map((r) => r.score)) };
}

const tierOf = (g) => Math.min(...[...g.prevails, ...g.rivals, ...g.conditional].map((r) => rankOf(r.tier)), AUTHORITY.length);

const byWeight = (a, b) => tierOf(a) - tierOf(b) || b.score - a.score || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0);

// Everything a question needs, in one call: widen, grade, settle, bound.
export function query(claims, ask, parts, status = {}) {
  const wide = widened(claims, ask);
  const all = answers(graded(claims, wide, parts, status), wide);
  return { answers: all.slice(0, ask.limit ?? LIMIT), total: all.length, uninterpreted: uninterpretedOf(claims, parts) };
}

// Relations in use that nothing here understands: kept and shown, never
// guessed at -- the list an extension author would start from.
const uninterpretedOf = (claims, parts) => [...new Set(claims.map((c) => c.relation))].filter((id) => !relationOf(parts, id).role && !interpretersOf(parts, id).length).sort();

// Rivals of ONE claim -- another object for the same subject and relation in
// the SAME context, when that relation competes. Said by `record`, never stored.
export const rivalsOf = (claims, claim, parts) => (competes(relationOf(parts, claim.relation).cardinality) ? claims.filter((c) => c.id !== claim.id && c.subject === claim.subject && c.relation === claim.relation && c.object !== claim.object && JSON.stringify(c.context) === JSON.stringify(claim.context)) : []);
