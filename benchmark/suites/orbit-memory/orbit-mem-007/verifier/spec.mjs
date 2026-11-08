// THE SPEC of ORBIT-MEM-007: a second look at an unchanged checkout is CURRENT, and reads no file -- written from its
// contract and never from its code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy
// of it, and it never imports the subject. Every check is a small checkout and a plan of looks at it, and an
// expectation over the ids the probe reports of each look: `has` (must be among them), `lacks` (must not be), `atMost`
// (the number an id carries is at most this) and `faster` (one look took under a fraction of another's time).
//
// The contract (AGENTS.md, "Memory first, and a scan is the exception"; the header of src/architecture/ensure.mjs and
// of cli/architecture.mjs): `architecture ensure` decides whether the repository has to be read at all, and the normal
// answer is CURRENT -- a few git calls, no listing and no file read. A first look, with nothing learned, is BOOTSTRAP:
// it lists the tree, reads it once and records a snapshot, so nothing after it has to. CURRENT means no scan, and
// `--dry` writes nothing, whatever it decides: one column of one table. A freshness check asks the index ONCE however
// many scopes there are. So a look at a checkout nothing moved in reads no file, lists nothing, searches nothing, asks
// the index once, writes nothing -- and costs a fraction of the look that learned the snapshot.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
//   judged(check, answer) -> { ok, why, measured }      the judge this case holds a look to, and what it measured
export const CASE = "ORBIT-MEM-007";

export const GROUPS = {
  "first-look-learns": "a first look with nothing learned is BOOTSTRAP: it lists the tree once, reads what the tree declares and records a snapshot",
  "second-look-current": "a second look at the unchanged checkout is CURRENT: no file read, no listing, no search, the index asked once, a few git calls, nothing written",
  "stays-current": "every later look at the unchanged checkout is CURRENT too, and writes nothing",
  "dry-writes-nothing": "a --dry look writes nothing whatever it decides: a --dry first look leaves the store as it was, so the next look still learns",
  "dry-current": "a --dry look over a snapshot is CURRENT, and writes nothing",
  "current-is-cheap": "the best of three CURRENT looks takes under half the time of the look that learned the snapshot",
  "seeded-tree": "seeded trees of packages, manifests and documents: learned once, then CURRENT every time, reading nothing",
};

// ---- the trees: a root manifest and README, packages with a manifest and a module each, documents, a lone note -----------

// How much of the learning look's time a CURRENT look may take, at its best of three.
export const CHEAP = 0.5;

// How many git calls "a few" is: the commit, the index and what the index cannot see -- and one to spare.
export const FEW = 4;

const manifest = (name, deps) => `${JSON.stringify({ name, version: "1.0.0", private: true, ...(deps ? { dependencies: deps } : { scripts: { test: "node --test" } }) }, null, 2)}\n`;

const RULE = "must never reach into another package's state directly";

const packageFiles = (p, next) => ({ [`packages/${p}/package.json`]: manifest(p, { [`${p}-client`]: "^1.0.0" }), [`packages/${p}/src/index.mjs`]: `import { value } from "../../${next}/src/index.mjs";\nexport const ${p} = value;\n` });

// A tree by its parts: the packages, the decision records under docs/adr, the lone note nothing is about.
export const treeOf = (t) => Object.assign({ "package.json": manifest("fixture"), "README.md": `# fixture\n\nA package ${RULE}, whatever it needs from it.\n` }, ...t.packages.map((p, i) => packageFiles(p, t.packages[(i + 1) % t.packages.length])), ...t.docs.map((d) => ({ [`docs/adr/${d}.md`]: `# ${d}\n\nA module ${RULE}; it asks through the module's own door.\n` })), { [`notes/${t.note}.txt`]: "a note no fact is about\n" });

const T1 = { packages: ["alpha", "beta", "gamma", "delta"], docs: ["0001-boundaries", "0002-state"], note: "today" };
const T2 = { packages: ["ledger", "billing", "orders", "stock", "reports", "audit"], docs: ["0001-one-door", "0002-events", "0003-ids"], note: "standup" };

// ---- the reference model: the contract, as data -------------------------------------------------------------------------

const learnsOwed = (k, dry) => ({ has: [`${k}:BOOTSTRAP`, `${k}:listing:1`, `${k}:read:package.json`, `${k}:store:${dry ? "same" : "changed"}`], lacks: [`${k}:reads:0`] });

const currentOwed = (k) => ({ has: [`${k}:CURRENT`, `${k}:reads:0`, `${k}:listing:0`, `${k}:search:0`, `${k}:index:1`, `${k}:store:same`], lacks: [`${k}:unsteady`], atMost: { [`${k}:calls`]: FEW } });

const isLook = (s) => Object.hasOwn(s, "look") || Object.hasOwn(s, "again");

const dryOf = (s) => (s.look ?? []).includes("--dry");

// One look of the plan, against what was learned before it: the first look that writes learns; every look after is
// CURRENT -- and a best-of-n after a learning look is held to a fraction of its time.
function lookOwed(state, s) {
  const k = state.k + 1;
  const owed = state.learnedAt ? currentOwed(k) : learnsOwed(k, dryOf(s));
  const faster = state.learnedAt && Object.hasOwn(s, "again") ? [{ look: k, than: state.learnedAt, ratio: CHEAP }] : [];
  return { k, learnedAt: state.learnedAt ?? (dryOf(s) ? null : k), owed: [...state.owed, { ...owed, faster }] };
}

const merged = (owed) => ({ has: owed.flatMap((o) => o.has), lacks: owed.flatMap((o) => o.lacks), atMost: Object.assign({}, ...owed.map((o) => o.atMost ?? {})), faster: owed.flatMap((o) => o.faster) });

