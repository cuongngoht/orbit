// Check both lexical and physical containment, including not-yet-created paths.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Refused } from "../errors.mjs";

export const within = (root, path) => {
  const rel = relative(resolve(root), resolve(path));
  return rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel);
};

// On Windows the JavaScript realpath keeps an 8.3 short name (C:\Users\RUNNER~1) that git -- and the file system's
// own answer -- spell long (C:\Users\runneradmin): one checkout reached two ways would hash to two checkout ids, and a
// binding written through git would never be found from the shell's directory. There the native call names the one
// path the file system does; anywhere else the realpath every id was already taken with stands.
export const realpathFor = (platform, fs = { realpathSync }) => (platform === "win32" ? nativeOr(fs) : (p) => fs.realpathSync(p));

const nativeOr = (fs) => (p) => {
  try { return fs.realpathSync.native(p); }
  catch { return fs.realpathSync(p); }
};

const real = realpathFor(process.platform);

export function physical(path) {
  const full = resolve(path);
  if (existsSync(full)) return real(full);
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
