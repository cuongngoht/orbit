// THE SPEC of ORBIT-MEM-008: after a scoped change, only that scope is read again -- written from its contract and never
// from its code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never
// imports the subject. Every check is a small checkout, a plan of looks and changes, and an expectation over the ids the
// probe reports of each look: `has` (must be among them), `lacks` (must not be) and `atMost` (the number an id carries
// is at most this).
//
// The contract (AGENTS.md, "Memory first, and a scan is the exception"; the headers of src/freshness.mjs,
// src/architecture/scan.mjs and src/architecture/fields.mjs): freshness is keyed to a fact's own SCOPE -- the paths it is
// about -- never to HEAD, so an unrelated commit leaves a fact alone, and a commit that touches a note no fact is about
// leaves the snapshot CURRENT. A change under a scope moves it: the next look is INCREMENTAL, re-reads what moved and
// nothing else -- never a file of another top-level folder, nor the root's own files when the change was elsewhere --
// asks the tree for its listing once, and records where the scopes stand now, so the look after it is CURRENT again.
// An uncommitted edit is UNKNOWN, which is neither fresh nor stale: every look re-reads that scope until the edit is
// committed; then the index moved from what was recorded, one more look re-reads it, and the next is CURRENT.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
//   judged(check, answer) -> { ok, why, measured }      the judge this case holds a look to, and what it measured
export const CASE = "ORBIT-MEM-008";

export const GROUPS = {
  "note-moves-nothing": "a commit that only touches a note no fact is about leaves the next look CURRENT: it reads nothing and writes nothing -- freshness is each fact's own scope, never HEAD",
  "manifest-moves-its-scope": "a commit to a package's manifest makes the next look INCREMENTAL: it re-reads that manifest, no file outside the packages, lists the tree once and records where the scope stands now",
  "current-after-rescan": "the look after an incremental one is CURRENT again: the scan recorded the scopes it re-read",
  "root-file-moves-itself": "a commit to one of the root's own files -- its manifest, its README -- re-reads that file and no other",
  "document-moves-its-folder": "a commit to a decision record re-reads it, and no package's or root file",
  "uncommitted-is-unknown": "an uncommitted edit leaves its scope unknown: every look re-reads it, and nothing outside its folder, until the edit is committed -- then one more look re-reads it, and the next is CURRENT",
  "seeded-change": "seeded trees and changes: a note leaves the snapshot CURRENT, a declaration moves only what holds it",
};

// ---- the trees: a root manifest and README, packages with a manifest and a module each, documents, a lone note -----------

const FEW = 4;

const manifest = (name, deps) => `${JSON.stringify({ name, version: "1.0.0", private: true, ...(deps ? { dependencies: deps } : { scripts: { test: "node --test" } }) }, null, 2)}\n`;

const RULE = "must never reach into another package's state directly";

const packageFiles = (p, next) => ({ [`packages/${p}/package.json`]: manifest(p, { [`${p}-client`]: "^1.0.0" }), [`packages/${p}/src/index.mjs`]: `import { value } from "../../${next}/src/index.mjs";\nexport const ${p} = value;\n` });

export const treeOf = (t) => Object.assign({ "package.json": manifest("fixture"), "README.md": `# fixture\n\nA package ${RULE}, whatever it needs from it.\n` }, ...t.packages.map((p, i) => packageFiles(p, t.packages[(i + 1) % t.packages.length])), ...t.docs.map((d) => ({ [`docs/adr/${d}.md`]: `# ${d}\n\nA module ${RULE}; it asks through the module's own door.\n` })), { [`notes/${t.note}.txt`]: "a note no fact is about\n" });

const T1 = { packages: ["alpha", "beta", "gamma", "delta"], docs: ["0001-boundaries", "0002-state"], note: "today" };
const T2 = { packages: ["ledger", "billing", "orders", "stock", "reports"], docs: ["0001-one-door", "0002-events", "0003-ids"], note: "standup" };

// ---- the reference model: the contract, as data -------------------------------------------------------------------------

