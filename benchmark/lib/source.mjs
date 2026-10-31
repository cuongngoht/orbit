// FREEZING the source a run measures: the branch the developer is on, exactly as git shows it -- its committed HEAD,
// or, when asked, HEAD and every uncommitted change -- read through read-only git and never written, reset or stashed.
// A tree with uncommitted changes and no word on which of the two to measure is REFUSED, never silently narrowed.
//
// What is frozen is held in memory as entries (path, mode, bytes, digest) and kept nowhere but the run's own room.
// A file named like a credential is never read: a committed one refuses the freeze, an untracked one is left out and
// listed. A submodule is another repository; a link is kept only when it stays inside the tree. The harness's own files are not part of what is measured: `subjectOf` drops them, by glob.
//
//   whereAt(repo, env) -> { root, branch, detached, commit, dirty: [path] }
//   frozen(repo, mode, env) -> { mode, entries: [{ rel, mode, bytes|target, digest }], skipped: [{ rel, why }] }
//   subjectOf(entries, globs) -> { entries, skipped }       treeDigestOf(entries) -> sha256
//   writtenTree(dest, entries)                               SOURCE_MODES
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { Blocked, Refused } from "../../src/errors.mjs";
import { sha, shaBytes } from "../../src/hash.mjs";
import { gitRead } from "./git.mjs";
import { matchesAny, safeRel } from "./paths.mjs";

export const SOURCE_MODES = ["head", "worktree"];

// Names that hold secrets far more often than code: never read, never measured, listed by path only.
export const CREDENTIAL_SHAPED = /(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx|jks|keystore)$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)|(^|\/)\.(npmrc|netrc|pgpass)$|(^|\/)credentials?(\.[a-z]+)?$|(^|\/)secrets?\.(json|ya?ml|env)$/i;

export const LIMITS = { fileBytes: 25 * 1024 * 1024, totalBytes: 400 * 1024 * 1024 };

const said = (r, what) => {
  if (!r.ok) throw new Blocked(`git could not ${what}: ${r.err || `it exited ${r.status}`}`);
  return r.out;
};

const fields = (text) => String(text).split("\0").filter(Boolean);

// `XY path` records, a rename or copy followed by the path it came from.
const dirtyPaths = (text) => fields(text).reduce((acc, rec, i, all) => (acc.skip.has(i) ? acc : { paths: [...acc.paths, rec.slice(3)], skip: /^[RC]/.test(rec) ? new Set([...acc.skip, i + 1]) : acc.skip }), { paths: [], skip: new Set() }).paths;

export function whereAt(repo, env) {
  const root = said(gitRead(repo, ["rev-parse", "--show-toplevel"], env), "find the repository this runs from").trim();
  const branch = gitRead(root, ["symbolic-ref", "--short", "-q", "HEAD"], env);
  const commit = said(gitRead(root, ["rev-parse", "--verify", "HEAD"], env), "read HEAD").trim();
  const dirty = dirtyPaths(said(gitRead(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], env), "read the working tree's status"));
  return { root, branch: branch.ok ? branch.out.trim() : null, detached: !branch.ok, commit, dirty };
}

// ---- HEAD, as committed -------------------------------------------------------------------------------------------

const TREE_LINE = /^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]*)$/;

const treeRows = (text) => fields(text).map((l) => TREE_LINE.exec(l)).filter(Boolean).map((m) => ({ gitMode: m[1], type: m[2], oid: m[3], rel: m[4] }));

const GIT_MODES = { 100644: "file", 100755: "exec", 120000: "link" };

const skipOf = (row) => (!GIT_MODES[row.gitMode] ? "a submodule or an entry git does not keep as a file" : null);

// A COMMITTED file named like a credential is part of the source: dropping it would measure another tree, and reading
// it would carry what may be a secret into a run. So the freeze is refused, naming it, and a person decides.
function refusingCredentials(rows) {
  const shaped = rows.filter((r) => CREDENTIAL_SHAPED.test(r.rel)).map((r) => r.rel);
  if (shaped.length) throw new Refused(`the source commits files named like credentials, which a benchmark never reads: ${shaped.slice(0, 5).join(", ")} — rename them, or measure a tree without them`);
  return rows;
}

// `cat-file --batch`: for each object `<oid> <type> <size>\n<bytes>\n`, read off one buffer in order.
function objectsFrom(buf) {
  const out = new Map();
  for (let at = 0, nl = buf.indexOf(10, 0); nl > 0; nl = buf.indexOf(10, at)) at = keptObject(out, buf, at, nl);
  return out;
}

function keptObject(out, buf, at, nl) {
  const [oid, type, size] = buf.subarray(at, nl).toString("latin1").split(" ");
  if (type === "missing") return nl + 1;
  out.set(oid, buf.subarray(nl + 1, nl + 1 + Number(size)));
  return nl + 2 + Number(size);
}

