// What a skill directory weighs on disk: how many files, how many bytes, and
// when anything in it last changed.
//
// Walked with lstat, so a symlink inside the directory is counted as the link
// it is and never followed out of it -- the same rule remove.mjs keeps. Nothing
// here reads a file's contents.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function statsOf(dir) {
  const found = walk(dir);
  const modified = found.reduce((latest, f) => Math.max(latest, f.mtimeMs), 0);
  return { files: found.length, bytes: found.reduce((sum, f) => sum + f.size, 0), modified: new Date(modified).toISOString() };
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => entry(join(dir, name)));
}

function entry(path) {
  const stat = lstatSync(path);
  return stat.isDirectory() ? walk(path) : [stat];
}
