# ORBIT-SAT-001 — a write rides only the owner it names, never a reading mode or a READ_ONLY profile

`satellite/src/permissions/evaluate.mjs` is the policy check every Satellite action passes before anything is
dispatched. `evaluate({ profile, operationKind, mode, provider, grants })` judges the profile an actor works under,
the operation kind it carries, the mode it works in, the provider it goes through and the operation kinds it was
granted TOGETHER, in one ordered table. The first row that fails denies, and the answer names that row
(`{ verdict: "deny", rule }`); when no row fails the answer is `{ verdict: "allow", rule: "ALLOW" }`. A role's name is
never asked, only the profile.

The behaviour this source must have, in the table's order:

1. `UNKNOWN_KIND` — an operation kind Satellite does not know.
2. `UNKNOWN_MODE` — a mode that is not one of the nineteen.
3. `UNKNOWN_PROFILE` — a profile that is not a permission profile.
4. `WRITE_IN_READ_MODE` — an operation kind whose effect is `store` or `write`, in a reading mode.
5. `WRITE_ON_READ_PROFILE` — an operation kind whose effect is `store` or `write`, under the READ_ONLY profile.
6. `MODE_FORBIDS` — a mode that does not carry the operation kind.
7. `PROFILE_MODE` — a profile that does not work in the mode.
8. `PROFILE_FORBIDS` — a profile that does not carry the operation kind.
9. `OWNER_REQUIRED` — a write kind names the only owner it may happen through, and anything else is refused:
   `source.patch`, `check.run` and `sandbox.test.run` happen only through an engineering task (provider
   `engineering`), never through the engine, a host's agent or any other provider. A read or store kind names no
   owner and may go through any provider.
10. `NOT_GRANTED` — an operation kind the grants do not hold.

The modes, the operation kinds with their effects and owners, and the profiles are the vocabulary as it stands in
`satellite/src/execution/modes.mjs`, `satellite/src/permissions/operations.mjs` and
`satellite/src/permissions/profiles.mjs`.

Make the smallest change in `satellite/src/` that gives this behaviour, and add a regression test under
`satellite/test/` that fails before your change and passes after it. Do not change or delete an existing test.
