// The SOURCE TREE port: what a checkout is, what is in it, and what has moved.
//
// It began as one method -- the frontend commit to stamp on anything recorded
// now -- and it stays one port rather than becoming two, because the alternative
// was a second module with its own `commit()`. Two definitions of "which commit
// this is" is the same mistake as two readers of run-log.jsonl: whichever one a
// caller happens to reach decides what a record is dated against.
//
// Everything here goes through `git`, and every method answers `null` rather
// than throwing. What null MEANS is the caller's to decide -- for a commit it is
// "undated", for an architecture scope it is `unknown`, and for a whole scan it
// is Blocked. The port does not get to choose which.
//
// `git ls-files` is the file list on purpose. It is the only way to exclude
// .gitignore'd build output, vendored dependencies and a run's evidence
// directory without this engine maintaining a list of what those look like in
// somebody else's stack -- which is exactly the product knowledge it must not
// hold. Untracked means invisible, and that is the right default: a file nobody
// committed is not evidence about an architecture.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { sha } from "../hash.mjs";

// git here is one local read. If it has not answered in ten seconds something is
// wrong with the checkout, and "no commit" is already a handled case.
const GIT_TIMEOUT_MS = 10000;

// One file, and one listing. A listing of a monorepo is megabytes; a source file
// that is half a megabyte is generated. Exceeding either throws ENOBUFS, which
// lands as null -- a bound, not a crash.
export const MAX_FILE = 512 * 1024;
export const MAX_LIST = 8 * 1024 * 1024;

// How much of a file is inspected before calling it binary. A NUL byte cannot
// appear in source this engine has any business reading.
const SNIFF = 8000;

// `staged: true` reads the INDEX instead of HEAD: what a task's workspace holds right now. A workspace is a
// clone detached at the revision the task began from, and what the task changed is not committed, so HEAD
// would answer with the base: a script or a dependency the task added would not exist, and every edit would
// read as "moved". The caller stages the workspace first (src/frontend/local-clones.mjs `treeOf`), and
// `commit()` then names the TREE -- the identity of exactly this source, which is what a run of it is
// evidence about. `dirty` means only what the index cannot see: an unstaged edit or an untracked file.
export function createFrontend(roots, exec = execFileSync, { staged = false } = {}) {
  const root = roots.find((r) => existsSync(r)) ?? null;
  const git = (args, max) => (root ? ran(root, args, exec, max) : null);
  return { root, commit: () => trimmed(staged ? git(["write-tree"]) : git(["rev-parse", "--short", "HEAD"])), branch: () => trimmed(git(["rev-parse", "--abbrev-ref", "HEAD"])), ...tree(git, staged) };
}

// `git show HEAD:<path>` rather than reading the working tree, and it is a
// safety property rather than a preference: `ls-files` lists a tracked SYMLINK,
// and a worktree read follows it straight out of the repository. A check for
// `..` or an absolute path does not catch that; the object database has no way
// to express it. A path that is not in HEAD simply fails, which is the answer.
// `fingerprints` takes a LIST and `search` takes a pattern, both deliberately:
// each is one git process however many scopes or files it covers. The
// per-scope and per-file forms were the obvious first shape and made a scan of
// this repository take eight seconds in three hundred processes.
// `--full-name` and `-- .` everywhere, and they go together. A root that is a
// SUBDIRECTORY of a checkout was the case that exposed it: `ls-files` reports
// paths relative to the current directory, `status --porcelain` reports them
// relative to the repository root, and `git show HEAD:<path>` resolves from the
// root too -- so three of the five methods spoke three different path
// languages, and a scope built from one could not be matched against another.
// One spelling, repo-root-relative, and `-- .` keeps each answer inside the
// tree this port was asked about.
const tree = (git, staged = false) => ({
  files: () => nulList(git(["ls-files", "--full-name", "-z", "--", "."], MAX_LIST)),
  read: (rel) => source(git(["show", `${staged ? ":0" : "HEAD"}:${slashes(rel)}`], MAX_FILE)),
  fingerprints: (scopes) => fingerprintsOf(git, scopes, staged),
  search: (pattern) => searched(git(["grep", "-I", "--cached", "--full-name", "-n", "-E", pattern, "--", "."], MAX_LIST, NO_MATCH)),
  changed: (from) => nulList(git(["diff", "--name-only", "-z", `${from}..HEAD`, "--", "."], MAX_LIST)),
});

// The SUBMODULES a checkout records, as the paths of their gitlinks (mode 160000): what `ls-files`
// lists in place of the files inside one. Repo-relative and POSIX, like every path here; null when
// git cannot answer.
export function gitlinks(root, exec = execFileSync) {
  const out = root ? ran(root, ["ls-files", "-s", "--full-name", "-z", "--", "."], exec, MAX_LIST) : null;
  return out === null ? null : out.split("\0").filter((row) => row.startsWith("160000 ")).map(pathOf);
}

