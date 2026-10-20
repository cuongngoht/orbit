// The WORKING TREE of a checkout, as a port: what is on disk NOW, as opposed to
// what the last commit says.
//
// The source tree port (src/frontend/index.mjs) answers from the object
// database on purpose -- an untracked file is not evidence about an
// architecture, and `git show HEAD:` cannot follow a symlink out of the
// repository. Environment files are the case that rule does not fit. A
// proposal to create `.devcontainer/devcontainer.json` is, by definition, about
// a file that is not committed yet; a person edits one while they review the
// proposal; and what adopting it must be checked against is the bytes on the
// disk at that moment. So the Environment Writer reads and writes through THIS,
// and nothing else in the engine does.
//
// It is still held to the rules the rest of the engine holds a path to. A path
// is contained in the checkout through symlinks (src/project/boundary.mjs); a
// symlink is neither read nor written, whatever it points at; a file past the
// source port's size cap, or with a NUL in its head, is not text and reads as
// absent. A read that cannot be answered is `null` and what that means is the
// caller's: a missing file and an unreadable one are different sentences, and
// `exists` is how they are told apart.
//
// Writing goes through src/store/atomic.mjs `writeAtomic`, so a reader never
// sees half a file, and there is no backup copy: a `.bak` next to somebody's
// devcontainer.json would be a file nobody asked for in their working tree.
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { realIo } from "../store/io.mjs";
import { MAX_FILE } from "./index.mjs";

const SNIFF = 8000;

export function createWorktree(root, io = realIo()) {
  return { root, read: (rel) => readIn(root, rel), exists: (rel) => entryIn(root, rel) !== null, list: (rel) => listIn(root, rel), write: (rel, text) => writeIn(root, rel, text, io) };
}

// Where a repo-relative path IS, or null when it escapes the checkout.
function placed(root, rel) {
  try {
    return contained(root, join(root, rel));
  } catch {
    return null;
  }
}

// What is there, without following a link: a file, a dir, a symlink -- or null.
function entryIn(root, rel) {
  const path = placed(root, rel);
  if (!path) return null;
  try {
    return { path, stat: lstatSync(path) };
  } catch {
    return null;
  }
}

function readIn(root, rel) {
  const entry = entryIn(root, rel);
  if (!entry?.stat.isFile() || entry.stat.size > MAX_FILE) return null;
  return text(readFileSync(entry.path, "utf8"));
}

const text = (out) => (out.slice(0, SNIFF).includes("\0") ? null : out);

function listIn(root, rel) {
  const entry = entryIn(root, rel);
  if (!entry?.stat.isDirectory()) return [];
  return readdirSync(entry.path).sort();
}

// A target that is a symlink is refused, not replaced: replacing it would
// quietly turn a link a person made into a regular file.
function writeIn(root, rel, body, io) {
  const path = placed(root, rel);
  if (!path) throw new Refused(`${rel} is outside the checkout`);
  if (entryIn(root, rel)?.stat.isSymbolicLink()) throw new Refused(`${rel} is a symlink; it is not written through`);
  return writeAtomic(path, body, io, false);
}
