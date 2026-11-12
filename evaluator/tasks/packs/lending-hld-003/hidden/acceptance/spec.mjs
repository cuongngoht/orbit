// THE HIDDEN CHECKS of ORBIT-HLD-003: renewing a loan -- held to a reference model written from the goal, never from the
// fixture's code. Each check lends one copy and then takes steps in order: renewals on given days, a hold placed on its
// title or another title by another member, the loan brought back. The model replays the steps under the goal's rules;
// the probe plays them through the target's API and says what each renewal answered.
//
// Where the goal names several reasons that hold at once (a loan back AND overdue), it does not say which one a refusal
// names, so such a refusal is held to its 409 and to the due date it kept -- never to a word.
//
//   GROUPS · cases(seed, samples) -> [{ id, group, input, expect }] · selfTest() -> [] when the model holds · replay(input)
export const GROUPS = {
  extends: "A renewal answers 200 with the loan: its due date moved on by the title's loan period -- 21 days for a book, 7 for a DVD -- counted from the due date it had, never from the day it was renewed, and `renewals` saying how many times it has been renewed.",
  twice: "A loan can be renewed twice; a third renewal answers 409 with `renewal-limit` and leaves the due date as it was.",
  overdue: "A loan past its due date is not renewed: 409 with `overdue`, the due date left as it was; on the due date itself it still is.",
  waiting: "While somebody is waiting for the loan's title, it is not renewed: 409 with `hold-waiting`, the due date left as it was; a hold on another title does not stop it.",
  returned: "A loan that has come back is not renewed: 409 with `returned`, the due date left as it was.",
};

// ---- the goal's rules, as a model ---------------------------------------------------------------------------------

const DAY_MS = 86400000;

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const LOAN_DAYS = { book: 21, dvd: 7 };

const RENEWALS = 2;

const startOf = (input) => ({ due: addDays(input.out, LOAN_DAYS[input.format]), renewals: 0, returned: false, waiting: false, answers: [] });

// Every reason the goal gives that holds for a renewal on a day.
const reasonsOf = (s, day) => [s.returned && "returned", day > s.due && "overdue", s.renewals >= RENEWALS && "renewal-limit", s.waiting && "hold-waiting"].filter(Boolean);

const renewedOn = (s, format) => ((due) => ({ ...s, due, renewals: s.renewals + 1, answers: [...s.answers, { status: 200, due, renewals: s.renewals + 1 }] }))(addDays(s.due, LOAN_DAYS[format]));

const STEPS = {
  hold: (s) => ({ ...s, waiting: true }),
  "hold-other": (s) => s,
  return: (s) => ({ ...s, returned: true }),
  renew: (s, step, format) => ((why) => (why.length ? { ...s, answers: [...s.answers, { status: 409, why }] } : renewedOn(s, format)))(reasonsOf(s, step.day)),
};

// What the loan comes to after the input's steps, and what each renewal answered.
export const replay = (input) => input.steps.reduce((s, step) => STEPS[step.do](s, step, input.format), startOf(input));

// What a renewal answered, as ids: its status, the reason a refusal names (when only one holds) and the due date it kept
// -- and for a renewal that went through, its new due date and count only where the group is about them (`extends`).
const idsOf = (a, k, dated) => (a.status === 200 ? [`renew:${k}:200`, ...(dated ? [`renew:${k}:due:${a.due}`, `renew:${k}:renewals:${a.renewals}`] : [])] : [`renew:${k}:409`, `renew:${k}:kept-due`, ...(a.why.length === 1 ? [`renew:${k}:409:${a.why[0]}`] : [])]);

const expected = (c) => ({ has: replay(c.input).answers.flatMap((a, k) => idsOf(a, k, c.group === "extends")) });

// ---- seeded inputs ------------------------------------------------------------------------------------------------

const streamOf = (seed) => ((st) => () => ((st.s = (st.s * 1664525 + 1013904223) % 4294967296), st.s / 4294967296))({ s: seed >>> 0 || 1 });

const pick = (next, xs) => xs[Math.floor(next() * xs.length)];

const between = (next, lo, hi) => lo + Math.floor(next() * (hi - lo + 1));

const OUT_DAYS = ["2026-03-02", "2026-02-20", "2028-02-15", "2026-12-20", "2027-06-25"];

// A plan's steps with their days: each renewal `offset` days from the due date the loan has by then (0 is on it), or
// `early` days before the due date it was lent with -- in time whichever way a renewal is counted.
const dayOf = (out, format, steps, p) => (p.early === undefined ? addDays(replay({ out, format, steps }).due, p.offset) : addDays(startOf({ out, format }).due, -p.early));

const dated = (out, format, plan) => plan.reduce((steps, p) => [...steps, p.do === "renew" ? { do: "renew", day: dayOf(out, format, steps, p) } : { do: p.do }], []);

const inTime = (next, format) => ({ do: "renew", offset: -between(next, 0, LOAN_DAYS[format]) });

const loanWith = (next, plan) => ((out, format) => ({ out, format, steps: dated(out, format, plan(format)) }))(pick(next, OUT_DAYS), pick(next, ["book", "dvd"]));

