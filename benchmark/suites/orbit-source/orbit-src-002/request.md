# ORBIT-SRC-002 — removing a step a person approves stops asking a person

`src/improvement/oracle.mjs` promises that a candidate successor of a declared playbook may never stop asking a person.
A step declares that it waits for a person with `approval: "owner"`.

The behaviour this source must have:

- A step that waited for a person's approval and, in the candidate, no longer waits -- because its approval was
  dropped, or because the step itself is gone or renamed -- is a weakening reported as `APPROVAL_DROPPED`. This holds
  for an optional step as much as for a required one.
- A required step that is gone is still `REQUIRED_DROPPED`.
- An optional step that waited for nobody, needed no owner's record and held no success rule may be removed without
  any weakening being reported.
- A step that starts waiting for a person is no weakening.
- `safetyOf` refuses such a candidate with `CAND_ORACLE_WEAKENED`.

Make the smallest change in `src/improvement/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
