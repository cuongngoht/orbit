# ORBIT-MEM-004 — authority is derived, and a host's memory is never above host-memory

`src/knowledge/vocab.mjs` holds what a project knowledge claim may say, as tables whose every column is documented, and
`authorityOf(claim)` says how far a claim may be relied on: one row of the ladder rule · adopted · source · confirmed ·
host-memory · inference. Authority is computed from what a claim already says -- its `source`, `strength`,
`confidence`, `layer` and its freshness -- and never stored. A claim carries the freshness `measured` now beside the
`status` stamped when it was recorded.

The behaviour this source must have, first match wins:

- `rule`: a gate in this repository enforces it -- `strength` enforced, `confidence` certain and fresh as measured now
  -- or an organisation declared it (`layer` organization, with a strength no observer may claim: enforced or adopted).
- `adopted`: any other claim whose strength no observer may claim (enforced or adopted).
- `source`: a verified source, fresh as measured now, reporting what it demonstrably does (`strength` observed).
- `confirmed`: certain and observed, and never from a host's memory.
- `host-memory`: a claim from a host's memory -- context for one invocation, never truth. Whatever confidence it
  claims, it is never above `host-memory`.
- `inference`: everything else.

Freshness is the one measured now (`measured`), never the status stamped at recording: a moved or unmeasurable scope
must not keep a claim at `source`. A tier, an authority or a binding a claim carries is never read.

Make the smallest change in `src/knowledge/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
