// Satellite holds itself to Orbit's own structural rule -- Five Lines of Code, strictly -- over every module it ships
// (src, cli and the acceptance recorder), with the same checker test/lint.test.mjs runs over src, cli and skills.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { lintText } from "../../src/lint/five-lines.mjs";

const SATELLITE = join(dirname(fileURLToPath(import.meta.url)), "..");

const files = (p) => (statSync(p).isFile() ? (p.endsWith(".mjs") ? [p] : []) : readdirSync(p).flatMap((n) => files(join(p, n))));

test("every line Satellite ships holds to Five Lines, strictly", () => {
  const shipped = ["src", "cli", "acceptance"].map((d) => join(SATELLITE, d)).filter(existsSync).flatMap(files);
  assert.ok(shipped.length > 40, `only ${shipped.length} modules found — the walk lost its subject`);
  assert.deepEqual(shipped.flatMap((f) => lintText(readFileSync(f, "utf8"), f)), []);
});

// Spelled in two halves so this checker does not match its own source (test/lint.test.mjs does the same).
const SPREAD_ENV = "..." + "process.env";

test("no Satellite test hands a child this machine's environment", () => {
  const dir = join(SATELLITE, "test");
  const leaky = files(dir).filter((f) => readFileSync(f, "utf8").includes(SPREAD_ENV));
  assert.deepEqual(leaky, [], "spread process.env into a child and it inherits HOME — use sealed() from test/home.mjs");
});
