// The status a finished run DESERVES, as distinct from the one it reached.
//
// `run.status` starts at "PASS" and is only ever downgraded by a step that
// stopped the loop -- so reaching the last step of the slice with nothing thrown
// used to BE the pass. It proves less than it sounds: a slice can contain no
// verdict at all (--from=1 --to=3 of create-thing is goto, skip-if, click), and
// a run of part of a case is not a run of the case.
//
// So a PASS now has to earn both halves of its meaning:
//   the case's own verdicts EXECUTED   -- else INCONCLUSIVE, exit 4
//   and the WHOLE case ran             -- else PARTIAL, exit 0
//
// SKIP, FAIL and BLOCKED are never re-judged: each already says what happened,
// and a fired skip-if ruling on nothing is the point of skip-if.
export function finalStatus(run) {
  if (run.status !== "PASS") return run.status;
  if (!run.verdicts) return "INCONCLUSIVE";
  return whole(run) ? "PASS" : "PARTIAL";
}

// The slice covered the case from its first step to its last.
export const whole = (run) => run.from === 1 && run.to >= (run.c.steps?.length ?? 0);

// Why it is not a PASS, in the words the RESULT line and the ledger both use.
export const sliceOf = (run) => ({ from: run.from, to: run.to, whole: whole(run) });
