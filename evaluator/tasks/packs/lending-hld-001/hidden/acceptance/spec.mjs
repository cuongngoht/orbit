// THE HIDDEN CHECKS of ORBIT-HLD-001: fines for late returns, and what a member owes -- held to a reference model written
// from the goal, never from the fixture's code. Each check is one member's loans: each lent on a day, then brought back
// so many days before or after the due date the service gave it, at the desk or through the drop box. The probe reads
// back each loan's fine and what the member owes; a group judges only the facts its sentence is about.
//
//   GROUPS · cases(seed, samples) -> [{ id, group, input, expect }] · selfTest() -> [] when the model holds · fineOf(loan)
export const GROUPS = {
  "on-time": "A loan brought back on or before its due date is fined nothing, and its member owes nothing for it.",
  "per-day": "A loan brought back late is fined for every day after its due date: 25 cents a day for a book, 100 cents a day for a DVD, said in `fineCents` on the loan.",
  capped: "A fine is never more than what the copy would cost to replace (its `replacementCents`).",
  balance: "`GET /members/:id` says in `balanceCents` every fine the member was charged, added up.",
  dropbox: "A late copy checked in through the drop box is fined and charged exactly as one checked in at the desk.",
};

// ---- the goal's rule, as a model -----------------------------------------------------------------------------------

const DAILY = { book: 25, dvd: 100 };

export const fineOf = (loan) => Math.min(Math.max(0, loan.lateBy) * DAILY[loan.format], loan.replacementCents);

const owedOf = (loans) => loans.reduce((n, l) => n + fineOf(l), 0);

const finesSaid = (loans) => loans.map((l, i) => `fine:${i}:${fineOf(l)}`);

const EXPECT = {
  "on-time": (input) => ({ has: [...finesSaid(input.loans), `balance:${owedOf(input.loans)}`] }),
  "per-day": (input) => ({ has: finesSaid(input.loans) }),
  capped: (input) => ({ has: finesSaid(input.loans) }),
  balance: (input) => ({ has: [`balance:${owedOf(input.loans)}`] }),
  dropbox: (input) => ({ has: [...finesSaid(input.loans), `balance:${owedOf(input.loans)}`] }),
};

// ---- seeded inputs ------------------------------------------------------------------------------------------------

const streamOf = (seed) => ((st) => () => ((st.s = (st.s * 1664525 + 1013904223) % 4294967296), st.s / 4294967296))({ s: seed >>> 0 || 1 });

const pick = (next, xs) => xs[Math.floor(next() * xs.length)];

const between = (next, lo, hi) => lo + Math.floor(next() * (hi - lo + 1));

// The days loans go out on: across the end of February, of a leap February, of a year, of a month of 30 days.
const OUT_DAYS = ["2026-03-02", "2026-02-20", "2028-02-15", "2026-12-20", "2027-06-25"];

const FORMATS = ["book", "dvd"];

const loanOf = (next, lateBy, replacementCents) => ({ format: pick(next, FORMATS), replacementCents, lateBy });

// Late, and never long enough to reach the replacement cost.
const uncapped = (next) => ((l) => ({ ...l, replacementCents: Math.max(l.replacementCents, l.lateBy * DAILY[l.format] + between(next, 1, 900)) }))(loanOf(next, between(next, 1, 45), 5000));

// Late enough that the replacement cost caps the fine -- now and then exactly at it.
const overCap = (next) => ((l) => ({ ...l, lateBy: Math.ceil(l.replacementCents / DAILY[l.format]) + between(next, 0, 1) * between(next, 1, 30) }))(loanOf(next, 0, between(next, 1, 1500)));

const GENERATORS = {
  "on-time": (next) => ({ out: pick(next, OUT_DAYS), via: pick(next, ["desk", "dropbox"]), loans: Array.from({ length: between(next, 1, 3) }, () => loanOf(next, between(next, -7, 0), between(next, 100, 5000))) }),
  "per-day": (next) => ({ out: pick(next, OUT_DAYS), via: "desk", loans: [uncapped(next)] }),
  capped: (next) => ({ out: pick(next, OUT_DAYS), via: "desk", loans: [overCap(next)] }),
  balance: (next) => ({ out: pick(next, OUT_DAYS), via: "desk", loans: Array.from({ length: between(next, 2, 4) }, () => loanOf(next, between(next, -5, 60), between(next, 300, 3000))) }),
  dropbox: (next) => ({ out: pick(next, OUT_DAYS), via: "dropbox", loans: Array.from({ length: between(next, 1, 2) }, () => uncapped(next)) }),
};

