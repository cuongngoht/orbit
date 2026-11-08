// THE HIDDEN CHECKS of ORBIT-HLD-004: every library system sees and changes only its own records -- held to a reference
// model written from the goal, never from the fixture's code. Each check sets two library systems up on one service --
// `theirs` with titles, a copy lent to a member, a copy on the shelf and a hold; `mine` with titles of its own, a copy
// lent and one on the shelf -- and has `mine` take ONE act: read, list or change something of theirs, check one of their
// copies in through its own drop box, or use its own records. The probe says what the act answered and whether
// anything of theirs moved; a group judges only the facts its sentence is about.
//
//   GROUPS · ACTS · cases(seed, samples) -> [{ id, group, input, expect }] · selfTest() -> [] when the model holds
export const GROUPS = {
  lookups: "Another library system's title, copy, member, a member's notices, loan or hold reads exactly as one that does not exist: 404.",
  listing: "`GET /titles` lists the caller's own titles, every one of them, and nobody else's.",
  changes: "A change that names another system's copy, member, title or loan -- lending it, lending to them, placing a hold on it or for them, adding a copy of it, checking it in or renewing it -- is refused as not found (404), and nothing of theirs changes.",
  dropbox: "A drop box checks in only its own library system's copies: a scan of another system's copy is acknowledged as `unknown-copy` and changes nothing of theirs.",
  own: "A library system's own records work as before: read, listed, lent, held and checked in through its own drop box.",
};

// Each act, by the group it belongs to.
export const ACTS = {
  lookups: ["read-their-title", "read-their-copy", "read-their-member", "read-their-notices", "read-their-loan", "read-their-hold"],
  listing: ["list-titles"],
  changes: ["borrow-their-copy", "lend-to-their-member", "hold-their-title", "hold-for-their-member", "copy-of-their-title", "return-their-loan", "renew-their-loan"],
  dropbox: ["scan-their-copy"],
  own: ["own-read-copy", "own-read-loan", "own-list", "own-borrow", "own-hold", "own-scan"],
};

// ---- the goal's rule, as a model -----------------------------------------------------------------------------------

const OWN = { "own-read-copy": ["own-read-copy:200"], "own-read-loan": ["own-read-loan:200"], "own-borrow": ["own-borrow:201"], "own-hold": ["own-hold:201"], "own-scan": ["own-scan:returned"] };

const EXPECT = {
  lookups: (input) => ({ has: [`${input.act}:404`] }),
  listing: (input) => ({ has: ["list:theirs:0", `list:mine:${input.mineTitles}`] }),
  changes: (input) => ({ has: [`${input.act}:404`, "theirs:untouched"] }),
  dropbox: () => ({ has: ["scan-their-copy:unknown-copy", "theirs:untouched"] }),
  own: (input) => ({ has: OWN[input.act] ?? [`own-list:${input.mineTitles}`] }),
};

export const expectOf = (group, input) => EXPECT[group](input);

// ---- seeded inputs ------------------------------------------------------------------------------------------------

const streamOf = (seed) => ((st) => () => ((st.s = (st.s * 1664525 + 1013904223) % 4294967296), st.s / 4294967296))({ s: seed >>> 0 || 1 });

const pick = (next, xs) => xs[Math.floor(next() * xs.length)];

const between = (next, lo, hi) => lo + Math.floor(next() * (hi - lo + 1));

const SYSTEMS = ["harbor", "upland", "north-county", "lakeside", "pine-ridge", "riverbend"];

const DAYS = ["2026-03-02", "2026-02-27", "2027-12-31", "2028-02-29"];

const twoSystems = (next) => ((a) => [a, pick(next, SYSTEMS.filter((s) => s !== a))])(pick(next, SYSTEMS));

const inputOf = (next, act) => ((systems) => ({ day: pick(next, DAYS), theirs: systems[0], mine: systems[1], theirTitles: between(next, 1, 3), mineTitles: between(next, 1, 3), act }))(twoSystems(next));

const ORDER = Object.keys(GROUPS);

// Every act of every group once, then the seeded ones, so each act is held whatever the seed.
const everyAct = (next) => ORDER.flatMap((group) => ACTS[group].map((act) => ({ id: `${group}-${act}`, group, input: inputOf(next, act) })));

const seeded = (next, samples) => Array.from({ length: samples }, (_, i) => ((group) => ({ id: `${group}-${i}`, group, input: inputOf(next, pick(next, ACTS[group])) }))(ORDER[i % ORDER.length]));

export const cases = (seed, samples) => ((next) => [...everyAct(next), ...seeded(next, samples)])(streamOf(seed)).map((c) => ({ ...c, expect: expectOf(c.group, c.input) }));

// ---- the model, held to a table written by hand ----------------------------------------------------------------------

const TABLE = [
  ["lookups", { act: "read-their-loan" }, { has: ["read-their-loan:404"] }],
  ["listing", { act: "list-titles", mineTitles: 2 }, { has: ["list:theirs:0", "list:mine:2"] }],
  ["changes", { act: "borrow-their-copy" }, { has: ["borrow-their-copy:404", "theirs:untouched"] }],
  ["dropbox", { act: "scan-their-copy" }, { has: ["scan-their-copy:unknown-copy", "theirs:untouched"] }],
  ["own", { act: "own-borrow" }, { has: ["own-borrow:201"] }],
  ["own", { act: "own-list", mineTitles: 3 }, { has: ["own-list:3"] }],
];

const actFindings = () => ORDER.flatMap((g) => ACTS[g]).filter((act, i, all) => all.indexOf(act) !== i).map((act) => `the act ${act} is in two groups`);

export const selfTest = () => [...TABLE.filter(([g, input, want]) => JSON.stringify(expectOf(g, input)) !== JSON.stringify(want)).map(([g, input]) => `${g} ${input.act} is expected to come to ${JSON.stringify(expectOf(g, input))}`), ...actFindings()];
