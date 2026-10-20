// The REPORTING PARTS registry: the project-report parts this project's
// extensions declared, one registry per context like the capability registry,
// so two projects in one process never share a part by accident.
//
//   check(rows, from)      every problem with an extension's rows, before any of
//                          them registers -- the loader asks this first
//   register(rows, from)   all or nothing
//   parts() / part(id)     what registered, in id order
//   contested()            ids more than one extension declared
//
// A second extension declaring an id already taken is REFUSED, and the id is
// remembered as CONTESTED: the report runner then runs neither, because a
// winner picked by load order would be a winner picked by the alphabet.
import { Refused } from "../errors.mjs";
import { partProblems } from "./reporting-v1.mjs";

export function createReportingParts() {
  const s = { parts: new Map(), contested: new Map() };
  return { check: (rows, from) => problems(rows, from), register: (rows, from) => registered(s, rows, from), parts: () => sorted(s.parts), part: (id) => s.parts.get(id) ?? null, contested: () => [...s.contested.entries()].map(([id, owners]) => ({ id, owners: [...owners] })) };
}

function problems(rows, from) {
  const seen = new Set();
  const twice = rows.filter((r) => r?.id && (seen.has(r.id) || !seen.add(r.id))).map((r) => `${r.id} is declared twice in ${from}`);
  return [...rows.flatMap((r, i) => partProblems(r, `${from} reporting[${i}]`, from)), ...twice];
}

function registered(s, rows, from) {
  const wrong = problems(rows, from);
  if (wrong.length) throw new Refused(wrong.join("; "));
  const taken = rows.filter((r) => s.parts.has(r.id));
  if (taken.length) return contest(s, taken, from);
  for (const row of rows) s.parts.set(row.id, { ...row, from });
}

function contest(s, taken, from) {
  for (const row of taken) s.contested.set(row.id, new Set([s.parts.get(row.id).from, from, ...(s.contested.get(row.id) ?? [])]));
  throw new Refused(`${taken.map((r) => r.id).join(", ")} ${taken.length > 1 ? "are" : "is"} already declared by ${s.parts.get(taken[0].id).from}, so neither runs`);
}

const sorted = (map) => [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