export const owed = (input) => merged(input.plan.filter(isLook).reduce(lookOwed, { k: 0, learnedAt: null, owed: [] }).owed);

// ---- the checks written by hand, each from a sentence of the contract -----------------------------------------------------

const check = (group, t, plan, expect) => ({ group, input: { call: "looks", tree: treeOf(t), plan }, expect });

const LEARN = { has: ["1:BOOTSTRAP", "1:listing:1", "1:read:package.json", "1:store:changed"], lacks: ["1:reads:0"], atMost: {}, faster: [] };

const current = (k) => ({ has: [`${k}:CURRENT`, `${k}:reads:0`, `${k}:listing:0`, `${k}:search:0`, `${k}:index:1`, `${k}:store:same`], lacks: [`${k}:unsteady`], atMost: { [`${k}:calls`]: FEW } });

const and = (...xs) => ({ has: xs.flatMap((x) => x.has), lacks: xs.flatMap((x) => x.lacks), atMost: Object.assign({}, ...xs.map((x) => x.atMost ?? {})), faster: xs.flatMap((x) => x.faster ?? []) });

export const STRUCTURE = [
  check("first-look-learns", T1, [{ look: [] }], LEARN),
  check("first-look-learns", T2, [{ look: [] }], LEARN),
  check("second-look-current", T1, [{ look: [] }, { look: [] }], and(LEARN, current(2))),
  check("second-look-current", T2, [{ look: [] }, { look: [] }], and(LEARN, current(2))),
  check("stays-current", T1, [{ look: [] }, { look: [] }, { look: [] }, { look: [] }], and(LEARN, current(2), current(3), current(4))),
  check("dry-writes-nothing", T1, [{ look: ["--dry"] }, { look: [] }], and({ has: ["1:BOOTSTRAP", "1:listing:1", "1:read:package.json", "1:store:same"], lacks: ["1:reads:0"] }, { has: ["2:BOOTSTRAP", "2:listing:1", "2:read:package.json", "2:store:changed"], lacks: ["2:reads:0"] })),
  check("dry-current", T2, [{ look: [] }, { look: ["--dry"] }], and(LEARN, current(2))),
  check("current-is-cheap", T1, [{ look: [] }, { again: 3 }], and(LEARN, current(2), { has: [], lacks: [], faster: [{ look: 2, than: 1, ratio: CHEAP }] })),
  check("current-is-cheap", T2, [{ look: [] }, { again: 3 }], and(LEARN, current(2), { has: [], lacks: [], faster: [{ look: 2, than: 1, ratio: CHEAP }] })),
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

const seededTree = (r) => ({ packages: some(r, NAMES.slice(Math.floor(r() * 4)), 4, 8), docs: some(r, ["0001-boundaries", "0002-one-door", "0003-events", "0004-ids"], 2, 4), note: pick(r, ["today", "standup", "todo"]) });

const PLANS = [[{ look: [] }, { again: 3 }], [{ look: ["--dry"] }, { look: [] }, { look: [] }], [{ look: [] }, { look: [] }, { look: ["--dry"] }, { look: [] }], [{ look: [] }, { look: [] }, { again: 3 }]];

const seeded = (r) => ((input) => ({ group: "seeded-tree", input, expect: owed(input) }))({ call: "looks", tree: treeOf(seededTree(r)), plan: pick(r, PLANS) });

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...STRUCTURE, ...Array.from({ length: Math.max(4, Math.floor(samples / 4)) }, () => seeded(r))]);
}

// ---- the judge of a look: the expectation held to what the probe measured, and the measurements kept as evidence -------

const numberAt = (got, prefix) => ((id) => (id ? Number(id.slice(prefix.length + 1)) : null))(got.find((id) => id.startsWith(`${prefix}:`) && /^-?\d+(\.\d+)?$/.test(id.slice(prefix.length + 1))));

const quicker = (got, f) => ((a, b) => a !== null && b !== null && b > 0 && a < b * f.ratio)(numberAt(got, `ms:${f.look}`), numberAt(got, `ms:${f.than}`));

const RULES = [
  { fails: (e, got) => (e.has ?? []).filter((id) => !got.includes(id)).map((id) => `expected ${id}`) },
  { fails: (e, got) => (e.lacks ?? []).filter((id) => got.includes(id)).map((id) => `never ${id}`) },
  { fails: (e, got) => Object.entries(e.atMost ?? {}).filter(([p, max]) => !(numberAt(got, p) !== null && numberAt(got, p) <= max)).map(([p, max]) => `${p} at most ${max}, and ${numberAt(got, p) ?? "nothing"} came back`) },
  { fails: (e, got) => (e.faster ?? []).filter((f) => !quicker(got, f)).map((f) => `look ${f.look} under ${f.ratio} of look ${f.than}'s time, and ${numberAt(got, `ms:${f.look}`) ?? "?"} ms against ${numberAt(got, `ms:${f.than}`) ?? "?"} ms came back`) },
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

const sorted = (e) => ({ has: [...e.has].sort(), lacks: [...e.lacks].sort(), atMost: Object.fromEntries(Object.entries(e.atMost ?? {}).sort()), faster: e.faster ?? [] });

const agrees = (c) => JSON.stringify(sorted(owed(c.input))) === JSON.stringify(sorted(c.expect));

export const selfTest = () => STRUCTURE.filter((c) => !agrees(c)).map((c) => `the reference model disagrees with the contract on a ${c.group} check: ${JSON.stringify(c.input.plan)}`);
