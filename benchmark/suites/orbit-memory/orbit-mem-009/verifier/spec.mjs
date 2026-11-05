// THE SPEC of ORBIT-MEM-009: a knowledge recall measures freshness once, now, and reads no file -- written from its
// contract and never from its code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy
// of it, and it never imports the subject. Every check is a small checkout with claims recorded about its folders, a plan
// of recalls and changes, and an expectation over the ids the probe reports of each recall: `has` (must be among them),
// `lacks` (must not be) and `atMost` (the number an id carries is at most this).
//
// The contract (AGENTS.md, "Memory first, and a scan is the exception" and "Knowledge is contextual ..."; the headers of
// src/knowledge/query.mjs, src/knowledge/views/claims.mjs and src/freshness.mjs): `knowledge claims` is the read side --
// it writes nothing; freshness is MEASURED for the answer, now, and never stamped back; it is measured in ONE call to the
// index for every scope the claims watch, and keyed to each claim's own scope, never to HEAD. So a recall over an
// unchanged checkout calls every claim fresh, reads no file, lists nothing, searches nothing, asks the index once and
// writes nothing; a commit under a claim's scope makes THAT claim stale -- needs revalidation, never false -- and leaves
// the others fresh, and a recall never re-records it, so it stays stale; an uncommitted edit makes it unknown, never
// fresh; and a note no claim watches moves nothing.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
//   judged(check, answer) -> { ok, why, measured }      the judge this case holds a recall to, and what it measured
export const CASE = "ORBIT-MEM-009";

export const GROUPS = {
  "unchanged-is-fresh": "a recall over an unchanged checkout calls every claim fresh, reads no file, lists nothing, searches nothing, asks the index once and writes nothing",
  "moved-is-stale": "a commit under one claim's scope makes that claim stale and leaves every other claim fresh -- still one look at the index, still no file read",
  "stale-stays-stale": "a recall never re-records what it measured: a claim whose scope moved is stale on every recall after, and the store is the same bytes",
  "uncommitted-is-unknown": "an uncommitted edit under a claim's scope makes it unknown -- never fresh -- and once committed, stale",
  "note-moves-nothing": "a commit that only touches a note no claim watches leaves every claim fresh",
  "one-look-for-many": "however many claims a recall answers -- up to the seven it shows at most -- it asks the index once",
  "seeded-recall": "seeded checkouts, claims and changes: each claim as fresh as its own scope, one look at the index, no file read",
};

// ---- the trees, and a claim about each package ----------------------------------------------------------------------

// How many git calls one look at the index is: its entries, what it cannot see -- and one to spare.
const ONE_LOOK = 3;

// How many answers one recall shows at most (src/knowledge/query.mjs LIMIT: bounded, "so a project that knows a great
// deal still answers in a screenful"): no check here holds more claims than one recall answers.
const BOUND = 7;

const manifest = (name) => `${JSON.stringify({ name, version: "1.0.0", private: true }, null, 2)}\n`;

const packageFiles = (p) => ({ [`packages/${p}/package.json`]: manifest(p), [`packages/${p}/src/index.mjs`]: `export const ${p} = 1;\n` });

export const treeOf = (t) => Object.assign({ "package.json": manifest("fixture"), "README.md": "# fixture\n" }, ...t.packages.map(packageFiles), { [`notes/${t.note}.txt`]: "a note no claim watches\n" });

const claimsOf = (t) => t.packages.map((p) => ({ subject: p, scope: `packages/${p}` }));

const T1 = { packages: ["alpha", "beta", "gamma", "delta"], note: "today" };
const T2 = { packages: ["ledger", "billing", "orders", "stock", "reports", "audit", "tax"], note: "standup" };

// ---- the reference model: the contract, as data -------------------------------------------------------------------------

const under = (rel, scope) => rel === scope || rel.startsWith(`${scope}/`);

// A claim as fresh as its own scope: unknown while an edit under it is uncommitted, stale once a commit moved it, fresh
// otherwise.
const freshnessOf = (state, c) => (state.dirty.some((rel) => under(rel, c.scope)) ? "unknown" : state.moved.includes(c.subject) ? "stale" : "fresh");

const recallOwed = (state, k, claims) => ({ has: [...claims.map((c) => `${k}:claim:${c.subject}:${freshnessOf(state, c)}`), `${k}:reads:0`, `${k}:listing:0`, `${k}:search:0`, `${k}:index:1`, `${k}:store:same`], lacks: [], atMost: { [`${k}:calls`]: ONE_LOOK } });

const movedBy = (claims, rels) => claims.filter((c) => rels.some((rel) => under(rel, c.scope))).map((c) => c.subject);

