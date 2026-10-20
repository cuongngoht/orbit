// A project's planning DOCUMENTS as they were at the cut-off: the tree the
// settings name, read out of Git at the last commit before the cut-off and
// written into the run, so the collector that parses it reads the past and
// never a story's status from the future.
//
// Through the Process port, argv only: `git -C <dir> …`. The tree may live in a
// submodule; the repository that holds it is asked, whichever it is. A tree
// that is not in Git at all is read as it is NOW, and the snapshot says so --
// a report must never claim a point in time it could not reach.
import { join } from "node:path";
import { contained } from "../project/boundary.mjs";

export const DOC_FILE = /\.(md|markdown|ya?ml)$/i;
export const DOC_LIMITS = { files: 1500, bytes: 1024 * 1024 };

// -> { ok, pointInTime, commit, files, label, reason }
export function prepareDocs({ root, path, cutoffUtc, into, io, process }) {
  const dir = contained(root, join(root, path));
  const top = git(process, dir, ["rev-parse", "--show-toplevel"]);
  if (!top) return copiedNow(dir, into, io, path);
  const commit = git(process, top, ["rev-list", "-1", `--before=${cutoffUtc}`, "HEAD"]);
  return commit ? readAt(process, { top, dir, commit, into, io, label: path }) : { ok: false, reason: `the repository holding ${path} has no commit before the cut-off`, label: path };
}

function git(process, dir, args) {
  const r = process.run("git", ["-C", dir, ...args], { timeoutMs: 30000 });
  return r.ok ? String(r.out).trim() || null : null;
}

// Where the tree sits in its repository is Git's to say (--show-prefix), never
// worked out by comparing two spellings of a path: a checkout may be reached
// through a symlink (/var on macOS) or an 8.3 short name (Windows), and Git
// answers with the long, physical one.
function readAt(process, at) {
  const inside = (git(process, at.dir, ["rev-parse", "--show-prefix"]) ?? "").replace(/\/+$/, "") || ".";
  const listed = gitList(process, at.top, at.commit, inside).filter((f) => DOC_FILE.test(f));
  const taken = listed.slice(0, DOC_LIMITS.files).filter((f) => wrote(process, at, f, inside));
  return { ok: true, pointInTime: true, commit: at.commit, files: taken.length, label: at.label, reason: listed.length > DOC_LIMITS.files ? `only the first ${DOC_LIMITS.files} of ${listed.length} documents were read` : null };
}

function gitList(process, top, commit, inside) {
  const r = process.run("git", ["-C", top, "ls-tree", "-r", "-z", "--name-only", commit, "--", inside], { timeoutMs: 30000 });
  return r.ok ? String(r.out).split("\0").filter(Boolean) : [];
}

function wrote(process, at, file, inside) {
  const r = process.run("git", ["-C", at.top, "show", `${at.commit}:${file}`], { timeoutMs: 30000, maxBuffer: DOC_LIMITS.bytes * 2 });
  if (!r.ok || Buffer.byteLength(String(r.out)) > DOC_LIMITS.bytes) return false;
  at.io.write(contained(at.into, join(at.into, inside === "." ? file : file.slice(inside.length + 1))), String(r.out));
  return true;
}

// Not in Git: the files as they are, bounded the same way, and labelled so.
function copiedNow(dir, into, io, label) {
  const files = walk(dir, io, "").filter((f) => DOC_FILE.test(f)).slice(0, DOC_LIMITS.files);
  for (const f of files) io.write(contained(into, join(into, f)), io.read(join(dir, f)) ?? "");
  return { ok: true, pointInTime: false, commit: null, files: files.length, label, reason: `${label} is not in Git, so it was read as it is now, not as it was at the cut-off` };
}

// Regular files and directories only: a link is not followed out of the tree.
function walk(dir, io, prefix) {
  return io.list(join(dir, prefix)).filter((n) => !n.startsWith(".")).flatMap((n) => entry(dir, io, prefix ? `${prefix}/${n}` : n));
}

const ENTRY = { file: (dir, io, rel) => [rel], dir: (dir, io, rel) => walk(dir, io, rel) };

const entry = (dir, io, rel) => ENTRY[io.kind?.(join(dir, rel)) ?? "file"]?.(dir, io, rel) ?? [];
