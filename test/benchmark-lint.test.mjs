// The Docker benchmark is development tooling and never ships, and it is still held to Five Lines of Code like every
// line the plugin ships -- its controller, the scripts its images run, its hidden checks and probes.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { lintText } from "../src/lint/five-lines.mjs";

const ROOT = join(import.meta.dirname, "..");

const files = (p) => (statSync(p).isFile() ? (p.endsWith(".mjs") ? [p] : []) : readdirSync(p).flatMap((n) => files(join(p, n))));

test("every line of the benchmark holds to Five Lines, strictly", () => {
  const all = files(join(ROOT, "benchmark"));
  assert.ok(all.length >= 20, `${all.length} modules`);
  assert.deepEqual(all.flatMap((f) => lintText(readFileSync(f, "utf8"), f)), []);
});

test("nothing of the benchmark is a module node --test would run, and nothing of the engine imports it", () => {
  assert.deepEqual(files(join(ROOT, "benchmark")).filter((f) => /(\.|-|_)test\.mjs$|(^|[\\/])test(-[^\\/]*)?\.mjs$|[\\/]test[\\/]/.test(f.slice(ROOT.length))), []);
  const engine = ["src", "cli", "skills"].flatMap((d) => files(join(ROOT, d)));
  assert.deepEqual(engine.filter((f) => /from\s+["'][^"']*benchmark\//.test(readFileSync(f, "utf8"))), []);
});

test("the benchmark never ships: the release archive leaves it out", () => {
  assert.match(readFileSync(join(ROOT, ".gitattributes"), "utf8"), /^\/benchmark\/\*\* export-ignore$/m);
});
