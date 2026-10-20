# ADR 0003 — A finding keeps its occurrences, and an analysis says which keys are current

**Status:** accepted, 1.7.0 · **Audit rows:** A02 (and the lingering-key risk found in review)

## Context
A finding's key is its family plus its subject, for example `persistence dlg-thing/Save Things`.
When two actions produced the same key, `merged()` kept the **first** finding and only added
evidence to it. So a control that persisted once and lost the row the next time read as
`OBSERVED_EXPECTED_BEHAVIOR`: the defect was on the journal and missing from the view.

Changing what a key contains (for example, giving it the identity it acted as) would have raised
a second problem. The old key's finding stayed "current" forever, because nothing ever
superseded it.

## Decision
1. **Occurrences.** All findings with one key become one finding, and it keeps every occurrence:
   action, outcome, confidence, oracle, evidence, identity and a scrubbed `actual`.
2. **Resolution.** An ordered list picks the headline, and the first outcome any occurrence
   reached wins:
   `CONFIRMED_DEFECT · SUSPECTED_DEFECT · REQUIRES_REQUIREMENT · OBSERVED_EXPECTED_BEHAVIOR ·
   INCONCLUSIVE · BLOCKED`.
   - A later good occurrence never closes a defect, and an earlier good one never hides a later bad one.
   - The headline's `action` is the first occurrence that showed that outcome, so a reproduction
     replays the failing chain.
   - `BLOCKED` sits last because a blocked read says nothing about the product. It never
     outranks an observation that does.
3. **Pattern.**
   - `consistent`: every occurrence has the same outcome.
   - `intermittent`: a defect sits beside the expected behaviour. It gains a need, "n of m
     occurrence(s) showed it".
   - `mixed`: anything else. When the headline is the expected behaviour, the occurrences that
     could not be judged are listed under `missing`.
4. **Order.** Occurrences are resolved **before** a reproduction may downgrade a confirmation.
5. **Identity in the key.** The key gains ` as <identity>` only when an action acted as somebody
   other than the investigation itself. What one identity may do, another may not, so two
   identities are two findings. Keys of single-identity journals do not change.
6. **The `analysis` record.** Each analysis appends the keys the evidence supports now. The
   current findings are then the latest record per key among those keys. A key no analysis
   derives any more stops being current and stays in the history. A journal written before
   analyses existed keeps the old reading: every record nothing superseded.

## Consequences
- The finding record gains `occurrences` and `pattern`, and the journal gains an `analysis` kind.
  All of it is additive and allow-listed.
- Re-analysing a 1.6.x journal on 1.7.0 retires any key the corrected rules no longer derive,
  with nothing deleted.
- The one knob a team may want to turn is the RESOLUTION order, for example reading an
  intermittent defect as SUSPECTED. It is one row in `src/investigation/findings.mjs`.
