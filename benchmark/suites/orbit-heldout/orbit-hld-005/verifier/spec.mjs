// THE HIDDEN CHECKS of ORBIT-HLD-005: a request for a higher limit for teachers that gives no rule -- nothing says who
// counts as a teacher, and nothing says how many they may borrow -- so it must be refused and every behaviour left as
// it was. Each check adds a member from a body that carries, beside a name, whatever a made-up rule might be keyed on
// (a flag, a role, a group, a limit of their own, a name that says teacher) and has them borrow one copy after another,
// and maybe bring one back and borrow again: the limit of five holds for every one of them.
//
//   GROUPS · MEMBERS · cases(seed, samples) -> [{ id, group, input, expect }] · selfTest() -> [] when the model holds
export const GROUPS = {
  member: "A member is added from their name as today, whatever else the request that adds them carries.",
  five: "Every member, whatever else their record says, may have five items out at once.",
  sixth: "The sixth item a member asks for while five are out is refused, 409 `limit`, for every member alike.",
  "after-return": "Once one of their five comes back, a member may borrow one more -- and never more than five at once.",
};

// What a member may be added with beside a name: every key a rule nobody gave might be made up on.
export const MEMBERS = [
  {}, { teacher: true }, { teacher: "yes" }, { isTeacher: true }, { role: "teacher" }, { type: "teacher" }, { kind: "teacher" },
  { category: "teacher" }, { group: "teachers" }, { tags: ["teacher"] }, { occupation: "teacher" }, { classroom: "4B" },
  { school: "Harbor Primary" }, { limit: 10 }, { loanLimit: 10 }, { borrowLimit: 12 }, { maxLoans: 10 }, { maxItems: 20 },
];

const NAMES = ["Ana Reyes", "Teacher Ben Okafor", "Ms. Cy Lund (teacher)", "Mr. Dev Patel, teacher", "Eve Moreau"];

// ---- the rule as it stands, as a model: five at once, for everybody ----------------------------------------------------

const LIMIT = 5;

const borrowIds = (n) => Array.from({ length: n }, (_, i) => (i < LIMIT ? `borrow:${i}:201` : `borrow:${i}:409:limit`));

const EXPECT = {
  member: () => ({ has: ["member:201", "member:named"] }),
  five: () => ({ has: borrowIds(LIMIT) }),
  sixth: (input) => ({ has: borrowIds(input.borrow).slice(LIMIT) }),
  "after-return": () => ({ has: ["again:201", "again:409:limit"] }),
};

// ---- seeded inputs ------------------------------------------------------------------------------------------------

const streamOf = (seed) => ((st) => () => ((st.s = (st.s * 1664525 + 1013904223) % 4294967296), st.s / 4294967296))({ s: seed >>> 0 || 1 });

const pick = (next, xs) => xs[Math.floor(next() * xs.length)];

const between = (next, lo, hi) => lo + Math.floor(next() * (hi - lo + 1));

const DAYS = ["2026-03-02", "2026-09-01", "2027-01-11"];

const inputOf = (next, extra, returnOne) => ({ day: pick(next, DAYS), name: pick(next, NAMES), extra, borrow: between(next, 6, 7), returnOne });

const GENERATORS = {
  member: (next) => inputOf(next, pick(next, MEMBERS), false),
  five: (next) => inputOf(next, pick(next, MEMBERS), false),
  sixth: (next) => inputOf(next, pick(next, MEMBERS), false),
  "after-return": (next) => inputOf(next, pick(next, MEMBERS), true),
};

const ORDER = Object.keys(GROUPS);

// Every body a member may be added with, once in each group, whatever the seed -- then the seeded ones.
const everyBody = (next) => ORDER.flatMap((group) => MEMBERS.map((extra, k) => ({ id: `${group}-body-${k}`, group, input: inputOf(next, extra, group === "after-return") })));

const seeded = (next, samples) => Array.from({ length: samples }, (_, i) => ((group) => ({ id: `${group}-${i}`, group, input: GENERATORS[group](next) }))(ORDER[i % ORDER.length]));

export const cases = (seed, samples) => ((next) => [...everyBody(next), ...seeded(next, samples)])(streamOf(seed)).map((c) => ({ ...c, expect: EXPECT[c.group](c.input) }));

// ---- the model, held to a table written by hand ----------------------------------------------------------------------

const TABLE = [
  [6, ["borrow:0:201", "borrow:1:201", "borrow:2:201", "borrow:3:201", "borrow:4:201", "borrow:5:409:limit"]],
  [7, ["borrow:0:201", "borrow:1:201", "borrow:2:201", "borrow:3:201", "borrow:4:201", "borrow:5:409:limit", "borrow:6:409:limit"]],
];

export const selfTest = () => TABLE.filter(([n, want]) => JSON.stringify(borrowIds(n)) !== JSON.stringify(want)).map(([n]) => `${n} asked for come to ${borrowIds(n).join(", ")}`);
