# ADR 0005 — The loop: obligations, decisions, steps and stops

**Status:** accepted, 1.7.0

## Context
Autonomous QA ran in phases: plan, then explore the whole plan in one go, then check, then
analyse. The host's model could not choose the next step from what the last one showed. The
engine had no notion of what was still owed. Nothing stopped a crashed write from being clicked
again, and nothing said why the work ended. The brief asks for a ReAct loop in which the host's
model reasons and the engine keeps the state that makes each step checkable and safe.

## Decision
1. **Obligations are derived, never stored** (`src/investigation/obligations.mjs`). There are
   seven kinds, each a row that says where they come from and what settles one:
   - `post-write`
   - `finding-need`
   - `scenario-layer`
   - `tenancy-row`
   - `question`
   - `control-effect`
   - `surface-visit`

   Details:
   - Their statuses are `OBLIGATION_STATES`.
   - A blocked one names who has to act: `environment`, `capability` or `person`.
   - In hybrid mode, a control a plan scenario drives is that scenario's to settle.
   - Three attempts that produced nothing hand an obligation to a person.
   - An open question parks it until a person answers.
2. **The frontier** is the pending obligations in rank order: what a write owes first, then
   suspicions, requirements, tenancy, questions and exploration. Each item carries a template:
   the reach path, or the table and `${TC}` choices for a data check. It never carries a
   guessed predicate.
3. **A decision is judged before anything runs** (`src/investigation/decision.mjs`, ordered
   rules, REFUSED with the rule's id first):
   1. shape and the known `schemaVersion`;
   2. the **forbidden** fields: verdict, outcome, confidence, authority, approved, oracle,
      status, severity. These are refused by name;
   3. only known fields;
   4. the decision id;
   5. a duplicate id: **replayed** if it settled, **AMBIGUOUS** if it never did;
   6. short text;
   7. **STALE** unless `expectedRevision` equals the journal's position;
   8. the lifecycle;
   9. the target is in the frontier;
   10. evidence refs resolve;
   11. the action fits the target and its fields;
   12. the mode;
   13. **READ_BACK_FIRST**: nothing that writes while a writing step is ambiguous;
   14. the budget.
4. **A step is written down, run, then settled** (`src/investigation/loop.mjs`).
   - Under the journal lock: judge and record the `decision`. Release the lock.
   - Dispatch through the SAME operation and gates the CLI uses (`src/investigation/dispatch.mjs`
     `ACTIONS`: act, check-data, security, reproduce, run-case, ask). There is no free-form step
     and no command string.
   - Re-derive findings.
   - Under the lock again: append `settled`, with the records the step produced, whether it made
     progress, and a snapshot of what is owed.
   - The lock never nests and is never held across the step.
5. **`run-case` is bound by the composition root.** It spawns `cli/run-case.mjs` by path, argv
   only, through the process port, then triages the result. A case that writes needs
   explore-write. Parameters are synthetic TC- values only. The run records whether it was an
   accepted case or a draft, and a draft's failure is SUSPECTED at most.
6. **Lifecycle** is `active · paused · completed · cancelled`, derived from the journal.
   - `finish` records the stop the engine can justify (`src/investigation/stop.mjs`) and writes
     the report. Only `completed-scope` completes. Everything else pauses, including
     `stopped-early`, where the agent stopped with work open.
   - `resume` restarts the minutes budget, stamped with the world's clock. The action and
     decision budgets are cumulative and never reset.
   - `release --human` is a person's word that a step which never settled was looked at.
7. **The journal has a schema.** `created.schema: 2`. The fold refuses a newer one rather than
   dropping records it does not know.

## Consequences
- The CLI gains: context (JSON, and writes nothing), step (the decision on stdin), finish,
  resume, answer --human, release --human, protocol and draft-plan.
- The old commands and `explore` keep working. The loop is the new way in, not the only one.
- Budgets `limits.decisions` (50) and `limits.noProgress` (4) are provisional, to be measured
  against the benchmark.