// A note is what no fact is about: a change under notes/ moves nothing.
const movesSomething = (rel) => !rel.startsWith("notes/");

// The folder a change's scope cannot reach past: a root file is its own; anything else, its top-level folder.
const reachOf = (rel) => (rel.includes("/") ? `${rel.split("/")[0]}/` : rel);

const within = (file, reach) => (reach.endsWith("/") ? file.startsWith(reach) : file === reach);

const learnsOwed = (k) => ({ has: [`${k}:BOOTSTRAP`, `${k}:listing:1`, `${k}:read:package.json`, `${k}:store:changed`], lacks: [`${k}:reads:0`] });

const currentOwed = (k) => ({ has: [`${k}:CURRENT`, `${k}:reads:0`, `${k}:listing:0`, `${k}:search:0`, `${k}:index:1`, `${k}:store:same`], lacks: [`${k}:unsteady`], atMost: { [`${k}:calls`]: FEW } });

// What moved re-read, nothing beyond what reaches it read, the tree listed once -- and, after a commit, the snapshot
// written with where the scope stands now.
const incrementalOwed = (k, moved, tree, committed) => ({ has: [`${k}:INCREMENTAL`, `${k}:listing:1`, ...moved.map((p) => `${k}:read:${p}`), ...(committed ? [`${k}:store:changed`] : [])], lacks: Object.keys(tree).filter((f) => !moved.some((p) => within(f, reachOf(p)))).map((f) => `${k}:read:${f}`), atMost: { [`${k}:search`]: 1 } });

const movedNow = (state) => [...new Set([...state.pending, ...state.dirty])].filter(movesSomething).sort();

const owedNow = (state, k, tree) => (!state.learned ? learnsOwed(k) : movedNow(state).length ? incrementalOwed(k, movedNow(state), tree, state.pending.some(movesSomething)) : currentOwed(k));

// One step of the plan: a look is owed what the state says; a commit is pending until a look records it; an edit stays
// unknown until it is settled.
const STEP = {
  look: (state, s, tree) => ({ ...state, k: state.k + 1, learned: true, pending: [], owed: [...state.owed, owedNow(state, state.k + 1, tree)] }),
  commit: (state, s) => ({ ...state, pending: [...state.pending, s.commit] }),
  edit: (state, s) => ({ ...state, dirty: [...state.dirty, s.edit] }),
  settle: (state) => ({ ...state, pending: [...state.pending, ...state.dirty], dirty: [] }),
};

const stepName = (s) => Object.keys(STEP).find((k) => Object.hasOwn(s, k));

const merged = (owed) => ({ has: owed.flatMap((o) => o.has), lacks: owed.flatMap((o) => o.lacks), atMost: Object.assign({}, ...owed.map((o) => o.atMost ?? {})) });

export const owed = (input) => merged(input.plan.reduce((state, s) => STEP[stepName(s)](state, s, input.tree), { k: 0, learned: false, pending: [], dirty: [], owed: [] }).owed);

// ---- the checks written by hand, each from a sentence of the contract -----------------------------------------------------

const check = (group, t, plan, expect) => ({ group, input: { call: "looks", tree: treeOf(t), plan }, expect });

const and = (...xs) => ({ has: xs.flatMap((x) => x.has), lacks: xs.flatMap((x) => x.lacks ?? []), atMost: Object.assign({}, ...xs.map((x) => x.atMost ?? {})) });

const LEARN = { has: ["1:BOOTSTRAP", "1:listing:1", "1:read:package.json", "1:store:changed"], lacks: ["1:reads:0"] };

const current = (k) => ({ has: [`${k}:CURRENT`, `${k}:reads:0`, `${k}:listing:0`, `${k}:search:0`, `${k}:index:1`, `${k}:store:same`], lacks: [`${k}:unsteady`], atMost: { [`${k}:calls`]: FEW } });

const reads = (k, t, files) => Object.keys(treeOf(t)).filter((f) => !files(f)).map((f) => `${k}:read:${f}`);

