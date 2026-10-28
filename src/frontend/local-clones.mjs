// LOCAL CLONES: a task's own copy of one checkout, made by git through the Process port -- argv
// only, never a shell -- for the one owner that makes them (src/orchestration/workspace.mjs).
//
//   head()              the full revision HEAD names in the checkout
//   dirty()             whether the checkout has uncommitted changes (a workspace starts from HEAD)
//   listed(dir)         whether `dir` is the top of a repository of its OWN (a clone this made), and
//                       never the checkout itself
//   add(dir, revision)  `git clone --local --no-checkout` of the checkout into `dir`, then a DETACHED
//                       checkout of `revision`: the objects are hard-linked where that is allowed,
//                       and COPIED (`--no-hardlinks`) where it is not -- a sandbox that keeps `.git`
//                       read-only refuses a link to it as it refuses a write (Codex's does). No branch
//                       is made, and the checkout's own `.git` is only READ: nothing is written there,
//                       not even a worktree entry
//   remove(dir)         a clone listed as its own, deleted; the checkout never
//   changes(dir, from)  inside the clone: stage everything (its own index), then what differs from
//                       `from` (a revision or a tree id) as rows -- path, change, lines added and
//                       removed, a rename's old path -- and the tree id of what it holds now
//   commit({ tree, store, base }, branch, message)
//                       what the clone holds now, committed on `branch` (0.2.0) -- in the STORE beside it, never in
//                       the clone's own `.git` (THE DELIVERY, below). Answers the commit's full id: the base
//                       itself when nothing changed
//   headOf(store)       the commit the store's branch names, or null before the first commit
//   remoteOf(name)      the push URL the CHECKOUT names for one of its remotes -- read, never written -- or null
//   push(store, url, sha, ref, force)
//                       exactly `sha` to `ref` at `url`, from a git directory made for this one push: the
//                       checkout's `.git` is never the target. Only the GIT_PUSH protected boundary's caller asks
//                       it (src/protected/), after a person's approval of exactly this push was spent
//   remoteRefOf(url, ref)
//                       what `ref` holds at `url` now, or null: how an interrupted push is read back
//
// A clone keeps no `origin`: `git clone` points it at the checkout's own path, and a push from inside a workspace --
// a test's script, a tool, a person's habit -- would write the checkout's refs. A push names its URL every time.
// And a clone's git directory must be its OWN (`ownGitDir`): a `.git` that is a link, or a file or a `commondir`
// naming another repository -- the checkout's own -- is never read or written through.
//
// No hook runs: every call points `core.hooksPath` at a directory that does not exist, and
// `core.fsmonitor` off -- a checkout's hooks are code it brought with it. A failing git is BLOCKED
// with the line that says why (its `fatal:` or `error:` line, else its last), scrubbed: the
// machine could not answer, and nothing about the change was learned.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { baseEnv } from "../process/env.mjs";
import { Blocked, Refused } from "../errors.mjs";
import { scrub } from "../scrub.mjs";

const TIMEOUT_MS = 300000;
const MAX_OUTPUT = 64 * 1024 * 1024;

const linesOf = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const firstLine = (text) => linesOf(text)[0] ?? "";

// What git said that explains a failure: a progress line ("Preparing worktree", "Cloning into") never does.
const reasonOf = (r) => ((lines) => lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines.at(-1) ?? "no answer")(linesOf(`${r.err ?? ""}\n${r.error ?? ""}`));

// opts: { noHooks (a directory that does not exist), env?, timeoutMs? }
const callOf = (proc, opts) => (cwd, args) => proc.run("git", ["-c", `core.hooksPath=${opts.noHooks}`, "-c", "core.fsmonitor=false", "-C", cwd, ...args], { timeoutMs: opts.timeoutMs ?? TIMEOUT_MS, maxBuffer: MAX_OUTPUT, ...(opts.env ? { env: opts.env } : {}) });

const gitOf = (call) => (cwd, args) => answered(call(cwd, args), args);

function answered(r, args) {
  if (!r.ok) throw new Blocked(`git ${args[0]} did not answer: ${scrub(reasonOf(r))}`);
  return r.out ?? "";
}

