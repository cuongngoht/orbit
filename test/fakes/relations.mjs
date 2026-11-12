// The login-app fixture (test/fixtures/relations/login-app/) as the composition root would hand it to the relations walk:
// the tracked listing, a read of one committed file, and a search of the index that answers the way `git grep -E` does
// -- one hit per matching line.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { treeOf } from "../../src/context/refs.mjs";

export const FIXTURE = new URL("../fixtures/relations/login-app/", import.meta.url);

const walk = (dir, at = "") => readdirSync(join(dir, at)).flatMap((name) => (statSync(join(dir, at, name)).isDirectory() ? walk(dir, at ? `${at}/${name}` : name) : [at ? `${at}/${name}` : name]));

export function loginApp() {
  const root = fileURLToPath(FIXTURE);
  const files = Object.fromEntries(walk(root).sort().map((p) => [p, readFileSync(join(root, p), "utf8")]));
  return { root, files, tree: treeOf(Object.keys(files)) };
}

// -> (pattern) => [{ path, line, text }], counting every search in `asked`.
export const searchOf = (files, asked = []) => (pattern) => (asked.push(pattern), Object.entries(files).flatMap(([path, text]) => text.split("\n").map((line, at) => ({ path, line: at + 1, text: line })).filter((h) => new RegExp(pattern).test(h.text))));