const T1_OUTSIDE_PACKAGES = (k) => reads(k, T1, (f) => f.startsWith("packages/"));

export const STRUCTURE = [
  check("note-moves-nothing", T1, [{ look: [] }, { commit: "notes/today.txt" }, { look: [] }], and(LEARN, current(2))),
  check("note-moves-nothing", T2, [{ look: [] }, { commit: "notes/later.txt" }, { look: [] }, { look: [] }], and(LEARN, current(2), current(3))),
  check("manifest-moves-its-scope", T1, [{ look: [] }, { commit: "packages/beta/package.json" }, { look: [] }], and(LEARN, { has: ["2:INCREMENTAL", "2:listing:1", "2:read:packages/beta/package.json", "2:store:changed"], lacks: T1_OUTSIDE_PACKAGES(2), atMost: { "2:search": 1 } })),
  check("current-after-rescan", T1, [{ look: [] }, { commit: "packages/gamma/package.json" }, { look: [] }, { look: [] }], and(LEARN, { has: ["2:INCREMENTAL", "2:listing:1", "2:read:packages/gamma/package.json", "2:store:changed"], lacks: T1_OUTSIDE_PACKAGES(2), atMost: { "2:search": 1 } }, current(3))),
  check("root-file-moves-itself", T1, [{ look: [] }, { commit: "package.json" }, { look: [] }, { look: [] }], and(LEARN, { has: ["2:INCREMENTAL", "2:listing:1", "2:read:package.json", "2:store:changed"], lacks: reads(2, T1, (f) => f === "package.json"), atMost: { "2:search": 1 } }, current(3))),
  check("root-file-moves-itself", T2, [{ look: [] }, { commit: "README.md" }, { look: [] }], and(LEARN, { has: ["2:INCREMENTAL", "2:listing:1", "2:read:README.md", "2:store:changed"], lacks: reads(2, T2, (f) => f === "README.md"), atMost: { "2:search": 1 } })),
  check("document-moves-its-folder", T2, [{ look: [] }, { commit: "docs/adr/0002-events.md" }, { look: [] }, { look: [] }], and(LEARN, { has: ["2:INCREMENTAL", "2:listing:1", "2:read:docs/adr/0002-events.md", "2:store:changed"], lacks: reads(2, T2, (f) => f.startsWith("docs/")), atMost: { "2:search": 1 } }, current(3))),
  check("uncommitted-is-unknown", T1, [{ look: [] }, { edit: "packages/delta/package.json" }, { look: [] }, { look: [] }, { settle: true }, { look: [] }, { look: [] }], and(LEARN, { has: ["2:INCREMENTAL", "2:listing:1", "2:read:packages/delta/package.json"], lacks: T1_OUTSIDE_PACKAGES(2), atMost: { "2:search": 1 } }, { has: ["3:INCREMENTAL", "3:listing:1", "3:read:packages/delta/package.json"], lacks: T1_OUTSIDE_PACKAGES(3), atMost: { "3:search": 1 } }, { has: ["4:INCREMENTAL", "4:listing:1", "4:read:packages/delta/package.json", "4:store:changed"], lacks: T1_OUTSIDE_PACKAGES(4), atMost: { "4:search": 1 } }, current(5))),
];

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

const NAMES = ["accounts", "catalog", "cart", "checkout", "invoices", "ledger", "mailer", "orders", "payments", "pricing", "search", "shipping", "stock", "tax"];

const some = (r, list, lo, hi) => list.filter(() => r() < 0.6).slice(0, hi).concat(list).filter((x, i, all) => all.indexOf(x) === i).slice(0, Math.max(lo, Math.min(hi, lo + Math.floor(r() * (hi - lo + 1)))));

const seededTree = (r) => ({ packages: some(r, NAMES.slice(Math.floor(r() * 4)), 4, 7), docs: some(r, ["0001-boundaries", "0002-one-door", "0003-events", "0004-ids"], 2, 4), note: pick(r, ["today", "standup", "todo"]) });

