// THE SPEC of ORBIT-MEM-001: what ONE session is, written from its contract and never from its code. Kept beside the
// probe and handed to no runner; the controller imports a FROZEN copy of it, and it never imports the subject. Every
// check is an input and an expectation over the ids the subject reports: `has` (must be among them), `lacks` (must not
// be), `exactly` (the whole set).
//
// The contract (AGENTS.md, and the header of src/memory/session.mjs): two independent sessions earn a lesson and one is
// an observation, and independence is one machine on one UTC day -- three runs in one sitting are one session, another
// UTC day or another machine is another. Where a host NAMES its session, two named observations are one session
// exactly when the names are equal, so two people on one laptop, or one session across midnight, are counted right;
// two unnamed ones keep the machine-and-day rule; and a named and an unnamed one on the same machine and day are never
// independent, whichever came first. Both directions are checked -- what must be one session and what must be two -- so
// a rule that merges everything fails as surely as one that merges nothing.
//
// Times are ISO-8601 in UTC with a Z, as the engine writes them; seeded ones crowd the edges of a day.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-MEM-001";

export const GROUPS = {
  "utc-day": "a run's day is the UTC date of its time -- never an hour or a minute of it",
  "one-sitting": "runs on one machine on one UTC day are one session, however many hours apart",
  "another-day": "another UTC day is another session, even a minute across midnight",
  "another-machine": "another machine is another session, even at the same moment",
  "named-named": "two observations a host named are one session exactly when the names are equal, whatever machine or day",
  "unnamed-unnamed": "two observations no host named are one session exactly when machine and UTC day are equal",
  "named-then-unnamed": "an unnamed observation after a named one on the same machine and UTC day is the same session",
  "unnamed-then-named": "a named observation after an unnamed one on the same machine and UTC day is the same session",
  "mixed-apart": "a named and an unnamed observation on another machine or another UTC day are independent",
  "known-among": "an observation is already counted when it is the same session as any one counted before it, and new otherwise",
  "seeded-day": "seeded times near the edges of a day: the day is the UTC date",
  "seeded-count": "seeded runs on two machines over three days: one session per machine and UTC day",
  "seeded-pair": "seeded pairs, named or not: one session exactly as the contract says",
  "seeded-among": "seeded lists of counted observations: known exactly when one of them is the same session",
};

// ---- the reference model: the contract, as data -------------------------------------------------------------------

export const utcDay = (at) => new Date(at).toISOString().slice(0, 10);

const sitting = (o) => `${o.host}|${utcDay(o.at)}`;

const named = (o) => typeof o.session === "string" && o.session.length > 0;

export const sameSession = (a, b) => (named(a) && named(b) ? a.session === b.session : sitting(a) === sitting(b));

export const sessionsIn = (runs) => new Set(runs.map(sitting)).size;

const MODEL = {
  day: (i) => [`day:${utcDay(i.run.at)}`],
  same: (i) => [sitting(i.a) === sitting(i.b) ? "SAME" : "DIFFERENT"],
  count: (i) => [`sessions:${sessionsIn(i.runs)}`],
  pair: (i) => [sameSession(i.a, i.b) ? "SAME" : "INDEPENDENT"],
  among: (i) => [i.prior.some((p) => sameSession(p, i.seen)) ? "KNOWN" : "NEW"],
};

// What the contract owes for one input: always the whole answer.
export const owed = (input) => ({ exactly: MODEL[input.call](input) });

// ---- what the inputs are made of ------------------------------------------------------------------------------------

const A = "laptop-a";
const B = "laptop-b";
const NAME_1 = "claude:5f0e3c1a9b2d4e6f";
const NAME_2 = "claude:0a1b2c3d4e5f6071";
const D1 = "2026-10-30";
const D2 = "2026-10-31";
const D3 = "2026-11-01";

const ran = (host, date, time) => ({ host, at: `${date}T${time}Z` });

const hooked = (host, date, time, session) => ({ ...ran(host, date, time), session });

const row = (group, input, ...ids) => ({ group, input, expect: { exactly: ids } });

const day = (group, run, id) => row(group, { call: "day", run }, id);
const same = (group, a, b, id) => row(group, { call: "same", a, b }, id);
const count = (group, runs, n) => row(group, { call: "count", runs }, `sessions:${n}`);
const pair = (group, a, b, id) => row(group, { call: "pair", a, b }, id);
const among = (group, prior, seen, id) => row(group, { call: "among", prior, seen }, id);

// ---- the checks written by hand, each from a sentence of the contract ------------------------------------------------

