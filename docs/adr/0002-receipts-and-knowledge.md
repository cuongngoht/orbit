# ADR 0002 — Receipts, and how a verified result reaches knowledge

**Status:** accepted, 1.7.0

## Context
The brief asks the loop to REMEMBER. The source journal comes first, and it is projected into the
project's knowledge afterwards. The projection must be:
- **deduplicated**, so a retry adds nothing;
- **scoped**, so an unrelated commit leaves it alone;
- **honest**, so a pending or failed write is said.

Knowledge's public door (`knowledge record`) accepts only tracked paths as evidence, and it
refuses a `scheme:id` reference. That refusal is right: a model must never cite an engine record
it made up. What was missing was a door for the engine's OWN records.

## Decision
1. **Receipts** (`src/investigation/receipts.mjs`). At a checkpoint, every obligation that reached
   `satisfied`, `violated` or `needs-requirement` on evidence becomes a receipt.
   - Fields: obligation, type, subject, layer, oracle with its revision, outcome, evidence, scope,
     the scope's fingerprints then, context (identity · environment · build), the session that
     produced it, and the engine version.
   - The key is obligation + outcome + sorted evidence + oracle revision. The same result checked
     again appends nothing, and a new one supersedes.
   - The obligation's kind travels as `type`, because `kind` is the journal's own word.
2. **Applicability is scoped** (`src/freshness.mjs`). The scope is the tracked files a result
   rests on: the plan, the linked cases, `graph/effects.json`, and the source files an effect
   cites. The composition root decides the scope. When those files have moved since the receipt,
   the obligation is owed again (rank 4.5, and it says so). An unrelated commit leaves the receipt
   fresh, and a file that cannot be read is `unknown`, never fresh. The build is context only.
3. **Knowledge projection** (`src/investigation/memory.mjs`).
   - **What is projected:** only `satisfied` or `violated` against an ACCEPTED oracle, and only for
     a plan scenario or a control's mapped write. Blocked, exercised or draft-plan results are
     never knowledge.
   - **The claim:** subject (slugged), `satisfies`, the oracle, in the result's context. Its
     evidence is `investigation:<id>#<receipt>`, stamped by the engine. It watches the receipt's
     scope. The source is `investigation`, and the strength is `observed`.
   - **A violated result** names the same triple with `contradicts`. That counts against the claim
     (contested) and never overwrites it; with no claim to count against, it writes nothing.
   - **The door:** `judgeStamped` (`src/knowledge/record.mjs`) holds candidates to the same
     Specification. It accepts only the schemes it is handed, and it resolves each reference
     against the record it names. `ingest` stays the only write.
   - **The public door refuses** a stamped-only source (`SOURCES.investigation.stamped`).
   - **Sessions:** the `seenBy` is the RECEIPT's session, ingested once per session group. A
     replay from this host or another adds no support.
4. **The checkpoint** re-derives findings, appends new receipts, and projects only the receipts
   no earlier checkpoint projected. It records `synced · failed · off`, with why. A failure never
   loses a receipt. `finish` always checkpoints first. The switch is settings `memory.project`, a
   person's choice.

## Consequences
- An investigation claim reaches the `confirmed` authority tier only with two independent
  sessions. It never reaches `source`, because it is unverified by design, like every source that
  exists only in knowledge.
- Knowledge holds what HELD, contested by what was seen to fail. A result that only ever failed
  is the investigation's to report. It is not a claim that something is false.
