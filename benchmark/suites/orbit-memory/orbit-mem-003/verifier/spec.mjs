// THE SPEC of ORBIT-MEM-003: which failures become a LESSON, written from its contract and never from its code. Kept
// beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never imports the
// subject. Every check is a ledger of runs and an expectation over the ids the subject reports for it: `has` (must be
// among them), `lacks` (must not be), `exactly` (the whole set).
//
// The contract (AGENTS.md, the headers of src/learn/families/failures.mjs, src/learn/families/shared.mjs and
// src/learn/confidence.mjs, and skills/orbit-learn): failures are grouped on the step the ledger records, or on the
// status when it records none, so BLOCKED is grouped apart from FAIL. Confirmations are counted in SESSIONS -- one
// machine on one UTC day -- never in runs: three runs in one sitting are one person hitting one thing once. One session
// is an OBSERVATION, printed and not kept; two independent sessions and nothing against make a lesson worth keeping. A
// contradiction is a session that PASSED after the last one that failed -- before it is older news -- and the ladder
// reads, in order: contradicted by at least as many sessions as support it, and by two or more, is rejected (and kept,
// so it is not derived again); any contradiction demotes it to a candidate; two sessions on a frontend that has moved
// since is stale (not observed lately is not false); two sessions is validated; one session is a candidate.
//
// Every run is a FAIL at a recorded step, a BLOCKED that reached no step, or a PASS; times are ISO-8601 in UTC with a
// Z, as the ledger keeps them.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-MEM-003";

export const GROUPS = {
  observation: "one failing session is an observation: a candidate, printed and not kept",
  "one-sitting": "several failing runs in one sitting are one session: still an observation",
  "two-sessions": "failures in two independent sessions, nothing against, are a validated lesson worth keeping",
  "sessions-not-runs": "a lesson counts the sessions behind it, never the runs",
  "later-pass-contradicts": "a session that passed after the last failure contradicts it and demotes it to a candidate",
  "later-passes-one-session": "several passes in one later sitting are one contradicting session",
  "earlier-pass-is-old-news": "passes before the failures contradict nothing",
  "contradicted-rejected": "contradicted by at least as many sessions as support it, and by two or more, it is rejected -- and kept",
  "blocked-apart": "BLOCKED is grouped apart from FAIL: neither lends the other its sessions",
  "steps-apart": "failures at different steps of one case are different findings",
  "cases-apart": "failures of different cases are different findings",
  "frontend-moved": "two sessions on a frontend that has moved since are stale, kept -- and current again when the latest failure ran on it",
  "passes-are-not-failures": "a ledger of passes makes no finding at all",
  seeded: "seeded ledgers: every finding's sessions, contradictions, state and keep exactly as the contract derives them",
};

// ---- the reference model: the contract, as data -------------------------------------------------------------------

const utcDay = (at) => new Date(at).toISOString().slice(0, 10);

const sessionsOf = (runs) => new Set(runs.map((r) => `${r.host}|${utcDay(r.at)}`)).size;

const FAILED = ["FAIL", "BLOCKED"];

const failed = (r) => FAILED.includes(r.status);

// Grouped on the step the ledger records ({i, do, on}), or on the status when it records none.
const groupKey = (r) => JSON.stringify([r.case, r.failedStep ? [r.failedStep.i, r.failedStep.do, r.failedStep.on ?? null] : r.status]);

const groupsOf = (runs) => [...runs.filter(failed).reduce((m, r) => m.set(groupKey(r), [...(m.get(groupKey(r)) ?? []), r]), new Map()).values()];

const latest = (runs) => [...runs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);

const laterPasses = (all, group) => all.filter((r) => r.case === group[0].case && r.status === "PASS" && Date.parse(r.at) > Date.parse(latest(group).at));

const LADDER = [
  { state: "rejected", when: (f) => f.against >= f.for && f.against >= 2 },
  { state: "candidate", when: (f) => f.against >= 1 },
  { state: "stale", when: (f) => f.for >= 2 && Boolean(f.commit) && Boolean(f.head) && f.commit !== f.head },
  { state: "validated", when: (f) => f.for >= 2 },
  { state: "candidate", when: () => true },
];

const findingOf = (all, group, head) => ({ about: `case:${group[0].case}`, for: sessionsOf(group), against: sessionsOf(laterPasses(all, group)), commit: latest(group).fe_commit ?? null, head });

const idsOf = (f) => ((state) => [`${f.about}:${state}:${state === "rejected" || f.for >= 2 ? "keep" : "observe"}`, `${f.about}:sessions:${f.for}`, `${f.about}:against:${f.against}`])(LADDER.find((row) => row.when(f)).state);

