# ORBIT-IMP-003 — twelve promotion gates in order, and a reported run never proves

`src/improvement/gates.mjs` holds the PROMOTION GATES a qualified candidate successor of a reusable definition passes
before it may be chosen to run for new work. `gatesOf(c)` asks every gate about the facts a campaign gathered --
`c: { m, aggregate, open, candidate, validation, current, weakened, widened, runs, regressions, values, door,
revisionOk }` -- and returns one row per gate, `{ id, holds, onFail, say }`; `decisionOf(rows)` returns
`{ decision, gate, because }`.

The behaviour this source must have:

- Every gate is asked every time, in this order, each with what happens instead when it does not hold:
  1. `CANDIDATE_INTACT` (`reject`): the candidate read back by its pin is intact and is the digest that was staged.
  2. `CAPABILITIES_PROVIDED` (`reject`): its owner's contract still holds it (`validation.ok`).
  3. `PARENT_CURRENT` (`supersede`): the version it was compared with is still the one in place.
  4. `EVALUATION_COMPLETE` (`wait`): the evaluations together say `BETTER`, and none is still open.
  5. `EVIDENCE_INDEPENDENT` (`wait`): they came from at least `minSessions` independent sessions (2 unless the
     settings say more), and every candidate run is evidence (below).
  6. `REQUIRED_CHECKS` (`reject`): there are candidate runs, and every one met every required check.
  7. `NO_CRITICAL_REGRESSION` (`reject`): no step the baseline met newly failed on the candidate.
  8. `NO_NEW_PERMISSIONS` (`reject`): it asks for nothing the version it succeeds did not have.
  9. `ORACLE_UNCHANGED` (`reject`): no acceptance rule of the version it succeeds was weakened.
  10. `NOT_WITHHELD` (`block`): the version in place is `active`, and a person has neither archived nor revoked it.
  11. `POLICY_ALLOWS` (`await`): a person promotes it in Orbit Control (door `control`), or `improvement.promote`
      (on unless a person turned it off) lets the engine promote.
  12. `REVISION_CURRENT` (`stale`): the campaign is still the revision the decision was made on.
- The first gate that does not hold decides: its outcome is the decision, and it is named as the gate. When every gate
  holds, the decision is `promote` and no gate is named.
- A candidate run is evidence only when the engine bound it (`RUNTIME_BOUND`) or the host's own payload linked it
  (`HOST_OBSERVED`). A run that was only `REPORTED`, an `UNATTRIBUTED` one and a `CONFLICTING` one prove nothing --
  however many independent sessions there are, and whoever is promoting.
- A person's switch always wins: a version in place that is not `active`, is archived or is revoked holds every
  promotion, through either door.
- A person's door passes the policy gate and no other.

Make the smallest change in `src/improvement/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
