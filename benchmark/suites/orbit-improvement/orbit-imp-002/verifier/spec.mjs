// THE SPEC of ORBIT-IMP-002: what every evaluation of a campaign comes to TOGETHER, written from its contract (ADR 0045,
// "One evaluation is an observation"; AGENTS.md, "A definition improves only on independent evidence"; the header of
// src/improvement/evaluation.mjs) and never from its code. Kept beside the probe and handed to no runner; it never
// imports the subject. One evaluation saying WORSE rejects the candidate. BETTER needs evaluations that found it better
// in `minSessions` INDEPENDENT sessions and none saying otherwise; EQUIVALENT needs as many sessions of no measurable
// difference and none better; every evaluation stopped is BLOCKED; anything else decides nothing. An evaluation that
// has not settled says nothing, and neither does one that was stopped or could not decide.
//
// Independence is learn's own rule (src/memory/session.mjs): one machine on one UTC day. A session MARK reaches a
// command as a variable its shell can set, so it is never counted -- two marks on one machine and day are one session,
// and one mark on two machine-days is two. Every check is a list of settled evaluations and the settings, and an
// expectation over the one id the probe reports: the verdict. Both directions are checked, so an aggregate that calls
// every candidate better fails as surely as one that rejects every candidate.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the hand-written expectations of the fixed checks
export const CASE = "ORBIT-IMP-002";

export const GROUPS = {
  "one-worse-rejects": "one evaluation that found the candidate worse rejects it, however many independent sessions found it better",
  "better-in-sessions": "evaluations that found it better on minSessions different machine-days, with none saying otherwise, make it BETTER",
  "one-sitting-one-vote": "evaluations on one machine on one UTC day are one session however many there are and however many hours apart: never enough for BETTER",
  "session-mark-ignored": "a session mark is never a session: different marks on one machine-day count once, one mark on two machine-days counts twice",
  "too-few-sessions": "fewer independent sessions than minSessions found it better: INCONCLUSIVE",
  "mixed-evidence": "evaluations that found it better beside evaluations that found no difference decide nothing: INCONCLUSIVE",
  equivalent: "no measurable difference in minSessions independent sessions, and none better, is EQUIVALENT; in fewer it decides nothing",
  "all-blocked": "every evaluation stopped by the environment or a person is BLOCKED; one that ran is not",
  "open-says-nothing": "an evaluation that has not settled says nothing, for the candidate or against it",
  "seeded-one-sitting": "seeded: many evaluations that found it better, all on one machine on one UTC day under any marks, are one session",
  "seeded-one-worse": "seeded: one WORSE among better evaluations from enough independent sessions rejects the candidate",
  seeded: "seeded evaluations, verdicts, machines, days and session marks: the verdict the contract's table gives",
};

// ---- the reference model: the contract's table, as data -------------------------------------------------------------

// One machine on one UTC day, as learn counts a session: never the mark a shell set.
const sessionOf = (e) => `${e.host ?? "?"}@${String(e.at ?? "").slice(0, 10)}`;

const sessionsIn = (list) => new Set(list.map(sessionOf)).size;

const minOf = (values) => values?.improvement?.minSessions ?? 2;

const factsOf = (evaluations, values) => ((all) => ({ all, min: minOf(values), of: (v) => all.filter((e) => e.settled.verdict === v), sessions: (v) => sessionsIn(all.filter((e) => e.settled.verdict === v)) }))(evaluations.filter((e) => e.settled));

// In its order: the first row that holds decides.
const TABLE = [
  { verdict: "WORSE", when: (f) => f.of("WORSE").length > 0 },
  { verdict: "BETTER", when: (f) => f.sessions("BETTER") >= f.min && f.of("EQUIVALENT").length === 0 },
  { verdict: "EQUIVALENT", when: (f) => f.sessions("EQUIVALENT") >= f.min && f.of("BETTER").length === 0 },
  { verdict: "BLOCKED", when: (f) => f.all.length > 0 && f.all.every((e) => e.settled.verdict === "BLOCKED") },
  { verdict: "INCONCLUSIVE", when: () => true },
];

export const owed = (evaluations, values) => ((f) => TABLE.find((r) => r.when(f)).verdict)(factsOf(evaluations, values));

// ---- what the inputs are made of ------------------------------------------------------------------------------------

const A = "laptop-a";
const B = "laptop-b";
const C = "ci-runner";
const HOSTS = [A, B, C];
const DAYS = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"];
const MARKS = [null, "s-1", "s-2", "s-3"];

const hh = (n) => String(n).padStart(2, "0");