// The NATIVE realpath: on Windows it expands a short name (RUNNER~1) the way git's answer already
// is, where the JavaScript one keeps it -- and two spellings of one directory are one directory.
function placed(p) {
  try { return realpathSync.native(p); }
  catch { return resolve(p); }
}

const folded = (p) => (process.platform === "win32" ? placed(p).toLowerCase() : placed(p));

export const samePath = (a, b) => folded(a) === folded(b);

// A clone's git directory is its OWN: a directory -- never a link, never a `gitdir:` file -- and no `commondir`
// naming another repository's, through which a git call in the clone would read and write that repository: the
// checkout's own, its index and its refs. The clone's `.git` is the host's to write (THE ANCHOR, below).
const realDirAt = (p) => {
  try { return lstatSync(p).isDirectory(); }
  catch { return false; }
};

const ownGitDir = (dir) => realDirAt(join(dir, ".git")) && !existsSync(join(dir, ".git", "commondir"));

function inOwnClone(dir) {
  if (!ownGitDir(dir)) throw new Refused(`${dir}'s .git is not its own — a link, or a file naming another repository; nothing is read or written through it`);
  return dir;
}

// A repository whose top is `dir` itself, its git directory its own, and which is not the checkout.
function ownTop(call, root, dir) {
  if (!ownGitDir(dir)) return false;
  const r = call(dir, ["rev-parse", "--show-toplevel"]);
  return r.ok === true && samePath(firstLine(r.out), dir) && !samePath(dir, root);
}

// opts.inherit: the environment a composition root starts from (PATH, HOME, temp) -- the anchor's git gets
// only that base, plus the switches that turn system and global configuration off.
export function createLocalClones(root, proc, opts) {
  const call = callOf(proc, opts);
  const anchorGit = (dir) => anchoredState(proc, opts, dir);
  const git = gitOf(call);
  return { root, head: () => firstLine(git(root, ["rev-parse", "HEAD"])), dirty: () => git(root, ["status", "--porcelain"]).trim().length > 0, listed: (dir) => ownTop(call, root, dir), add: (dir, revision) => cloned(call, git, root, dir, revision), remove: (dir) => removed(call, root, dir), changes: (dir, from) => changesIn(git, anchorGit, inOwnClone(dir), from), treeOf: (dir) => anchoredTree(git, anchorGit, inOwnClone(dir)), stateOf: (dir) => anchorGit(dir), treeAt: (dir, revision) => treeAtIn(git, root, revision), ...delivery(proc, opts, root) };
}

// ---- THE DELIVERY: a task's commit, and a push of exactly it (0.2.0) -----------------------------------------
//
// Never through the clone's own `.git`: that is the host's to write (THE ANCHOR, below), and a hook, a configuration
// that rewrites a URL (`pushInsteadOf`) or a `.git` naming the checkout's own would make a commit, or a push a person
// approved, land somewhere else. So a commit is made in a STORE: a bare git directory beside the tree that only this
// module writes, made FRESH for every commit (whatever stood there is removed, a link unfollowed), with no template --
// no hook, no exclude -- and the checkout's objects borrowed through `objects/info/alternates`, which git never writes.
// Its index starts from the base revision and takes the tree's files through the anchored git that names a recorded
// tree (no system, global or workspace configuration; git passes over the tree's own `.git`, whatever it holds), so the
// commit holds what the workspace holds -- a file the project tracks though it ignores it included -- and the commit is
// plumbing (`commit-tree`), which runs no hook. A push goes from a git directory made for that one push, borrowing the
// checkout's objects and the store's and holding nothing of its own: the URL it pushes to is the one it was given, read
// only through the machine's and the person's own configuration (their credentials), never through a task's file.
const delivery = (proc, opts, root) => ({ commit: (place, branch, message) => committedIn(proc, opts, root, place, { branch, message }), headOf: (store) => storeHead(callOf(proc, opts), store), remoteOf: (name) => remoteUrl(callOf(proc, opts), root, name), push: (store, url, sha, ref, force) => pushedFrom(proc, opts, root, store, { url, sha, ref, force }), remoteRefOf: (url, ref) => remoteRef(callOf(proc, opts), root, url, ref) });

const REVISION = /^[0-9a-f]{7,64}$/;

