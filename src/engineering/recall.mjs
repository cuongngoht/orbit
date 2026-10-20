// Which engineering facts bear on THIS task -- and how much each may steer it.
//
// SessionStart gets a count and a pointer, never the facts (src/lifecycle/): a
// session about a CSS tweak must not open with fifty rules about persistence.
// This is the other half: when a task is known, the few facts that touch it,
// ranked by how binding they are and then by how directly they touch it.
//
// Pure: facts, the task's tokens and the scopes the session is working in, and
// out come rows. Two signals, both computed, neither a guess:
//
//   subject   the task names what the fact is ABOUT (src/engineering/subject.mjs)
//             -- worth 3, because a direct subject hit is the strongest thing a
//             token search can show
//   nearness  the session is already reading or changing a scope the fact
//             watches -- worth 2 per scope
//
// How much a row may steer is src/engineering/vocab.mjs's ROUTING, read, never
// restated. A HINT needs a direct subject hit; nothing observed is a rule.
import { routeOf, TIERS } from "./vocab.mjs";
import { speaks } from "./subject.mjs";

export const LIMIT = 7;

const SUBJECT = 3;
const NEAR = 2;

export function recall(facts, opts = {}) {
  const asked = opts.asked ?? [];
  const near = opts.near ?? [];
  const rows = facts.map((fact) => ({ fact, route: routeOf(fact), score: scoreOf(fact, asked, near) }));
  return rows.filter((r) => shown(r, asked.length + near.length > 0)).sort(byTier).slice(0, opts.limit ?? LIMIT);
}

const scoreOf = (fact, asked, near) => speaks(fact, asked).length * SUBJECT + nearness(fact, near) * NEAR;

// A scope the session works in that sits inside -- or contains -- one the fact
// watches. Both directions, because "changing src/Application/Orders" is near
// a fact about src/Application, and "reading src" is near everything under it.
const nearness = (fact, near) => (fact.scope ?? []).filter((s) => near.some((n) => inside(n, s) || inside(s, n))).length;

const inside = (a, b) => a === b || a.startsWith(`${b}/`);

// With no task at all, only what BINDS is worth a reader's attention; with one,
// each tier's own threshold decides.
const shown = (row, asked) => (asked ? row.score >= row.route.minScore : row.route.binding);

const byTier = (a, b) => TIERS.indexOf(a.route.tier) - TIERS.indexOf(b.route.tier) || b.score - a.score;
