// The boundaries the requirement side of the engine keeps, as a grep: no provider is
// something this code KNOWS, and each subsystem imports only what its neighbours
// allow. A directory that does not exist yet is skipped, so a work package that adds
// one is held to the rule from its first file -- the scans list directories by hand,
// so a new one is unguarded until somebody names it here.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO, "src");

// Words that would mean a product, a vendor or a tool was learned. Code only:
// comment lines are prose, and the rule is about what the engine does.
const PRODUCTS = /\b(github|azure|devops|jira|gitlab|linear|microsoft|entra|az|gh)\b/i;

// What each directory may NOT import, as a path under src/.
const FORBIDDEN = {
  sources: /^(requirements|work|frontend|architecture|intelligence|run|report|qa|investigation)(\/|$)/,
  requirements: /^(sources|work|frontend|architecture|intelligence|run|report|qa|investigation|knowledge|routing|resources|mcp|capability|tools|process|connections|extensions)(\/|$)|^learn\/(?!args)/,
  work: /^(sources|frontend|architecture|intelligence|report|qa|investigation)(\/|$)/,
};

const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".mjs") ? [join(dir, e.name)] : [])) : []);

const code = (file) => readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");

const importsOf = (file) => [...code(file).matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]).filter((s) => s.startsWith("."));

const targetOf = (file, spec) => relative(SRC, resolve(dirname(file), spec)).split("\\").join("/");

test("nothing under src/sources, src/requirements or src/work names a provider, a vendor or a tool", () => {
  for (const dir of ["sources", "requirements", "work"]) {
    for (const f of walk(join(SRC, dir))) assert.doesNotMatch(code(f), PRODUCTS, relative(REPO, f));
  }
});

test("each requirement-side subsystem imports only what the dependency direction allows", () => {
  for (const [dir, banned] of Object.entries(FORBIDDEN)) {
    for (const f of walk(join(SRC, dir))) {
      for (const spec of importsOf(f)) assert.doesNotMatch(targetOf(f, spec), banned, `${relative(REPO, f)} imports ${spec}`);
    }
  }
});

test("the scan itself sees files: src/sources is not an empty directory to it", () => {
  assert.ok(walk(join(SRC, "sources")).length >= 3);
});
