import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dataDirs } from "../config/config.js";
import { contained, isSessionId, repositoryDir } from "./workspace-path.js";

test("a path is inside its root only when it resolves there, symlinks included", () => {
  const root = mkdtempSync(join(tmpdir(), "ow-contain-"));
  const outside = mkdtempSync(join(tmpdir(), "ow-outside-"));
  mkdirSync(join(root, "a"));
  symlinkSync(outside, join(root, "escape"));
  assert.equal(contained(root, join(root, "a")), true);
  assert.equal(contained(root, join(root, "a", "..", "..")), false);
  assert.equal(contained(root, join(root, "escape")), false);
  assert.equal(contained(root, join(root, "not-yet")), true);
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("a workspace path is built only from a server-made session id", () => {
  const data = dataDirs("/data");
  assert.equal(repositoryDir(data, "0b6c2f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f"), "/data/workspaces/0b6c2f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f/repository");
  assert.equal(isSessionId("../../etc"), false);
  assert.throws(() => repositoryDir(data, "../x"));
});
