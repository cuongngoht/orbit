// The patch is the difference between two trees, taken through a git directory of the controller's own: what the
// agent did to its own .git (a commit, a reset, a deleted history) changes nothing that is graded.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { builtRepo, changedPaths, diffTrees, git, privateGitDir, treeOfWork } from "../lib/core/git.mjs";
import { patchOf } from "../lib/run/attempt.mjs";
import { packIds } from "../lib/tasks/packs.mjs";
import { taskOf } from "../lib/tasks/index.mjs";
import { checkoutStart } from "../lib/tasks/swebench.mjs";

const FILES = [{ rel: "src/a.mjs", text: "export const a = 1;\n" }, { rel: "test/a.test.mjs", text: "// t\n" }, { rel: ".gitignore", text: "node_modules/\n" }];

function scene(fn) {
  const dir = mkdtempSync(join(tmpdir(), "evl-git-"));
  try {
    const start = builtRepo(join(dir, "start"), FILES);
    cpSync(join(dir, "start"), join(dir, "after"), { recursive: true });
    fn(join(dir, "after"));
    const gd = privateGitDir(join(dir, "start", ".git"), join(dir, "diff.git"));
    const tree = treeOfWork(gd, join(dir, "after"), start.commit);
    return { patch: diffTrees(gd, start.tree, tree).toString("latin1"), paths: changedPaths(gd, start.tree, tree), start };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the same files always make the same start commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "evl-git-"));
  try {
    assert.deepEqual(builtRepo(join(dir, "x"), FILES), builtRepo(join(dir, "y"), FILES));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an edit, a new file, a deletion and a binary file are in the patch; an ignored file is not", () => {
  const r = scene((w) => {
    writeFileSync(join(w, "src/a.mjs"), "export const a = 2;\n");
    writeFileSync(join(w, "src/b.mjs"), "export const b = 1;\n");
    unlinkSync(join(w, "test/a.test.mjs"));
    writeFileSync(join(w, "img.bin"), Buffer.from([0, 1, 2, 255, 0, 7]));
    cpSync(join(w, "src"), join(w, "node_modules", "x"), { recursive: true });
  });
  assert.deepEqual(r.paths.sort(), ["img.bin", "src/a.mjs", "src/b.mjs", "test/a.test.mjs"]);
  assert.match(r.patch, /GIT binary patch/);
  assert.doesNotMatch(r.patch, /node_modules/);
});

test("what the agent did to its own .git changes nothing: a commit, then a reset of it, then no .git at all", () => {
  const plain = scene((w) => writeFileSync(join(w, "src/a.mjs"), "export const a = 3;\n"));
  const committed = scene((w) => {
    writeFileSync(join(w, "src/a.mjs"), "export const a = 3;\n");
    git(["add", "-A"], { cwd: w });
    git(["commit", "-qm", "agent"], { cwd: w });
  });
  const reset = scene((w) => {
    writeFileSync(join(w, "src/a.mjs"), "export const a = 3;\n");
    git(["add", "-A"], { cwd: w });
    git(["commit", "-qm", "agent"], { cwd: w });
    git(["reset", "-q", "--soft", "HEAD~1"], { cwd: w });
  });
  const noGit = scene((w) => {
    writeFileSync(join(w, "src/a.mjs"), "export const a = 3;\n");
    rmSync(join(w, ".git"), { recursive: true, force: true });
  });
  assert.equal(committed.patch, plain.patch);
  assert.equal(reset.patch, plain.patch);
  assert.equal(noGit.patch, plain.patch);
  assert.deepEqual(plain.paths, ["src/a.mjs"]);
});

test("nothing changed is an empty patch", () => {
  assert.equal(scene(() => null).patch, "");
});

test("the patch applies to the start with git apply", () => {
  const dir = mkdtempSync(join(tmpdir(), "evl-git-"));
  try {
    const r = scene((w) => writeFileSync(join(w, "src/a.mjs"), "export const a = 4;\n"));
    builtRepo(join(dir, "s"), FILES);
    writeFileSync(join(dir, "p.diff"), r.patch, "latin1");
    assert.equal(git(["apply", "--binary", join(dir, "p.diff")], { cwd: join(dir, "s") }).ok, true);
    assert.equal(readFileSync(join(dir, "s", "src/a.mjs"), "utf8"), "export const a = 4;\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the run's git directory: every tree the controller compares is written into it and read from it -----------------

// A start whose work tree holds a file its HEAD does not (an image's untracked build/), so its start tree is NOT
// HEAD's tree and its objects exist only where the controller staged it.
function checkoutScene(fn) {
  const dir = mkdtempSync(join(tmpdir(), "evl-git-"));
  try {
    const scratch = join(dir, "scratch");
    builtRepo(join(scratch, "start"), FILES);
    mkdirSync(join(scratch, "start", "build", "lib"), { recursive: true });
    writeFileSync(join(scratch, "start", "build", "lib", "a.py"), "built = 1\n");
    const start = checkoutStart(join(scratch, "start"));
    cpSync(join(scratch, "start"), join(scratch, "after"), { recursive: true });
    fn(join(scratch, "after"));
    return { start, patch: patchOf(start, scratch, ensureDirOf(join(dir, "room"))) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ensureDirOf = (d) => (mkdirSync(d, { recursive: true }), d);

test("a start tree with an untracked file is diffed against the end tree: the untracked file is the start's, never the agent's", () => {
  const r = checkoutScene((w) => writeFileSync(join(w, "src/a.mjs"), "export const a = 5;\n"));
  assert.deepEqual(r.patch.paths, ["src/a.mjs"]);
  assert.ok(r.patch.bytes > 0);
  assert.equal(checkoutScene(() => null).patch.bytes, 0);
  assert.deepEqual(checkoutScene((w) => rmSync(join(w, "build"), { recursive: true })).patch.paths, ["build/lib/a.py"]);
});

test("every task source's start holds its start tree in the git directory it names, and an untouched tree is an empty patch", () => {
  const dir = mkdtempSync(join(tmpdir(), "evl-git-"));
  try {
    for (const id of packIds()) {
      const scratch = join(dir, id);
      const start = taskOf(`pack:${id}`).start(join(scratch, "start"));
      assert.equal(git(["cat-file", "-e", `${start.startTree}^{tree}`], { env: { GIT_DIR: start.gitDir } }).ok, true, id);
      cpSync(join(scratch, "start", "work", "repo"), join(scratch, "after"), { recursive: true });
      assert.equal(patchOf(start, scratch, ensureDirOf(join(scratch, "room"))).bytes, 0, id);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
