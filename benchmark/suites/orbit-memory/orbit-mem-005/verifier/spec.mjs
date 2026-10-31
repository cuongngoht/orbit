// THE SPEC of ORBIT-MEM-005: has the tree moved under a fact -- written from its contract and never from its code. Kept
// beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never imports the
// subject. Every check is an input and an expectation over the ids the subject reports: `has` (must be among them),
// `lacks` (must not be), `exactly` (the whole set).
//
// The contract (AGENTS.md, "Memory first, and a scan is the exception", and the header of src/freshness.mjs):
// freshness is keyed to a fact's own SCOPE, never to HEAD. Three words: `fresh` -- the scope hashes to what it hashed to
// when it was recorded; `stale` -- it moved, which means NEEDS REVALIDATION and never false; `unknown` -- nothing could
// settle it: the scope is gone, nothing recorded what it was, there is no checkout to ask, or it has uncommitted edits
// the index cannot see (an uncommitted edit is `unknown`, which is neither). The hash measured now rides along with the
// verdict. A fact is as fresh as its least fresh scope: any stale scope makes it stale, all fresh makes it fresh, and
// anything else -- a scope nobody measured, or no scope at all -- is unknown. A freshness check measures every scope
// the facts name, once, in ONE call to the source port however many scopes there are (none when they name none), and
// a rescan covers the scopes that are not fresh.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-MEM-005";

export const GROUPS = {
  "scope-unchanged": "a scope that hashes to what was recorded is fresh, and its hash rides along",
  "scope-moved": "a scope whose hash moved is stale -- needs revalidation, never false",
  "scope-gone": "a scope that is gone, or with no checkout to ask, is unknown",
  "never-recorded": "a scope nothing recorded is unknown, never fresh",
  "uncommitted-is-unknown": "a scope with uncommitted edits is unknown -- never stale and never fresh -- whatever its hash",
  "clean-compared": "a scope with no uncommitted edit is compared by its hash",
  "all-fresh": "a fact all of whose scopes are fresh is fresh",
  "stale-wins": "any stale scope makes a fact stale, whatever its other scopes say",
  "unknown-is-not-fresh": "a fact with an unknown scope and no stale one is unknown",
  "unmeasured-is-unknown": "a scope a fact names that nobody measured is unknown, never fresh",
  "no-scope": "a fact that names no scope is unknown",
  "measured-once": "a check measures every scope the facts name in one call, and a rescan covers what is not fresh",
  "scoped-not-head": "a scope no fact names is never asked about: a README that moved leaves a fact about other code alone",
  "seeded-scope": "seeded scopes: hash, recording and uncommitted edits, judged as the contract says",
  "seeded-fact": "seeded facts over measured and unmeasured scopes: as fresh as the least fresh",
  "seeded-measure": "seeded freshness checks: every fact, every scope a rescan must cover, one call",
};

// ---- the reference model: the contract, as data -------------------------------------------------------------------

const SCOPE = [
  { state: "unknown", when: (now) => !now },
  { state: "unknown", when: (now) => now.dirty > 0 },
  { state: "unknown", when: (now, was) => !was },
  { state: "fresh", when: (now, was) => now.hash === was },
  { state: "stale", when: () => true },
];

export const scopeOf = (now, was) => SCOPE.find((row) => row.when(now, was)).state;

const leastFresh = (states) => (states.includes("stale") ? "stale" : states.length && states.every((s) => s === "fresh") ? "fresh" : "unknown");

export const factOf = (fact, scopes) => leastFresh((fact.scope ?? []).map((s) => scopes[s]?.state ?? "unknown"));

const wantedBy = (facts) => [...new Set(facts.flatMap((f) => f.scope ?? []))];

const measuredOf = (i) => Object.fromEntries(wantedBy(i.facts).map((s) => [s, { state: scopeOf(i.current[s] ?? null, i.recorded[s] ?? null) }]));

const checkOf = (i, scopes) => [...i.facts.map((f, k) => `fact-${k + 1}:${factOf(f, scopes)}`), ...Object.keys(scopes).filter((s) => scopes[s].state !== "fresh").map((s) => `moved:${s}`), `calls:${wantedBy(i.facts).length ? 1 : 0}`];

