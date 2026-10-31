# ORBIT-IMP-004 — a regression and an opportunity need independent sessions, never session marks

Self-improvement reads ordinary work's runs off their owners' records -- a declared playbook's run as
`{ task, run, pin, word, at, session, host, steps }`, a role's as
`{ kind: "satellite", mission, run, rolePin, at, session, host, outcome, level, signature }` -- and three modules
decide what those runs amount to:

- `src/improvement/signals.mjs`: `independent(runs)` and `sessionKeys(runs)` count the INDEPENDENT sessions runs came
  from, and `groupsOf(records)` gathers the runs of one version that showed one problem.
- `src/improvement/monitor.mjs`: `observationOf({ records, values })` watches a promoted version's later runs.
- `src/improvement/detect.mjs`: `analyse({ groups, kept, campaigns, values, now })` says which problems are
  opportunities.

`values.improvement.minSessions` is 2 and `values.improvement.minRuns` is 3 unless the settings say more.

The behaviour this source must have:

- A session is one machine on one UTC day (`host`, and the UTC date of `at`), as learn counts it. Runs hours apart on
  one machine and day are one session; another machine or another UTC day is another. A session mark (`session`) is
  never counted: a shell can set it, so different marks on one machine and day are still one session, and the same
  mark on two machine-days is two. `independent` and `sessionKeys` always agree on the count.
- `observationOf` decides in this order: the definition's own failure (a signal of the `definition` category) back in
  at least `minSessions` independent sessions is `REGRESSED`; fewer than `minRuns` runs, or runs from fewer than
  `minSessions` independent sessions, are `INSUFFICIENT`; runs more than half of which the environment stopped are
  `CONFOUNDED`; runs that held in at least `minSessions` independent sessions are `STABLE`; anything else is
  `INSUFFICIENT`. A run still open says nothing. The definition's failure repeated inside one sitting, under any marks,
  is never `REGRESSED`, and a provider's failure is no regression either.
- `analyse` over `groupsOf` holds each problem, in this order (with no campaign open, cooling down or at its cap): a
  problem an environment or a provider caused is `NOT_A_DEFINITION_DEFECT`; one shown by fewer than `minRuns` runs is
  `TOO_FEW_RUNS`; one shown in fewer than `minSessions` independent sessions is `TOO_FEW_SESSIONS`; one whose version
  also held in at least as many independent sessions as showed it is `CONTRADICTED`; anything else is `ELIGIBLE`. Runs
  repeated inside one sitting, under any marks, are one observation -- for a problem and against it.

Make the smallest change in `src/improvement/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
