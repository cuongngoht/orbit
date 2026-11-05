// The MODULE MAP (docs/agents/layout.md) is what an agent reads before it adds, moves or splits a module, so a module it
// names that does not exist sends somebody looking for a file, and one it leaves out is a module nobody knows the job of.
// 0.4.0 left the sandbox's section naming fixtures, fixture-policy, test-faults and replay-policy -- none of them a file
// -- while declarations, held, isolated-launch, isolated-prepare and scratch went unnamed. The sandbox's sections are
// held to src/runtime/sandbox/ both ways: every module they name exists there, and every module there is named.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const MAP = readFileSync(join(ROOT, "docs", "agents", "layout.md"), "utf8").split("\n");

// One entry of the map: its first line starts with `head` at the left edge, and it runs until the next line that does.
function entryOf(head) {
  const at = MAP.findIndex((line) => line.startsWith(head));
  const end = MAP.findIndex((line, i) => i > at && /^\S/.test(line));
  assert.ok(at >= 0, `the map has an entry for ${head.trim()}`);
  return MAP.slice(at, end < 0 ? undefined : end).join("\n");
}

// The parenthetical that opens at `open`, to its own closing parenthesis.
function parenthetical(text, open) {
  const at = text.indexOf(open);
  let depth = 0;
  for (let i = at + open.length - 1; at >= 0 && i < text.length; i += 1) {
    depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    if (depth === 0) return text.slice(at, i + 1);
  }
  return "";
}

// A module named by its own file name: one a path qualifies (isolation/docker.mjs, skills/…/ports.mjs) is another
// directory's, and not the sandbox's to hold.
const namedIn = (text) => new Set([...text.matchAll(/(?<![\w/.-])([a-z][a-z0-9-]*)\.mjs/g)].map((m) => m[1]));

const SANDBOX = join(ROOT, "src", "runtime", "sandbox");

test("the module map's sandbox sections name every module src/runtime/sandbox/ holds, and only those", () => {
  const text = `${parenthetical(entryOf("src/runtime/   "), "sandbox/ (")}\n${entryOf("src/runtime/sandbox/ ")}`;
  const named = namedIn(text);
  const files = new Set(readdirSync(SANDBOX).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)));
  assert.ok(named.size > 10, `the sections were found: ${[...named].join(", ")}`);
  assert.deepEqual([...named].filter((m) => !files.has(m)).sort(), [], "named in the map, and no such module");
  assert.deepEqual([...files].filter((m) => !named.has(m)).sort(), [], "a module of the sandbox the map never names");
});
