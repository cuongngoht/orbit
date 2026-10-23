// DISCOVER before generating: is there already a role that answers for every responsibility asked, with the very
// profile requested? An ordered table, first row that finds something wins:
//
//   REUSE          an offered role (latest, intact, not revoked) covers every pair, same profile -- fewest extra wins
//   REUSE_STARTER  a starter role covers every pair, same profile (published on first use)
//   COMPOSE        two offered roles together cover every pair, same profile: a composite is generated, naming both
//   GENERATE       nothing covers: a new role is generated from the responsibilities
import { pairsOf } from "./naming.mjs";
import { STARTER_ROLES } from "./starters.mjs";

const rolePairs = (row) => pairsOf(row.record?.content?.responsibilities);

const fits = (row, need) => row.record?.content?.requestedPermissionProfile === need.profile;

const covers = (pairs, needed) => needed.every((p) => pairs.includes(p));

const extra = (row, needed) => rolePairs(row).filter((p) => !needed.includes(p)).length;

const best = (rows, needed) => rows.sort((a, b) => extra(a, needed) - extra(b, needed)).at(0) ?? null;

function pairCovering(rows, needed) {
  const fitting = rows.filter((r) => rolePairs(r).some((p) => needed.includes(p)));
  const pairs = fitting.flatMap((a, i) => fitting.slice(i + 1).map((b) => [a, b]));
  return pairs.find(([a, b]) => covers([...rolePairs(a), ...rolePairs(b)], needed)) ?? null;
}

const RESOLUTION = [
  { word: "REUSE", find: (c) => best(c.offered.filter((r) => fits(r, c.need) && covers(rolePairs(r), c.needed)), c.needed) },
  { word: "REUSE_STARTER", find: (c) => STARTER_ROLES.find((s) => s.profile === c.need.profile && covers(pairsOf(s.responsibilities), c.needed)) ?? null },
  { word: "COMPOSE", find: (c) => pairCovering(c.offered.filter((r) => fits(r, c.need)), c.needed) },
  { word: "GENERATE", find: () => true },
];

// offered: registry rows of roles (with record); need: { responsibilities, profile }
export function discoverRole(offered, need) {
  const c = { offered, need, needed: pairsOf(need.responsibilities) };
  const row = RESOLUTION.map((r) => ({ word: r.word, found: r.find(c) })).find((r) => r.found);
  return { word: row.word, found: row.found === true ? null : row.found };
}
