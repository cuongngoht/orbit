# ORBIT-MEM-001 — one session is one machine on one UTC day, and a named session is counted by its name

`src/memory/session.mjs` is the one definition of what counts as ONE session. Learning counts independent
confirmations with it: two independent sessions earn a lesson, one is an observation, and three runs in one sitting are
one person hitting one thing once. Where a coding host names its session, the observation carries that name in
`session`; where nothing named it (a record typed at a shell), it has none.

The behaviour this source must have:

- `dayOf(run)` is the UTC date of the run's time, as `YYYY-MM-DD`.
- `sessionId(a)` and `sessionId(b)` are equal exactly when the two runs ran on the same machine (`host`) on the same
  UTC day, however many hours apart. `independent(runs)` is the number of distinct machine-and-day sessions among the
  runs: three runs in one sitting are one, another UTC day (even a minute across midnight) or another machine is
  another, and no runs are none.
- `sessionMarks(seen)` are the marks an observation leaves in a list, and `knownIn(list, seen)` says whether `seen` is a
  session that one of the observations whose marks are in the list already was:
  - two named observations are the same session exactly when their names are equal, whatever machine or day -- two
    people on one laptop are two sessions, and one session across midnight is one;
  - two unnamed observations are the same session exactly when machine and UTC day are equal;
  - a named and an unnamed observation on the same machine and UTC day are the same session, whichever of them was
    counted first; on another machine or another day they are independent.

Times are ISO-8601 in UTC with a trailing `Z`, as the engine writes them.

Make the smallest change in `src/memory/` that gives this behaviour, and add a regression test under `test/` that fails
before your change and passes after it. Do not change or delete an existing test.