const MODEL = {
  scope: (i) => [scopeOf(i.now, i.was), `hash:${i.now ? i.now.hash : "none"}`],
  fact: (i) => [factOf(i.fact, i.scopes)],
  measure: (i) => checkOf(i, measuredOf(i)),
};

export const owed = (input) => ({ exactly: [...new Set(MODEL[input.call](input))].sort() });

// ---- what the inputs are made of ------------------------------------------------------------------------------------

const H1 = "3f6c1a0b9e2d";
const H2 = "a81d44c07b5e";
const H3 = "0c9e7f12d3a4";

const tree = (hash, dirty = 0, files = 12) => ({ hash, files, dirty });

const ids = (...list) => ({ exactly: [...new Set(list)].sort() });

const scope = (group, now, was, ...answer) => ({ group, input: { call: "scope", now, was }, expect: ids(...answer) });
const fact = (group, f, scopes, state) => ({ group, input: { call: "fact", fact: f, scopes }, expect: ids(state) });
const check = (group, facts, recorded, current, ...answer) => ({ group, input: { call: "measure", facts, recorded, current }, expect: ids(...answer) });

const st = (state) => ({ state });

// ---- the checks written by hand, each from a sentence of the contract ------------------------------------------------

const SCOPES = [
  scope("scope-unchanged", tree(H1), H1, "fresh", `hash:${H1}`),
  scope("scope-moved", tree(H2), H1, "stale", `hash:${H2}`),
  scope("scope-gone", null, H1, "unknown", "hash:none"),
  scope("scope-gone", null, null, "unknown", "hash:none"),
  scope("never-recorded", tree(H1), null, "unknown", `hash:${H1}`),
  scope("uncommitted-is-unknown", tree(H1, 3), H1, "unknown", `hash:${H1}`),
  scope("uncommitted-is-unknown", tree(H2, 1), H1, "unknown", `hash:${H2}`),
  scope("uncommitted-is-unknown", tree(H1, 1), null, "unknown", `hash:${H1}`),
  scope("uncommitted-is-unknown", tree(H3, 40, 200), H3, "unknown", `hash:${H3}`),
  scope("clean-compared", tree(H1, 0, 0), H1, "fresh", `hash:${H1}`),
  scope("clean-compared", tree(H3, 0, 7), H2, "stale", `hash:${H3}`),
];

const FACTS = [
  fact("all-fresh", { scope: ["src/dsl"] }, { "src/dsl": st("fresh") }, "fresh"),
  fact("all-fresh", { scope: ["src/dsl", "src/run"] }, { "src/dsl": st("fresh"), "src/run": st("fresh") }, "fresh"),
  fact("stale-wins", { scope: ["src/dsl", "src/run"] }, { "src/dsl": st("fresh"), "src/run": st("stale") }, "stale"),
  fact("stale-wins", { scope: ["a", "b", "c"] }, { a: st("unknown"), b: st("stale"), c: st("fresh") }, "stale"),
  fact("stale-wins", { scope: ["a", "b"] }, { a: st("stale") }, "stale"),
  fact("unknown-is-not-fresh", { scope: ["a", "b"] }, { a: st("fresh"), b: st("unknown") }, "unknown"),
  fact("unknown-is-not-fresh", { scope: ["a"] }, { a: st("unknown") }, "unknown"),
  fact("unmeasured-is-unknown", { scope: ["a", "b"] }, { a: st("fresh") }, "unknown"),
  fact("unmeasured-is-unknown", { scope: ["src/dsl"] }, {}, "unknown"),
  fact("unmeasured-is-unknown", { scope: ["a", "b", "c"] }, { a: st("fresh"), c: st("fresh") }, "unknown"),
  fact("no-scope", { scope: [] }, { a: st("fresh") }, "unknown"),
  fact("no-scope", {}, { a: st("fresh") }, "unknown"),
];

