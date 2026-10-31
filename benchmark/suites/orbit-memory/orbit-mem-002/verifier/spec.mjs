// THE SPEC of ORBIT-MEM-002: how many INDEPENDENT sessions back a record, and what that makes its confidence -- written
// from its contract and never from its code. Kept beside the probe and handed to no runner; the controller imports a
// FROZEN copy of it, and it never imports the subject. Every check is an input and an expectation over the ids the
// subject reports: `has` (must be among them), `lacks` (must not be), `exactly` (the whole set).
//
// The contract (the header of src/memory/support.mjs, beside src/memory/session.mjs's definition of a session):
// CONFIDENCE is derived, never carried -- two or more independent sessions and nothing against is `certain`, anything
// else is `possible`. SESSIONS are a set, not a counter beside the last one seen, so A, B, A is two sessions and never
// three; a supporting session and a contradicting one are counted in their own lists; and whether an observation is a
// session already counted is session.mjs's rule: two named observations by their names, two unnamed ones by machine
// and UTC day, and a named and an unnamed one on the same machine and day never independent.
//
// Every sequence starts from a record with no support, and stays well inside the number of sessions a record keeps.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-MEM-002";

export const GROUPS = {
  "rerun-is-one": "the same session seen again adds nothing: a rerun is never a second session",
  "a-b-a": "A, B, A is two sessions and never three, however often the two alternate",
  "two-sessions-certain": "two independent sessions and nothing against is certain",
  "one-session-possible": "one session, however many observations it made, is possible -- and so is no session at all",
  "contested-stays-possible": "a contradicting session keeps a record possible, however many sessions support it",
  "lists-apart": "supporting and contradicting sessions are counted in their own lists, each once",
  "named-and-unnamed": "a named and an unnamed observation on one machine and UTC day are one session; two names are two",
  "derive": "the one statement of confidence: certain exactly when two or more sessions support it and none contradicts it",
  "seeded": "seeded sequences of supporting and contradicting observations: sessions, contradictions and confidence as the contract counts them",
};

// ---- the reference model: the contract, as data -------------------------------------------------------------------

const utcDay = (at) => new Date(at).toISOString().slice(0, 10);

const sitting = (o) => `${o.host}|${utcDay(o.at)}`;

const named = (o) => typeof o.session === "string" && o.session.length > 0;

const sameSession = (a, b) => (named(a) && named(b) ? a.session === b.session : sitting(a) === sitting(b));

export const confidenceOf = (sessions, against) => (sessions >= 2 && against === 0 ? "certain" : "possible");

// A session already counted in its list adds nothing; a new one is counted, in that list alone.
const counted = (acc, e) => (acc[e.list].some((p) => sameSession(p, e.by)) ? acc : { ...acc, [e.list]: [...acc[e.list], e.by] });

export const supportOf = (events) => ((acc) => ({ sessions: acc.seen.length, against: acc.contested.length }))(events.reduce(counted, { seen: [], contested: [] }));

const answer = (s) => [confidenceOf(s.sessions, s.against), `sessions:${s.sessions}`, `against:${s.against}`];

const MODEL = {
  support: (i) => answer(supportOf(i.events)),
  derive: (i) => [confidenceOf(i.sessions, i.against)],
};

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

const seen = (by) => ({ list: "seen", by });
const against = (by) => ({ list: "contested", by });

const row = (group, input, ...ids) => ({ group, input, expect: { exactly: ids } });

const support = (group, events, confidence, sessions, contradictions) => row(group, { call: "support", events }, confidence, `sessions:${sessions}`, `against:${contradictions}`);

const derive = (sessions, contradictions, confidence) => row("derive", { call: "derive", sessions, against: contradictions }, confidence);

// ---- the checks written by hand, each from a sentence of the contract ------------------------------------------------

const MORNING = ran(A, D1, "09:00:00.000");
const EVENING = ran(A, D1, "21:00:00.000");
const NEXT_DAY = ran(A, D2, "09:00:00.000");
const OTHER_MACHINE = ran(B, D1, "09:00:00.000");
const THIRD_DAY = ran(A, D3, "09:00:00.000");

