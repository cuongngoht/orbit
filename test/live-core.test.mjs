// The LIVE CORE's boundary (ADR 0016): what src/live/ may import, the effects it may not have, the words it
// may not know, and the one thing every viewer is -- a reader. A viewer that could append a line would be a
// second writer of a task's journal, and an orchestrator's decision is STALE on any line after the revision
// it read (src/orchestration/decision.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = join(ROOT, "src", "live");

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files = walk(LIVE).filter((p) => p.endsWith(".mjs"));
const code = (p) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const name = (p) => relative(ROOT, p).replace(/\\/g, "/");
const lines = (p) => code(p).split("\n").map((l, i) => [name(p), i + 1, l]);

// Leaves, the store primitives, and itself. Never a subject: what a task, an investigation or a sandbox is
// arrives as a SOURCE a composition root hands in (src/task/live.mjs TASK_SOURCE, src/investigation/live.mjs).
const ALLOWED = /^(live|store|protected)\//;
const SINGLE = new Set(["errors.mjs", "hash.mjs", "constraints.mjs", "printable.mjs"]);

test("src/live imports only leaves, the store primitives and itself -- never a task, an investigation, a runtime or a host", () => {
  const bad = files.flatMap((p) => [...code(p).matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => relative(join(ROOT, "src"), resolve(dirname(p), m[1])).replace(/\\/g, "/")).filter((target) => !SINGLE.has(target) && !ALLOWED.test(target)).map((target) => `${name(p)} imports ${target}`));
  assert.deepEqual(bad, []);
});

test("src/live spawns nothing, opens no socket or file of its own, and reads no environment or clock", () => {
  const forbidden = /(from\s+"node:(child_process|net|http|https|fs|os|dgram|worker_threads|readline|tty)")|\bprocess\.|\bfetch\(|\bDate\.now\(|new Date\(\)/;
  const hits = files.flatMap(lines).filter(([, , l]) => forbidden.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 80)}`);
  assert.deepEqual(hits, []);
});

test("the one timer in the live core is the follower registry's, held only while a viewer holds a lease", () => {
  const timers = files.flatMap(lines).filter(([, , l]) => /\bset(Interval|Timeout)\(/.test(l)).map(([f]) => f);
  assert.deepEqual([...new Set(timers)], ["src/live/followers.mjs"]);
});

const PRODUCTS = /\b(npm|pnpm|yarn|dotnet|nuget|python3?|java|golang|ruby|cargo|maven|gradle|postgres(ql)?|redis|kafka|mongo(db)?|mysql|playwright|github|gitlab|azure|aws|vscode|microsoft|jetbrains|kubernetes|docker|claude|codex|antigravity|openai|gemini|anthropic|iterm|powershell)\b/i;

test("nothing under src/live names a stack, a product, a vendor or a host", () => {
  const hits = files.flatMap(lines).filter(([, , l]) => PRODUCTS.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 100)}`);
  assert.deepEqual(hits, []);
});

test("nothing under src/live appends to a journal or creates a task: a viewer is a reader", () => {
  const writes = /\.append\(|\bcreateTask\b|\bappended\(|\.begin\(|\bjournalWrite/;
  const hits = files.flatMap(lines).filter(([, , l]) => writes.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 80)}`);
  assert.deepEqual(hits, []);
});

test("only a composition root reaches the live core: the CLI, Orbit Control's import door, and nothing else in src/", () => {
  const importers = [];
  for (const dir of ["src", "skills", "cli", "control-server/src"]) {
    for (const p of walk(join(ROOT, dir)).filter((f) => f.endsWith(".mjs") && !f.startsWith(`${LIVE}${sep}`))) {
      if ([...readFileSync(p, "utf8").matchAll(/from\s+"(\.[^"]+)"/g)].some((m) => resolve(dirname(p), m[1]).startsWith(`${LIVE}${sep}`))) importers.push(name(p));
    }
  }
  assert.deepEqual(importers.filter((p) => !/^(cli\/|control-server\/src\/core\.mjs$|skills\/orbit-learn\/hosts\/)/.test(p)), []);
  assert.ok(importers.includes("control-server/src/core.mjs"));
});
