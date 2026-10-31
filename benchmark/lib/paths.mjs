// PATHS a benchmark speaks of: repository-relative, '/'-separated, never above the tree they name -- and the globs a
// case's scope is written in (`*` one segment, `**` any depth, `?` one character), compiled where they are asked.
//
//   globRe(glob) -> RegExp      matchesAny(globs, path) -> boolean      posixOf(root, file) -> "a/b.mjs"
//   safeRel(path) -> boolean    a relative path with no root, drive, `..`, backslash or control character
import { relative, sep } from "node:path";
import { relativeInside } from "../../src/project/boundary.mjs";

const TOKENS = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]" };

const GLOB_PIECE = /\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\]/g;

export const globRe = (glob) => new RegExp(`^${String(glob).replace(GLOB_PIECE, (t) => TOKENS[t] ?? `\\${t}`)}$`);

export const matchesAny = (globs, path) => (globs ?? []).some((g) => globRe(g).test(path));

export const posixOf = (root, file) => relative(root, file).split(sep).join("/");

const CONTROL = /[\u0000-\u001f\u007f]/;

export const safeRel = (p) => relativeInside(p) && !String(p).includes("\\") && !CONTROL.test(p) && !String(p).split("/").includes("") && String(p).length <= 400;
