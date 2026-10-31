# ORBIT-SAT-004 — a mission completes only when every criterion is verified by an independent owner

Satellite never takes an agent's word for an outcome: every reference a report names is read back from the owner that
keeps it, as an evidence row `{ owner, ref, level, independent }`. Levels, weakest first: UNKNOWN, BLOCKED,
TOOL_COMPLETED, CONTRACT_MET, BEHAVIOR_OBSERVED, VERIFIED. Only an engineering task's own record (`task`), a check its
runner ran (`check`) and a QA investigation's outcome (`investigation`) are independent; the run's own report, a
handoff, a definition, a file and the checkout witness are not.

`satellite/src/mission/conclude.mjs` decides how an agent run ENDS: `outcomeOf({ unit, rows, state })`, where `state`
is what the run itself said (`reported` or `blocked`) and the unit carries a `verificationContract: { min, owner }`
(`owner` is `any` or `independent`). The first row of this table that holds is the outcome:

1. `blocked` — the run said it could not go on.
2. `violated` — the checkout changed while the run was open (a `checkout` row at BLOCKED).
3. `succeeded` — some evidence row is at or above the contract's minimum level and, when the contract asks for an
   `independent` owner, comes from an independent owner. Evidence nobody independent holds never reaches such a
   contract, however strong it is.
4. `blocked` — an owner's record is BLOCKED.
5. `insufficient` — everything else.

`satellite/src/evidence/verdict.mjs` derives a mission's VERDICT: `verdictOf(m, settled)` answers
`{ verdict, acceptance, owed }`. A row counts only when it comes from a run that ended `succeeded` after its unit's
last reset (the run's line `n` is past the unit's `resetAt`). The verdict is `VERIFIED` only when the mission recorded
at least one acceptance criterion, every criterion has a counted row VERIFIED by an independent owner, and no action
is still open; otherwise it is `NOT_VERIFIED` once settled and `PENDING` before. A mission that recorded no
acceptance criterion (one never analyzed) is never VERIFIED. `owed` names every criterion that is not verified, by its
id.

Make the smallest change in `satellite/src/` that gives this behaviour, and add a regression test under
`satellite/test/` that fails before your change and passes after it. Do not change or delete an existing test.
