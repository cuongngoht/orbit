import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { trackedSet } from "../src/engineering/record.mjs";

function repo(name, files) {
  const dir = join(mkdtempSync(join(tmpdir(), "orbit-multi-")), name);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  commit(dir, ["init", "-q", "."]);
  return dir;
}

function commit(dir, first) {
  for (const args of [first, ["add", "-A"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"]]) if (args) spawnSync("git", args, { cwd: dir });
}

test("one root is exactly the old port: plain paths, nothing namespaced", () => {
  const a = repo("backend", { "src/index.ts": "a" });
  const tree = createSourceTree([a, join(a, "..", "nope")]);
  assert.deepEqual(tree.files(), ["src/index.ts"]);
  assert.equal(tree.roots, undefined);
});

test("a second checkout is READ, namespaced, and the same path in both never collides", () => {
  const a = repo("backend", { "src/index.ts": "backend", "src/Orders/OrderRepository.cs": "r" });
  const b = repo("frontend", { "src/index.ts": "frontend" });
  const tree = createSourceTree([a, b]);
  assert.deepEqual(tree.files().sort(), ["frontend::src/index.ts", "src/Orders/OrderRepository.cs", "src/index.ts"]);
  assert.equal(tree.read("src/index.ts"), "backend");
  assert.equal(tree.read("frontend::src/index.ts"), "frontend");
  assert.deepEqual(tree.roots.map((r) => r.alias), ["backend", "frontend"]);
});

test("fingerprints are per repository: a commit in one moves nothing in the other", () => {
  const a = repo("backend", { "src/index.ts": "backend" });
  const b = repo("frontend", { "src/index.ts": "frontend" });
  const tree = createSourceTree([a, b]);
  const before = tree.fingerprints(["src", "frontend::src"]);
  assert.notEqual(before.src.hash, before["frontend::src"].hash, "the same relative scope in two repos is two scopes");
  writeFileSync(join(b, "src/index.ts"), "changed");
  commit(b, null);
  const after = tree.fingerprints(["src", "frontend::src"]);
  assert.equal(after.src.hash, before.src.hash);
  assert.notEqual(after["frontend::src"].hash, before["frontend::src"].hash);
});

test("search results carry the namespace of the repository they came from", () => {
  const a = repo("backend", { "src/a.ts": "needle" });
  const b = repo("frontend", { "src/b.ts": "needle" });
  assert.deepEqual(createSourceTree([a, b]).search("needle").map((h) => h.path).sort(), ["frontend::src/b.ts", "src/a.ts"]);
});

test("two checkouts with one directory name get distinct aliases", () => {
  const a = repo("app", { "x.ts": "1" });
  const b = repo("app", { "y.ts": "2" });
  assert.deepEqual(createSourceTree([a, b]).roots.map((r) => r.alias), ["app", "app-2"]);
  assert.equal(basename(a), basename(b));
});

test("a namespaced path is a tracked path for evidence, directories included", () => {
  const a = repo("backend", { "src/x.ts": "1" });
  const b = repo("frontend", { "src/features/orders/list.tsx": "2" });
  const tracked = trackedSet(createSourceTree([a, b]).files());
  assert.ok(tracked.has("frontend::src/features/orders"));
  assert.ok(tracked.has("frontend::src/features/orders/list.tsx"));
});

// A SUBMODULE: a second repository recorded inside the first as a gitlink. `ls-files` lists the link
// and none of the files behind it, so whatever lives there -- a frontend, say -- is invisible to a
// reader of the checkout, until it asks for submodules.
function withSubmodule(at = "external/ui") {
  const child = repo("child", { "app/package.json": '{"name":"app"}' });
  const parent = repo("parent", { "README.md": "parent" });
  spawnSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", child, at], { cwd: parent });
  commit(parent, null);
  return { parent, at };
}

test("a submodule is invisible unless asked for, and then read under the path it has in the working tree", () => {
  const { parent, at } = withSubmodule();
  assert.ok(!createSourceTree([parent]).files().includes(`${at}/app/package.json`), "the default port reads the checkout's own tree, as it always has");
  const tree = createSourceTree([parent], undefined, { submodules: true });
  assert.ok(tree.files().includes(`${at}/app/package.json`));
  assert.ok(tree.files().includes("README.md"));
  assert.equal(tree.read(`${at}/app/package.json`), '{"name":"app"}');
  assert.equal(tree.read("README.md"), "parent");
});

test("a commit inside a submodule moves its own files and nothing of the checkout around it", () => {
  const { parent, at } = withSubmodule();
  const tree = createSourceTree([parent], undefined, { submodules: true });
  const before = tree.fingerprints([`${at}/app/package.json`, "README.md"]);
  writeFileSync(join(parent, at, "app/package.json"), '{"name":"app","version":"2.0.0"}');
  commit(join(parent, at), null);
  const after = tree.fingerprints([`${at}/app/package.json`, "README.md"]);
  assert.notEqual(after[`${at}/app/package.json`].hash, before[`${at}/app/package.json`].hash);
  assert.equal(after["README.md"].hash, before["README.md"].hash);
});

test("a submodule that was never initialised has nothing to read, and is left out rather than failing", () => {
  const { parent, at } = withSubmodule();
  const copy = join(mkdtempSync(join(tmpdir(), "orbit-multi-")), "copy");
  spawnSync("git", ["clone", "-q", parent, copy]);
  const files = createSourceTree([copy], undefined, { submodules: true }).files();
  assert.ok(files.includes("README.md"));
  assert.ok(!files.some((p) => p.startsWith(`${at}/`)), "nothing behind the link");
});
