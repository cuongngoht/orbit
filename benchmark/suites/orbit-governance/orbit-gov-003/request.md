# ORBIT-GOV-003 — a person's DENY is crossed only through Orbit Control's door, and an approval binds exactly one action

`src/protected/authorize.mjs` decides, besides the verdict itself, two things a person's word rests on. `crossing(verdict,
actor, w)` says whether an actor may do, now, what a verdict decided: `{ allowed, by, says }`, where `actor` is what a
composition root could ESTABLISH (`{ door, human, tty, confirmed }`; Orbit Control sets `door: "control"` after its
mutation token). And an approval is bound to a FINGERPRINT of one action -- `fingerprintOf(requestOf(verdict, base))`
for what a task asks a person for, `actionFingerprint(verdict)` for the call that spends it -- so a changed action
cannot spend it.

The behaviour this source must have:

- An AUTO verdict crosses for anybody, with nobody asked: `allowed`, by `AUTO`, whoever the actor is, or none.
- A DENY a person's own act may cross (a primary checkout write) crosses only for an actor at Orbit Control's door
  (`door: "control"`): `allowed`, by `CONTROL`. Nothing else crosses it -- not a terminal, a person typing at one
  (`human`, `tty`, a `confirmed` id typed back), a flag, any other door, an actor that names a role or an approval, or
  no actor at all: refused, by `DENIED`. A terminal cannot prove a person: an agent can make a pseudo-terminal, and it
  knows every id it was shown.
- An approve-once verdict (a push, a production deployment or migration, destructive production data) is never crossed
  by a door, Orbit Control's included: refused, by `APPROVAL` -- only a task's approval of exactly that action lets it
  run.
- Two actions have the same fingerprint exactly when they are one action: a change to any field the boundary binds
  (for a push: repository, remote, URL, ref, commit and force; for a production deployment: artifact, revision, target
  and the call's input; for a production migration: database, migration, digest, target and input; for destructive
  production data: database, table, scope, target and input), to the boundary, or to the destructive operation is
  another action, and a request through another tool is another request. What is only shown (a push's `at`), an identity riding along (`agentRunId`,
  `attribution`, `role`, …) or a note is not what is approved, and the same fields in another order are the same action.

Make the smallest change in `src/protected/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