export const lessonIds = (runs, head) => [...new Set(groupsOf(runs).flatMap((g) => idsOf(findingOf(runs, g, head))))].sort();

export const owed = (input) => ({ exactly: lessonIds(input.runs, input.head) });

// ---- what the inputs are made of ------------------------------------------------------------------------------------

const A = "laptop-a";
const B = "laptop-b";
const ADD = { i: 2, do: "click", on: "home/Add" };
const SAVE = { i: 5, do: "click", on: "dialog/Save" };

const run = (kase, status, host, date, time, extra = {}) => ({ at: `${date}T${time}Z`, host, case: kase, status, fe_commit: "abc1234", ...extra });

const fail = (host, date, time, step = ADD, extra = {}) => run("create-thing", "FAIL", host, date, time, { failedStep: step, ...extra });
const blocked = (host, date, time) => run("create-thing", "BLOCKED", host, date, time);
const pass = (host, date, time) => run("create-thing", "PASS", host, date, time);

const lessons = (group, runs, head, ...ids) => ({ group, input: { call: "lessons", runs, head }, expect: { exactly: [...new Set(ids)].sort() } });

const said = (state, keep, sessions, against, kase = "create-thing") => [`case:${kase}:${state}:${keep}`, `case:${kase}:sessions:${sessions}`, `case:${kase}:against:${against}`];

// ---- the checks written by hand, each from a sentence of the contract ------------------------------------------------

const D1 = "2026-10-27";
const D2 = "2026-10-28";
const D3 = "2026-10-29";
const D4 = "2026-10-30";