const entryOf = (rel, mode, bytes) => (mode === "link" ? { rel, mode, target: bytes.toString("utf8"), digest: sha(`link:${bytes.toString("utf8")}`) } : { rel, mode, bytes, digest: shaBytes(bytes) });

function frozenHead(root, env) {
  const rows = refusingCredentials(treeRows(said(gitRead(root, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], env), "list HEAD's tree")));
  const kept = rows.filter((r) => !skipOf(r));
  const objects = objectsFrom(said(gitRead(root, ["cat-file", "--batch"], env, { bytes: true, input: `${kept.map((r) => r.oid).join("\n")}\n` }), "read HEAD's files"));
  return { entries: kept.filter((r) => objects.has(r.oid)).map((r) => entryOf(r.rel, GIT_MODES[r.gitMode], objects.get(r.oid))), skipped: [...rows.filter(skipOf).map((r) => ({ rel: r.rel, why: skipOf(r) })), ...kept.filter((r) => !objects.has(r.oid)).map((r) => ({ rel: r.rel, why: "its object is not in this clone" }))] };
}

// ---- the working tree, as git shows it ----------------------------------------------------------------------------

const KIND_OF = (st) => (st.isSymbolicLink() ? "link" : st.isFile() ? ((st.mode & 0o111) !== 0 ? "exec" : "file") : null);

function onDisk(root, rel) {
  const file = join(root, rel);
  if (!existsSync(file) && !isLink(file)) return { skip: "deleted in the working tree" };
  const kind = KIND_OF(lstatSync(file));
  return kind ? { entry: entryOf(rel, kind, kind === "link" ? Buffer.from(readlinkSync(file)) : readFileSync(file)) } : { skip: "a directory or a special file, not a file git keeps" };
}

function isLink(file) {
  try { return lstatSync(file).isSymbolicLink(); }
  catch { return false; }
}

const worktreeRow = (root, rel) => (CREDENTIAL_SHAPED.test(rel) ? { rel, skip: "named like a credential: never read" } : { rel, ...onDisk(root, rel) });

function frozenWorktree(root, env) {
  const tracked = refusingCredentials(fields(said(gitRead(root, ["ls-files", "-z", "-c"], env), "list the tracked files")).map((rel) => ({ rel })));
  const rels = [...new Set([...tracked.map((t) => t.rel), ...fields(said(gitRead(root, ["ls-files", "-z", "-o", "--exclude-standard"], env), "list the untracked files"))])];
  const rows = rels.map((rel) => worktreeRow(root, rel));
  return { entries: rows.filter((r) => r.entry).map((r) => r.entry), skipped: rows.filter((r) => r.skip).map((r) => ({ rel: r.rel, why: r.skip })) };
}

// ---- held to what a snapshot may be -------------------------------------------------------------------------------

const outward = (e) => e.mode === "link" && !safeRel(posix.normalize(posix.join(posix.dirname(e.rel), e.target)));

const sizeOf = (e) => e.bytes?.length ?? 0;

function bounded(entries) {
  const big = entries.filter((e) => sizeOf(e) > LIMITS.fileBytes).map((e) => e.rel);
  if (big.length) throw new Refused(`files larger than ${LIMITS.fileBytes} bytes cannot be frozen: ${big.slice(0, 5).join(", ")}`);
  if (entries.reduce((n, e) => n + sizeOf(e), 0) > LIMITS.totalBytes) throw new Refused(`the source is larger than ${LIMITS.totalBytes} bytes, more than a snapshot may hold`);
  return entries;
}

const FREEZERS = { head: frozenHead, worktree: frozenWorktree };

export function frozen(root, mode, env) {
  if (!FREEZERS[mode]) throw new Refused(`--source is one of ${SOURCE_MODES.join(", ")}`);
  const got = FREEZERS[mode](root, env);
  const kept = bounded(got.entries.filter((e) => safeRel(e.rel) && !outward(e)));
  return { mode, entries: kept, skipped: [...got.skipped, ...got.entries.filter((e) => !kept.includes(e)).map((e) => ({ rel: e.rel, why: "a link out of the tree, or a path no tree may hold" }))] };
}

export const subjectOf = (entries, globs) => ({ entries: entries.filter((e) => !matchesAny(globs, e.rel)), skipped: entries.filter((e) => matchesAny(globs, e.rel)).map((e) => ({ rel: e.rel, why: "the benchmark harness's own file: never part of what is measured" })) });

export const treeDigestOf = (entries) => sha(entries.map((e) => `${e.rel}\u0000${e.mode}\u0000${e.digest}`).sort().join("\n"));

const writtenOne = (dest, e) => {
  mkdirSync(dirname(join(dest, e.rel)), { recursive: true });
  if (e.mode === "link") return symlinkSync(e.target, join(dest, e.rel));
  writeFileSync(join(dest, e.rel), e.bytes, { mode: e.mode === "exec" ? 0o755 : 0o644 });
};

export const writtenTree = (dest, entries) => entries.forEach((e) => writtenOne(dest, e));
