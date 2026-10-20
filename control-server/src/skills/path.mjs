// From a skill ID to a path on disk, and the only place that happens.
//
// The API accepts an ID and never a path, so the question here is narrow: is
// this a name a skill directory could have, does such a directory exist as a
// DIRECT child of skills/, and does it stay there once every symlink is
// followed? A symlinked skill directory or SKILL.md is refused outright rather
// than followed -- a link is a path nobody reviewed, and "it points somewhere
// harmless today" is not a property this server can keep true.
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { contained } from "../core.mjs";
import { forbidden, invalid, missing } from "../errors.mjs";

// Letters, digits, `-` and `_`, starting with a letter or digit. No dot at all,
// so `.`, `..` and hidden directories are not IDs, and no separator of either
// platform can reach a join().
export const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const SKILL_FILE = "SKILL.md";

export const isSkillId = (id) => typeof id === "string" && SKILL_ID.test(id);

export function skillDir(ctx, id) {
  if (!isSkillId(id)) throw invalid("INVALID_SKILL_ID", "a skill ID is letters, digits, - and _ only");
  const dir = inside(ctx.skillsRoot, join(ctx.skillsRoot, id));
  if (!existsSync(dir) && !isLink(dir)) throw missing("SKILL_NOT_FOUND", `no skill named ${id}`);
  return plain(dir, "directory", id);
}

export function skillFile(ctx, id) {
  const file = inside(ctx.skillsRoot, join(skillDir(ctx, id), SKILL_FILE));
  if (!existsSync(file) && !isLink(file)) throw missing("SKILL_NOT_FOUND", `${id} has no ${SKILL_FILE}`);
  return plain(file, "file", id);
}

// `contained` answers with an absolute path in its message; the page gets a
// sentence instead.
function inside(root, path) {
  try { return contained(root, path); }
  catch { throw forbidden("OUTSIDE_SKILLS_ROOT", "that skill resolves outside the skills directory"); }
}

function plain(path, kind, id) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw forbidden("SYMLINKED_SKILL", `${id} is a symbolic link, which this server never follows`);
  if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) throw missing("SKILL_NOT_FOUND", `no skill named ${id}`);
  return path;
}

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); }
  catch { return false; }
}
