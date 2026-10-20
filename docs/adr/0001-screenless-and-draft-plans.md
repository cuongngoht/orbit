# ADR 0001 — A plan about no screen, and a plan an agent wrote

**Status:** accepted, 1.7.0

## Context
Before 1.7.0, a QA plan had to name a screen:
- the placement rule, `planFile` and `qa-plan new` all refused one without;
- `denial.ui` was mandatory in a permission scenario.

A requirement that lives behind an API, or a PBI whose UI does not exist yet, therefore had no
honest home. The only way in was to name a screen it is not about. And an agent investigating a
PBI had nowhere to put the plan it drafted: autonomous QA never writes into a checkout.

## Decision
1. **A plan with no `screen` lives in `screens/_no-screen/`.** This is the reserved folder a case
   with no `start` already lived in, and the plan names its `feature`.
   - It is *no* screen, not a fake one. The map is untouched, and the ui-tests layout keeps its
     shape: one folder per screen, one reserved folder for none.
   - `qa-plan new <id> --no-screen --feature=<f>` writes one.
   - `plan-check` requires that such a plan sits there and names a feature.
2. **The screen's side of a refusal is owed only when there is a screen.**
   - A scenario that states `expect.ui` answers for itself: `n-a` means there is no screen to
     refuse on.
   - One that states nothing owes `denial.ui` exactly when its plan names a screen.
3. **Agent-authored plans are drafts** in `<store>/drafts/plans/`. The room is flat and separate
   from `drafts/cases/`.
   - The loader labels a draft `_draft`, and every view says "a DRAFT in the machine store".
   - A draft is not placed, so the placement rule leaves it alone.
   - Its world includes the draft cases linked beside it. A committed plan's world never does,
     so an agent's case never verifies the team's plan by being linked to it.
4. **Promotion is a person's request** (`cli/draft.mjs promote <id>`, the same command as for a
   case).
   - It runs the plan rules first.
   - It places the plan with `planFile`, never beside another plan with that id and never over
     a file.
   - It **stamps `authority: "draft"`** on every source that does not already say what it is.
     Promoting an agent's plan is not accepting it; a person changes that word in review.

## Deferred
Per-feature folders (`ui-tests/features/<id>/`) wait until a consumer has enough screenless plans
to need them, under the no-speculative-code rule. `_no-screen` stays valid after that, so choosing
it now closes no door.
