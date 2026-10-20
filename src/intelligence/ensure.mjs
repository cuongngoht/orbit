// Does this task need the repository read at all -- and if so, which STAGE,
// over which scopes?
//
// src/architecture/ensure.mjs's table, with the properties it holds to: pure
// (facts in, one row out), the last row always matches, `writes` is a column
// so `--dry` is one flag flipped, and every row SAYS what it decided. What is
// new is that a row names a PLAN rather than a scan size, because intelligence
// has two stages that cost very different amounts:
//
//   manifests  a handful of small files. Re-read whenever one moved, one
//              appeared or one went away -- and never because a source file
//              moved, so an unchanged project file costs nothing.
//   usage      source files, found by one search and read within a budget. Only
//              the directories that moved are re-read; a directory whose
//              fingerprint held keeps every usage fact it had.
//
// A task that names what it is about (`--for`) narrows the usage work to the
// scopes of facts that speak to it, and the row says which moved scopes it
// walked past rather than calling them current.

const ALL = () => ({ manifests: true, usage: "all", scopes: [], fresh: [] });
const NOTHING = () => ({ manifests: false, usage: "none", scopes: [], fresh: [] });

export const DECISIONS = [
  { name: "BLOCKED_SOURCE", writes: false, stops: true, when: (f) => !f.readable, plan: NOTHING, say: () => "there is no readable git checkout here, so nothing can be read or dated" },
  { name: "RESCAN", writes: true, when: (f) => f.forced, plan: ALL, say: (f) => `asked for outright — re-reading every manifest and every usage, over ${f.count} fact(s) already here` },
  { name: "BOOTSTRAP", writes: true, when: (f) => !f.model && !f.count, plan: ALL, say: () => "nothing has read this project's technologies yet — reading them once, so nothing after this has to" },
  { name: "UNREADABLE_STATE", writes: true, when: (f) => !f.model, plan: ALL, say: (f) => `${f.count} fact(s) are here but the state beside them cannot be read — ${f.modelWhy}. The old file is left where it is` },
  { name: "RECOGNISER_CHANGED", writes: true, when: (f) => f.registryMoved, plan: ALL, say: () => "what this engine recognises changed since the snapshot — a descriptor or an analyser was added, removed or edited — so everything is read again with the new eyes" },
  { name: "MANIFESTS", writes: true, when: (f) => f.manifestsMoved.length > 0, plan: (f) => ({ manifests: true, usage: f.usageMoved.length ? "scopes" : "none", scopes: f.usageMoved, fresh: f.fresh }), say: (f) => `${f.manifestsMoved.length} manifest(s) moved, appeared or went away: ${f.manifestsMoved.slice(0, 6).join(", ")} — re-reading the manifests${f.usageMoved.length ? `, and ${f.usageMoved.length} moved source scope(s)` : "; no source is read unless what is declared changed"}` },
  { name: "INCREMENTAL", writes: true, when: (f) => f.usageMoved.length > 0, plan: (f) => ({ manifests: false, usage: "scopes", scopes: f.usageMoved, fresh: f.fresh }), say: (f) => `${f.usageMoved.length} source scope(s) moved or cannot be settled: ${f.usageMoved.slice(0, 6).join(", ")} — re-reading those and nothing else` },
  { name: "CURRENT", writes: false, when: () => true, plan: NOTHING, say: (f) => `${f.count} fact(s), every scope ${f.skipped.length ? "this task touches" : ""} still where the snapshot left it`.replace("  ", " ") },
];

export function decide(facts, opts = {}) {
  const row = DECISIONS.find((d) => d.when(facts));
  const dry = Boolean(opts.dry);
  return { ...row, dry, writes: row.writes && !dry, plan: { ...row.plan(facts), budget: opts.budget }, say: row.say(facts), skipped: facts.skipped ?? [] };
}
