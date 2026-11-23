// AN EMPLOYEE'S DESK, AS A PERSON LOOKS INTO IT AND CLEANS IT UP: a path inside it is relative and plain, never Orbit
// Web's own files at its top; a clean names what goes -- paths, everything but the toolbox, the dependency cache -- and
// never the toolbox's own folders.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDeskClean, checkDeskDir, checkDeskPath, DESK_LIMITS, isDeskReserved } from "./desks.js";
import type { Checked } from "./validate.js";

const errorsOf = <T>(c: Checked<T>): string[] => (c.ok ? [] : c.errors);
const has = (errors: readonly string[], needle: string): void => assert.ok(errors.some((e) => e.includes(needle)), `"${needle}" in ${JSON.stringify(errors)}`);

test("a path in a desk is relative and plain: no root, no dot segments, no empty segment, no control character", () => {
  for (const ok of ["notes/plan.md", "toolbox/skills/report/SKILL.md", "a b/ü.txt", "notes/.orbit-mine", "x"]) assert.equal(checkDeskPath(ok), ok, ok);
  for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "a/", ".", "a/./b", "..", "x\u0000y", "a\u0001b", "a\u007fb", "x".repeat(DESK_LIMITS.pathLength + 1), 7, null]) assert.equal(checkDeskPath(bad), null, JSON.stringify(bad));
  // A folder may be the desk's root.
  assert.equal(checkDeskDir(""), "");
  assert.equal(checkDeskDir("notes"), "notes");
  assert.equal(checkDeskDir("/notes"), null);
});

test("Orbit Web's own names at the top of a desk are never addressed, and only those: an employee's file is never hidden", () => {
  for (const name of [".orbit-canary-1a2b3c4d5e6f7a8b", ".orbit", ".orbit-publish", "lost+found"]) assert.equal(isDeskReserved(name), true, name);
  // What an employee may name a file itself stays its own -- shown, and removable.
  for (const name of ["orbit", "notes", ".orbit-mine", ".orbitals", ".orbit-canary-not-hex", ".orbit-canary-"]) assert.equal(isDeskReserved(name), false, name);
  for (const path of [".orbit-canary-1a2b3c4d5e6f7a8b", ".orbit-canary-1a2b3c4d5e6f7a8b/x", "lost+found/123", ".orbit/x"]) {
    assert.equal(checkDeskPath(path), null, path);
    assert.equal(checkDeskDir(path), null, path);
  }
  // Deeper down, a name is just a name.
  assert.equal(checkDeskPath("notes/lost+found"), "notes/lost+found");
});

test("a clean names what goes: paths (a path inside another named one is dropped), everything but the toolbox, or the cache", () => {
  assert.deepEqual(checkDeskClean({ remove: ["notes", "notes/plan.md", "build/out.bin", "notes"] }), { ok: true, value: { remove: ["notes", "build/out.bin"], empty: false, cache: false } });
  assert.deepEqual(checkDeskClean({ empty: true }), { ok: true, value: { remove: [], empty: true, cache: false } });
  assert.deepEqual(checkDeskClean({ cache: true }), { ok: true, value: { remove: [], empty: false, cache: true } });
  assert.deepEqual(checkDeskClean({ empty: true, cache: true, remove: [] }), { ok: true, value: { remove: [], empty: true, cache: true } });
  assert.deepEqual(checkDeskClean({ remove: ["toolbox/skills/old-skill"] }), { ok: true, value: { remove: ["toolbox/skills/old-skill"], empty: false, cache: false } });
  has(errorsOf(checkDeskClean({})), "name what to remove");
  has(errorsOf(checkDeskClean({ remove: [], empty: false })), "name what to remove");
  has(errorsOf(checkDeskClean({ remove: ["a"], empty: true })), "empty removes everything but the toolbox");
  for (const kept of ["toolbox", "toolbox/skills", "toolbox/scripts"]) has(errorsOf(checkDeskClean({ remove: [kept] })), `${kept} is kept`);
  has(errorsOf(checkDeskClean({ remove: ["../etc"] })), '"../etc" is not a path in the desk');
  has(errorsOf(checkDeskClean({ remove: [".orbit-canary-0123456789abcdef"] })), '".orbit-canary-0123456789abcdef" is not a path in the desk');
  has(errorsOf(checkDeskClean({ remove: Array.from({ length: DESK_LIMITS.removePaths + 1 }, (_, i) => `f${i}`) })), `at most ${DESK_LIMITS.removePaths}`);
  has(errorsOf(checkDeskClean({ remove: "notes" })), "remove must be a list");
  has(errorsOf(checkDeskClean({ empty: "yes" })), "empty must be true or false");
  has(errorsOf(checkDeskClean({ cache: 1 })), "cache must be true or false");
  has(errorsOf(checkDeskClean({ remove: ["a"], purge: true })), "purge is not a field");
  has(errorsOf(checkDeskClean(["a"])), "JSON object");
});
