# ORBIT-VER-001 — PASS is earned: a verdict executed over the whole case, never defaulted

`src/run/status.mjs` decides the status a finished run DESERVES, as distinct from the one it reached. A run's `status`
starts at `PASS` and is only ever downgraded by a step that stopped the loop, so reaching the end of a slice with
nothing thrown proves less than it sounds. `finalStatus(run)` answers the final word, where `run` is
`{ status, verdicts, from, to, c: { steps } }`: the status the loop reached, how many of the case's verdicts EXECUTED
(a counter that starts at 0), and the slice it ran -- steps `from` to `to`, counted from 1 and inclusive -- of the
case's `steps`. `whole(run)` says whether that slice covered the case from its first step to its last.

The behaviour this source must have:

- A status other than `PASS` -- `FAIL`, `SKIP`, `BLOCKED`, `REFUSED` -- is never judged again: it is the answer,
  sliced or whole, with or without verdicts.
- A `PASS` that executed no verdict is `INCONCLUSIVE` (exit 4): a counter still at 0, or no count at all. That holds
  for a slice too: proving nothing outranks running part.
- A `PASS` that executed at least one verdict over a slice that is not the whole case is `PARTIAL` (exit 0).
- Only a `PASS` that executed at least one verdict over the whole case stays `PASS`.
- `whole(run)` is true exactly when the slice starts at step 1 and reaches the case's last step (a `to` past the last
  step still reaches it). A slice that starts after step 1, or stops before the last step -- even by one step -- is not
  the whole case.

Never widen what PASS covers: it is the one word that means this case was verified.

Make the smallest change in `src/run/` that gives this behaviour, and add a regression test under `test/` that fails
before your change and passes after it. Do not change or delete an existing test.
