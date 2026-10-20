// What a terminal is handed: text that came from a checkout's files is made printable first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { printable } from "../src/printable.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("control characters and reordering marks are removed; a line feed, a tab and ordinary text are not", () => {
  assert.equal(printable("a\u001b[2Jb\u001b]52;c;QQ==\u0007c"), "a[2Jb]52;c;QQ==c");
  assert.equal(printable("line\r\noverwritten\rhere"), "line\noverwrittenhere");
  assert.equal(printable("a\tb\nc"), "a\tb\nc");
  assert.equal(printable("evil‮fdp.exe⁦"), "evilfdp.exe");
  assert.equal(printable("Ngô Hoàng — 22.x ≥ ünï"), "Ngô Hoàng — 22.x ≥ ünï");
  assert.equal(printable(null), "");
  assert.equal(printable("\u0085\u009b31m"), "31m", "the 8-bit controls too");
});

test("a repository that puts an escape sequence in what it says does not get it onto a person's terminal", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-printable-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "shop");
  mkdirSync(join(repo, "web"), { recursive: true });
  writeFileSync(join(repo, "web", "package.json"), JSON.stringify({ name: "web", engines: { node: ">=999\u001b]52;c;QUJD\u0007\u001b[2J" }, scripts: { dev: "vite" } }));
  writeFileSync(join(repo, "web", "package-lock.json"), "{}");
  const env = sealed({ ORBIT_STORE_DIR: join(base, "store"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
  for (const args of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "x"]]) spawnSync("git", args, { cwd: repo, env });
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, "cli", "runtime.mjs"), ...args], { cwd: repo, encoding: "utf8", env });
  run("discover");
  for (const args of [["status"], ["doctor"], ["start"]]) {
    const out = run(...args);
    assert.doesNotMatch(out.stdout + out.stderr, /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/, `${args[0]} printed a control character`);
  }
  const json = run("status", "--json");
  assert.doesNotMatch(json.stdout, /\u001b/, "--json escapes it");
});
