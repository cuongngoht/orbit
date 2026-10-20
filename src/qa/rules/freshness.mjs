// How old is what this plan rests on -- and, where that cannot be told, saying
// so instead of guessing.
//
// Every finding here is ADVICE. Whether a requirement has moved since somebody
// read it is not something this tool can demonstrate, and a build that fails
// because a commit hash advanced is a build people learn to ignore. What it can
// do is refuse to let "I cannot tell" pass as "still current": a plan with no
// revision cannot date its own evidence, and that is worth one line.
import { advice } from "../finding.mjs";
import { at, filled, members, scenariosOf } from "./common.mjs";

export const freshnessFindings = (p, world) => [...planFindings(p), ...sourceFindings(p), ...mapFindings(p, world), ...caseFindings(p, world)];

// Without a date on the plan, no run can be placed before or after this
// revision, so every verdict reads as current forever.
function planFindings(p) {
  if (filled(p.at)) return [];
  return [advice(p.id, "records no `at` — nothing can tell whether a run predates this revision, so all evidence will be reported as unknown rather than fresh")];
}

const sourceFindings = (p) => members(p, "sources").filter((s) => !filled(s.revision)).map((s) => advice(at(p, s), `${s.kind ?? "source"} ${s.ref ?? ""} has no revision recorded — nothing can say whether it has changed since`.replace(/\s+/g, " ")));

// The map the plan was designed against, compared with the map as it is now.
function mapFindings(p, world) {
  const want = p.map?.fe_commit;
  const now = world?.graph?.meta?.fe_commit;
  if (!filled(want) || !filled(now) || want === now) return [];
  return [advice(p.id, `was designed against frontend ${want}; the map is now at ${now} — run \`query verify\` and re-read the scenarios it names`)];
}

// A case recorded live at an older build is the case's own expiry date. It is
// not a plan error; it is the reason a PASS from it will count as stale.
function caseFindings(p, world) {
  const head = world?.head;
  if (!filled(head)) return [];
  return scenariosOf(p).flatMap((s) => staleCases(p, s, world, head));
}

function staleCases(p, s, world, head) {
  const linked = (s.cases ?? []).map((l) => world.cases?.get(l?.id)).filter(Boolean);
  const stale = linked.filter((c) => filled(c.fe_commit) && c.fe_commit !== head);
  return stale.map((c) => advice(at(p, s), `${c.id} was last recorded at ${c.fe_commit}, the working copy is ${head} — its PASS is history until it runs again`));
}
