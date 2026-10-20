// A source tree held in memory that BEHAVES like the real port -- a search
// that actually matches, fingerprints that actually change when content does --
// and counts everything asked of it.
//
// test/fakes/frontend.mjs answers what it is told, which is right for proving a
// decision table; this one is for proving a PIPELINE, where the interesting
// question is what a second run re-reads after one file moved. Editing a file
// here moves exactly the scopes that contain it, the way a commit does, so an
// incremental scan can be exercised without making commits inside the suite.
//
// Namespaced paths (`worker::src/a.cs`) route the way src/frontend/composite.mjs
// routes them: `.` is the primary's whole tree and never a secondary's.
import { sha } from "../../src/hash.mjs";
import { splitPath } from "../../src/frontend/composite.mjs";

export function memorySource(files, opts = {}) {
  const state = { files: { ...files }, commit: opts.commit ?? "abc1234", branch: opts.branch ?? "main", dirty: new Set(opts.dirty ?? []) };
  const calls = { files: 0, read: 0, search: 0, fingerprints: 0, paths: [] };
  return { root: "/repo", state, calls, ...api(state, calls), write: (p, text) => void (state.files[p] = text), remove: (p) => void delete state.files[p] };
}

const api = (state, calls) => ({
  commit: () => state.commit,
  branch: () => state.branch,
  files: () => (calls.files++, Object.keys(state.files).sort()),
  read: (p) => (calls.read++, calls.paths.push(p), state.files[p] ?? null),
  search: (pattern) => (calls.search++, hits(state, new RegExp(pattern))),
  fingerprints: (scopes) => (calls.fingerprints++, Object.fromEntries(scopes.map((s) => [s, printOf(state, s)]))),
  changed: () => [],
});

const hits = (state, re) => Object.entries(state.files).flatMap(([path, text]) => String(text).split("\n").map((line, i) => ({ path, line: i + 1, text: line })).filter((h) => re.test(h.text)));

function printOf(state, scope) {
  const mine = Object.keys(state.files).filter((p) => inside(p, scope)).sort();
  if (!mine.length) return null;
  return { hash: sha(mine.map((p) => `${p}\u0000${state.files[p]}`).join("\n")), files: mine.length, dirty: mine.filter((p) => state.dirty.has(p)).length };
}

function inside(p, s) {
  const path = splitPath(p);
  const scope = splitPath(s);
  return path.prefix === scope.prefix && (scope.local === "." || path.local === scope.local || path.local.startsWith(`${scope.local}/`));
}
