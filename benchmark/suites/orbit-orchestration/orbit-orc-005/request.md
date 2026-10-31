# ORBIT-ORC-005 — a goal's intent is held as it was sent

A goal (`/orbit`) is planned from the host model's STRUCTURED reading of it, never from the words of its objective:
the analysis carries an `intent` (`src/goal/intent.mjs`) -- `category`, `workKinds`, `capabilities`, `verification`,
`dependencies`, `missing` -- and the engine validates the reading as it was SENT (`rawFindings` in
`src/goal/candidate.mjs`), then plans the goal's work units from it (`buildPlanUnits` in `src/goal/plan-units.mjs`).

The behaviour this source must have:

- `rawFindings(raw)` reports, all at once and as sentences, everything wrong with what the host sent; a field is
  refused, never dropped:
  - a field of the analysis that is neither declared nor stamped by the engine (`analysis: unknown field "<f>"`), and
    a field the engine stamps (`analysis: <f> is the engine's to say`);
  - no intent at all, or an intent with no `category` or no `workKinds` (`… is required`);
  - a field of the intent it does not declare, an engine-owned one included (`intent: unknown field "<f>"`);
  - a `category` that is not one of the categories, `workKinds` that are not 1 to 5 different work kinds,
    `capabilities` that are not dotted lower-case capability words, `verification` or `dependencies` that are not
    sentences, `missing` rows that are not `{ statement, blocks: [work kind] }`, and text that looks like a secret.
- `buildPlanUnits` plans one unit per work kind the reading names, in the engine's own order (analyze, change,
  investigate, procedure, verify) whatever order they were sent in, each waiting for the one before it; the first is
  `ready` and the rest `planned`.
- A procedure carries the capabilities the reading names; a capability another kind takes by name goes to that kind.
- Every unit of a kind a `missing` row blocks is `unresolved` -- planned, so a person sees it, and never started on a
  guess -- and so is a procedure for which the reading names no capability. An unresolved unit is never what may start
  next, and nothing waiting for it starts.

Make the smallest change in `src/goal/` that gives this behaviour, and add a regression test under `test/` that fails
before your change and passes after it. Do not change or delete an existing test.