const SUPPORT = [
  support("rerun-is-one", [seen(MORNING), seen(MORNING)], "possible", 1, 0),
  support("rerun-is-one", [seen(MORNING), seen(EVENING), seen(ran(A, D1, "23:59:59.999"))], "possible", 1, 0),
  support("rerun-is-one", [seen(hooked(A, D1, "09:00:00.000", NAME_1)), seen(hooked(A, D2, "00:30:00.000", NAME_1))], "possible", 1, 0),
  support("a-b-a", [seen(MORNING), seen(NEXT_DAY), seen(EVENING)], "certain", 2, 0),
  support("a-b-a", [seen(MORNING), seen(NEXT_DAY), seen(MORNING), seen(NEXT_DAY), seen(MORNING)], "certain", 2, 0),
  support("a-b-a", [seen(hooked(A, D1, "09:00:00.000", NAME_1)), seen(hooked(A, D1, "10:00:00.000", NAME_2)), seen(hooked(A, D1, "11:00:00.000", NAME_1))], "certain", 2, 0),
  support("a-b-a", [seen(MORNING), seen(OTHER_MACHINE), seen(EVENING), seen(THIRD_DAY), seen(OTHER_MACHINE)], "certain", 3, 0),
  support("two-sessions-certain", [seen(MORNING), seen(NEXT_DAY)], "certain", 2, 0),
  support("two-sessions-certain", [seen(MORNING), seen(OTHER_MACHINE)], "certain", 2, 0),
  support("two-sessions-certain", [seen(ran(A, D1, "23:59:59.999")), seen(ran(A, D2, "00:00:00.000"))], "certain", 2, 0),
  support("one-session-possible", [seen(MORNING)], "possible", 1, 0),
  support("one-session-possible", [], "possible", 0, 0),
  support("contested-stays-possible", [seen(MORNING), seen(NEXT_DAY), seen(THIRD_DAY), against(OTHER_MACHINE)], "possible", 3, 1),
  support("contested-stays-possible", [against(MORNING), seen(NEXT_DAY), seen(THIRD_DAY), seen(OTHER_MACHINE)], "possible", 3, 1),
  support("contested-stays-possible", [seen(MORNING), seen(NEXT_DAY), against(THIRD_DAY), against(THIRD_DAY)], "possible", 2, 1),
  support("lists-apart", [seen(MORNING), against(EVENING)], "possible", 1, 1),
  support("lists-apart", [against(MORNING), against(NEXT_DAY), against(MORNING)], "possible", 0, 2),
  support("lists-apart", [seen(MORNING), against(NEXT_DAY), seen(NEXT_DAY), against(MORNING)], "possible", 2, 2),
  support("named-and-unnamed", [seen(hooked(A, D1, "09:00:00.000", NAME_1)), seen(EVENING)], "possible", 1, 0),
  support("named-and-unnamed", [seen(MORNING), seen(hooked(A, D1, "22:00:00.000", NAME_2))], "possible", 1, 0),
  support("named-and-unnamed", [seen(hooked(A, D1, "09:00:00.000", NAME_1)), seen(hooked(A, D1, "09:30:00.000", NAME_2))], "certain", 2, 0),
  support("named-and-unnamed", [seen(hooked(A, D1, "09:00:00.000", NAME_1)), seen(ran(A, D2, "09:00:00.000"))], "certain", 2, 0),
];

const DERIVE = [derive(2, 0, "certain"), derive(3, 0, "certain"), derive(32, 0, "certain"), derive(1, 0, "possible"), derive(0, 0, "possible"), derive(2, 1, "possible"), derive(7, 3, "possible"), derive(1, 1, "possible"), derive(0, 2, "possible")];

export const STRUCTURE = [...SUPPORT, ...DERIVE];

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
const NAMES = [NAME_1, NAME_2];
const EDGES = [0, 1, 43200000, 86399999];

const msOfDay = (r) => (r() < 0.3 ? pick(r, EDGES) : Math.floor(r() * 86400000));

const onDate = (date, ms) => new Date(Date.parse(`${date}T00:00:00.000Z`) + ms).toISOString();

const seededRun = (r) => ({ host: pick(r, HOSTS), at: onDate(pick(r, DATES), msOfDay(r)) });

const seededObs = (r) => ((o) => (r() < 0.35 ? { ...o, session: pick(r, NAMES) } : o))(seededRun(r));

const seededEvent = (r) => ({ list: r() < 0.8 ? "seen" : "contested", by: seededObs(r) });

const seededSupport = (r) => ((input) => ({ group: "seeded", input, expect: owed(input) }))({ call: "support", events: Array.from({ length: 1 + Math.floor(r() * 9) }, () => seededEvent(r)) });

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...STRUCTURE, ...Array.from({ length: Math.max(8, samples) }, () => seededSupport(r))]);
}

// ---- the reference model, held to the table written by hand ---------------------------------------------------------

const agrees = (c) => JSON.stringify(owed(c.input)) === JSON.stringify(c.expect);

export const selfTest = () => STRUCTURE.filter((c) => !agrees(c)).map((c) => `the reference model disagrees with the contract on a ${c.group} check: ${JSON.stringify(c.input)}`);
