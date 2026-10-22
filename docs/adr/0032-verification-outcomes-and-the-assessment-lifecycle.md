# ADR 0032 — Verification outcomes and the assessment lifecycle

## Status

Proposed (0.1.0). Extends ADR 0002 (receipts), ADR 0005 (the loop), ADR 0015 (Live is delivery) and ADR 0020 (an
observation beside a journal).

## Context

1. **Nothing in the journal records a generated test's life.** The investigation journal is schema 2 with 21 kinds
   (`src/investigation/vocab.mjs:119`). It has no line for an obligation discovered from a requirement, a test
   designed, a version frozen, an execution authorised, an observation window closed or a result evaluated.
2. **No word for what a generated test came to.** Runner statuses (`src/run/status.mjs`) say what a run did.
   Investigation OUTCOMES (`vocab.mjs`) say what the evidence says about the product. Neither says whether a
   generated test was invalid, missing a capability, blocked by authorisation, ambiguous, flaky or stale.
3. **Evidence can outlive what it ran.** A draft is overwritten in place, and promotion deletes it
   (`src/draft/index.mjs:33-42,69-93`).
4. **The fold mislabels its own refusal.** It refuses every schema but its own while saying the journal was "written by
   a newer engine" (`src/investigation/model.mjs:34`).

## Decision

- **Milestones are journal kinds.** These join `KINDS`, each an allow-list: binding, discovery, obligation, designed,
  version, validated, authorized, prepared, started, observed, evaluated, assessed, published, cleanup, applicability.
  - A `MILESTONES` table maps them to the plan's words (OBLIGATION_DISCOVERED … REPORT_PUBLISHED). The views are
    generated from it.
  - A scheduler waiting, a consumer retrying and a worker processing are observations INSIDE TEST_RUNNING. There is no
    competing lifecycle per broker.
- **Journal schema 3.** A schema-2 journal is reported and kept byte for byte, never migrated. The refusal names the
  schema it saw and the one it reads.
- **One fold, each event once.** Every new line carries an `eventId`. `appendOnce` is a no-op for an id already in the
  journal, and the fold folds each id once. There is no `state.json`: the investigation's journal is canonical, and a
  task keeps only links and owners' receipts.
- **`VERIFICATION_OUTCOMES` is a table of its own** (`src/investigation/verification.mjs`).
  - Outcomes: GENERATION_FAILED, INVALID_TEST, CAPABILITY_MISSING, AUTHORIZATION_BLOCKED, ENVIRONMENT_BLOCKED,
    EXECUTION_ERROR, INCONCLUSIVE, REQUIRES_REQUIREMENT, CONTRADICTED, SATISFIED, FLAKY, NON_REPRODUCIBLE, STALE,
    AMBIGUOUS.
  - Columns: `counts` (true only for SATISFIED); `defect` (true only for CONTRADICTED); the loop state it moves an
    obligation to; whether a retry is safe, needs a read-back, or never happens.
  - REPORT_FAILED belongs to a report, not a result.
  - Runner statuses and exit codes are unchanged. A FAIL is never mechanically a defect: an assertion's syntax error is
    a test error.
- **A result is read back from its owners.** Ordered `RESULT` rows decide it over facts the owners keep:
  - triage's status and cause;
  - Runtime's receipts;
  - observation completeness;
  - the bindings' authority now;
  - the mapping;
  - control pairing.

  An invocation is never proof. An acknowledgement never satisfies a state obligation.
- **Artifacts are written once, by digest.** A new `artifacts/` sub-room of the investigation holds bindings,
  obligations, designs, versions, results, assessments, graphs and catalogs.
  - Identical bytes are a no-op. Different bytes under one digest are refused and the stored file is kept.
  - Every read checks the digest again.
  - A run is bound to a FROZEN case version, run by its path, its digest checked before and after.
- **Coverage counts only SATISFIED results on current revisions**, per obligation and never per delivery attempt. An
  empty scope reads "—". A stale or draft-only result raises nothing.
- **An assessment is a frozen snapshot.** A report renders only from it: REPORT_FAILED re-renders and never re-runs.
  Late evidence makes a new assessment revision.
- **In-run progress is an observation beside the journal** (`activity/<execution>.jsonl`, the ADR 0020 pattern). The
  journal's position is the revision every decision names, so a progress line in it would make the next decision STALE.

## Consequences

- Investigations begun under 0.0.4 must be started again.
- Live gains an activity row per new kind. The `unchosen` test keeps every kind choosing.