const STEP = {
  recall: (state, s, claims) => ({ ...state, k: state.k + 1, owed: [...state.owed, recallOwed(state, state.k + 1, claims)] }),
  commit: (state, s, claims) => ({ ...state, moved: [...state.moved, ...movedBy(claims, [s.commit])] }),
  edit: (state, s) => ({ ...state, dirty: [...state.dirty, s.edit] }),
  settle: (state, s, claims) => ({ ...state, moved: [...state.moved, ...movedBy(claims, state.dirty)], dirty: [] }),
};

const stepName = (s) => Object.keys(STEP).find((k) => Object.hasOwn(s, k));

const merged = (owed) => ({ has: owed.flatMap((o) => o.has), lacks: owed.flatMap((o) => o.lacks), atMost: Object.assign({}, ...owed.map((o) => o.atMost)) });

export const owed = (input) => merged(input.plan.reduce((state, s) => STEP[stepName(s)](state, s, input.claims), { k: 0, moved: [], dirty: [], owed: [] }).owed);

// ---- the checks written by hand, each from a sentence of the contract -----------------------------------------------------

const check = (group, t, plan, expect) => ({ group, input: { call: "recall", tree: treeOf(t), claims: claimsOf(t), plan }, expect });

const recall = (k, t, says = {}) => ({ has: [...t.packages.map((p) => `${k}:claim:${p}:${says[p] ?? "fresh"}`), `${k}:reads:0`, `${k}:listing:0`, `${k}:search:0`, `${k}:index:1`, `${k}:store:same`], lacks: [], atMost: { [`${k}:calls`]: ONE_LOOK } });

const and = (...xs) => ({ has: xs.flatMap((x) => x.has), lacks: xs.flatMap((x) => x.lacks), atMost: Object.assign({}, ...xs.map((x) => x.atMost)) });

export const STRUCTURE = [
  check("unchanged-is-fresh", T1, [{ recall: true }, { recall: true }], and(recall(1, T1), recall(2, T1))),
  check("moved-is-stale", T1, [{ recall: true }, { commit: "packages/beta/src/index.mjs" }, { recall: true }], and(recall(1, T1), recall(2, T1, { beta: "stale" }))),
  check("moved-is-stale", T2, [{ commit: "packages/orders/package.json" }, { commit: "packages/tax/src/index.mjs" }, { recall: true }], recall(1, T2, { orders: "stale", tax: "stale" })),
  check("stale-stays-stale", T1, [{ commit: "packages/gamma/package.json" }, { recall: true }, { recall: true }, { recall: true }], and(recall(1, T1, { gamma: "stale" }), recall(2, T1, { gamma: "stale" }), recall(3, T1, { gamma: "stale" }))),
  check("uncommitted-is-unknown", T1, [{ edit: "packages/delta/src/index.mjs" }, { recall: true }, { settle: true }, { recall: true }], and(recall(1, T1, { delta: "unknown" }), recall(2, T1, { delta: "stale" }))),
  check("note-moves-nothing", T1, [{ commit: "notes/today.txt" }, { recall: true }, { commit: "notes/later.txt" }, { recall: true }], and(recall(1, T1), recall(2, T1))),
  check("one-look-for-many", T2, [{ recall: true }], recall(1, T2)),
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

const seededTree = (r) => ({ packages: some(r, NAMES.slice(Math.floor(r() * 4)), 4, BOUND), note: pick(r, ["today", "standup", "todo"]) });

// One seeded change between recalls: a package's manifest or module committed, an edit left uncommitted, a note.
const CHANGES = [(t, r) => ({ commit: `packages/${pick(r, t.packages)}/package.json` }), (t, r) => ({ commit: `packages/${pick(r, t.packages)}/src/index.mjs` }), (t, r) => ({ edit: `packages/${pick(r, t.packages)}/src/index.mjs` }), (t) => ({ commit: `notes/${t.note}.txt` })];

const seededPlan = (r, t) => [{ recall: true }, ...Array.from({ length: 1 + Math.floor(r() * 3) }, () => [pick(r, CHANGES)(t, r), { recall: true }]).flat()];

const seeded = (r) => ((t) => ((input) => ({ group: "seeded-recall", input, expect: owed(input) }))({ call: "recall", tree: treeOf(t), claims: claimsOf(t), plan: seededPlan(r, t) }))(seededTree(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...STRUCTURE, ...Array.from({ length: Math.max(4, Math.floor(samples / 4)) }, () => seeded(r))]);
}

// ---- the judge of a recall: the expectation held to what the probe measured, and the measurements kept as evidence ----

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

// What each recall measured, kept beside the verdict whatever it is: its time, its git calls, the files it read.
const recallsIn = (got) => [...new Set(got.map((id) => /^(\d+):/.exec(id)?.[1]).filter(Boolean))];

const measuredOf = (got) => Object.fromEntries(recallsIn(got).map((k) => [k, { ms: numberAt(got, `ms:${k}`), calls: numberAt(got, `${k}:calls`), reads: numberAt(got, `${k}:reads`) }]));

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
