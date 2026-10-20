// Check both lexical and physical containment, including not-yet-created paths.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Refused } from "../errors.mjs";

export const within = (root, path) => {
  const rel = relative(resolve(root), resolve(path));
  return rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel);
};

export function physical(path) {
  const full = resolve(path);
  if (existsSync(full)) return realpathSync(full);
  if (isLink(full)) throw new Refused(`broken symlink at ${full}`);
  if (dirname(full) === full) return full;
  return join(physical(dirname(full)), relative(dirname(full), full));
}

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); }
  catch { return false; }
}

export function contained(root, path) {
  if (!within(root, path) || !within(physical(root), physical(path))) throw new Refused(`${path} must stay inside ${root}`);
  return resolve(path);
}

export function repositoryAt(path) {
  let at = physical(path);
  while (dirname(at) !== at) {
    if (existsSync(join(at, ".git"))) return at;
    at = dirname(at);
  }
  return null;
}

export function outsideRepositories(path) {
  const repo = repositoryAt(path);
  if (repo) throw new Refused(`${path} is inside the repository at ${repo}`);
  return path;
}

// A RELATIVE path that stays inside whatever it is joined to, on either
// platform's rules: no root, no drive letter, no `..` segment. What a receipt
// may say about where a runtime went -- a store that moves takes it along.
export const relativeInside = (p) => typeof p === "string" && p.length > 0 && !/^([\\/]|[A-Za-z]:)/.test(p) && !p.split(/[\\/]/).includes("..");
