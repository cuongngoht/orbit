// WHICH UNITS a subtree manifest reaches.
//
// An adapter says what each file STATES. The one relation no file can state about itself is which
// units a shared file -- a central package list, a set of properties every project inherits --
// actually reaches. The rule is generic and written once, here: a unit takes the NEAREST such file
// of that name above it, in its own checkout and its own ecosystem, and no other. A shared file at
// the root of one repository never reaches into another, and a file of the same name in a different
// ecosystem is a different file.
//
// Two subjects ask it -- intelligence, which units a package list applies to, and runtime
// understanding, which units a shared target applies to -- and a second definition of "reaches" is
// how the two would come to disagree about one tree.
import { basename, dirname } from "node:path/posix";
import { splitPath } from "../frontend/composite.mjs";

// The paths of every UNIT record that `shared` reaches. `records` are canonical manifest records from
// ONE reading, and `shared` is one of them: the comparison is by identity. A unit of another ecosystem is
// never reached -- a build file for one format says nothing about a package of another that happens to
// sit in the same folder.
export const reachedBy = (records, shared) => records.filter((u) => u.unit && u.ecosystem === shared.ecosystem && nearest(records, u, shared) === shared).map((u) => u.path);

function nearest(records, unit, like) {
  const candidates = records.filter((s) => s.reach === "subtree" && s.ecosystem === like.ecosystem && basename(s.path) === basename(like.path) && encloses(s.path, unit.path));
  return candidates.sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

// Same checkout, and the unit sits in or beneath the shared file's directory.
function encloses(sharedPath, unitPath) {
  const shared = splitPath(sharedPath);
  const unit = splitPath(unitPath);
  const dir = dirname(shared.local);
  return shared.prefix === unit.prefix && (dir === "." || unit.local.startsWith(`${dir}/`));
}
