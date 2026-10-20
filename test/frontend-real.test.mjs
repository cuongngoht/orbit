// The source tree port over a REAL checkout: what it can see of uncommitted work, whatever the path is
// called. A fake cannot say what git prints for a name with a space in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFrontend } from "../src/frontend/index.mjs";
import { sealed } from "./home.mjs";

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8", env: sealed(IDENTITY) });

function repository(t, files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-frontend-real-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  for (const args of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "init"]]) git(dir, ...args);
  return dir;
}

// A double quote is a legal name on POSIX and a forbidden one on Windows, where nothing could write it.
const NAMES = ["plain/package.json", "dir with space/package.json", "ünï/package.json", ...(process.platform === "win32" ? [] : ['quote"d/package.json'])];

test("an unstaged edit is seen under every kind of name -- spaces, non-ASCII, a quote -- not only the plain ones", (t) => {
  const dir = repository(t, Object.fromEntries(NAMES.map((n) => [n, "{}"])));
  const source = createFrontend([dir]);
  const clean = source.fingerprints(NAMES);
  assert.deepEqual(NAMES.map((n) => clean[n].dirty), NAMES.map(() => 0));
  for (const n of NAMES) writeFileSync(join(dir, n), '{ "edited": true }');
  const dirty = source.fingerprints(NAMES);
  assert.deepEqual(NAMES.map((n) => dirty[n].dirty), NAMES.map(() => 1), "each is reported as edited");
});

test("a rename is one thing that is not committed, under the NEW name", (t) => {
  const dir = repository(t, { "old name/package.json": "{}", "keep/package.json": "{}" });
  git(dir, "mv", "old name/package.json", "old name/renamed.json");
  const source = createFrontend([dir]);
  const got = source.fingerprints(["old name", "keep"]);
  assert.deepEqual([got["old name"].dirty, got.keep.dirty], [1, 0]);
});

test("a file that is only STAGED is listed and not readable: it is in the index and not in the last commit", (t) => {
  const dir = repository(t, { "package.json": "{}" });
  mkdirSync(join(dir, "apps/new"), { recursive: true });
  writeFileSync(join(dir, "apps/new/package.json"), '{ "name": "new" }');
  git(dir, "add", "apps/new/package.json");
  const source = createFrontend([dir]);
  assert.ok(source.files().includes("apps/new/package.json"), "listed");
  assert.equal(source.read("apps/new/package.json"), null, "but there is nothing at HEAD to read");
  git(dir, "commit", "-qm", "add");
  assert.equal(source.read("apps/new/package.json"), '{ "name": "new" }', "and it reads once it is committed");
});

// A task's workspace is a clone with uncommitted edits: HEAD would answer with what it began from. `staged` reads the INDEX,
// and names the TREE, which is what a run of exactly this source is evidence about.
test("a staged source reads what the workspace holds -- the edit, the new file, the tree -- where HEAD still says what it began as", (t) => {
  const dir = repository(t, { "web/package.json": '{"scripts":{"dev":"vite"}}', "web/package-lock.json": "{}" });
  writeFileSync(join(dir, "web/package.json"), '{"scripts":{"dev":"vite","serve":"node s.js"}}');
  writeFileSync(join(dir, "web/added.json"), "{}");
  git(dir, "add", "-A");
  const head = createFrontend([dir]);
  const staged = createFrontend([dir], undefined, { staged: true });
  assert.equal(head.read("web/package.json"), '{"scripts":{"dev":"vite"}}');
  assert.equal(staged.read("web/package.json"), '{"scripts":{"dev":"vite","serve":"node s.js"}}');
  assert.equal(staged.read("web/added.json"), "{}");
  assert.equal(head.read("web/added.json"), null, "a file HEAD never had");
  assert.equal(staged.commit(), git(dir, "write-tree").stdout.trim(), "the tree itself, whole");
  assert.deepEqual(staged.fingerprints(["web"]).web.dirty, 0, "a change the index holds is not a change it cannot see");
  assert.equal(head.fingerprints(["web"]).web.dirty, 2, "while against HEAD both are uncommitted");
});

test("an unstaged edit or an untracked file is what a staged source says it cannot see", (t) => {
  const dir = repository(t, { "web/package.json": "{}" });
  writeFileSync(join(dir, "web/package.json"), '{"edited":true}');
  assert.equal(createFrontend([dir], undefined, { staged: true }).fingerprints(["web"]).web.dirty, 1);
});
