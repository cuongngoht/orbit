# ORBIT-ORC-004 — a decision that asserts what the engine derives is refused by name

The host's model chooses an engineering task's next step and sends it as a decision; `src/orchestration/decision.mjs`
holds it to the protocol before anything is written or run. `judgeForm(d)` asks the form rules alone -- is it a
decision at all -- and refuses with `Refused`, the rule's id first (`<RULE>: <sentence>`), or lets the decision through.

A decision carries only the fields the vocabulary declares (`DECISION_FIELDS` in `src/orchestration/vocab.mjs`). It may
never ASSERT anything the engine derives from evidence -- whether something worked, where the task stands, what a
failure is, whether a person allowed something: the fields in `DECISION_FORBIDDEN` (`outcome`, `verdict`, `status`,
`passed`, `succeeded`, `success`, `done`, `completed`, `stage`, `signature`, `failureSignature`, `class`, `confidence`,
`approved`, `granted`, `human`, `door`). One sent anyway is refused by name, never ignored.

The behaviour this source must have:

- A decision that carries a forbidden field is refused as `FORBIDDEN`, and the refusal names every forbidden field it
  carries, whatever value the field holds: carrying it is the assertion.
- A decision that carries a field neither declared nor forbidden is refused as `FIELDS`, naming that field.
- A decision whose `action` is not an object whose `kind` is one of the action kinds is refused as `ACTION`.
- Anything that is not a JSON object with `"schemaVersion": 1` is refused as `SHAPE`.
- A forbidden field beside another problem -- an unknown field, an unknown action -- still gets the decision refused,
  and the forbidden field is named.
- A well-formed decision, for any action kind, with or without its optional fields, passes the form.

Make the smallest change in `src/orchestration/` that gives this behaviour, and add a regression test under `test/`
that fails before your change and passes after it. Do not change or delete an existing test.