const CHECKS = [
  check("measured-once", [{ scope: ["a"] }, { scope: ["a", "b"] }], { a: H1, b: H2 }, { a: tree(H1), b: tree(H3) }, "fact-1:fresh", "fact-2:stale", "moved:b", "calls:1"),
  check("measured-once", [{ scope: ["a"] }], { a: H1 }, { a: tree(H1, 2) }, "fact-1:unknown", "moved:a", "calls:1"),
  check("measured-once", [{ scope: [] }], {}, {}, "fact-1:unknown", "calls:0"),
  check("measured-once", [{ scope: ["a"] }, { scope: ["b"] }], { a: H1 }, { a: tree(H1), b: tree(H2) }, "fact-1:fresh", "fact-2:unknown", "moved:b", "calls:1"),
  check("measured-once", [{ scope: ["a", "b"] }], { a: H1, b: H2 }, { a: tree(H1) }, "fact-1:unknown", "moved:b", "calls:1"),
  check("measured-once", [{ scope: ["a", "b", "c"] }, { scope: ["c", "b"] }, { scope: ["a"] }], { a: H1, b: H2, c: H3 }, { a: tree(H1), b: tree(H2), c: tree(H3) }, "fact-1:fresh", "fact-2:fresh", "fact-3:fresh", "calls:1"),
  check("scoped-not-head", [{ scope: ["src/dsl"] }], { "src/dsl": H1, "README.md": H2 }, { "src/dsl": tree(H1), "README.md": tree(H3) }, "fact-1:fresh", "calls:1"),
  check("scoped-not-head", [{ scope: ["src/dsl"] }, { scope: ["README.md"] }], { "src/dsl": H1, "README.md": H2 }, { "src/dsl": tree(H1), "README.md": tree(H3) }, "fact-1:fresh", "fact-2:stale", "moved:README.md", "calls:1"),
];

export const STRUCTURE = [...SCOPES, ...FACTS, ...CHECKS];

// ---- a seeded generator, the same numbers for the same seed --------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const HASHES = [H1, H2, H3];
const POOL = ["src/dsl", "src/run", "src/query", "docs"];
const STATES = ["fresh", "fresh", "stale", "unknown"];

const seededTree = (r) => (r() < 0.15 ? null : tree(pick(r, HASHES), r() < 0.65 ? 0 : 1 + Math.floor(r() * 5), Math.floor(r() * 50)));

const seededScope = (r) => ((input) => ({ group: "seeded-scope", input, expect: owed(input) }))({ call: "scope", now: seededTree(r), was: r() < 0.2 ? null : pick(r, HASHES) });

const some = (r, p) => POOL.filter(() => r() < p);

const seededFact = (r) => ((input) => ({ group: "seeded-fact", input, expect: owed(input) }))({ call: "fact", fact: { scope: some(r, 0.5) }, scopes: Object.fromEntries(some(r, 0.75).map((s) => [s, st(pick(r, STATES))])) });

// What a scope is now: often what was recorded, sometimes moved, edited or gone.
const nowOf = (r, was) => (r() < 0.12 ? null : tree(was && r() < 0.6 ? was : pick(r, HASHES), r() < 0.75 ? 0 : 1 + Math.floor(r() * 3)));

const seededCheck = (r) => ((recorded) => ((input) => ({ group: "seeded-measure", input, expect: owed(input) }))({ call: "measure", facts: Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ scope: some(r, 0.4) })), recorded, current: Object.fromEntries(POOL.map((s) => [s, nowOf(r, recorded[s])]).filter(([, now]) => now)) }))(Object.fromEntries(some(r, 0.85).map((s) => [s, pick(r, HASHES)])));

const times = (n, make, r) => Array.from({ length: n }, () => make(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const n = Math.max(8, Math.floor(samples / 3));
  return numbered([...STRUCTURE, ...times(n, seededScope, r), ...times(n, seededFact, r), ...times(n, seededCheck, r)]);
}

// ---- the reference model, held to the table written by hand ---------------------------------------------------------

const agrees = (c) => JSON.stringify(owed(c.input)) === JSON.stringify(c.expect);

export const selfTest = () => STRUCTURE.filter((c) => !agrees(c)).map((c) => `the reference model disagrees with the contract on a ${c.group} check: ${JSON.stringify(c.input)}`);
