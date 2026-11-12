# Provenance

The local task packs under `tasks/packs/` were converted from the CHANGE cases of the plugin repository's old in-repo
Docker benchmark (`benchmark/`, ADR 0046-0056), which judged the plugin by its own record words and is to be deleted
once this evaluator runs. What came from where:

| pack | old case | suite |
|---|---|---|
| orders-e2e-001 .. 006 | ORBIT-E2E-001 .. 006 | orbit-engineering (fixture `orders`) |
| lending-hld-001 .. 004 | ORBIT-HLD-001 .. 004 | orbit-heldout (fixture `lending`, the held-out application) |

Each pack's `pack.json` names its case, the case's version and the sha256 of its `case.json`. The converter
(`lib/tasks/convert.mjs`, `node cli.mjs packs convert --from=<benchmark dir>`) read the old files as data and imported
none of them. The cases left out, and why, are in `tasks/packs/EXCLUDED.md`.

What changed in the grading: the old harness held a candidate to its scope rules and to the plugin's own records (a
deleted test was refused by name); this evaluator grades only by the hidden tests, after putting every graded test file
back as the start had it. A cheat that carries the reference change and only edits a test therefore resolves here, and
each pack's `controls.cheat.graded` says so.
