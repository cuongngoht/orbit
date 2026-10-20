# The decision protocol — one step of the loop

The fields, the step kinds, the obligation states and the stop reasons are printed from the
engine's own tables:

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs protocol
```

This page says how to use them. It does not copy them; when this page and `protocol` disagree,
`protocol` is right.

## A decision

```json
{
  "schemaVersion": 1,
  "decisionId": "save-read-back-1",
  "expectedRevision": 18,
  "target": "obl-05c5d2e59d",
  "action": { "kind": "check-data", "action": "act-4", "query": "SELECT COUNT(*) AS n FROM Things WHERE Name='${TC}'", "expect": 1 },
  "evidenceRefs": ["act-4", "obs-11"],
  "hypothesis": "the save answered 201 but wrote nothing",
  "reason": "a write's read-back comes first"
}
```

- **`decisionId`**: yours, and unique in the investigation. Sending the same one again is SAFE.
  - If it settled, you get the same answer back (`replayed: true`) and nothing runs twice.
  - If it never settled, it is `AMBIGUOUS`: read back what it did. Never send it again.
  - The same id for a DIFFERENT step is refused `ID_REUSED`. In a new session, name your
    decisions afresh (a prefix of your own), never from 1 again.
- **`expectedRevision`**: the `position` from the `context` (or the last response) you decided on.
  If the journal has moved since, the decision is refused `STALE` and you read again.
- **`target`**: an obligation id from the frontier. Anything else is refused `TARGET`, with the
  obligation's current state when it is one.
- **`action`**: one step kind with its own fields, and nothing else.
  - The target lists the kinds that can settle it (`can`), and its `template` shows the shape.
  - Take the table and the `${TC}` choice from the template; write the predicate yourself. A
    predicate is never guessed for you.
- **`hypothesis`** and **`reason`**: short text, at most 240 characters. They say what you
  expect and why, never a chain of thought.
- **Never** `verdict`, `outcome`, `confidence`, `authority`, `approved`, `oracle`, `status` or
  `severity`. They are refused by name, because the engine derives them from evidence.

## What comes back

A step's answer holds:
- `state` (`done`, `refused`, `blocked`);
- the records it produced (`refs`), which you can cite as evidence;
- `progress`, whether anything new was learned;
- `changed`, the obligations whose status moved;
- the current `findings`, the `budget`, `next` (the frontier's head) and `stop`.

`state: done` says the step ran. It never says the product is right. A step refused by a gate
(an unapproved mode, a signed-out session, a destructive control) is `refused`, and nothing
about the product follows from it.

## Obligations, briefly

`context.frontier` holds only `pending` obligations, in rank order:
- a write's read-back;
- a suspicion to settle;
- a plan scenario's layers;
- tenancy rows;
- questions;
- controls to exercise;
- screens to look at.

A satisfied obligation whose receipt's files moved since comes back into the frontier, and it
says so.

Three attempts that produced nothing new hand an obligation to a person. Asking the same read
again and getting the same answer is not new. A question you `ask` parks what it is about until a
person answers.

The plan's own word comes first. A manual scenario, a scenario that is not ready, a destructive
case and a case that failed are a person's to settle, never yours to retry.

## Ending

`finish` does three things: it checkpoints, it records the stop the engine can justify, and it
writes the report. Only `completed-scope` completes an investigation; every other reason pauses
it, and `resume` continues it.