// One evaluation as a campaign's journal folds it: where and when it started, the session mark its shell carried, and
// -- once it settled -- what it came to.
const ev = (verdict, host, day, o = {}) => ({ task: "tsk-0000000000e2", baseline: "release-notes:1.0.0:aaaaaaaa", candidate: "release-notes:1.0.1:bbbbbbbb", session: o.mark ?? null, host, pid: 4242, at: `${DAYS[day]}T${hh(o.hour ?? 10)}:${hh(o.minute ?? 15)}:00.000Z`, runs: [], ...(verdict ? { settled: { verdict, regressions: [] } } : {}) });

const min = (n) => ({ improvement: { minSessions: n } });

const aggregate = (evaluations, values) => ({ call: "aggregate", evaluations: evaluations.map((e, i) => ({ evaluation: `ev-${i + 1}`, ...e })), values });

const row = (group, verdict, evaluations, values = {}) => ({ group, verdict, evaluations, values });

// ---- the fixed checks, each expectation written by hand from the contract -------------------------------------------

const FIXED = [
  row("one-worse-rejects", "WORSE", [ev("BETTER", A, 0), ev("BETTER", B, 1), ev("WORSE", A, 2)]),
  row("one-worse-rejects", "WORSE", [ev("BETTER", A, 0), ev("BETTER", A, 1), ev("BETTER", B, 2), ev("WORSE", A, 0, { hour: 16 })]),
  row("one-worse-rejects", "WORSE", [ev("WORSE", A, 0)]),
  row("one-worse-rejects", "WORSE", [ev("EQUIVALENT", A, 0), ev("EQUIVALENT", B, 1), ev("WORSE", C, 2)]),
  row("one-worse-rejects", "WORSE", [ev("BETTER", A, 0), ev("BETTER", B, 1), ev("BETTER", C, 2), ev("WORSE", C, 3)], min(3)),
  row("better-in-sessions", "BETTER", [ev("BETTER", A, 0), ev("BETTER", A, 1)]),
  row("better-in-sessions", "BETTER", [ev("BETTER", A, 0), ev("BETTER", B, 0)]),
  row("better-in-sessions", "BETTER", [ev("BETTER", A, 0), ev("BETTER", B, 1), ev("BETTER", C, 2)], min(3)),
  row("better-in-sessions", "BETTER", [ev("BETTER", A, 0, { hour: 23, minute: 59 }), ev("BETTER", A, 1, { hour: 0, minute: 1 })]),
  row("better-in-sessions", "BETTER", [ev("BETTER", A, 0), ev("BETTER", B, 1), ev("INCONCLUSIVE", C, 2), ev("BLOCKED", A, 3)]),
  row("one-sitting-one-vote", "INCONCLUSIVE", [ev("BETTER", A, 0, { hour: 9 }), ev("BETTER", A, 0, { hour: 17 })]),
  row("one-sitting-one-vote", "INCONCLUSIVE", [ev("BETTER", A, 0, { hour: 0, minute: 5 }), ev("BETTER", A, 0, { hour: 23, minute: 55 })]),
  row("one-sitting-one-vote", "INCONCLUSIVE", [8, 9, 10, 11].map((hour) => ev("BETTER", B, 2, { hour }))),
  row("session-mark-ignored", "INCONCLUSIVE", [ev("BETTER", A, 0, { mark: "s-1" }), ev("BETTER", A, 0, { mark: "s-2", hour: 11 })]),
  row("session-mark-ignored", "BETTER", [ev("BETTER", A, 0, { mark: "s-1" }), ev("BETTER", A, 1, { mark: "s-1" })]),
  row("session-mark-ignored", "INCONCLUSIVE", ["s-1", "s-2", "s-3"].map((mark, i) => ev("BETTER", C, 1, { mark, hour: 9 + i })), min(3)),
  row("session-mark-ignored", "INCONCLUSIVE", [ev("BETTER", B, 3), ev("BETTER", B, 3, { mark: "s-9", hour: 20 })]),
  row("too-few-sessions", "INCONCLUSIVE", [ev("BETTER", A, 0)]),
  row("too-few-sessions", "INCONCLUSIVE", [ev("BETTER", A, 0), ev("BETTER", B, 1)], min(3)),
  row("too-few-sessions", "INCONCLUSIVE", []),
  row("mixed-evidence", "INCONCLUSIVE", [ev("BETTER", A, 0), ev("EQUIVALENT", B, 1)]),
  row("mixed-evidence", "INCONCLUSIVE", [ev("BETTER", A, 0), ev("BETTER", B, 1), ev("EQUIVALENT", C, 2)]),
  row("mixed-evidence", "INCONCLUSIVE", [ev("EQUIVALENT", A, 0), ev("EQUIVALENT", B, 1), ev("BETTER", C, 2)]),
  row("equivalent", "EQUIVALENT", [ev("EQUIVALENT", A, 0), ev("EQUIVALENT", B, 1)]),
  row("equivalent", "INCONCLUSIVE", [ev("EQUIVALENT", A, 0, { mark: "s-1" }), ev("EQUIVALENT", A, 0, { mark: "s-2", hour: 15 })]),
  row("all-blocked", "BLOCKED", [ev("BLOCKED", A, 0), ev("BLOCKED", B, 1)]),
  row("all-blocked", "BLOCKED", [ev("BLOCKED", A, 0)]),
  row("all-blocked", "INCONCLUSIVE", [ev("BLOCKED", A, 0), ev("INCONCLUSIVE", B, 1)]),
  row("open-says-nothing", "INCONCLUSIVE", [ev("BETTER", A, 0), ev(null, B, 1)]),
  row("open-says-nothing", "BETTER", [ev("BETTER", A, 0), ev("BETTER", B, 1), ev(null, C, 2)]),
  row("open-says-nothing", "INCONCLUSIVE", [ev(null, A, 0)]),
];