const ORDER = Object.keys(GROUPS);

// The boundaries every run holds, whatever its seed.
const FIXED = [
  { id: "on-time-due-day", group: "on-time", input: { out: "2026-03-02", via: "desk", loans: [{ format: "book", replacementCents: 2000, lateBy: 0 }, { format: "dvd", replacementCents: 2500, lateBy: 0 }] } },
  { id: "on-time-early", group: "on-time", input: { out: "2026-12-20", via: "dropbox", loans: [{ format: "book", replacementCents: 2000, lateBy: -21 }] } },
  { id: "per-day-one-book", group: "per-day", input: { out: "2026-02-20", via: "desk", loans: [{ format: "book", replacementCents: 2000, lateBy: 1 }] } },
  { id: "per-day-one-dvd", group: "per-day", input: { out: "2028-02-15", via: "desk", loans: [{ format: "dvd", replacementCents: 2500, lateBy: 1 }] } },
  { id: "per-day-three-books", group: "per-day", input: { out: "2026-03-02", via: "desk", loans: [{ format: "book", replacementCents: 2000, lateBy: 3 }] } },
  { id: "capped-exactly", group: "capped", input: { out: "2026-03-02", via: "desk", loans: [{ format: "book", replacementCents: 100, lateBy: 4 }] } },
  { id: "capped-below-a-day", group: "capped", input: { out: "2026-03-02", via: "desk", loans: [{ format: "book", replacementCents: 99, lateBy: 4 }] } },
  { id: "capped-long-late", group: "capped", input: { out: "2026-03-02", via: "desk", loans: [{ format: "dvd", replacementCents: 1250, lateBy: 52 }] } },
  { id: "capped-free-copy", group: "capped", input: { out: "2026-03-02", via: "desk", loans: [{ format: "book", replacementCents: 0, lateBy: 10 }] } },
  { id: "balance-mixed", group: "balance", input: { out: "2026-03-02", via: "desk", loans: [{ format: "book", replacementCents: 2000, lateBy: 3 }, { format: "book", replacementCents: 2000, lateBy: -2 }, { format: "dvd", replacementCents: 2500, lateBy: 2 }] } },
  { id: "dropbox-two-days", group: "dropbox", input: { out: "2026-03-02", via: "dropbox", loans: [{ format: "book", replacementCents: 2000, lateBy: 2 }] } },
  { id: "dropbox-capped", group: "dropbox", input: { out: "2026-03-02", via: "dropbox", loans: [{ format: "dvd", replacementCents: 300, lateBy: 9 }] } },
];

const seeded = (seed, samples) => ((next) => Array.from({ length: samples }, (_, i) => ((group) => ({ id: `${group}-${i}`, group, input: GENERATORS[group](next) }))(ORDER[i % ORDER.length])))(streamOf(seed));

export const cases = (seed, samples) => [...FIXED, ...seeded(seed, samples)].map((c) => ({ ...c, expect: EXPECT[c.group](c.input) }));

// ---- the model, held to a table written by hand ----------------------------------------------------------------------

const TABLE = [
  [{ format: "book", replacementCents: 2000, lateBy: 0 }, 0],
  [{ format: "book", replacementCents: 2000, lateBy: -4 }, 0],
  [{ format: "book", replacementCents: 2000, lateBy: 1 }, 25],
  [{ format: "book", replacementCents: 2000, lateBy: 3 }, 75],
  [{ format: "dvd", replacementCents: 2500, lateBy: 4 }, 400],
  [{ format: "dvd", replacementCents: 1250, lateBy: 52 }, 1250],
  [{ format: "book", replacementCents: 100, lateBy: 4 }, 100],
  [{ format: "book", replacementCents: 99, lateBy: 4 }, 99],
  [{ format: "book", replacementCents: 0, lateBy: 10 }, 0],
];

const tableFindings = () => TABLE.filter(([l, want]) => fineOf(l) !== want).map(([l, want]) => `${JSON.stringify(l)} is fined ${fineOf(l)}, and the goal says ${want}`);

export const selfTest = () => [...tableFindings(), ...(owedOf(TABLE.map(([l]) => l)) === 1949 ? [] : [`the table's fines add up to ${owedOf(TABLE.map(([l]) => l))}, and by hand to 1949`])];
