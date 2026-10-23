// THE DOCS SAY WHAT THE CODE DOES: the hosts page is the matrix, rendered; every ground a cell cites and every relative
// link in satellite/docs resolves to a file and a heading that exist; the README names every command; each ADR has its
// four parts.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/index.mjs";
import { CAPABILITIES, HOSTS } from "../src/hosts/matrix.mjs";
import { matrixNotes, matrixTable } from "./fakes/matrix-doc.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = join(ROOT, "satellite", "docs");
const read = (p) => readFileSync(p, "utf8");

// A heading's anchor as GitHub derives it: lower case, punctuation dropped, spaces as hyphens.
const slugOf = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");

const anchorsOf = (file) => new Set(read(file).split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => slugOf(l.replace(/^#{1,6} /, ""))));

function resolves(file, anchor) {
  if (!existsSync(file)) return `${file} does not exist`;
  return !anchor || anchorsOf(file).has(anchor) ? null : `${file} has no heading #${anchor}`;
}

test("the hosts page is the matrix, rendered from the one table", () => {
  const page = read(join(DOCS, "hosts.md"));
  assert.ok(page.includes(matrixTable()), "satellite/docs/hosts.md carries the table matrix.mjs renders");
  assert.ok(page.includes(matrixNotes()), "and every cell's note");
});

test("every ground a host cell cites in this repository resolves to a file and a heading", () => {
  const grounds = Object.values(HOSTS).flatMap((row) => CAPABILITIES.map((cap) => row[cap].by?.docs ?? row[cap].fallback?.docs)).filter((ref) => ref && !/^https?:/.test(ref));
  for (const ref of new Set(grounds)) assert.equal(resolves(join(ROOT, ref.split("#")[0]), ref.split("#")[1]), null, ref);
});

const markdownIn = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? markdownIn(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []));

test("every relative link in satellite/docs resolves", () => {
  for (const file of markdownIn(DOCS)) for (const [, target] of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split("#");
    assert.equal(resolves(path ? resolve(dirname(file), path) : file, anchor), null, `${file}: ${target}`);
  }
});

test("the README names every command, and each ADR has its status, context, decision and consequences", () => {
  const readme = read(join(DOCS, "README.md"));
  for (const name of Object.keys(COMMANDS)) assert.match(readme, new RegExp(`\\b${name.split(".").join("`?\\s*`?")}\\b|\\b${name.split(".").at(-1)}\\b`), name);
  for (const live of ["status", "watch", "tui", "open", "where"]) assert.match(readme, new RegExp(`live ${live}|\`${live}\``), `live ${live}`);
  const adrs = readdirSync(join(DOCS, "adr")).filter((n) => /^\d{4}-.*\.md$/.test(n));
  assert.deepEqual(adrs.map((n) => n.slice(0, 4)), ["0001", "0002", "0003", "0004"]);
  for (const n of adrs) for (const part of ["## Status", "## Context", "## Decision", "## Consequences"]) assert.ok(read(join(DOCS, "adr", n)).includes(part), `${n}: ${part}`);
});