const asCheck = (x) => ({ group: x.group, input: aggregate(x.evaluations, x.values), expect: { exactly: [x.verdict] } });

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

const seededCheck = (group, evaluations, values) => ({ group, input: aggregate(evaluations, values), expect: { exactly: [owed(evaluations, values)] } });

const anyDay = (r) => Math.floor(r() * DAYS.length);

function seededSitting(r) {
  const host = pick(r, HOSTS);
  const day = anyDay(r);
  const list = Array.from({ length: 2 + Math.floor(r() * 4) }, (_, i) => ev("BETTER", host, day, { hour: 6 + i * 3, minute: Math.floor(r() * 60), mark: pick(r, MARKS) }));
  return seededCheck("seeded-one-sitting", list, min(pick(r, [2, 3])));
}

// Better on as many machine-days as are needed (or one more), and one evaluation anywhere saying worse.
function seededWorse(r) {
  const need = pick(r, [2, 3]);
  const better = Array.from({ length: need + Math.floor(r() * 2) }, (_, i) => ev("BETTER", HOSTS[i % HOSTS.length], i, { mark: pick(r, MARKS) }));
  const at = Math.floor(r() * (better.length + 1));
  return seededCheck("seeded-one-worse", [...better.slice(0, at), ev("WORSE", pick(r, HOSTS), anyDay(r), { mark: pick(r, MARKS) }), ...better.slice(at)], min(need));
}

const ANY = ["BETTER", "EQUIVALENT", "WORSE", "INCONCLUSIVE", "BLOCKED", null];

const LEANS = ["BETTER", "BETTER", "EQUIVALENT", "BLOCKED"];

// A campaign whose evaluations mostly lean one way, with the odd one saying anything at all (or not settled yet).
const randomEv = (r, lean) => ev(r() < 0.7 ? lean : pick(r, ANY), pick(r, HOSTS), anyDay(r), { hour: Math.floor(r() * 24), minute: Math.floor(r() * 60), mark: pick(r, MARKS) });

const seededRandom = (r) => ((lean) => seededCheck("seeded", Array.from({ length: Math.floor(r() * 6) }, () => randomEv(r, lean)), pick(r, [{}, min(2), min(3)])))(pick(r, LEANS));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

const many = (n, make, r) => Array.from({ length: n }, () => make(r));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const quarter = Math.max(4, Math.floor(samples / 4));
  return numbered([...FIXED.map(asCheck), ...many(quarter, seededSitting, r), ...many(quarter, seededWorse, r), ...many(Math.max(8, Math.floor(samples / 2)), seededRandom, r)]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const seededHold = (group, verdict) => cases(7, 48).filter((c) => c.group === group).every((c) => c.expect.exactly[0] === verdict);

const INVARIANTS = [["seeded-one-sitting", "INCONCLUSIVE"], ["seeded-one-worse", "WORSE"]];

export const selfTest = () => [...FIXED.filter((x) => owed(x.evaluations, x.values) !== x.verdict).map((x) => `the reference model disagrees with the contract on a ${x.group} aggregate: expected ${x.verdict}`), ...INVARIANTS.filter(([g, v]) => !seededHold(g, v)).map(([g, v]) => `a ${g} check is not owed ${v}`)];
