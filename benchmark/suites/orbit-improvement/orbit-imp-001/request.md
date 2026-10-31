# ORBIT-IMP-001 — a step newly failed makes a candidate worse, whatever else it improved

`src/improvement/evaluation.mjs` judges ONE evaluation of a candidate successor of a reusable definition against the
version it would replace (the baseline). `verdictOf(e)` reads the evaluation's run lines -- each
`{ side: "baseline" | "candidate", n, met, failing: [step], blocked, … }`, run n of one version beside run n of the
other, on the same frozen inputs -- and returns `{ verdict, because, regressions }`.

The behaviour this source must have, decided in this order (the first that holds decides):

- A run that was stopped (`blocked`) compares nothing: `BLOCKED`, whatever the other runs show.
- Two versions that did not run the same inputs -- no baseline run at all, or a different number of runs on each side
  -- decide nothing: `INCONCLUSIVE`.
- A step the candidate failed on an input where the baseline did not fail it is a regression. Any regression makes the
  candidate `WORSE`, whatever else it improved -- even when it met more runs than the baseline. Every such step is
  named in `regressions`; a step both versions failed on that same input is not.
- A baseline that met every run did not reproduce the failure, so nothing was improved on: `INCONCLUSIVE`.
- Otherwise a candidate that met more runs than the baseline is `BETTER`, one that met fewer is `WORSE`, and one that
  met as many is `EQUIVALENT`.

What a run cost -- its calls, retries and time -- never decides a verdict.

Make the smallest change in `src/improvement/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
