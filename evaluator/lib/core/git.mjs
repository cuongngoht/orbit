// GIT, on the controller, with no system, global or repository configuration of anybody's: a starting repository built
// from files with a fixed author and date (the same files always make the same commit), and a patch taken as the
// difference between two TREES -- the start as it was handed to the agent, and the tree the agent left -- through a git
// directory of the controller's own, so nothing the agent did to its own .git (a commit, a reset, a deleted history, a
// rewritten config) changes what is graded.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { must, run } from "./proc.mjs";

const IDENT = { GIT_AUTHOR_NAME: "evaluator", GIT_AUTHOR_EMAIL: "evaluator@localhost", GIT_COMMITTER_NAME: "evaluator", GIT_COMMITTER_EMAIL: "evaluator@localhost", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };

export const gitEnv = (extra = {}) => ({ PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", LANG: "C", LC_ALL: "C", ...IDENT, ...extra });

const SAFE = ["-c", "core.autocrlf=false", "-c", "core.fileMode=true", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main", "-c", "commit.gpgSign=false", "-c", "core.quotePath=false"];

export const git = (args, o = {}) => run(["git", ...SAFE, ...args], { cwd: o.cwd, env: gitEnv(o.env), binary: o.binary, max: 512 * 1024 * 1024, input: o.input });

export const gitMust = (args, o = {}) => must(["git", ...SAFE, ...args], { cwd: o.cwd, env: gitEnv(o.env), binary: o.binary, max: 512 * 1024 * 1024 });

// Files written into `dir` ([{ rel, text, mode }]) and committed once: the start commit and its tree.
export function builtRepo(dir, files) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    mkdirSync(dirname(join(dir, f.rel)), { recursive: true });
    writeFileSync(join(dir, f.rel), f.text, { mode: f.mode === "755" ? 0o755 : 0o644 });
  }
  gitMust(["init", "-q"], { cwd: dir });
  gitMust(["add", "-A"], { cwd: dir });
  gitMust(["commit", "-q", "--allow-empty", "-m", "start"], { cwd: dir });
  return { commit: gitMust(["rev-parse", "HEAD"], { cwd: dir }).out.trim(), tree: gitMust(["rev-parse", "HEAD^{tree}"], { cwd: dir }).out.trim() };
}

// The tree a work tree holds, staged in a git directory of the controller's own over the index of `base` (a commit),
// so a tracked file the agent deleted leaves it and an untracked file nobody ignores joins it.
export function treeOfWork(gitDir, workTree, base) {
  const o = { env: { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: join(gitDir, "eval-index") } };
  gitMust(["read-tree", base], o);
  gitMust(["add", "-A", "--", "."], { ...o, cwd: workTree });
  return gitMust(["write-tree"], o).out.trim();
}

// The binary-safe patch from one tree to another, as `git apply` takes it.
export const diffTrees = (gitDir, from, to) => gitMust(["diff", "--binary", "--no-color", "--no-ext-diff", "--full-index", from, to], { env: { GIT_DIR: gitDir }, binary: true }).out;

export const changedPaths = (gitDir, from, to) => gitMust(["diff", "--name-only", "-z", "--no-renames", from, to], { env: { GIT_DIR: gitDir } }).out.split("\0").filter(Boolean);

// THE RUN'S GIT DIRECTORY: one of the controller's own per run, and every tree the controller compares -- the start
// and the end the agent left -- is written into it and read from it, whatever the task source. A start tree need not
// be HEAD's tree (an image's untracked build output is part of what the agent was handed), so its objects exist only
// where it was staged: a tree read from any other git directory would be a bad object.
//
//   startOfWork(source, gitDir, workTree, base) -> { gitDir, base, startTree }      endOfWork(start, workTree) -> tree
export function startOfWork(source, gitDir, workTree, base) {
  privateGitDir(source, gitDir);
  return { gitDir, base, startTree: treeOfWork(gitDir, workTree, base) };
}

export function endOfWork(start, workTree) {
  if (!holdsTree(start.gitDir, start.startTree)) throw new Error(`the start tree ${start.startTree} is not in the run's git directory ${start.gitDir}`);
  return treeOfWork(start.gitDir, workTree, start.base);
}

export const holdsTree = (gitDir, tree) => git(["cat-file", "-e", `${tree}^{tree}`], { env: { GIT_DIR: gitDir } }).ok;

// A private copy of a git directory to stage in: the original stays as it was.
export function privateGitDir(src, dest) {
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  return dest;
}

export const hasGit = () => run(["git", "--version"]).ok;

export const headOf = (dir) => ((r) => (r.ok ? r.out.trim() : null))(git(["rev-parse", "HEAD"], { cwd: dir }));

export const isDirty = (dir) => ((r) => (r.ok ? r.out.trim().length > 0 : null))(git(["status", "--porcelain", "--", "."], { cwd: dir }));

export const exists = existsSync;
