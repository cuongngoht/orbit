// The acceptance fixture: a small repository with an addition that subtracts and the test that catches it. Made at
// run time, never committed (the repository's own `node --test` would run a failing sum.test.mjs).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXTURE_REPOSITORY = "acceptance/sum-fixture";

const FILES = {
  "package.json": `${JSON.stringify({ name: "sum-fixture", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
  "sum.mjs": "// Adds two numbers.\nexport function sum(a, b) {\n  return a - b;\n}\n",
  "sum.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { sum } from "./sum.mjs";\n\ntest("sum adds two numbers", () => {\n  assert.equal(sum(2, 3), 5);\n  assert.equal(sum(-1, 1), 0);\n});\n',
  "README.md": "# sum-fixture\n\nA tiny repository for Orbit Web's acceptance run.\n",
};

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

// Returns the directory holding the bare repository (mounted read-only into the container as /fixture). It is given
// to the container's user, because git refuses to clone a repository another user owns.
export function makeFixture(owner = "10001:10001") {
  const root = mkdtempSync(join(tmpdir(), "orbit-web-fixture-"));
  const work = join(root, "work");
  mkdirSync(work);
  git(work, "init", "-q");
  for (const [file, text] of Object.entries(FILES)) writeFileSync(join(work, file), text);
  git(work, "add", ".");
  git(work, "commit", "-qm", "sum fixture: the addition subtracts");
  const served = join(root, "served");
  mkdirSync(served);
  git(served, "clone", "-q", "--bare", work, join(served, "sum-fixture.git"));
  spawnSync("chmod", ["-R", "a+rX", root]);
  spawnSync("chown", ["-R", owner, served]);
  return { root, served, head: git(work, "rev-parse", "HEAD").trim() };
}
