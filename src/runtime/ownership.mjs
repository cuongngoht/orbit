// Whose is this process? -- decided from a receipt and from what the OS says now,
// and never from a pid.
//
// A pid is a number the OS hands out again. The one that was a dev server an hour
// ago may be somebody's editor now, and a stop that went by the number would
// terminate it. So ownership is proven from several independent facts, and only
// when all of them agree does Orbit call a process its own:
//
//   a receipt   Orbit wrote a session for it, before launching
//   a pid       the receipt names one
//   a start     the pid's START TIME is the one the receipt recorded, to the second
//
// Everything else is refused, and each refusal says which fact is missing:
//
//   ORBIT_OWNED   all three agree -- it may be observed AND stopped
//   EXTERNAL     Orbit has no receipt for it: it was there before, or somebody else
//                started it. It may be observed and, if the person allows it
//                (`reuseExternal`), reused. It is never stopped
//   UNKNOWN      Orbit started something and can no longer prove it is that
//                process: the start never settled, the pid was reused, or the OS
//                would not say when it started. Observed; never stopped
//
// An ordered table, the last row always answering, and a sentence per row -- the
// shape every decision in this engine takes, because a tool that decides silently
// cannot be audited, and one that kills silently cannot be forgiven.
export const OWNED = "ORBIT_OWNED";
export const EXTERNAL = "EXTERNAL";
export const UNKNOWN = "UNKNOWN";

// How far apart two readings of one process's start time may be: the OS reports to
// the second, and a clock read at launch and one read later are not the same call.
export const TOLERANCE_MS = 2000;

const same = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= TOLERANCE_MS;

export const OWNERSHIP = [
  { name: "NO_RECEIPT", when: (s) => !s, answer: () => ({ ownership: EXTERNAL, state: "RUNNING", why: "Orbit has no receipt for it: it was not started by Orbit" }) },
  { name: "UNSETTLED", when: (s) => s.state === "AMBIGUOUS" || (s.state === "STARTING" && s.pid === null), answer: () => ({ ownership: UNKNOWN, state: "AMBIGUOUS", why: "a start was recorded and never settled, so what it launched, if anything, cannot be named" }) },
  { name: "FINISHED", when: (s) => ["STOPPED", "LOST"].includes(s.state), answer: (s) => ({ ownership: OWNED, state: s.state, why: s.state === "STOPPED" ? "it was stopped" : "it was lost" }) },
  { name: "GONE", when: (s, o) => !o.alive, answer: () => ({ ownership: OWNED, state: "STOPPED", why: "the process is no longer there" }) },
  { name: "CANNOT_TELL_WHEN", when: (s, o) => !o.startedAt || !s.pidStartedAt, answer: () => ({ ownership: UNKNOWN, state: "RUNNING", why: "the OS would not say when that process started, so it cannot be told from one that took the pid over" }) },
  { name: "PID_REUSED", when: (s, o) => !same(o.startedAt, s.pidStartedAt), answer: (s, o) => ({ ownership: UNKNOWN, state: "LOST", why: `the pid now belongs to a process that started at ${o.startedAt}, not the one Orbit launched` }) },
  { name: "PROVEN", when: () => true, answer: () => ({ ownership: OWNED, state: "RUNNING", why: "a receipt, a pid and a start time all agree" }) },
];

// -> { ownership, state, why, rule }. `observation` is { alive, startedAt }.
export function judge(session, observation) {
  const seen = observation ?? {};
  const row = OWNERSHIP.find((r) => r.when(session, seen));
  return { ...row.answer(session, seen), rule: row.name };
}

// Only a process that is Orbit's AND running is stopped; the reason it is not, when
// it is not, is the judgement's own.
export const mayStop = (judgement) => judgement.ownership === OWNED && judgement.state === "RUNNING";
