# ADR 0057 — An independent evaluator measures a release, and the gate reads its record

## Status

Accepted (0.6.0; backlog E1–E4, R1–R4, Q8), 2026-11-12, the owner's decision. Supersedes ADR 0046, 0047, 0048, 0049,
0051, 0053, 0054, 0055 and 0056 (the in-repo Docker benchmark, its suites, and the autonomous ship that qualified a
release on it). Release tooling and development tooling only: no engine contract changes. Changes what a person runs to
qualify a release: `node skills/orbit-release/ship.mjs` has two modes, `--ci` and `--evidence --evaluation=<record>`;
`--precheck`, `--status`, `--resume` and the autonomous ship are gone, and so is every GitHub workflow.

## Context

1. The benchmark (`benchmark/`, ADR 0046) held Orbit to cases written as data, in Docker, on the branch being built:
   source cases (Orbit's own modules against hidden checks, a planted fault repaired through Orbit), QA cases (does
   autonomous QA find a defect planted in an application, ADR 0047), and engineering, activation, sessions, workflow,
   mission and held-out cases (ADR 0048, 0050, 0053–0056). The ship (ADR 0049, 0051) ran every case, the model-carried
   ones by the real Claude Code CLI, repaired what a case declared repairable, and wrote `evidence.json` for the release
   commit.
2. What it measured was Orbit judged by Orbit. A case passed when Orbit's own records said what the case expected --
   a task's journal, an investigation's verdict, a work's receipts -- read by a judge written beside the product, tuned
   release after release against the same cases. Most 0.4.0 and 0.5.0 "misses" were Orbit defects the cases exposed,
   and fixing them made the cases pass; nothing in it could say whether a coding host WITH Orbit does better work than
   the same host without it, which is the question a release is asked.
3. It was also expensive to keep true. Seventy-nine cases in fifteen suites, a scripted host per control, three Docker
   images, a relay, a judge per kind of case, a ship machine of thirteen modules, and a pipeline whose QA controls ended
   `EXECUTION_ERROR` on hosted runners while they held in a cloud session (0.5.0, backlog Q8): the gate was red where
   nobody released, and green only where a person ran it.

## Decision

**An independent evaluator** (`evaluator/`, its own README) measures what Orbit adds to a coding host from outside.

- **Roles, kept apart.** A task source (local packs converted from the old engineering and held-out cases; SWE-bench
  Verified rows pinned by revision and row digest), an ARM (what is under test), and a grader. A package of its own: no
  dependency, imports nothing of Orbit and is imported by nothing (`test/evaluator-boundary.test.mjs`), export-ignored
  so the archive an agent is handed never holds a hidden test or a gold patch, splittable into its own repository.
- **Arms** differ only by the plugin. `claude` (plain Claude Code), `claude+orbit` at a revision (the previous
  release's tag, or the release candidate's commit: `git archive` of it), and `mini` / `mini+orbit` (mini-SWE-agent,
  a second host, so a gain can be told apart as Orbit's or the host's). The same model, effort, tools, prompt, limits
  and argv in every arm; a fresh container, home and store per run; network only to the model API through an egress
  proxy checked before the agent starts; the credential handed by name.
- **Outcome words**, one per run, from what the controller and the grader OBSERVED (an ordered table): RESOLVED,
  UNRESOLVED, REGRESSED, EMPTY_PATCH, FALSE_DONE, TIMEOUT, BUDGET, INFRA_ERROR, UNGRADABLE -- and NOT_RUN for a run that
  never started (its budget or its credential). The patch is the difference of the start tree and the tree the agent
  left, graded alone by hidden tests in a fresh container with no network; never the agent's word, never Orbit's
  records. INFRA_ERROR and NOT_RUN are excluded from every rate and always listed.
- **Pre-registration.** What runs and how it is judged -- the selection rule and seed, the task order, a development set
  and a held-out set that share no repository, the arms, limits, prompt, outcome table, comparisons, verdict rule and
  budget ledger -- is committed (`evaluator/prereg/<release>.json`) before any model run it governs. A campaign is made
  from it (`prereg campaign <phase>`), never by hand, and freezes its digest. A development pass informs development
  and is never part of the verdict; the held-out set only measures.
- **The verdict rule.** On the held-out set, the release against the plain host and against the previous release, over
  the tasks both have a rated word on: fewer than 4 paired tasks INCONCLUSIVE; a resolved difference of -2 or worse, or
  2 more regressions, REGRESSED; +2 or better IMPROVED; 0 NO_DIFFERENCE; exactly 1 INCONCLUSIVE -- one run of one task
  of a non-deterministic model is noise. The release's verdict is REGRESSED if either comparison is, IMPROVED or
  NO_DIFFERENCE only if both are, else INCONCLUSIVE. The mini comparison is reported (`gate: false`) and not part of it.
