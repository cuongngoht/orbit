import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO, "src", "goal");

const FORBIDDEN = /^(automation|orchestration|investigation|architecture|intelligence|mcp|routing|process)(\/|$)/;

const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".mjs") ? [join(dir, e.name)] : [])) : []);

const importsOf = (file) => [...readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "").matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]).filter((s) => s.startsWith("."));

test("src/goal imports only allowed neighbours", () => {
  for (const f of walk(SRC)) {
    for (const spec of importsOf(f)) {
      const target = relative(join(REPO, "src"), resolve(dirname(f), spec)).split("\\").join("/");
      assert.doesNotMatch(target, FORBIDDEN, `${relative(REPO, f)} → ${target}`);
    }
  }
});
