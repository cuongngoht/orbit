# ORBIT-ORC-003 — no progress is three attempts in a row on one failure

An engineering task stops with `NO_PROGRESS` when its loop is going round: the task model (`src/task/model.mjs`) folds
`repeats` -- how many completed attempts in a row, counting back from the last, ended on the same failure signature --
and the progress rows (`src/orchestration/progress.mjs`) conclude `SAME_FAILURE` from it. A signature is what failed,
normalised (`src/orchestration/failure.mjs`), so a cosmetic edit that leaves the same test failing the same way counts
as no progress, and a change that makes a different test fail -- or the same one fail differently -- starts the count
again.

The behaviour this source must have:

- `repeats` is the number of completed attempts in a row, counting back from the last completed one, that ended on its
  failure signature. Attempts with that signature earlier in the history, separated from the last ones by another
  signature, are not part of the run. An attempt that ended with no failure signature breaks the run (a last one gives
  0), and an attempt still open is not counted.
- `noProgress` concludes `SAME_FAILURE` exactly when `repeats` is three or more.
- `signatureOf(run, root)` is 12 hex characters. Two runs of the same failure sign the same when what differs between
  them is a timestamp, an absolute path, the workspace's path (`root`), an id, a duration, or the order the lines
  arrived in. A different failing test, an extra failing test, the same test failing differently in words, another
  check (`command`), another `purpose`, or a run that timed out signs differently.
- `exactOf(run, root)` is the identity a baseline comparison needs: every output line in any order, with only escape
  codes, the workspace's path, an absolute timing in parentheses or a `duration_ms`, and a timestamp taken out. Two
  runs that differ in any other value, name, count or absolute path differ, and a run whose output was kept only in
  part (`cut`) has no exact identity.
- `classify(facts)` reads a failure from facts: a check that did not start, or failed the same way at its baseline, is
  about the environment; a build or a test that fails after a change is `CODE` or `TEST`, with high confidence only
  when the same command passed at its baseline.

Make the smallest change in `src/task/` or `src/orchestration/` that gives this behaviour, and add a regression test
under `test/` that fails before your change and passes after it. Do not change or delete an existing test.
