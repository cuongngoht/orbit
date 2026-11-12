// The independent evaluator (evaluator/, 0.6.0) measures this plugin from OUTSIDE: a package of its own, meant to be
// split into a repository of its own, that imports nothing of the product and is imported by nothing of it. It holds
// hidden tests and gold patches, so the plugin archive an agent under test is handed must never carry any of it, and
// none of its files may be a module the product's own `node --test` would discover and run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const EVAL = join(ROOT, "evaluator");

const SKIP = new Set(["node_modules", ".git"]);

const walk = (p) => (statSync(p).isFile() ? [p] : readdirSync(p).filter((n) => !SKIP.has(n)).flatMap((n) => walk(join(p, n))));

const CODE = /\.(mjs|cjs|js|ts|tsx|mts|cts)$/;

const SPECIFIERS = [/\bfrom\s*["']([^"'\s]+)["']/g, /\bimport\s*\(\s*["']([^"'\s]+)["']\s*\)/g, /\bimport\s+["']([^"'\s]+)["']/g, /\brequire\s*\(\s*["']([^"'\s]+)["']\s*\)/g];

const specifiersOf = (file) => ((text) => SPECIFIERS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1])))(readFileSync(file, "utf8"));

const isBuiltin = (s) => s.startsWith("node:") || builtinModules.includes(s);

const inside = (dir, p) => p === dir || p.startsWith(`${dir}${sep}`);

const evalFiles = () => walk(EVAL);

test("the evaluator is a package of its own: it imports Node's built-ins and its own files, nothing else", () => {
  const code = evalFiles().filter((f) => CODE.test(f));
  assert.ok(code.length >= 20, `${code.length} modules under evaluator/`);
  const outside = code.flatMap((f) => specifiersOf(f).filter((s) => !isBuiltin(s) && !(s.startsWith(".") && inside(EVAL, resolve(dirname(f), s)))).map((s) => `${relative(ROOT, f)} -> ${s}`));
  assert.deepEqual(outside, []);
  assert.deepEqual(JSON.parse(readFileSync(join(EVAL, "package.json"), "utf8")).dependencies ?? {}, {});
});

test("nothing outside the evaluator imports it", () => {
  const code = readdirSync(ROOT).filter((n) => !SKIP.has(n) && n !== "evaluator").flatMap((n) => walk(join(ROOT, n))).filter((f) => CODE.test(f));
  const into = code.flatMap((f) => specifiersOf(f).filter((s) => /(^|\/)evaluator(\/|$)/.test(s) && (!s.startsWith(".") || inside(EVAL, resolve(dirname(f), s)))).map((s) => `${relative(ROOT, f)} -> ${s}`));
  assert.deepEqual(into, []);
});

// node --test's default patterns (Node 20-24): **/*.test.*, **/*-test.*, **/*_test.*, **/test-*.*, **/test.*, and
// every module under a directory named test/.
const DISCOVERED = /(^|\/)(test|[^/]*[.\-_]test|test-[^/]*)\.(mjs|cjs|js)$|(^|\/)test\//;

test("no file of the evaluator is one node --test would discover", () => {
  const rels = evalFiles().map((f) => relative(EVAL, f).split(sep).join("/"));
  assert.deepEqual(rels.filter((r) => DISCOVERED.test(r)), []);
});

test("the plugin archive holds no part of the evaluator", () => {
  assert.match(readFileSync(join(ROOT, ".gitattributes"), "utf8"), /^\/evaluator export-ignore$/m);
  assert.match(readFileSync(join(ROOT, ".gitattributes"), "utf8"), /^\/evaluator\/\*\* export-ignore$/m);
  if (!existsSync(join(ROOT, ".git"))) return;
  const r = spawnSync("git", ["archive", "--format=tar", "HEAD"], { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) return;
  const listed = spawnSync("tar", ["-t"], { input: r.stdout, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(listed.status, 0);
  assert.deepEqual(listed.stdout.split("\n").filter((p) => /^evaluator(\/|$)/.test(p)), []);
});