const DAYS = [
  day("utc-day", ran(A, D2, "23:59:59.999"), "day:2026-10-31"),
  day("utc-day", ran(A, D3, "00:00:00.000"), "day:2026-11-01"),
  day("utc-day", ran(A, D2, "00:00:00.000"), "day:2026-10-31"),
  day("utc-day", ran(B, "2026-12-31", "13:45:10.250"), "day:2026-12-31"),
  day("utc-day", ran(B, "2027-01-01", "00:00:00"), "day:2027-01-01"),
];

const SITTINGS = [
  same("one-sitting", ran(A, D2, "08:00:00.000"), ran(A, D2, "21:30:00.000"), "SAME"),
  count("one-sitting", [ran(A, D2, "09:01:00.000"), ran(A, D2, "09:02:00.000"), ran(A, D2, "17:45:00.000")], 1),
  count("one-sitting", [ran(A, D2, "00:00:00.000"), ran(A, D2, "23:59:59.999")], 1),
  same("another-day", ran(A, D2, "23:59:00.000"), ran(A, D3, "00:01:00.000"), "DIFFERENT"),
  count("another-day", [ran(A, D1, "10:00:00.000"), ran(A, D2, "10:00:00.000")], 2),
  count("another-day", [ran(A, D2, "23:59:59.999"), ran(A, D3, "00:00:00.000")], 2),
  same("another-machine", ran(A, D2, "10:00:00.000"), ran(B, D2, "10:00:00.000"), "DIFFERENT"),
  count("another-machine", [ran(A, D2, "10:00:00.000"), ran(B, D2, "10:00:00.000"), ran(A, D2, "11:00:00.000"), ran(B, D2, "12:00:00.000")], 2),
  count("another-machine", [ran(A, D1, "09:00:00.000"), ran(B, D1, "09:00:00.000"), ran(A, D2, "09:00:00.000"), ran(B, D2, "09:00:00.000"), ran(A, D2, "18:00:00.000")], 4),
  count("another-machine", [], 0),
];

const PAIRS = [
  pair("named-named", hooked(A, D2, "09:00:00.000", NAME_1), hooked(A, D2, "15:00:00.000", NAME_2), "INDEPENDENT"),
  pair("named-named", hooked(A, D2, "23:50:00.000", NAME_1), hooked(A, D3, "00:20:00.000", NAME_1), "SAME"),
  pair("named-named", hooked(A, D2, "10:00:00.000", NAME_1), hooked(B, D2, "10:05:00.000", NAME_1), "SAME"),
  pair("named-named", hooked(A, D2, "09:00:00.000", NAME_1), hooked(A, D2, "09:00:00.000", NAME_1), "SAME"),
  pair("unnamed-unnamed", ran(A, D2, "09:00:00.000"), ran(A, D2, "18:00:00.000"), "SAME"),
  pair("unnamed-unnamed", ran(A, D1, "12:00:00.000"), ran(A, D2, "12:00:00.000"), "INDEPENDENT"),
  pair("unnamed-unnamed", ran(A, D2, "12:00:00.000"), ran(B, D2, "12:00:00.000"), "INDEPENDENT"),
  pair("unnamed-unnamed", ran(A, D2, "23:59:59.999"), ran(A, D3, "00:00:00.000"), "INDEPENDENT"),
  pair("named-then-unnamed", hooked(A, D2, "09:00:00.000", NAME_1), ran(A, D2, "17:00:00.000"), "SAME"),
  pair("named-then-unnamed", hooked(A, D2, "23:59:59.999", NAME_1), ran(A, D2, "00:00:00.000"), "SAME"),
  pair("named-then-unnamed", hooked(B, D1, "06:30:00.000", NAME_2), ran(B, D1, "06:31:00.000"), "SAME"),
  pair("unnamed-then-named", ran(A, D2, "09:00:00.000"), hooked(A, D2, "17:00:00.000", NAME_1), "SAME"),
  pair("unnamed-then-named", ran(B, D3, "00:00:00.000"), hooked(B, D3, "23:59:59.999", NAME_2), "SAME"),
  pair("mixed-apart", hooked(A, D1, "12:00:00.000", NAME_1), ran(A, D2, "12:00:00.000"), "INDEPENDENT"),
  pair("mixed-apart", hooked(A, D2, "12:00:00.000", NAME_1), ran(B, D2, "12:00:00.000"), "INDEPENDENT"),
  pair("mixed-apart", ran(A, D1, "12:00:00.000"), hooked(A, D2, "12:00:00.000", NAME_1), "INDEPENDENT"),
  pair("mixed-apart", ran(B, D2, "12:00:00.000"), hooked(A, D2, "12:00:00.000", NAME_1), "INDEPENDENT"),
];

