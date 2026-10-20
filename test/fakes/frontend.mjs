// The source tree, in memory -- and COUNTING what was asked of it.
//
// The counters are the point. "This command performed no repository scan" is the
// whole promise of the architecture snapshot, and the only honest way to assert
// it is that `files` and `read` were never called. Asserting on printed output
// would pass just as happily for a command that scanned everything and then
// said nothing about it.
//
// It also lets a test describe the one case that is otherwise unreachable: a
// commit that moved while a scope's fingerprint did not. That is what proves a
// fact is dated against its own scope rather than against HEAD, and producing it
// for real would mean making commits inside the suite.
export function fakeFrontend(opts = {}) {
  const calls = { commit: 0, files: 0, read: 0, fingerprints: 0, search: 0, changed: 0, paths: [], scopes: [] };
  const state = { branch: opts.branch ?? "main", commit: opts.commit ?? "abc1234", files: opts.files ?? [], sources: opts.sources ?? {}, prints: opts.fingerprints ?? {}, hits: opts.search ?? [], changed: opts.changed ?? [] };
  return { root: opts.root ?? "/repo", calls, state, ...api(calls, state) };
}

const api = (calls, state) => ({
  commit: () => (calls.commit++, state.commit),
  branch: () => state.branch,
  files: () => (calls.files++, state.files),
  read: (rel) => read(calls, state, rel),
  fingerprints: (scopes) => prints(calls, state, scopes),
  search: () => (calls.search++, state.hits),
  changed: (from) => (calls.changed++, from ? state.changed : null),
});

// Tracked-only, like the real one: a path the listing does not carry is not
// readable, however plausible it looks.
function read(calls, state, rel) {
  calls.read++;
  calls.paths.push(rel);
  return state.files.includes(rel) ? state.sources[rel] ?? null : null;
}

// A LIST in, a map out, in one call -- the real port's shape, because a port
// answering one scope per call means one git process per scope.
//
// A scope nothing was declared for comes back `null`: gone, or never there,
// which is exactly what the real one answers for an empty listing.
function prints(calls, state, scopes) {
  calls.fingerprints++;
  calls.scopes.push(...scopes);
  return Object.fromEntries(scopes.map((s) => [s, state.prints[s] ?? null]));
}
