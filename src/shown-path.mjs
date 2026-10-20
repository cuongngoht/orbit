// A path as a person at this terminal reads it: relative when it is below where they stand, whole otherwise. The
// machine store lives outside every checkout, so relative to one it was `../../../.orbit/projects/…` -- a path that
// is correct and that nobody can read.
import { isAbsolute, relative } from "node:path";

export function shownPath(path, cwd = process.cwd()) {
  const rel = relative(cwd, path);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}
