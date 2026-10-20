// The task's WORKSPACE on a real repository: a local clone detached at the base revision, its owner
// written first, its changes read back as rows, and nothing of the developer's checkout touched --
// not a file, not a byte of its `.git`, not a branch, and no hook of the repository run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, utimesSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createLocalClones } from "../src/frontend/local-clones.mjs";
import { createProcess } from "../src/process/index.mjs";
import { createWorkspaces, workspaceIdOf } from "../src/orchestration/workspace.mjs";
import { guardedIo } from "../src/store/guard.mjs";
import { realIo } from "../src/store/io.mjs";
import { sealed } from "./home.mjs";

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8", env: sealed(IDENTITY) });
const TASK = "tsk-0123456789ab";
const OTHER = "tsk-ba9876543210";

function repository(t, files) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-ws-real-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "repo");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  for (const args of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "init"]]) git(dir, ...args);
  return { base, dir, store: join(base, "store") };
}

const FILES = { "src/refund.js": "exports.valid = (a) => a > 0;\n", "src/keep.js": "1\n", "old/name.js": "x\ny\n", ".gitignore": "dist/\n" };

function owned(t, files = FILES) {
  const repo = repository(t, files);
  const trees = createLocalClones(repo.dir, createProcess(), { noHooks: join(repo.store, "workspaces", ".no-hooks"), env: sealed(IDENTITY) });
  const io = guardedIo(repo.store, realIo());
  const ws = createWorkspaces({ root: repo.store, io, trees, host: "laptop-a", now: () => "2026-10-07T10:00:00.000Z" });
  const head = { task: TASK, project: "repo-a", checkout: "c".repeat(64), baseRevision: trees.head() };
  return { ...repo, trees, io, ws, head };
}

// Every file under the developer's .git, with its bytes: what a workspace must never write.
const gitDir = (dir) => {
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  return walk(join(dir, ".git")).map((p) => [relative(dir, p), readFileSync(p).toString("base64")]);
};

// Every file of the developer's checkout, with its bytes, outside .git -- and what git says of it.
function picture(dir) {
  const walk = (d) => readdirSync(d).filter((n) => n !== ".git").flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  return { files: walk(dir).map((p) => [relative(dir, p), readFileSync(p, "utf8")]), status: git(dir, "status", "--porcelain").stdout, branches: git(dir, "branch", "--list").stdout, head: git(dir, "rev-parse", "HEAD").stdout };
}

test("a workspace is a local clone DETACHED at the base revision, its owner written beside it -- and the developer's checkout, .git included, is byte for byte what it was", (t) => {
  const o = owned(t);
  const before = picture(o.dir);
  const beforeGit = gitDir(o.dir);
  const ws = o.ws.prepare(o.head);
  assert.deepEqual([ws.id, ws.reused, ws.baseRevision], [workspaceIdOf(TASK), false, o.head.baseRevision]);
  assert.equal(git(ws.path, "rev-parse", "HEAD").stdout.trim(), o.head.baseRevision);
  assert.equal(git(ws.path, "symbolic-ref", "-q", "HEAD").status, 1, "detached: no branch was made");
  assert.deepEqual(JSON.parse(readFileSync(join(dirname(ws.path), "owner.json"), "utf8")).task, TASK);
  writeFileSync(join(ws.path, "src", "refund.js"), "exports.valid = (a, paid) => a > 0 && a <= paid;\n");
  assert.deepEqual(picture(o.dir), before, "nothing of the developer's checkout moved");
  assert.deepEqual(gitDir(o.dir), beforeGit, "not one byte of its .git was written: a sandbox that keeps .git read-only can make a workspace too");
  assert.equal(existsSync(join(o.dir, ".git", "worktrees")), false);
  assert.equal(o.trees.listed(ws.path), true);
  assert.equal(o.trees.listed(o.dir), false, "the checkout is never a clone of its own");
});

test("its changes are read back as rows -- modified, added, deleted, renamed, with lines -- untracked files included and ignored ones not", (t) => {
  const o = owned(t);
  const ws = o.ws.prepare(o.head);
  writeFileSync(join(ws.path, "src", "refund.js"), "exports.valid = (a, paid) => a > 0 && a <= paid;\n// checked\n");
  writeFileSync(join(ws.path, "src", "new.js"), "a\nb\nc\n");
  rmSync(join(ws.path, "src", "keep.js"));
  git(ws.path, "mv", "old/name.js", "old/renamed.js");
  mkdirSync(join(ws.path, "dist"));
  writeFileSync(join(ws.path, "dist", "bundle.js"), "built\n");
  const got = o.ws.changes(TASK, o.head.baseRevision);
  const rows = Object.fromEntries(got.rows.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(rows).sort(), ["old/renamed.js", "src/keep.js", "src/new.js", "src/refund.js"]);
  assert.deepEqual([rows["src/refund.js"].change, rows["src/refund.js"].added, rows["src/refund.js"].removed], ["modified", 2, 1]);
  assert.deepEqual([rows["src/new.js"].change, rows["src/new.js"].added], ["added", 3]);
  assert.equal(rows["src/keep.js"].change, "deleted");
  assert.deepEqual([rows["old/renamed.js"].change, rows["old/renamed.js"].from], ["renamed", "old/name.js"]);
  assert.match(got.tree, /^[0-9a-f]{40,64}$/);
  writeFileSync(join(ws.path, "src", "new.js"), "a\nb\nc\nd\n");
  const delta = o.ws.changes(TASK, got.tree).rows;
  assert.deepEqual(delta.map((r) => [r.path, r.change, r.added]), [["src/new.js", "modified", 1]], "against the last recorded tree: only what moved since");
});