const GENERATORS = {
  extends: (next) => loanWith(next, (f) => Array.from({ length: between(next, 1, 2) }, () => inTime(next, f))),
  twice: (next) => loanWith(next, (f) => Array.from({ length: between(next, 3, 4) }, () => between(next, 0, LOAN_DAYS[f])).sort((a, b) => b - a).map((early) => ({ do: "renew", early }))),
  overdue: (next) => loanWith(next, (f) => [...(next() < 0.5 ? [{ do: "renew", offset: 0 }] : []), { do: "renew", offset: between(next, 1, 12) }]),
  waiting: (next) => loanWith(next, (f) => [{ do: pick(next, ["hold", "hold", "hold-other"]) }, inTime(next, f)]),
  returned: (next) => loanWith(next, (f) => [{ do: "return" }, inTime(next, f)]),
};

const ORDER = Object.keys(GROUPS);

const fixed = (id, group, out, format, plan) => ({ id, group, input: { out, format, steps: dated(out, format, plan) } });

const renewAt = (offset) => ({ do: "renew", offset });

// The boundaries every run holds, whatever its seed.
const FIXED = [
  fixed("extends-book-early", "extends", "2026-03-02", "book", [renewAt(-10)]),
  fixed("extends-dvd-twice", "extends", "2026-03-02", "dvd", [renewAt(-3), renewAt(-1)]),
  fixed("extends-end-of-year", "extends", "2026-12-20", "book", [renewAt(-2)]),
  fixed("extends-leap-february", "extends", "2028-02-15", "dvd", [renewAt(0)]),
  fixed("twice-third-refused", "twice", "2026-03-02", "book", [renewAt(0), renewAt(0), renewAt(0)]),
  fixed("twice-before-the-first-due-date", "twice", "2026-03-02", "dvd", [{ do: "renew", early: 6 }, { do: "renew", early: 2 }, { do: "renew", early: 0 }, { do: "renew", early: 0 }]),
  fixed("overdue-on-the-due-day", "overdue", "2026-03-02", "dvd", [renewAt(0)]),
  fixed("overdue-the-day-after", "overdue", "2026-03-02", "dvd", [renewAt(1)]),
  fixed("waiting-same-title", "waiting", "2026-03-02", "book", [{ do: "hold" }, renewAt(-5)]),
  fixed("waiting-other-title", "waiting", "2026-03-02", "book", [{ do: "hold-other" }, renewAt(-5)]),
  fixed("returned-in-time", "returned", "2026-03-02", "book", [{ do: "return" }, renewAt(-5)]),
  fixed("returned-and-overdue", "returned", "2026-03-02", "dvd", [{ do: "return" }, renewAt(3)]),
];

const seeded = (seed, samples) => ((next) => Array.from({ length: samples }, (_, i) => ((group) => ({ id: `${group}-${i}`, group, input: GENERATORS[group](next) }))(ORDER[i % ORDER.length])))(streamOf(seed));

export const cases = (seed, samples) => [...FIXED, ...seeded(seed, samples)].map((c) => ({ ...c, expect: expected(c) }));

// ---- the model, held to a table written by hand ----------------------------------------------------------------------

const TABLE = [
  [{ out: "2026-03-02", format: "book", steps: [{ do: "renew", day: "2026-03-13" }] }, [{ status: 200, due: "2026-04-13", renewals: 1 }]],
  [{ out: "2026-03-02", format: "dvd", steps: [{ do: "renew", day: "2026-03-06" }, { do: "renew", day: "2026-03-15" }] }, [{ status: 200, due: "2026-03-16", renewals: 1 }, { status: 200, due: "2026-03-23", renewals: 2 }]],
  [{ out: "2026-03-02", format: "book", steps: [{ do: "renew", day: "2026-03-23" }, { do: "renew", day: "2026-04-13" }, { do: "renew", day: "2026-05-04" }] }, [{ status: 200, due: "2026-04-13", renewals: 1 }, { status: 200, due: "2026-05-04", renewals: 2 }, { status: 409, why: ["renewal-limit"] }]],
  [{ out: "2026-03-02", format: "dvd", steps: [{ do: "renew", day: "2026-03-10" }] }, [{ status: 409, why: ["overdue"] }]],
  [{ out: "2026-03-02", format: "book", steps: [{ do: "hold" }, { do: "renew", day: "2026-03-18" }] }, [{ status: 409, why: ["hold-waiting"] }]],
  [{ out: "2026-03-02", format: "book", steps: [{ do: "hold-other" }, { do: "renew", day: "2026-03-18" }] }, [{ status: 200, due: "2026-04-13", renewals: 1 }]],
  [{ out: "2026-03-02", format: "dvd", steps: [{ do: "return" }, { do: "renew", day: "2026-03-12" }] }, [{ status: 409, why: ["returned", "overdue"] }]],
  [{ out: "2026-12-20", format: "book", steps: [{ do: "renew", day: "2027-01-08" }] }, [{ status: 200, due: "2027-01-31", renewals: 1 }]],
];

export const selfTest = () => TABLE.filter(([input, want]) => JSON.stringify(replay(input).answers) !== JSON.stringify(want)).map(([input, want]) => `${JSON.stringify(input.steps)} answers ${JSON.stringify(replay(input).answers)}, and the goal says ${JSON.stringify(want)}`);
