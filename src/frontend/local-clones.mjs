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
//
// No hook runs: every call points `core.hooksPath` at a directory that does not exist, and
// `core.fsmonitor` off -- a checkout's hooks are code it brought with it. A failing git is BLOCKED
// with the line that says why (its `fatal:` or `error:` line, else its last), scrubbed: the
// machine could not answer, and nothing about the change was learned.
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

// A repository whose top is `dir` itself, and which is not the checkout.
function ownTop(call, root, dir) {
  const r = call(dir, ["rev-parse", "--show-toplevel"]);
  return r.ok === true && samePath(firstLine(r.out), dir) && !samePath(dir, root);
}

// opts.inherit: the environment a composition root starts from (PATH, HOME, temp) -- the anchor's git gets
// only that base, plus the switches that turn system and global configuration off.
export function createLocalClones(root, proc, opts) {
  const call = callOf(proc, opts);
  const anchorGit = (dir) => anchoredState(proc, opts, dir);
  const git = gitOf(call);
  return { root, head: () => firstLine(git(root, ["rev-parse", "HEAD"])), dirty: () => git(root, ["status", "--porcelain"]).trim().length > 0, listed: (dir) => ownTop(call, root, dir), add: (dir, revision) => cloned(call, git, root, dir, revision), remove: (dir) => removed(call, root, dir), changes: (dir, from) => changesIn(git, anchorGit, dir, from), treeOf: (dir) => anchoredTree(git, anchorGit, dir), stateOf: (dir) => anchorGit(dir), treeAt: (dir, revision) => treeAtIn(git, root, revision) };
}

// Linked first, which costs nothing on the same disk; a clone git could not link is copied. A failed
// clone leaves no directory behind (git removes what it made), so the copy starts clean.
function cloned(call, git, root, dir, revision) {
  const linked = call(root, ["clone", "--quiet", "--local", "--no-checkout", root, dir]);
  if (!linked.ok) git(root, ["clone", "--quiet", "--local", "--no-hardlinks", "--no-checkout", root, dir]);
  git(dir, ["checkout", "--quiet", "--detach", revision]);
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
// a process wrote there may decide what a tree holds.
const anchorEnv = (opts, anchor) => ({ ...baseEnv(opts.env ?? opts.inherit ?? {}), HOME: anchor, XDG_CONFIG_HOME: anchor, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_ATTR_NOSYSTEM: "1" });

// A file's own change time -- a link's, never its target's -- or NaN when it cannot be read, and then the
// whole stamp is null: an unreadable file is never a stamp that cannot move.
const ctimeOf = (path) => {
  try { return lstatSync(path).ctimeMs; }
  catch { return NaN; }
};

const stampOf = (dir, files) => ((times) => (times.some(Number.isNaN) ? null : Math.max(0, ...times)))(files.map((p) => ctimeOf(join(dir, p))));

const anchoredIn = (git, dir, anchor) => (args) => git(dir, [`--git-dir=${anchor}`, `--work-tree=${dir}`, "-c", "core.bare=false", ...args]);

function anchoredState(proc, opts, dir) {
  const anchor = mkdtempSync(join(tmpdir(), "orbit-anchor-"));
  try { return stateWith(gitOf(callOf(proc, { ...opts, env: anchorEnv(opts, anchor) })), dir, anchor); }
  finally { rmSync(anchor, { recursive: true, force: true }); }
}

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