// A commit needs an author: the person's own git identity as the CHECKOUT names it -- their configuration, never the
// task's -- else Orbit's.
const configured = (call, root, key) => ((r) => (r.ok === true ? firstLine(r.out) : ""))(call(root, ["config", "--get", key]));

const identityOf = (call, root) => ["-c", `user.name=${configured(call, root, "user.name") || "Orbit"}`, "-c", `user.email=${configured(call, root, "user.email") || "orbit@localhost"}`];

// The checkout's object directory, as git names it: a linked worktree's is its common directory's.
const objectsOf = (git, root) => join(resolve(root, firstLine(git(root, ["rev-parse", "--git-common-dir"]))), "objects");

// A bare git directory with no template, borrowing these object directories and writing none of them.
function borrowing(git, dir, objects) {
  git(dirname(dir), ["init", "--bare", "--quiet", "--template=", dir]);
  mkdirSync(join(dir, "objects", "info"), { recursive: true });
  writeFileSync(join(dir, "objects", "info", "alternates"), `${objects.join("\n")}\n`);
  return dir;
}

function committedIn(proc, opts, root, place, c) {
  if (!REVISION.test(String(place.base))) throw new Refused(`${place.base} is not a revision — nothing is committed`);
  rmSync(place.store, { recursive: true, force: true, maxRetries: 3 });
  const store = borrowing(gitOf(callOf(proc, opts)), place.store, [objectsOf(gitOf(callOf(proc, opts)), root)]);
  const identity = identityOf(callOf(proc, opts), root);
  return anchored(proc, opts, (git) => committedWith(anchoredIn(git, place.tree, store), place.base, identity, c.branch, c.message));
}

function committedWith(at, base, identity, branch, message) {
  at(["read-tree", base]);
  at(["add", "-A"]);
  at(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  at(["update-ref", "HEAD", commitOf(at, base, identity, message)]);
  return firstLine(at(["rev-parse", "HEAD"]));
}

// Nothing changed is the base itself, never an empty commit.
function commitOf(at, base, identity, message) {
  const tree = firstLine(at(["write-tree"]));
  if (tree === firstLine(at(["rev-parse", `${base}^{tree}`]))) return base;
  return firstLine(at([...identity, "commit-tree", tree, "-p", base, "-m", message]));
}

// Before the first commit there is no store, and no branch.
const storeHead = (call, store) => (existsSync(join(store, "HEAD")) ? ((r) => (r.ok === true ? firstLine(r.out) || null : null))(call(store, [`--git-dir=${store}`, "rev-parse", "--verify", "--quiet", "HEAD"])) : null);

function pushedFrom(proc, opts, root, store, p) {
  const fresh = mkdtempSync(join(tmpdir(), "orbit-push-"));
  try { return pushedWith(proc, opts, borrowing(gitOf(callOf(proc, opts)), join(fresh, "git"), [objectsOf(gitOf(callOf(proc, opts)), root), join(store, "objects")]), p); }
  finally { rmSync(fresh, { recursive: true, force: true }); }
}

// -> { ok, reason }: a refusal (a non-fast-forward, a missing permission) is the remote's answer, kept as said.
const pushedWith = (proc, opts, dir, p) => ((r) => ({ ok: r.ok === true, reason: r.ok === true ? null : scrub(reasonOf(r)) }))(callOf(proc, opts)(dir, [`--git-dir=${dir}`, "push", "--porcelain", "--no-verify", p.url, `${p.force ? "+" : ""}${p.sha}:${p.ref}`]));

// A remote the checkout names by a RELATIVE path means a directory next to the CHECKOUT, and a push runs from the
// clone, which lives elsewhere: it is resolved where the checkout would have resolved it. A URL with a scheme, an
// `host:path` one and an absolute path are taken as said.
const relativePath = (url) => !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url) && !/^[^/\\]+:/.test(url) && !isAbsolute(url);

const placedUrl = (root, url) => (url && relativePath(url) ? resolve(root, url) : url);

const remoteUrl = (call, root, name) => ((r) => (r.ok === true ? placedUrl(root, firstLine(r.out)) || null : null))(call(root, ["remote", "get-url", "--push", name]));

const remoteRef = (call, root, url, ref) => ((r) => (r.ok === true ? firstLine(r.out).split(/\s+/)[0] || null : null))(call(root, ["ls-remote", url, ref]));

