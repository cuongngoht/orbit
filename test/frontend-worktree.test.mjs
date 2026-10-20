// The working-tree port: what is on disk now, held to the rules the rest of the
// engine holds a path to -- contained through symlinks, no link read or written
// through, no binary, no write that is half done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFrontend } from "../src/frontend/index.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { createWorktree } from "../src/frontend/worktree.mjs";
import { Refused } from "../src/errors.mjs";

function checkout(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orbit-wt-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".devcontainer", "api"), { recursive: true });
  writeFileSync(join(root, ".devcontainer", "devcontainer.json"), "{ // a comment\n}\n");
  writeFileSync(join(root, "blob.bin"), "ab\0cd");
  return root;
}

test("read answers the bytes on disk now, and null for what is not text or not there", (t) => {
  const tree = createWorktree(checkout(t));
  assert.equal(tree.read(".devcontainer/devcontainer.json"), "{ // a comment\n}\n");
  assert.equal(tree.read("missing.json"), null);
  assert.equal(tree.read("blob.bin"), null);
  assert.equal(tree.read(".devcontainer"), null, "a directory is not a file");
  assert.deepEqual([tree.exists("blob.bin"), tree.exists("missing.json"), tree.exists(".devcontainer")], [true, false, true]);
});

test("a path that leaves the checkout, lexically or through a symlink, is absent -- never read", (t) => {
  const root = checkout(t);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "orbit-out-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "secret.txt"), "nope");
  symlinkSync(outside, join(root, "link"));
  symlinkSync(join(outside, "secret.txt"), join(root, "file-link"));
  const tree = createWorktree(root);
  assert.equal(tree.read("../secret.txt"), null);
  assert.equal(tree.read("link/secret.txt"), null);
  assert.equal(tree.read("file-link"), null);
  assert.deepEqual(tree.list("link"), []);
});

test("list is a sorted directory listing, and empty for anything that is not a directory", (t) => {
  const tree = createWorktree(checkout(t));
  assert.deepEqual(tree.list(".devcontainer"), ["api", "devcontainer.json"]);
  assert.deepEqual(tree.list("blob.bin"), []);
  assert.deepEqual(tree.list("nowhere"), []);
});

test("write replaces atomically, leaves no temporary or backup file, and creates what is missing", (t) => {
  const root = checkout(t);
  const tree = createWorktree(root);
  tree.write(".devcontainer/devcontainer.json", "{}\n");
  tree.write(".devcontainer/new/devcontainer.json", "{ \"name\": \"x\" }\n");
  assert.equal(readFileSync(join(root, ".devcontainer", "devcontainer.json"), "utf8"), "{}\n");
  assert.equal(readFileSync(join(root, ".devcontainer", "new", "devcontainer.json"), "utf8"), "{ \"name\": \"x\" }\n");
  assert.deepEqual(readdirSync(join(root, ".devcontainer")).sort(), ["api", "devcontainer.json", "new"]);
});

test("write refuses a path outside the checkout and a symlink target, and writes nothing", (t) => {
  const root = checkout(t);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "orbit-out-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(join(outside, "target.txt"), join(root, "linked.txt"));
  symlinkSync(join(root, "blob.bin"), join(root, "inner-link"));
  const tree = createWorktree(root);
  assert.throws(() => tree.write("../escape.txt", "x"), Refused);
  assert.throws(() => tree.write("linked.txt", "x"), /outside the checkout/, "a link out of the checkout is outside it");
  assert.throws(() => tree.write("inner-link", "x"), /is a symlink/, "a link inside is still not written through");
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(readFileSync(join(root, "blob.bin"), "utf8"), "ab\0cd");
});

test("the source port names the branch, as a one-line git answer, and the composite speaks for its primary", () => {
  const exec = (file, args) => (args.includes("--abbrev-ref") ? "feature/refund\n" : "abc\n");
  assert.equal(createFrontend([process.cwd()], exec).branch(), "feature/refund");
  assert.equal(createSourceTree([process.cwd()], exec).branch(), "feature/refund");
  const failing = () => { throw Object.assign(new Error("not a repo"), { status: 128 }); };
  assert.equal(createFrontend([process.cwd()], failing).branch(), null);
});
