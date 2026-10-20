// Grouping, once. Every stage folds records into facts by a subject key, and a
// second spelling of the fold is how two stages would come to disagree about
// what "the same subject" means.
import { dirname } from "node:path/posix";
import { splitPath } from "../frontend/composite.mjs";

export function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}

export const unique = (list) => [...new Set(list)];

export const sortedUnique = (list) => unique(list).sort();

// The same reading of "is this path in that scope" the source port uses,
// including `.` meaning the whole tree -- of ONE checkout. `.` is the primary's
// whole tree and `<alias>::.` a secondary's, and neither contains the other:
// the composite port routes a scope to one repository, and so does this.
export function under(p, s) {
  const path = splitPath(p);
  const scope = splitPath(s);
  return path.prefix === scope.prefix && (scope.local === "." || scope.local === "" || path.local === scope.local || path.local.startsWith(`${scope.local}/`));
}

export const underAny = (p, scopes) => scopes.some((s) => under(p, s));

// The directory a path lives in, in the same path language: a file at the top
// of a secondary checkout lives in `<alias>::.`, never in the primary's `.`.
export function dirOf(path) {
  const { prefix, local } = splitPath(path);
  const d = dirname(local);
  return d === "." ? `${prefix}.` : `${prefix}${d}`;
}