- **The record.** `node evaluator/cli.mjs record --campaign=<ids> --out=<file>` writes, from the named campaigns' frozen
  `campaign.json` and journals alone, every run's word per arm, task and trial, the commit each arm ran, the
  pre-registration's path and digest, and the comparisons and verdict by the registered rule. It refuses a mixture: a
  campaign made under another pre-registration, an arm at two commits, a run in two campaigns.

**The gate.** A release qualifies on the fast tier and that record, for the exact artifact:
`node skills/orbit-release/ship.mjs --evidence --evaluation=<record>` is ONE ordered table (`PUBLISH`,
`skills/orbit-release/ship/evidence.mjs`). The first row that fails decides; each says what it read and the one thing a
person does next; every fact is read again there, and only when a row asks:

| row | holds when |
|---|---|
| DIRTY | the checkout has nothing uncommitted or untracked |
| FAST_TIER | every required gate of `--ci` holds, run on this tree |
| NO_RECORD, RECORD_SHAPE | the record is JSON with the shape the evaluator writes |
| OTHER_RELEASE | it is about this tree's version |
| PREREG_MOVED | the pre-registration it names is the committed file, by digest |
| ARTIFACT_REFUSED | HEAD's archive is one a host accepts |
| REV_UNKNOWN, ARTIFACT_MOVED | every release-candidate arm (registered with no revision) ran a commit this repository holds, whose `git archive` has the content of `git archive HEAD` -- both digests computed by the gate (`ship/artifact.mjs`), so a commit touching only export-ignored paths (the evaluator's results, the record) keeps the evidence and any other voids it |
| ARTIFACT_OTHER | an archive given with `--artifact` has that content too |
| INCOMPLETE | every pre-registered held-out run has an outcome word; NOT_RUN only on an arm the verdict does not rest on |
| RECORD_DISAGREES | the record's comparisons are what its runs say, worked out again by the registered rule |
| REGRESSED | the release's verdict is not REGRESSED |
| PUBLISHABLE | it prints the comparison table and says IMPROVED, NO_DIFFERENCE or INCONCLUSIVE plainly |

The gate never tags, pushes or publishes. **No GitHub workflow** (Q8): the gates run where the release is made, and what
a pipeline ran is one command, `ship.mjs --ci` -- whose gates gained the two the pipeline held on its own (zero
dependencies; the control server's Five Lines), with Orbit Control on its own Node
(`skills/orbit-release/panel.mjs`: the server's tests, the panel's install, typecheck, tests and build, the committed
build) reported beside them. Native host and backend acceptance stay optional rows.

## Consequences

- **Deleted:** `benchmark/` (its controller, images, suites, fixtures, judges and scripted hosts), every
  `test/benchmark-*` file and helper, the ship's benchmark machine (`skills/orbit-release/ship/` machine, dispatch, rows,
  steps, session, diagnose, door, policy and its `policy.json`, preflight, report, room, workspace) with its tests and
  `test/fakes/ship-world.mjs`, `test/release-workflows.test.mjs`, and `.github/workflows/`. `.gitattributes` no longer
  names `benchmark/`; the archive rule still refuses `acceptance/`, `integrations/` and `evaluator/` in an archive. The
  rooms an older release left in the machine store (`<store>/benchmark/`, `<store>/release/`) are read by nothing.
- **Kept by the triage (R1):** before the deletion every no-model control's planted fault was applied alone to the
  source and the product suite run against it: of 60 mutations, 38 were killed by existing tests and 22 survived, and
  each survivor is now held by a product test under `test/`. The QA designs the old scripted hosts sent are fixtures
  (`test/fixtures/qa-designs/`), held by the QA contradiction tests. `acceptance/` (product verification the engine
  reads), `test/autonomous-qa-benchmark.test.mjs` with `test/fixtures/benchmark/` (an engine test; the name is history)
  and Live's generic display of a task of provider `benchmark` or `release` stay.
- **No longer proven with a model:** whether autonomous QA finds a planted defect (the QA rows), whether a host activates
  Orbit by itself, what memory buys a second session, a request taken through a coordinated workflow, and a Satellite
  mission. The evaluator grades code changes only; those engine paths are held by the product suite without a model,
  and a model measurement of them is future work for the evaluator, not for an in-repo harness.
- A release's claim is now a measured comparison with its noise said, never "every case passed": an INCONCLUSIVE verdict
  is publishable and is reported as what it is.
- Tests: `test/release-evidence.test.mjs` (the artifact, the fast tier's word, every PUBLISH row alone, and the
  evaluator's own `record` command spawned and its record held by the gate), `test/orbit-ship-plugin.test.mjs` (the
  gates), `evaluator/checks/record.check.mjs`.
