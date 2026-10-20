// Relative paths and byte digests for explicit test-data publication.
// Links are never followed or copied. Paths remain relative and platform independent.
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { sha, shaBytes } from "../hash.mjs";

export function treeFiles(root, skip = [], at = root) {
  if (!existsSync(at) || skip.some((s) => s && resolve(s) === resolve(at))) return [];
  return readdirSync(at, { withFileTypes: true }).flatMap((e) => entryUnder(root, skip, join(at, e.name), e));
}

function entryUnder(root, skip, path, e) {
  if (e.isDirectory()) return treeFiles(root, skip, path);
  return e.isFile() ? [relative(root, path).split(sep).join("/")] : [];
}

// -> [{ rel, digest }] for the files named, read through `io.bytes`.
export const treeDigests = (root, files, io) => files.map((rel) => ({ rel, digest: shaBytes(io.bytes(join(root, rel))) }));

// One digest for a whole tree: the same files with the same bytes are the same tree, whatever order they were
// listed in.
export const treeDigest = (entries) => sha(entries.map((e) => `${e.rel}\u0000${e.digest}`).sort().join("\n"));
