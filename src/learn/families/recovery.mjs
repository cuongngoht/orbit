// What happens AFTER a failure here.
//
// This family is deliberately not what its name suggests elsewhere. There is no
// retry in this engine: `times` re-runs a step and returns only the last result
// as one ledger line, and `polls` is a wait's probe count recorded only when the
// wait succeeded. So "how many attempts did it take" is a question the data
// cannot answer, and a family that answered it would be making numbers up.
//
// What the ledger can say is what came next, which turns out to be the more
// useful question anyway:
//   FAIL then PASS on the SAME build  -- nothing was fixed, so the case is flaky,
//                                        and a green run of it proves nothing;
//   FAIL then PASS on a NEWER build   -- something was fixed, and both commits
//                                        are named so somebody can look;
//   BLOCKED again and again           -- we are not getting an answer at all,
//                                        which is a different problem from a bug.
import { LEDGER_CANNOT } from "../evidence.mjs";
import { byTime, finding, groupBy, plural, runRow, tally } from "./shared.mjs";

const PASSED = new Set(["PASS", "SKIP"]);
const NO_RETRY = "how many attempts a step took — this engine does not retry, and a failing step records no poll count, so nothing here is attempt data";

export function recovery(evidence) {
  const byLane = groupBy(evidence.runs, (r) => `${r.case}|${r.host}`);
  const turns = [...byLane].flatMap(([lane, runs]) => transitions(lane, runs));
  return [...groupBy(turns, (t) => t.key)].map(([, group]) => flapping(group));
}

function transitions(lane, runs) {
  const ordered = [...runs].sort(byTime);
  const pairs = ordered.slice(1).map((r, i) => ({ prev: ordered[i], now: r }));
  return pairs.filter(recovered).map((p) => labelled(lane, p));
}

const recovered = (p) => !PASSED.has(p.prev.status) && PASSED.has(p.now.status);

function labelled(lane, p) {
  const [caseId, host] = lane.split("|");
  const sameBuild = p.prev.fe_commit === p.now.fe_commit;
  return { key: `${caseId}|${sameBuild ? "same-build" : "new-build"}`, caseId, host, sameBuild, ...p };
}

function flapping(group) {
  const runs = group.flatMap((t) => [t.prev, t.now]);
  const counted = tally(runs);
  const first = group[0];
  return first.sameBuild ? unfixed(first, group, counted, runs) : fixed(first, group, counted, runs);
}

// The one that matters. Nothing changed and the verdict did: the case is not
// measuring what it thinks it is, and a PASS from it is not evidence.
function unfixed(first, group, counted, runs) {
  return finding({
    family: "recovery",
    topic: "orbit-ui-recovery",
    about: `case:${first.caseId}`,
    key: "passes on a retry with nothing changed",
    scope: { hosts: counted.hostNames },
    statement: `${first.caseId} has failed and then passed on the same frontend ${plural(group.length, "time")} — nothing was fixed in between, so a green run of it does not prove much.`,
    applies: [`case ${first.caseId}`, `machines ${counted.hostNames.join(", ")}`],
    notWhen: ["a run that failed and stayed failed — that one is worth believing"],
    for: counted.for,
    hosts: counted.hosts,
    runs: counted.runs,
    sessions: counted.sessions,
    firstSeen: counted.firstSeen,
    confirmed: counted.confirmed,
    fe_commit: counted.fe_commit,
    evidenceRuns: runs.map(runRow),
    missing: [NO_RETRY, ...LEDGER_CANNOT],
  });
}

function fixed(first, group, counted, runs) {
  const last = group.at(-1);
  return finding({
    family: "recovery",
    topic: "orbit-ui-recovery",
    about: `case:${first.caseId}`,
    key: `recovered at ${last.now.fe_commit}`,
    scope: { hosts: counted.hostNames },
    statement: `${first.caseId} started passing again at frontend ${last.now.fe_commit}, having failed at ${last.prev.fe_commit}.`,
    applies: [`case ${first.caseId}`, `frontend ${last.now.fe_commit} and later`],
    notWhen: [`frontend ${last.prev.fe_commit}`],
    for: counted.for,
    hosts: counted.hosts,
    runs: counted.runs,
    sessions: counted.sessions,
    firstSeen: counted.firstSeen,
    confirmed: counted.confirmed,
    fe_commit: last.now.fe_commit,
    evidenceRuns: runs.map(runRow),
    missing: [NO_RETRY, "what the fix was — the ledger records verdicts, not changes", ...LEDGER_CANNOT],
  });
}
