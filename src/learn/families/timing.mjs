// How long this product actually takes -- and a short list of what that means.
//
// The ledger holds ONE duration: `ms`, for the whole run. Per-step timing exists
// only in an evidence dir's run-log.jsonl, whose path in the ledger is absolute
// and machine-local, so another machine cannot read it and a cleaned dir has
// taken it away. Worse, a step that FAILED logs no duration at all -- the step
// anybody actually wants timed is the one that is never timed.
//
// So this family claims whole-run milliseconds and nothing else, and says so on
// every lesson. No mean, no percentile, no decimal: a median and a sample count
// are what this many observations can carry, and a figure like "p95 4.7s" over
// nine runs is a lie with a decimal point in it.
//
// It also proposes no change to any budget. A slow run is reported to a person.
// Making a timeout bigger so a case stops failing is the one move that turns a
// test suite into decoration, and the recipe table refuses to emit it.
import { LEDGER_CANNOT } from "../evidence.mjs";
import { finding, groupBy, plural, runRow, tally } from "./shared.mjs";

export const MIN_SESSIONS = 3;
const TIMED = new Set(["PASS", "SKIP"]);
const WHOLE_RUN_ONLY = "per-step timing — it lives only in each run's own evidence dir, which is a local path on the machine that ran it, and a failing step records no duration at all";

export function timing(evidence) {
  const timed = evidence.runs.filter((r) => TIMED.has(r.status) && Number.isFinite(r.ms) && whole(r));
  const byCase = groupBy(timed, (r) => r.case);
  return [...byCase].flatMap(([caseId, runs]) => slowedDown(caseId, runs));
}

// A --from/--to slice times a fragment of the case, and comparing it with a whole
// run would invent a speed-up that never happened.
const whole = (r) => !r.slice || r.slice.whole !== false;

function slowedDown(caseId, runs) {
  const byCommit = groupBy(runs, (r) => r.fe_commit ?? "unknown");
  const groups = [...byCommit].map(([commit, rs]) => ({ commit, rs, counted: tally(rs), median: median(rs) })).sort(byMedian);
  return groups.length < 2 ? [] : compared(caseId, groups.at(0), groups.at(-1));
}

const byMedian = (a, b) => a.median - b.median;

function compared(caseId, fastest, slowest) {
  const enough = fastest.counted.for >= MIN_SESSIONS && slowest.counted.for >= MIN_SESSIONS;
  if (slowest.median <= fastest.median * 1.5) return [];
  return [regression(caseId, fastest, slowest, enough)];
}

function regression(caseId, fastest, slowest, enough) {
  const counted = slowest.counted;
  return finding({
    family: "timing",
    topic: "orbit-ui-timing",
    about: `case:${caseId}`,
    key: `slower at ${slowest.commit}`,
    scope: { hosts: counted.hostNames },
    statement: `${caseId} takes about ${secs(slowest.median)} at frontend ${slowest.commit}, against ${secs(fastest.median)} at ${fastest.commit} — whole-run time, ${samples(slowest, fastest)}.`,
    applies: [`case ${caseId}`, `frontend ${slowest.commit}`],
    notWhen: [`frontend ${fastest.commit}`, ...(enough ? [] : ["a sample this small — treat it as something to watch, not a trend"])],
    for: enough ? counted.for : 1,
    hosts: counted.hosts,
    runs: counted.runs,
    sessions: counted.sessions,
    firstSeen: counted.firstSeen,
    confirmed: counted.confirmed,
    fe_commit: slowest.commit,
    evidenceRuns: slowest.rs.map(runRow),
    missing: [WHOLE_RUN_ONLY, ...(enough ? [] : [tooFew(slowest, fastest)]), ...LEDGER_CANNOT],
  });
}

// Below the threshold the finding is still produced and still printed -- it just
// cannot reach `validated`, because `for` is pinned to one session. Hiding it
// would be worse: a real regression nobody has run enough times is exactly the
// thing worth mentioning early.
const tooFew = (slow, fast) => `whether this is a trend — ${samples(slow, fast)}, and this family wants ${MIN_SESSIONS} on each side before it will call one`;

const samples = (slow, fast) => `${plural(slow.counted.for, "session")} against ${plural(fast.counted.for, "session")}`;

const secs = (ms) => `${Math.round(ms / 100) / 10}s`;

function median(runs) {
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
