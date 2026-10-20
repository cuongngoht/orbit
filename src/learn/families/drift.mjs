// What changed underneath the tests.
//
// Two things this can honestly see, and a large one it cannot.
//
// It CAN see that a case passed at one frontend commit and has failed since a
// later one, and that a control named in those failures is the one that stopped
// working. It CANNOT see which files changed, or whether one commit descends from
// another -- a commit string has no order, and finding out needs git, which a
// pure family must not spawn. So "since" here means LATER IN TIME, every
// statement says so, and the recommendation hands off to `query verify`, which is
// the command that already answers the question properly.
import { LEDGER_CANNOT } from "../evidence.mjs";
import { byTime, finding, groupBy, plural, runRow, tally } from "./shared.mjs";

const PASSED = new Set(["PASS", "SKIP"]);
const SINCE_IS = "whether the new commit descends from the old one — a commit string carries no order, so this is later in TIME, not necessarily after in history";

export function drift(evidence) {
  const byCase = groupBy(evidence.runs.filter((r) => r.fe_commit), (r) => r.case);
  return [...byCase].flatMap(([caseId, runs]) => turned(caseId, runs));
}

// The turn: the last commit it passed at, and the first later commit it failed
// at. Anything else is one build's news, which the failures family already has.
function turned(caseId, runs) {
  const ordered = [...runs].sort(byTime);
  const lastGood = [...ordered].reverse().find((r) => PASSED.has(r.status));
  const firstBad = ordered.find((r) => !PASSED.has(r.status) && after(r, lastGood));
  return firstBad ? [...buildFinding(caseId, ordered, lastGood, firstBad), ...controlFinding(caseId, ordered, firstBad)] : [];
}

const after = (r, good) => good && String(r.at) > String(good.at) && r.fe_commit !== good.fe_commit;

function buildFinding(caseId, ordered, lastGood, firstBad) {
  const since = ordered.filter((r) => String(r.at) >= String(firstBad.at) && !PASSED.has(r.status));
  const counted = tally(since);
  return [finding({
    family: "drift",
    topic: "orbit-ui-drift",
    about: `case:${caseId}`,
    key: `${lastGood.fe_commit} to ${firstBad.fe_commit}`,
    scope: { hosts: counted.hostNames },
    statement: `${caseId} last passed at frontend ${lastGood.fe_commit} and has failed in ${plural(counted.for, "session")} since ${firstBad.fe_commit} appeared.`,
    applies: [`case ${caseId}`, `frontend ${firstBad.fe_commit} and later`],
    notWhen: [`frontend ${lastGood.fe_commit}, where it passed`],
    for: counted.for,
    hosts: counted.hosts,
    runs: counted.runs,
    sessions: counted.sessions,
    firstSeen: firstBad.at,
    confirmed: counted.confirmed,
    fe_commit: counted.fe_commit,
    evidenceRuns: [lastGood, ...since].map(runRow),
    missing: [SINCE_IS, VERIFY_INSTEAD, ...LEDGER_CANNOT],
  })];
}

const VERIFY_INSTEAD = "which file changed — that needs the checkout; `query verify` is the command that reads it";

// The same turn, said about the CONTROL rather than the case, because that is
// what a person writing the next selector needs and it is a different question.
function controlFinding(caseId, ordered, firstBad) {
  const control = firstBad.failedStep?.on;
  if (!control) return [];
  const hits = ordered.filter((r) => r.failedStep?.on === control && String(r.at) >= String(firstBad.at));
  return [selector(caseId, control, hits, firstBad)];
}

function selector(caseId, control, hits, firstBad) {
  const counted = tally(hits);
  return finding({
    family: "drift",
    topic: "orbit-ui-selectors",
    about: control,
    key: `stopped at ${firstBad.fe_commit}`,
    scope: { hosts: counted.hostNames, control },
    statement: `${control} stopped working at frontend ${firstBad.fe_commit} — ${plural(counted.for, "session")} hit it while driving ${caseId}.`,
    applies: [`the control ${control}`, `frontend ${firstBad.fe_commit} and later`],
    notWhen: [`frontend commits before ${firstBad.fe_commit}`],
    for: counted.for,
    hosts: counted.hosts,
    runs: counted.runs,
    sessions: counted.sessions,
    firstSeen: firstBad.at,
    confirmed: counted.confirmed,
    fe_commit: counted.fe_commit,
    evidenceRuns: hits.map(runRow),
    missing: [SINCE_IS, VERIFY_INSTEAD, ...LEDGER_CANNOT],
  });
}