const AMONG = [
  among("known-among", [], ran(A, D2, "12:00:00.000"), "NEW"),
  among("known-among", [ran(A, D1, "12:00:00.000"), ran(B, D2, "12:00:00.000")], ran(A, D2, "12:00:00.000"), "NEW"),
  among("known-among", [ran(A, D1, "12:00:00.000"), ran(B, D2, "12:00:00.000"), ran(A, D2, "08:00:00.000")], ran(A, D2, "20:00:00.000"), "KNOWN"),
  among("known-among", [hooked(A, D2, "09:00:00.000", NAME_1)], hooked(A, D2, "10:00:00.000", NAME_2), "NEW"),
  among("known-among", [hooked(A, D2, "09:00:00.000", NAME_1), hooked(B, D2, "09:00:00.000", NAME_2)], hooked(A, D3, "01:00:00.000", NAME_2), "KNOWN"),
  among("named-then-unnamed", [hooked(A, D2, "09:00:00.000", NAME_1), hooked(A, D2, "10:00:00.000", NAME_2)], ran(A, D2, "11:00:00.000"), "KNOWN"),
  among("unnamed-then-named", [ran(B, D1, "09:00:00.000"), ran(A, D2, "09:00:00.000")], hooked(A, D2, "10:00:00.000", NAME_2), "KNOWN"),
  among("mixed-apart", [hooked(A, D1, "23:00:00.000", NAME_1), ran(B, D2, "01:00:00.000")], ran(A, D2, "01:00:00.000"), "NEW"),
];

export const STRUCTURE = [...DAYS, ...SITTINGS, ...PAIRS, ...AMONG];

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

const HOSTS = [A, B];
const DATES = [D1, D2, D3];
const NAMES = [NAME_1, NAME_2, "agy:77e1d0c2b3a49586"];

// The edges of a day weigh more than its middle: midnight is where a day rule goes wrong.
const EDGES = [0, 1, 999, 3600000, 43200000, 86340000, 86399000, 86399999];

const msOfDay = (r) => (r() < 0.4 ? pick(r, EDGES) : Math.floor(r() * 86400000));

const onDate = (date, ms) => new Date(Date.parse(`${date}T00:00:00.000Z`) + ms).toISOString();

const seededRun = (r) => ({ host: pick(r, HOSTS), at: onDate(pick(r, DATES), msOfDay(r)) });

const withName = (r, o, near) => (r() < 0.5 ? { ...o, session: near?.session && r() < 0.6 ? near.session : pick(r, NAMES) } : o);

const seededObs = (r) => withName(r, seededRun(r), null);

// An observation close to another: often its machine, often its day, sometimes its name.
const nearRun = (r, o) => ({ host: r() < 0.7 ? o.host : pick(r, HOSTS), at: r() < 0.7 ? onDate(o.at.slice(0, 10), msOfDay(r)) : onDate(pick(r, DATES), msOfDay(r)) });

const nearObs = (r, o) => withName(r, nearRun(r, o), o);

const seeded = (group, input) => ({ group, input, expect: owed(input) });

const seededPair = (r) => ((a) => seeded("seeded-pair", { call: "pair", a, b: nearObs(r, a) }))(seededObs(r));

const seededAmong = (r) => ((prior) => seeded("seeded-among", { call: "among", prior, seen: r() < 0.4 ? nearObs(r, pick(r, prior)) : seededObs(r) }))(Array.from({ length: 1 + Math.floor(r() * 3) }, () => seededObs(r)));

const seededCount = (r) => seeded("seeded-count", { call: "count", runs: Array.from({ length: 1 + Math.floor(r() * 7) }, () => seededRun(r)) });

const seededDay = (r) => seeded("seeded-day", { call: "day", run: seededRun(r) });

const times = (n, make, r) => Array.from({ length: n }, () => make(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const n = Math.max(8, Math.floor(samples / 3));
  return numbered([...STRUCTURE, ...times(n, seededPair, r), ...times(n, seededAmong, r), ...times(n, seededCount, r), ...times(Math.ceil(n / 2), seededDay, r)]);
}

// ---- the reference model, held to the table written by hand ---------------------------------------------------------

const agrees = (c) => JSON.stringify(owed(c.input)) === JSON.stringify(c.expect);

export const selfTest = () => STRUCTURE.filter((c) => !agrees(c)).map((c) => `the reference model disagrees with the contract on a ${c.group} check: ${JSON.stringify(c.input)}`);