// `git grep` exits 1 for "nothing matched", which is an ANSWER and not a
// failure. Every other non-zero status stays null, so "no imports anywhere" and
// "this is not a checkout" remain two different things.
const NO_MATCH = 1;

function ran(root, args, exec, max, emptyOn) {
  try {
    return exec("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: GIT_TIMEOUT_MS, maxBuffer: max ?? MAX_FILE });
  } catch (e) {
    return e?.status === emptyOn ? "" : null;
  }
}

// `-z` is not a nicety. Without it git C-quotes any path holding a non-ASCII
// byte, a quote or a backslash -- "src/caf\303\251.ts" -- so a fingerprint over
// that listing would silently depend on git's quoting rules rather than on the
// files. With it, paths arrive raw and NUL-separated.
const nulList = (out) => (out === null ? null : out.split("\0").filter(Boolean));

const trimmed = (out) => (out === null ? null : out.trim() || null);

const source = (out) => (out === null || out.slice(0, SNIFF).includes("\0") ? null : out);

// git speaks forward slashes on every platform, including Windows. A caller that
// joins a path from here with node:path before comparing it to another one from
// here gets two spellings of one file, which is a bug this repo has already paid
// for twice. Repo-relative POSIX is the canonical key; convert to native only at
// the moment of an actual filesystem call.
const slashes = (rel) => String(rel).replace(/\\/g, "/");

// The identity of a SCOPE, from the index: mode, blob sha and path per entry.
// An unrelated commit does not change it, and a content change inside the scope
// does -- which is what lets a fact about `src/dsl` stay current while the rest
// of the repository moves.
//
// The blob sha is of NORMALISED content, so a checkout with core.autocrlf=true
// produces the same fingerprint as one without. That is the reason to hash the
// index rather than the working tree.
//
// A scope that is GONE lists empty and exits 0, so hashing the empty string
// would report a deleted directory as unchanged. Empty is `null`, which reads as
// unknown: "the scope is gone" and "the scope has not moved" are not one answer.
function fingerprintsOf(git, scopes, staged) {
  const listed = git(["ls-files", "-s", "--full-name", "-z", "--", "."], MAX_LIST);
  if (listed === null) return null;
  const rows = listed.split("\0").filter(Boolean);
  const dirty = dirtyPaths(git, staged);
  return Object.fromEntries(scopes.map((s) => [s, oneScope(rows, dirty, slashes(s))]));
}

function oneScope(rows, dirty, scope) {
  const mine = rows.filter((r) => under(pathOf(r), scope));
  if (!mine.length) return null;
  return { hash: sha(mine.join("\n")), files: mine.length, dirty: dirty === null ? null : dirty.filter((p) => under(p, scope)).length };
}

// `<mode> <sha> <stage>\t<path>`, and the tab is the only reliable separator:
// a path may contain a space, and with `-z` it may contain very nearly anything.
const pathOf = (row) => row.slice(row.indexOf("\t") + 1);

// `.` and `""` are the whole tree, which is what `dirname` hands back for a file
// at the root. Without this row a fact about root-level files fingerprints to
// nothing, reads as `unknown`, and forces a rescan on every single call -- the
// exact failure this feature exists to avoid, caused by a path convention.
const under = (p, scope) => scope === "." || scope === "" || p === scope || p.startsWith(`${scope}/`);

// What the index cannot see. An unstaged edit means the fingerprint cannot
// SETTLE whether the scope moved -- so it is reported, and the caller says
// `unknown` rather than claiming either answer.
//
// Read once for the whole tree rather than once per scope. A rename prints two
// paths and is counted once, which is right: it is one thing that is not committed.
//
// `-z`, for the reason every listing here has it: without it git C-quotes a path that holds a space,
// a non-ASCII byte or a quote -- "dir with space/package.json" -- and a quoted path never matches the
// scope it belongs to, so an edit there was reported as no edit at all.
function dirtyPaths(git, staged = false) {
  const out = git(["status", "--porcelain", "-z", "--", "."], MAX_LIST);
  return out === null ? null : porcelainPaths(out.split("\0").filter(Boolean), staged);
}

// `XY path` per entry, and for a rename or a copy the path it came FROM is an entry of its own, which
// is skipped: the new path is the one that is not committed. Against the INDEX only the second column
// counts (a change the index has not taken): a staged edit is the very thing being read.
function porcelainPaths(entries, staged = false) {
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    if (!staged || entries[i][1] !== " ") paths.push(entries[i].slice(3));
    if (/[RC]/.test(entries[i].slice(0, 2))) i++;
  }
  return paths;
}

// `path:line:text` per match, and a path may contain a colon, so the split is
// bounded to the two separators that are positional.
function searched(out) {
  if (out === null) return null;
  return out.split("\n").filter(Boolean).map(oneMatch).filter(Boolean);
}

function oneMatch(line) {
  const at = /^(.*?):(\d+):([\s\S]*)$/.exec(line);
  return at ? { path: at[1], line: Number(at[2]), text: at[3] } : null;
}
