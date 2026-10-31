# ORBIT-MEM-003 — a lesson counts sessions, never runs, and one session is an observation

Learning turns what several INDEPENDENT sessions keep hitting into a dated lesson. `src/learn/families/failures.mjs`
groups a run ledger's failures into findings, using the arithmetic every family shares in
`src/learn/families/shared.mjs`, and `src/learn/confidence.mjs` grades each finding (`gradeOf`) and decides whether it is
worth writing down (`worthKeeping`). A session is one machine on one UTC day (`src/memory/session.mjs`): three runs in one
sitting are one person hitting one thing once.

The behaviour this source must have, for a finding graded with no lesson kept before it:

- Failures (FAIL, BLOCKED) are grouped per case on the step the ledger records (`failedStep`: `i`, `do`, `on`), or on
  the status when it records none -- so BLOCKED is grouped apart from FAIL, two steps of one case are two findings, and
  two cases are two findings.
- A finding's support (`for`) is the number of independent sessions among its failing runs, never the number of runs.
- A finding's contradictions (`against`) are the sessions that PASSED that case after the last failure of the finding --
  a pass before it is older news -- counted in sessions too: several passes in one later sitting are one.
- The grade, first match wins: contradicted by at least as many sessions as support it, and by two or more, is
  `rejected`; any other contradiction makes it a `candidate`; two or more sessions on a frontend that has moved since
  (the latest failure's `fe_commit` is not the head commit given) is `stale`; two or more sessions is `validated`; one
  session is a `candidate`.
- One session is an observation: printed, never kept. A finding is worth keeping when it is `rejected` or rests on two
  or more sessions.

Make the smallest change in `src/learn/` that gives this behaviour, and add a regression test under `test/` that fails
before your change and passes after it. Do not change or delete an existing test.