// What a seeded change touches: a note, a new note, a package's manifest, the root's own files, a decision record.
const CHANGES = [(t) => `notes/${t.note}.txt`, () => "notes/later.txt", (t, r) => `packages/${pick(r, t.packages)}/package.json`, () => "package.json", () => "README.md", (t, r) => `docs/adr/${pick(r, t.docs)}.md`];

const seededPlan = (r, t) => ((rel) => (r() < 0.25 ? [{ look: [] }, { edit: rel }, { look: [] }, { settle: true }, { look: [] }, { look: [] }] : [{ look: [] }, { commit: rel }, { look: [] }, { look: [] }]))(pick(r, CHANGES)(t, r));

const seeded = (r) => ((t) => ((input) => ({ group: "seeded-change", input, expect: owed(input) }))({ call: "looks", tree: treeOf(t), plan: seededPlan(r, t) }))(seededTree(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...STRUCTURE, ...Array.from({ length: Math.max(4, Math.floor(samples / 4)) }, () => seeded(r))]);
}

// ---- the judge of a look: the expectation held to what the probe measured, and the measurements kept as evidence -------

const numberAt = (got, prefix) => ((id) => (id ? Number(id.slice(prefix.length + 1)) : null))(got.find((id) => id.startsWith(`${prefix}:`) && /^-?\d+(\.\d+)?$/.test(id.slice(prefix.length + 1))));

const RULES = [
  { fails: (e, got) => (e.has ?? []).filter((id) => !got.includes(id)).map((id) => `expected ${id}`) },
  { fails: (e, got) => (e.lacks ?? []).filter((id) => got.includes(id)).map((id) => `never ${id}`) },
  { fails: (e, got) => Object.entries(e.atMost ?? {}).filter(([p, max]) => !(numberAt(got, p) !== null && numberAt(got, p) <= max)).map(([p, max]) => `${p} at most ${max}, and ${numberAt(got, p) ?? "nothing"} came back`) },
];

const ANSWER = [
  { when: (a) => !a, why: () => "no answer came back for it" },
  { when: (a) => a.threw !== undefined, why: (a) => `it threw: ${String(a.threw).slice(0, 200)}` },
  { when: (a) => !Array.isArray(a.got) || !a.got.every((x) => typeof x === "string"), why: () => "its answer is not a list of ids" },
];

// What each look measured, kept beside the verdict whatever it is: its time, its git calls, the files it read.
const looksIn = (got) => [...new Set(got.map((id) => /^(\d+):/.exec(id)?.[1]).filter(Boolean))];

const measuredOf = (got) => Object.fromEntries(looksIn(got).map((k) => [k, { ms: numberAt(got, `ms:${k}`), calls: numberAt(got, `${k}:calls`), reads: numberAt(got, `${k}:reads`), said: got.find((id) => new RegExp(`^${k}:[A-Z_]+$`).test(id))?.slice(k.length + 1) ?? null }]));

export function judged(c, a) {
  const bad = ANSWER.find((r) => r.when(a));
  if (bad) return { ok: false, why: bad.why(a) };
  const why = RULES.flatMap((r) => r.fails(c.expect ?? {}, a.got));
  return { ok: why.length === 0, why: why.length ? why.slice(0, 6).join("; ") : null, measured: measuredOf(a.got) };
}

// ---- the reference model, held to the table written by hand ---------------------------------------------------------

const sorted = (e) => ({ has: [...new Set(e.has)].sort(), lacks: [...new Set(e.lacks)].sort(), atMost: Object.fromEntries(Object.entries(e.atMost ?? {}).sort()) });

const agrees = (c) => JSON.stringify(sorted(owed(c.input))) === JSON.stringify(sorted(c.expect));

export const selfTest = () => STRUCTURE.filter((c) => !agrees(c)).map((c) => `the reference model disagrees with the contract on a ${c.group} check: ${JSON.stringify(c.input.plan)}`);
