import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORBIT = join(ROOT, "cli/orbit.mjs");
const FIXTURE = join(ROOT, "test/fixtures/ui-tests");
function storeDir() {
  return mkdtempSync(join(tmpdir(), "orbit-orbit-cli-"));
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [ORBIT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: sealed({ ORBIT_UI_TESTS: FIXTURE, ORBIT_STORE_DIR: env.ORBIT_STORE_DIR ?? storeDir(), ...env }),
  });
}

test("orbit --help exits 0", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ORBIT/);
  assert.match(r.stdout, /goal start/);
});

test("orbit goal doctor exits 0 with json", () => {
  const r = run(["goal", "doctor", "--json"]);
  assert.equal(r.status, 0);
  const body = JSON.parse(r.stdout);
  assert.ok(typeof body.count === "number");
  assert.ok(body.store);
});

test("orbit unknown subcommand is REFUSED", () => {
  const r = run(["goal", "nope"]);
  assert.equal(r.status, 2);
});