test("prepare is idempotent, and nothing that is not this task's -- another task's owner, a stray directory, a link -- is used or touched", (t) => {
  const o = owned(t);
  const first = o.ws.prepare(o.head);
  assert.equal(o.ws.prepare(o.head).reused, true);
  assert.deepEqual(o.ws.found(TASK).path, first.path);
  assert.throws(() => o.ws.prepare({ ...o.head, checkout: "d".repeat(64) }), /not this task's/, "another checkout's head cannot take this workspace");
  mkdirSync(join(o.store, "workspaces", OTHER, "tree"), { recursive: true });
  writeFileSync(join(o.store, "workspaces", OTHER, "tree", "mine.txt"), "a developer's\n");
  assert.throws(() => o.ws.prepare({ ...o.head, task: OTHER }), /not a repository of its own/);
  assert.equal(readFileSync(join(o.store, "workspaces", OTHER, "tree", "mine.txt"), "utf8"), "a developer's\n");
  assert.throws(() => o.ws.prepare({ ...o.head, task: "tsk-../../x" }), /is not a task id/);
});

test("a link where the tree goes is refused, never followed", { skip: process.platform === "win32" && "creating a symlink needs a privilege a Windows runner may not have" }, (t) => {
  const o = owned(t);
  const elsewhere = join(o.base, "elsewhere");
  mkdirSync(elsewhere);
  mkdirSync(join(o.store, "workspaces", TASK), { recursive: true });
  symlinkSync(elsewhere, join(o.store, "workspaces", TASK, "tree"));
  assert.throws(() => o.ws.prepare(o.head), /holds a symlink/);
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("no hook of the repository runs when a workspace is made: a checkout brings code, and making a clone does not run it", { skip: process.platform === "win32" && "a hook is a shell script there" }, (t) => {
  const o = owned(t);
  const marker = join(o.base, "hook-ran");
  const hook = join(o.dir, ".git", "hooks", "post-checkout");
  writeFileSync(hook, `#!/bin/sh\necho ran > "${marker}"\n`);
  chmodSync(hook, 0o755);
  o.ws.prepare(o.head);
  assert.equal(existsSync(marker), false);
});

test("removal takes only this task's own clone, and refuses one it cannot account for -- and never the checkout", (t) => {
  const o = owned(t);
  const ws = o.ws.prepare(o.head);
  assert.throws(() => o.ws.remove({ ...o.head, checkout: "d".repeat(64) }), /not this task's/);
  assert.deepEqual(o.ws.remove(o.head), { id: workspaceIdOf(TASK), removed: true });
  assert.equal(existsSync(dirname(ws.path)), false);
  assert.equal(o.trees.listed(ws.path), false);
  assert.throws(() => o.trees.remove(o.dir), /not a clone this made/);
  assert.ok(existsSync(join(o.dir, "src", "refund.js")), "the checkout is all there");
});

test("where a link to the checkout's objects is refused (a sandbox keeps .git read-only), the objects are copied instead", (t) => {
  const repo = repository(t, FILES);
  const real = createProcess();
  const asked = [];
  const refusingLinks = { run: (file, args, opts) => {
    asked.push(args.filter((a) => a.startsWith("--")));
    const linking = args.includes("clone") && !args.includes("--no-hardlinks");
    return linking ? { ok: false, out: "", err: "fatal: failed to create link '.git/objects/3c/x': Operation not permitted", error: "git exited 128", status: 128 } : real.run(file, args, opts);
  } };
  const trees = createLocalClones(repo.dir, refusingLinks, { noHooks: join(repo.store, "none"), env: sealed(IDENTITY) });
  const ws = createWorkspaces({ root: repo.store, io: guardedIo(repo.store, realIo()), trees, host: "laptop-a", now: () => "2026-10-07T10:00:00.000Z" }).prepare({ task: TASK, project: "repo-a", checkout: "c".repeat(64), baseRevision: trees.head() });
  assert.equal(readFileSync(join(ws.path, "src", "refund.js"), "utf8").replace(/\r\n/g, "\n"), FILES["src/refund.js"], "a Windows checkout may write CRLF");
  assert.ok(asked.some((flags) => flags.includes("--no-hardlinks")), "the second clone copied");
});

test("a failing git is BLOCKED, and says WHY -- its fatal or error line, not a progress line", (t) => {
  const o = owned(t);
  assert.throws(() => o.trees.add(join(o.base, "x"), "f".repeat(40)), (e) => e.constructor.name === "Blocked" && /git checkout did not answer: (fatal|error):/.test(e.message));
});

test("the tree of a workspace is the one write-tree names after everything is staged, and it moves with an edit and with nothing else", (t) => {
  const o = owned(t);
  const made = o.ws.prepare(o.head);
  const before = o.ws.treeOf(TASK);
  assert.match(before, /^[0-9a-f]{40}$/);
  assert.equal(o.ws.treeOf(TASK), before, "asking again changes nothing");
  writeFileSync(join(made.path, "added.txt"), "a task's new file");
  const after = o.ws.treeOf(TASK);
  assert.notEqual(after, before);
  assert.equal(o.ws.changes(TASK, o.head.baseRevision).tree, after, "the identity record-changes keeps is this one");
});

test("a fresh workspace's tree IS its base revision's tree, what the project ignores beside it is counted, and the clone's own exclude file hides nothing", (t) => {
  const o = owned(t);
  const ws = o.ws.prepare(o.head);
  assert.equal(o.ws.treeOf(TASK), o.ws.treeAt(TASK, o.head.baseRevision), "nothing changed: a baseline here is on the base revision");
  assert.equal(o.ws.stateOf(TASK).ignored, 0);
  mkdirSync(join(ws.path, "dist"), { recursive: true });
  writeFileSync(join(ws.path, "dist", "out.js"), "1\n");
  assert.equal(o.ws.stateOf(TASK).ignored, 1, "the project's own ignore file");
  writeFileSync(join(ws.path, ".git", "info", "exclude"), "planted.js\n");
  writeFileSync(join(ws.path, "planted.js"), "module.exports = 0;\n");
  assert.notEqual(o.ws.treeOf(TASK), o.ws.treeAt(TASK, o.head.baseRevision), "the clone's own exclude file hides nothing from the anchor");
  assert.equal(o.ws.stateOf(TASK).ignored, 1, "only what the project's tracked ignore file ignores is ignored");
  assert.equal(o.ws.treeAt(TASK, "--output=/tmp/x"), null, "only a hex revision is asked");
});

test("neither the clone's own git nor a planted anchor makes an edited file read as the base revision: a fresh anchor names what the files hold", (t) => {
  const o = owned(t);
  const ws = o.ws.prepare(o.head);
  const base = o.ws.treeAt(TASK, o.head.baseRevision);
  mkdirSync(join(dirname(ws.path), ".anchor"), { recursive: true });
  writeFileSync(join(dirname(ws.path), ".anchor", "config"), "[core]\n\tbare = true\n[filter \"hide\"]\n\tclean = cat\n");
  git(ws.path, "update-index", "--skip-worktree", "src/refund.js");
  writeFileSync(join(ws.path, "src", "refund.js"), "exports.valid = () => true;\n");
  assert.notEqual(o.ws.treeOf(TASK), base, "a skip-worktree flag in the clone's index hides nothing");
  writeFileSync(join(ws.path, "src", "refund.js"), FILES["src/refund.js"]);
  git(ws.path, "config", "filter.hide.clean", "cat src/keep.js");
  writeFileSync(join(ws.path, ".git", "info", "attributes"), "src/refund.js filter=hide\n");
  writeFileSync(join(ws.path, "src", "refund.js"), "exports.valid = () => false;\n");
  assert.notEqual(o.ws.treeOf(TASK), base, "nor a clean filter its config defines");
  writeFileSync(join(ws.path, "src", "refund.js"), FILES["src/refund.js"]);
  assert.equal(o.ws.treeOf(TASK), base, "the same files are the same tree");
  const before = o.ws.stateOf(TASK).stamp;
  const earlier = new Date(Date.now() - 86400000);
  writeFileSync(join(ws.path, "src", "refund.js"), FILES["src/refund.js"]);
  utimesSync(join(ws.path, "src", "refund.js"), earlier, earlier);
  assert.equal(o.ws.treeOf(TASK), base);
  assert.ok(o.ws.stateOf(TASK).stamp > before, "a file written and put back is still a write, however its modification time is set back");
});

test("a file whose change time cannot be read makes the stamp null -- never one that cannot move -- and a per-user ignore file decides nothing", { skip: process.platform === "win32" && "creating a symlink needs a privilege a Windows runner may not have" }, (t) => {
  const o = owned(t);
  const ws = o.ws.prepare(o.head);
  symlinkSync("does-not-exist", join(ws.path, "src", "dangling"));
  assert.notEqual(o.ws.stateOf(TASK).stamp, null, "a link's own change time is read, not its target's");
  assert.equal(typeof o.ws.stateOf(TASK).stamp, "number");
  const base = o.ws.treeOf(TASK);
  const home = mkdtempSync(join(tmpdir(), "orbit-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".config", "git"), { recursive: true });
  writeFileSync(join(home, ".config", "git", "ignore"), "planted.js\n");
  const trees = createLocalClones(o.dir, createProcess(), { noHooks: join(o.store, "workspaces", ".no-hooks"), env: { ...sealed(IDENTITY), HOME: home, XDG_CONFIG_HOME: join(home, ".config") } });
  writeFileSync(join(ws.path, "planted.js"), "module.exports = 1;\n");
  assert.notEqual(trees.stateOf(ws.path).tree, base, "a per-user ignore file hides nothing from the anchor");
});
