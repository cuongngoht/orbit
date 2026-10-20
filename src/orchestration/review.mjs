// The REVIEW of a change as a whole, bounded: what changed against what its plan said it would
// change. A path outside the plan's scope is scope drift -- the requirement was about one thing and
// the change reaches another -- and it is never accepted silently: the review fails, the attempt
// ends on a signature of the unexpected paths, and the loop diagnoses it like any other failure.
// The same drift three times is NO_PROGRESS.
//
// A scope entry is a repository-relative path: a file, or a directory that covers everything
// below it. Nothing here reads a file's contents or names a kind of file; the plan says what it
// meant to touch, and the diff says what was touched.
import { short } from "../hash.mjs";
import { relativeInside } from "../project/boundary.mjs";
import { MAX_SCOPE } from "./vocab.mjs";

const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

const covers = (entry, path) => path === entry || path.startsWith(`${entry}/`);

export const inScope = (path, scope) => scope.map(norm).some((entry) => entry === "" || covers(entry, norm(path)));

// Both ends of a rename must be in scope: moving a file out of where the plan worked is a change too.
const pathsOf = (row) => [row.path, row.from].filter(Boolean);

export const unexpectedOf = (rows, scope) => [...new Set(rows.flatMap(pathsOf).filter((p) => !inScope(p, scope)))].sort();

export const scopeSignature = (unexpected) => short(["review", "scope", ...unexpected].join("\u0000"), 12);

// What a plan's scope may be: 1..MAX_SCOPE repository-relative paths, none escaping.
export function scopeProblem(scope) {
  if (!Array.isArray(scope) || !scope.length || scope.length > MAX_SCOPE) return `scope is a list of 1 to ${MAX_SCOPE} repository-relative paths`;
  const bad = scope.filter((p) => typeof p !== "string" || p.length > 400 || !relativeInside(p) || /[\u0000-\u001f]/.test(p));
  return bad.length ? `scope paths stay inside the repository: no root, no drive letter, no "..", no control characters (${bad.slice(0, 3).map(String).join(", ")})` : null;
}

// -> { files, unexpected[], say }
export function reviewOf(rows, scope) {
  const unexpected = unexpectedOf(rows, scope);
  const say = `${rows.length} file(s) changed, ${unexpected.length ? `${unexpected.length} outside the plan's scope (${unexpected.slice(0, 5).join(", ")}${unexpected.length > 5 ? ", …" : ""})` : "all inside the plan's scope"}`;
  return { files: rows.length, rows, unexpected, say };
}
