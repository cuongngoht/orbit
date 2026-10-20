# ADR 0007 — Whose word a requirement is, and what a snapshot keeps

**Status:** accepted, 1.7.0

## Context
An investigation may now start from a PBI. A PBI can be a proposal or the accepted contract, and
an agent reading one decides neither. If a draft requirement could confirm a defect, an
investigation would report a bug against something nobody agreed to. And a requirement's text can
hold anything, so keeping a copy is a redaction problem somebody would have later.

## Decision
1. **Plan sources gain `authority: accepted | draft`.**
   - In a committed plan an absent value reads `accepted`: a person committed it.
   - In a draft plan an absent value reads `draft`.
   - Promotion stamps `draft` on every unqualified source (ADR 0001).
   - A criterion from a draft source prepares tests and never confirms a finding.
   - `code` and `commit` sources stay non-criteria, as before.
2. **The ways in are derived, never declared** (`src/investigation/input.mjs` `INPUT_MODES`,
   first row wins):
   - `hybrid`: a requirement and a screen, where the screen is named or is the one the plan
     names;
   - `pbi`: a requirement and no screen;
   - `screen`: anything else.
3. **What an input record holds.** It keeps its type, ref, revision, a sha digest, whose word it
   is, when it was read and its state. It never keeps the text. The field is `type` and not
   `kind`, because `kind` is the journal's own word for a record.
   - A snapshot is `draft` unless a person relays `--authority=accepted --human`.
   - A source that cannot be read is recorded `unavailable`, and the investigation carries on.
4. **An agent's plan goes in through `autonomous-qa draft-plan`.** The plan rules check it, the
   drafts room keeps it, and it is recorded as an input with `authority: draft`. It is never
   written into a checkout.
