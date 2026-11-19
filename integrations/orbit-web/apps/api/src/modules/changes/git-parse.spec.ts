import assert from "node:assert/strict";
import { test } from "node:test";
import { changedFiles, languageOf, parseNameStatus, parseNumstat, parseStatus, totalsOf } from "./git-parse.js";

// Captured from git 2.43 on a repository with an edit, a rename, an untracked file and a binary.
const STATUS = ["# branch.oid b00930ca943c71d90353084b374fa4226113d639", "# branch.head orbit-web/1234abcd", "1 .M N... 100644 100644 100644 422c 422c f.txt", "2 R. N... 100644 100644 100644 587b 587b R100 h.txt", "g.txt", "? bin.dat", "? u.txt", "u UU N... 100644 100644 100644 100644 1 2 3 conflict.txt", ""].join("\0");

test("porcelain v2 status: branch, untracked, conflicts, renames read whole", () => {
  const s = parseStatus(STATUS);
  assert.equal(s.oid, "b00930ca943c71d90353084b374fa4226113d639");
  assert.equal(s.head, "orbit-web/1234abcd");
  assert.deepEqual(s.untracked, ["bin.dat", "u.txt"]);
  assert.deepEqual(s.conflicted, ["conflict.txt"]);
  assert.deepEqual(s.changed, ["f.txt", "h.txt"]);
});

test("numstat -z: counts, renames and binaries", () => {
  assert.deepEqual(parseNumstat("2\t1\tf.txt\0" + "0\t0\t\0g.txt\0h.txt\0" + "-\t-\tlogo.png\0"), [
    { path: "f.txt", oldPath: null, additions: 2, deletions: 1, binary: false },
    { path: "h.txt", oldPath: "g.txt", additions: 0, deletions: 0, binary: false },
    { path: "logo.png", oldPath: null, additions: null, deletions: null, binary: true },
  ]);
});

test("name-status -z: kinds and renames; a path with spaces stays one path", () => {
  assert.deepEqual(parseNameStatus("M\0f.txt\0R100\0g.txt\0h.txt\0A\0dir/with space.md\0D\0gone.js\0"), [
    { path: "f.txt", oldPath: null, kind: "modified" },
    { path: "h.txt", oldPath: "g.txt", kind: "renamed" },
    { path: "dir/with space.md", oldPath: null, kind: "added" },
    { path: "gone.js", oldPath: null, kind: "deleted" },
  ]);
});

test("one list: committed and uncommitted changes, untracked files, conflicts, totals", () => {
  const files = changedFiles(parseNameStatus("M\0f.txt\0D\0gone.js\0"), parseNumstat("2\t1\tf.txt\0" + "0\t5\tgone.js\0"), parseStatus(STATUS), new Map([["u.txt", { path: "u.txt", oldPath: "/dev/null", additions: 2, deletions: 0, binary: false }]]));
  assert.deepEqual(files.map((f) => [f.path, f.kind, f.additions, f.deletions]), [
    ["bin.dat", "untracked", null, null],
    ["conflict.txt", "conflicted", null, null],
    ["f.txt", "modified", 2, 1],
    ["gone.js", "deleted", 0, 5],
    ["u.txt", "untracked", 2, 0],
  ]);
  assert.deepEqual(totalsOf(files), { files: 5, additions: 4, deletions: 6 });
});

test("a language for highlighting, from the file name", () => {
  assert.equal(languageOf("src/a.ts"), "typescript");
  assert.equal(languageOf("Dockerfile"), "dockerfile");
  assert.equal(languageOf("LICENSE"), null);
});
