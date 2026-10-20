import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { insideRepo, machineContext } from "../src/store/context.mjs";
import { STORE_LAYOUT as LAYOUT, STORE_FILE } from "../src/project/paths.mjs";
import { explicitProjectPaths } from "../src/project/repository.mjs";
import { storePaths } from "../src/learn/store.mjs";
import { createLessons } from "../src/learn/lessons.mjs";
import { fakeIo } from "./fakes/io.mjs";

// A store on disk carries no other evidence of which layout it is, so the next
// move would have to guess from directory names -- which is exactly what the
// 1.4.2 move had to do by hand once, and there is no reason to do it twice.
test("a store is labelled on its first write, never while resolving or reading", () => {
  const base = mkdtempSync(join(tmpdir(), "orbit-stamp-"));
  const ctx = { config: { name: "Acme", origin: "https://acme.test" }, project: { root: base } };
  const at = () => machineContext({ ...ctx, project: explicitProjectPaths(join(base, "ui-tests"), { ORBIT_STORE_DIR: base }) });

  const fresh = at();
  assert.ok(!existsSync(join(fresh.store.root, STORE_FILE)), "resolving a store still creates nothing at all");

  mkdirSync(fresh.store.root, { recursive: true });
  at();
  assert.ok(!existsSync(join(fresh.store.root, STORE_FILE)), "even an existing store is not changed by a read");
  fresh.io.write(join(fresh.store.root, "state", "test.json"), "{}");
  const file = join(fresh.store.root, STORE_FILE);
  const stamp = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(stamp.layout, LAYOUT);
  assert.equal(stamp.key, fresh.store.key, "and says which project it belongs to, so a stray copy can be identified");
  assert.ok(!existsSync(join(fresh.store.root, ".lock")), "the marker's lock is released");
  fresh.io.append(join(fresh.store.root, "runs", "host.jsonl"), "{}\n");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), stamp, "later writes do not replace the marker");
  rmSync(base, { recursive: true, force: true });
});

test("store validation follows symlinks and refuses a file used as a directory", () => {
  const base = mkdtempSync(join(tmpdir(), "orbit-path-"));
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  symlinkSync(repo, join(base, "link"), "junction");
  assert.equal(insideRepo(join(base, "link", "missing", "store")), insideRepo(repo));
  const ctx = { config: { name: "Acme", origin: "https://acme.test" }, project: { root: base } };
  assert.throws(() => explicitProjectPaths(join(base, "ui-tests"), { ORBIT_STORE_DIR: join(base, "link") }), /inside the repository/);
  writeFileSync(join(base, "file"), "not a directory");
  assert.throws(() => machineContext({ ...ctx, project: explicitProjectPaths(join(base, "ui-tests"), { ORBIT_STORE_DIR: join(base, "file") }) }).prepare(), (e) => e instanceof Refused && /cannot be written|not a directory|ENOTDIR/.test(e.message));
  rmSync(base, { recursive: true, force: true });
});