// Linked first, which costs nothing on the same disk; a clone git could not link is copied. A failed
// clone leaves no directory behind (git removes what it made), so the copy starts clean.
// A clone is checked out BYTE FOR BYTE (0.0.2): a person's or a machine's `core.autocrlf` -- Git for Windows ships it
// on in its system configuration -- would write CRLF files the anchor (which reads no such configuration) names as
// another tree, and every fresh workspace would read as changed. The project's own attributes still apply to both.
const VERBATIM = ["--config", "core.autocrlf=false"];

function cloned(call, git, root, dir, revision) {
  const linked = call(root, ["clone", "--quiet", "--local", ...VERBATIM, "--no-checkout", root, dir]);
  if (!linked.ok) git(root, ["clone", "--quiet", "--local", "--no-hardlinks", ...VERBATIM, "--no-checkout", root, dir]);
  git(dir, ["checkout", "--quiet", "--detach", revision]);
  call(dir, ["remote", "remove", "origin"]);
  return dir;
}

function removed(call, root, dir) {
  if (!ownTop(call, root, dir)) throw new Refused(`${dir} is not a clone this made — it is not removed`);
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  return dir;
}

// ---- what changed ----------------------------------------------------------------------------

const CHANGE = { A: "added", C: "added", M: "modified", T: "modified", U: "modified", D: "deleted", R: "renamed" };

const tokensOf = (text) => text.split("\0").filter(Boolean);

const widthOf = (code) => (/^[RC]/.test(code) ? 3 : 2);

// name-status -z: STATUS\0path\0, or Rnnn\0from\0to\0 for a rename or a copy.
function statusRows(tokens) {
  const starts = [];
  for (let i = 0; i < tokens.length; i += widthOf(tokens[i])) starts.push(i);
  return starts.map((i) => (widthOf(tokens[i]) === 3 ? { code: tokens[i], from: tokens[i + 1], path: tokens[i + 2] } : { code: tokens[i], path: tokens[i + 1] }));
}

const count = (n) => (/^\d+$/.test(n) ? Number(n) : undefined);

// numstat -z: added\tremoved\tpath\0, or added\tremoved\t\0from\0to\0 for a rename. A binary file
// counts `-`, which is no number at all.
function countRows(tokens) {
  const starts = [];
  for (let i = 0; i < tokens.length; i += tokens[i].endsWith("\t") ? 3 : 1) starts.push(i);
  return starts.map((i) => ((parts) => ({ added: count(parts[0]), removed: count(parts[1]), path: parts[2] || tokens[i + 2] }))(tokens[i].split("\t")));
}

const merged = (statuses, counts) => statuses.map((s) => ({ path: s.path, change: CHANGE[s.code[0]] ?? "modified", ...(s.from ? { from: s.from } : {}), added: counts.find((c) => c.path === s.path)?.added, removed: counts.find((c) => c.path === s.path)?.removed }));

// The identity of a workspace's source as it is NOW: stage everything (untracked files count, ignored ones
// do not) in the clone's OWN index, and name the tree. The one spelling both `changes` and a sandbox use,
// so the tree a record-changes recorded and the tree a sandbox was built from are comparable.
function treeIn(git, dir) {
  git(dir, ["add", "-A"]);
  return firstLine(git(dir, ["write-tree"]));
}

// ---- the ANCHOR: what a workspace holds, named by a git nothing else configured ----------------------
//
// The clone's own `.git` is the host's to write -- its index (a `--skip-worktree` flag), its config (a clean
// filter), its `info/exclude`, its replace refs -- and any of those can make the clone's git name a tree that
// is not what its files hold. So the identity a baseline and a check are held to is named through a FRESH
// bare git directory, made for this one look in a new temporary directory nobody could have prepared, with
// its own index and no system or global configuration (`anchorEnv`): the files as they are, the project's own
// tracked ignore files, nothing else. It is removed when the look is done.
//
//   stateOf(dir) -> { tree, ignored, stamp }
//     tree     the anchored tree id
//     ignored  how many entries the project's own ignore files leave out of it
//     stamp    the newest CHANGE time (ctime) among the files it holds: any write -- an edit put back
//              included -- moves it, and an unprivileged process cannot set it back
// HOME and XDG_CONFIG_HOME are the anchor itself, which is empty: git's per-user DEFAULT ignore and attributes
// files ($XDG_CONFIG_HOME/git/ignore, …/attributes) are read even with the global config off, and nothing
// a process wrote there may decide what a tree holds. The global configuration is an EMPTY file the anchor itself
// holds (0.0.2): Git for Windows refuses the null device as a config file (`unable to access '\\.\nul'`), and an
// empty file in a directory made for this one look says the same thing on every OS.
const EMPTY_CONFIG = "empty.gitconfig";

