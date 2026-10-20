import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { lintText } from "../src/lint/five-lines.mjs";
import { mask } from "../src/lint/mask.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = (p) => (statSync(p).isFile() ? (p.endsWith(".mjs") ? [p] : []) : readdirSync(p).flatMap((n) => files(join(p, n))));

test("mask blanks strings, comments, templates and regex literals but keeps code and newlines", () => {
  const src = 'const a = "x{y}"; // c {\nconst r = /\\{/g; const t = `a${b}{`;\nif (a) {}';
  const m = mask(src);
  assert.equal(m.length, src.length);
  assert.equal(m.split("\n").length, 3);
  assert.equal((m.match(/\{/g) ?? []).length, 1, "only the real block brace survives");
});

test("lint counts statements per function, flags else and switch, ignores object literals", () => {
  const src = `
const table = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 };
function ok(x) {
  const y = x + 1;
  return y;
}
const arrow = (x) => {
  if (x) return 1;
  else return 2;
};
function long() {
  a(); b(); c();
  d();
  e();
  f();
  g();
}
export function sw(k) {
  switch (k) { case 1: return 1; }
}
`;
  const f = lintText(src, "x.mjs");
  assert.deepEqual(f.map((x) => [x.name, x.rule]), [["arrow", 4], ["long", 1], ["sw", 5]]);
  assert.equal(f.find((x) => x.name === "long").message, "7 statements — Five Lines says ≤ 5");
});

test("every line the plugin ships holds to Five Lines, strictly", () => {
  const findings = ["src", "cli", "skills"].flatMap((d) => files(join(ROOT, d))).flatMap((f) => lintText(readFileSync(f, "utf8"), f));
  assert.deepEqual(findings, []);
});

// The same schema exists three times: the one the engine documents, the one a
// new project copies, and the one the fixture validates against. Three copies
// with no check is three copies that drift, and the drift shows up as a project
// whose editor accepts a key the engine rejects.
test("the schema a project copies is byte-for-byte the schema the engine ships", () => {
  const same = (a, b) => assert.equal(readFileSync(join(ROOT, a), "utf8"), readFileSync(join(ROOT, b), "utf8"), `${a} has drifted from ${b}`);
  same("templates/ui-tests/project.schema.json", "schemas/project.schema.json");
  same("test/fixtures/ui-tests/project.schema.json", "schemas/project.schema.json");
  same("templates/ui-tests/graph/schema.json", "schemas/graph.schema.json");
  same("test/fixtures/ui-tests/graph/schema.json", "schemas/graph.schema.json");
});

// A child inherits HOME, and HOME is where this machine keeps its SQL settings
// and its browser profiles. One test spread process.env into a spawn and so
// reached a real database on a suite that promises no network; CI stayed green
// because CI has no home to read. Structural, so the next spawn cannot quietly
// bring it back -- a comment saying "no database is reached" already failed at
// exactly that job.
// Spelled in two halves so this checker does not match its own source.
const SPREAD_ENV = "..." + "process.env";

test("no test hands a child this machine's environment", () => {
  const dir = join(ROOT, "test");
  const spread = (f) => readFileSync(join(dir, f), "utf8").includes(SPREAD_ENV);
  const leaky = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).filter(spread);
  assert.deepEqual(leaky, [], "spread process.env into a child and it inherits HOME — use sealed() from test/home.mjs");
});
