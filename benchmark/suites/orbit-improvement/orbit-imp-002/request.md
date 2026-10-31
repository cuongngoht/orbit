# ORBIT-IMP-002 — a candidate is better only in independent sessions, and one worse evaluation rejects it

`src/improvement/evaluation.mjs` reads every evaluation of a self-improvement campaign TOGETHER: `aggregateOf(evaluations,
values)` takes the campaign's evaluations -- each `{ evaluation, host, at, session, settled: { verdict } }`, where
`settled` is there only once the evaluation settled -- and the effective settings (`values.improvement.minSessions`,
2 when it is not set), and returns `{ verdict, because, sessions, evaluations }`.

One evaluation is an observation, never a conclusion. The behaviour this source must have, decided in this order:

- One settled evaluation that found the candidate `WORSE` rejects it: `WORSE`, however many found it better.
- The candidate is `BETTER` only when the evaluations that found it better came from at least `minSessions`
  INDEPENDENT sessions and no evaluation found it `EQUIVALENT`.
- It is `EQUIVALENT` when the evaluations that found no measurable difference came from at least `minSessions`
  independent sessions and none found it better.
- When every settled evaluation was stopped (`BLOCKED`), the aggregate is `BLOCKED`.
- Anything else -- too few independent sessions, or mixed evidence -- decides nothing: `INCONCLUSIVE`.

An evaluation that has not settled says nothing, and one that was stopped (`BLOCKED`) or could not decide
(`INCONCLUSIVE`) says nothing for the candidate or against it.

Independence is learn's own rule: a session is ONE MACHINE ON ONE UTC DAY (`host`, and the UTC date of `at`).
Evaluations on one machine on one UTC day are one session, however many there are and however many hours apart. A
session mark (`session`) is never counted: a shell can set it, so two marks on one machine and day are still one
session, and the same mark on two machine-days is two.

Make the smallest change in `src/improvement/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