export const STRUCTURE = [
  lessons("observation", [fail(A, D1, "09:00:00.000")], null, ...said("candidate", "observe", 1, 0)),
  lessons("observation", [blocked(B, D2, "07:30:00.000")], null, ...said("candidate", "observe", 1, 0)),
  lessons("one-sitting", [fail(A, D1, "09:01:00.000"), fail(A, D1, "09:02:00.000"), fail(A, D1, "17:45:00.000")], null, ...said("candidate", "observe", 1, 0)),
  lessons("one-sitting", [fail(A, D1, "00:00:00.000"), fail(A, D1, "23:59:59.999")], null, ...said("candidate", "observe", 1, 0)),
  lessons("one-sitting", [blocked(A, D2, "08:00:00.000"), blocked(A, D2, "08:05:00.000"), blocked(A, D2, "16:00:00.000"), blocked(A, D2, "16:01:00.000")], null, ...said("candidate", "observe", 1, 0)),
  lessons("two-sessions", [fail(A, D1, "09:00:00.000"), fail(A, D2, "09:00:00.000")], null, ...said("validated", "keep", 2, 0)),
  lessons("two-sessions", [fail(A, D1, "09:00:00.000"), fail(B, D1, "09:00:00.000")], null, ...said("validated", "keep", 2, 0)),
  lessons("two-sessions", [fail(A, D1, "23:59:59.999"), fail(A, D2, "00:00:00.000")], null, ...said("validated", "keep", 2, 0)),
  lessons("sessions-not-runs", [fail(A, D1, "09:00:00.000"), fail(A, D1, "10:00:00.000"), fail(A, D1, "11:00:00.000"), fail(B, D2, "09:00:00.000"), fail(B, D2, "10:00:00.000"), fail(B, D2, "11:00:00.000")], null, ...said("validated", "keep", 2, 0)),
  lessons("sessions-not-runs", [fail(A, D1, "09:00:00.000"), fail(A, D1, "12:00:00.000"), fail(B, D1, "09:00:00.000"), fail(A, D2, "09:00:00.000"), fail(A, D2, "18:00:00.000")], null, ...said("validated", "keep", 3, 0)),
  lessons("later-pass-contradicts", [fail(A, D1, "09:00:00.000"), fail(A, D2, "09:00:00.000"), pass(A, D3, "09:00:00.000")], null, ...said("candidate", "keep", 2, 1)),
  lessons("later-pass-contradicts", [fail(A, D1, "09:00:00.000"), pass(A, D1, "10:00:00.000")], null, ...said("candidate", "observe", 1, 1)),
  lessons("later-passes-one-session", [fail(A, D1, "09:00:00.000"), fail(B, D2, "09:00:00.000"), pass(A, D3, "09:00:00.000"), pass(A, D3, "11:00:00.000"), pass(A, D3, "15:00:00.000")], null, ...said("candidate", "keep", 2, 1)),
  lessons("earlier-pass-is-old-news", [pass(A, D1, "09:00:00.000"), pass(B, D1, "09:00:00.000"), pass(A, D2, "09:00:00.000"), fail(A, D3, "09:00:00.000"), fail(A, D4, "09:00:00.000")], null, ...said("validated", "keep", 2, 0)),
  lessons("contradicted-rejected", [fail(A, D1, "09:00:00.000"), fail(A, D2, "09:00:00.000"), pass(A, D3, "09:00:00.000"), pass(B, D3, "09:00:00.000")], null, ...said("rejected", "keep", 2, 2)),
  lessons("contradicted-rejected", [fail(A, D1, "09:00:00.000"), pass(A, D2, "09:00:00.000"), pass(B, D2, "09:00:00.000"), pass(A, D3, "09:00:00.000")], null, ...said("rejected", "keep", 1, 3)),
  lessons("blocked-apart", [blocked(A, D1, "09:00:00.000"), blocked(A, D2, "09:00:00.000"), fail(A, D3, "09:00:00.000")], null, ...said("validated", "keep", 2, 0), ...said("candidate", "observe", 1, 0)),
  lessons("blocked-apart", [blocked(A, D1, "09:00:00.000"), fail(B, D2, "09:00:00.000")], null, ...said("candidate", "observe", 1, 0)),
  lessons("steps-apart", [fail(A, D1, "09:00:00.000", ADD), fail(A, D2, "09:00:00.000", SAVE)], null, ...said("candidate", "observe", 1, 0)),
  lessons("steps-apart", [fail(A, D1, "09:00:00.000", ADD), fail(A, D2, "09:00:00.000", ADD), fail(B, D2, "09:00:00.000", SAVE)], null, ...said("validated", "keep", 2, 0), ...said("candidate", "observe", 1, 0)),
  lessons("cases-apart", [fail(A, D1, "09:00:00.000"), run("open-thing", "FAIL", A, D2, "09:00:00.000", { failedStep: ADD })], null, ...said("candidate", "observe", 1, 0), ...said("candidate", "observe", 1, 0, "open-thing")),
  lessons("frontend-moved", [fail(A, D1, "09:00:00.000"), fail(A, D2, "09:00:00.000")], "def5678", ...said("stale", "keep", 2, 0)),
  lessons("frontend-moved", [fail(A, D1, "09:00:00.000"), fail(A, D2, "09:00:00.000")], "abc1234", ...said("validated", "keep", 2, 0)),
  lessons("frontend-moved", [fail(A, D1, "09:00:00.000"), fail(A, D2, "09:00:00.000", ADD, { fe_commit: "def5678" })], "def5678", ...said("validated", "keep", 2, 0)),
  lessons("passes-are-not-failures", [pass(A, D1, "09:00:00.000"), pass(B, D2, "09:00:00.000")], null),
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

const HOSTS = [A, B];
const DATES = [D1, D2, D3, D4];
const CASES = ["create-thing", "open-thing"];
const STEPS = [ADD, SAVE];
const HEADS = [null, "abc1234", "def5678"];

const stamp = (r) => new Date(Date.parse(`${pick(r, DATES)}T00:00:00.000Z`) + Math.floor(r() * 86400000)).toISOString();

const seededRun = (r, kase) => ((status) => ({ at: stamp(r), host: pick(r, HOSTS), case: kase, status, fe_commit: "abc1234", ...(status === "FAIL" ? { failedStep: pick(r, STEPS) } : {}) }))(pick(r, ["FAIL", "FAIL", "FAIL", "BLOCKED", "PASS", "PASS"]));

const seededCase = (r) => ((kase) => Array.from({ length: 1 + Math.floor(r() * 6) }, () => seededRun(r, kase)))(pick(r, CASES));

const seededLedger = (r) => Array.from({ length: 1 + Math.floor(r() * 2) }, () => seededCase(r)).flat().sort((a, b) => a.at.localeCompare(b.at));

const seededLessons = (r) => ((input) => ({ group: "seeded", input, expect: owed(input) }))({ call: "lessons", runs: seededLedger(r), head: pick(r, HEADS) });

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...STRUCTURE, ...Array.from({ length: Math.max(8, samples) }, () => seededLessons(r))]);
}

// ---- the reference model, held to the table written by hand ---------------------------------------------------------

const agrees = (c) => JSON.stringify(owed(c.input)) === JSON.stringify(c.expect);

export const selfTest = () => STRUCTURE.filter((c) => !agrees(c)).map((c) => `the reference model disagrees with the contract on a ${c.group} check: ${JSON.stringify(c.input.runs.map((r) => [r.case, r.status, r.host, r.at]))}`);