const anchorEnv = (opts, anchor) => ({ ...baseEnv(opts.env ?? opts.inherit ?? {}), HOME: anchor, XDG_CONFIG_HOME: anchor, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(anchor, EMPTY_CONFIG), GIT_ATTR_NOSYSTEM: "1" });

// A file's own change time -- a link's, never its target's -- or NaN when it cannot be read, and then the
// whole stamp is null: an unreadable file is never a stamp that cannot move.
const ctimeOf = (path) => {
  try { return lstatSync(path).ctimeMs; }
  catch { return NaN; }
};

const stampOf = (dir, files) => ((times) => (times.some(Number.isNaN) ? null : Math.max(0, ...times)))(files.map((p) => ctimeOf(join(dir, p))));

const anchoredIn = (git, dir, anchor) => (args) => git(dir, [`--git-dir=${anchor}`, `--work-tree=${dir}`, "-c", "core.bare=false", ...args]);

// `fn(git, anchor)` with a git nothing else configured, in a directory made for it and removed after.
function anchored(proc, opts, fn) {
  const anchor = mkdtempSync(join(tmpdir(), "orbit-anchor-"));
  writeFileSync(join(anchor, EMPTY_CONFIG), "");
  try { return fn(gitOf(callOf(proc, { ...opts, env: anchorEnv(opts, anchor) })), anchor); }
  finally { rmSync(anchor, { recursive: true, force: true }); }
}

const anchoredState = (proc, opts, dir) => anchored(proc, opts, (git, anchor) => stateWith(git, dir, anchor));

function stateWith(git, dir, anchor) {
  git(dirname(dir), ["init", "--bare", "--quiet", join(anchor, "git")]);
  const at = anchoredIn(git, dir, join(anchor, "git"));
  at(["add", "-A"]);
  return { tree: firstLine(at(["write-tree"])), ignored: ignoredBy(at), stamp: stampOf(dir, at(["ls-files", "-z"]).split("\u0000").filter(Boolean)) };
}

const ignoredBy = (at) => at(["status", "--porcelain=v1", "--ignored=traditional", "--untracked-files=normal", "-z"]).split("\u0000").filter((e) => e.startsWith("!! ")).length;

// The tree a REVISION holds, as git names it: what a workspace's tree is, exactly, before anything changed
// in it -- read in the developer's checkout, which a task never writes, with replace refs ignored. Only a
// hex revision is asked, so nothing typed becomes an argument git would read as an option.
function treeAtIn(git, root, revision) {
  if (!/^[0-9a-f]{7,64}$/.test(String(revision))) return null;
  return firstLine(git(root, ["--no-replace-objects", "rev-parse", "--verify", `${revision}^{tree}`]));
}

// What changed since `from`, read in the clone's own index (a diff needs the clone's objects): the clone's tree
// id is kept as `git`, the base of the next diff; the NAME the change is recorded under is the anchor's.
function changesIn(git, anchorGit, dir, from) {
  const gitTree = treeIn(git, dir);
  const statuses = statusRows(tokensOf(git(dir, ["diff", "--cached", "-M", "--name-status", "-z", from, "--"])));
  const counts = countRows(tokensOf(git(dir, ["diff", "--cached", "-M", "--numstat", "-z", from, "--"])));
  return { rows: merged(statuses, counts), tree: anchorGit(dir).tree, git: gitTree };
}

// The clone's own index is staged too, as it always was: a sandbox reads what a workspace holds from it
// (src/frontend/index.mjs, `staged`). The NAME is the anchor's.
function anchoredTree(git, anchorGit, dir) {
  treeIn(git, dir);
  return anchorGit(dir).tree;
}
