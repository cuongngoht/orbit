# ORBIT-SRC-001 — a candidate never weakens the acceptance oracle it is judged by

`src/improvement/oracle.mjs` decides whether a successor of a reusable definition WEAKENS the acceptance rules of the
version it succeeds, and `src/improvement/safety.mjs` refuses such a candidate before anything runs
(`CAND_ORACLE_WEAKENED`). A candidate may change where a step reads its answer; it may never lower what counts as a
pass, drop a check, or stop asking a person.

The behaviour this source must have:

- A lower bound (`gte`, `gt`) whose value DROPS is a weakening (`RULE_LOOSENED`); one that rises or stays is not.
- An upper bound (`lte`, `lt`) whose value RISES is a weakening (`RULE_LOOSENED`); one that drops or stays is not.
- A required step that is gone, or no longer required, is a weakening (`REQUIRED_DROPPED`).
- A step proven by an owner's record that settles for a report is a weakening (`EVIDENCE_WEAKENED`).
- A step that waited for a person and no longer does is a weakening (`APPROVAL_DROPPED`).
- A success rule that is gone is a weakening (`RULE_REMOVED`); a ruled output whose type changed is one too
  (`OUTPUT_RETYPED`); a change to only WHERE an output is read is not.
- For a role: a completion criterion or a restriction that is gone, or an output contract that changed, is a weakening
  (`CRITERION_REMOVED`, `RESTRICTION_REMOVED`, `CONTRACT_CHANGED`); one added is not.
- Two definitions of different kinds cannot be compared (`ORACLE_UNREADABLE`).
- `safetyOf` refuses with `CAND_ORACLE_WEAKENED` exactly when the oracle of the candidate is weakened, for a playbook
  (`factsOf("skill", …)`) and for a role (`factsOf("satellite", …)`).

Thresholds are any finite number: negative, zero, decimal, large.

Make the smallest change in `src/improvement/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
