// The lock grammar (src/tools/lock.mjs) and the locks the catalog ships: a lock is the ONE thing that decides what a
// `python-lock` install may fetch, so what it may contain is held here, line by line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lockProblems, pinnedIn } from "../src/tools/lock.mjs";
import { toolCatalog } from "../src/tools/catalog.mjs";

const REPO = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const H = (c) => `--hash=sha256:${c.repeat(64)}`;
const GOOD = `# a comment\n\nfoo==1.0.0 ${H("a")}\nBar_Baz==2.1.0b1 ${H("b")} ${H("c")}\n`;

test("a pinned, hashed list is a lock; comments and blank lines are allowed", () => {
  assert.deepEqual(lockProblems(GOOD), []);
});

test("everything that is not `name==version` plus hashes is refused, line by line -- an install can never be widened by editing the file", () => {
  const refused = {
    "an index": "--index-url https://example.test/simple",
    "an extra index": "--extra-index-url https://example.test/simple",
    "a link page": "--find-links https://example.test/wheels",
    "a trusted host": "--trusted-host example.test",
    "an editable": "-e .",
    "another file": "-r other.txt",
    "a URL": `foo @ https://example.test/foo-1.0.0.whl ${H("a")}`,
    "a VCS reference": `foo @ git+https://example.test/foo.git ${H("a")}`,
    "a path": `./foo-1.0.0-py3-none-any.whl ${H("a")}`,
    "a range": `foo>=1.0 ${H("a")}`,
    "a marker": `foo==1.0.0 ; sys_platform == "win32" ${H("a")}`,
    "no hash": "foo==1.0.0",
    "a short hash": "foo==1.0.0 --hash=sha256:abc123",
    "another algorithm": `foo==1.0.0 --hash=md5:${"a".repeat(32)}`,
    "an upper-case digest": `foo==1.0.0 --hash=sha256:${"A".repeat(64)}`,
    "a continuation": `foo==1.0.0 \\\n  ${H("a")}`,
    "an option after the hashes": `foo==1.0.0 ${H("a")} --no-binary :all:`,
    "an unpinned name": `foo ${H("a")}`,
  };
  for (const [what, line] of Object.entries(refused)) assert.notDeepEqual(lockProblems(`ok==1.0.0 ${H("d")}\n${line}\n`), [], what);
});

test("a lock that names nothing, or names a distribution twice (in any spelling), is refused", () => {
  assert.match(lockProblems("# only a comment\n")[0], /names no distribution/);
  assert.match(lockProblems(`Foo_Bar==1.0.0 ${H("a")}\nfoo-bar==1.0.1 ${H("b")}\n`).join(" "), /foo-bar is pinned twice/);
});

test("the version a lock pins is read case- and separator-insensitively", () => {
  assert.equal(pinnedIn(GOOD, "bar-baz"), "2.1.0b1");
  assert.equal(pinnedIn(GOOD, "FOO"), "1.0.0");
  assert.equal(pinnedIn(GOOD, "missing"), null);
});

const shipped = toolCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8"))).filter((t) => t.install.strategy === "python-lock");

test("every lock the catalog names is shipped, is in the grammar, and pins the row's own package to the row's own version", () => {
  assert.ok(shipped.length >= 1, "the catalog has a python-lock row");
  for (const row of shipped) for (const [platform, asset] of Object.entries(row.install.assets)) {
    const text = readFileSync(join(REPO, "catalog", asset.lock), "utf8");
    assert.deepEqual(lockProblems(text), [], `${row.id} ${platform}`);
    assert.equal(pinnedIn(text, row.install.package), row.install.version, `${row.id} ${platform} pins ${row.install.package}`);
    assert.ok(text.split("\n").filter((l) => l && !l.startsWith("#")).length > 100, `${row.id} ${platform} locks the whole closure, not only the package`);
  }
});

test("a lock row names the interpreter row it builds from, and that row is one Orbit may fetch itself", () => {
  const all = toolCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8")));
  for (const row of shipped) {
    const python = all.find((t) => t.id === row.install.python);
    assert.ok(python, `${row.id} names ${row.install.python}`);
    assert.deepEqual([python.install.strategy, python.install.autonomous], ["archive", true]);
    for (const platform of Object.keys(row.install.assets)) assert.ok(python.install.assets[platform], `${platform} has a private interpreter to build from`);
  }
});
