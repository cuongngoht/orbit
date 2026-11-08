# ADR 0051 — Recorded benchmark rows and the precheck

## Status

Accepted (0.5.0; release tooling, backlog B6 and the 0.5.0 release criteria). No engine contract changes. Builds on
ADR 0049 (a release qualifies on Docker benchmark evidence carried by Claude Code), whose catalog, verdict tables and
publish gate it extends, and on ADR 0046 to 0048 (the benchmark the ship drives as a command). Additions to what a
person can observe: `ship.mjs --precheck`, the policy's `recorded` lists, `recorded` in a ship's result, `--status`
and `evidence.json`, a diagnosis bundle in `--status` and in a benchmark run's report, `controls --run-id` and the
`resume` of a control set in `benchmark/run.mjs`.

## Context

1. The 0.5.0 release criteria add benchmark suites (the code-and-QA workflow, memory, Satellite, activation) whose
   model-carried rows nobody has measured yet. Their criteria say such a row starts **recorded, not required**, the way
   `policy.json` `optional` lists native acceptance, and becomes required only by the promotion rule (pass@1 at least
   80% over at least five Opus runs). The ship (ADR 0049) knew one kind of row: required. A new suite named in the
   catalog would have blocked every release until its model rows passed; left out of the catalog, it would have been
   `CATALOG_DRIFT`.
2. The 0.4.0 release took twelve ships over two days. A ship runs about ninety minutes of verifications and controls
   before the first model-carried row, and stops at the first failed row: one release found its failures one at a
   time. The team pre-checked by hand, running the sixteen model-carried rows directly (CLAUDE.md), each with the same
   flags, and read every failure from its run's room.
3. Reading a failure meant reading the room: the relay's log for refusals, the host's whole stream for where a run
   stopped short (`result.stopped`) and how the session ended, the manifest for what the run was allowed. Most 0.4.0
   "misses" were Orbit defects a host could not get past, found that way.
4. A cloud worker restarts every hour or two. Ship 14 found six ways a resumed ship went wrong (backlog B6): images that
   failed to build were never built again; a refused host check blocked again without the host being asked; a run read
   back on resume was judged before the catalog was read, skipping the content-digest part of `WRONG_TREE`; the stage
   stayed ENVIRONMENT while rows ran; an interrupted run was charged its whole allowance; and an interrupted repair was
   UNTRUSTED and spent a repair attempt. And the twenty-minute control set of a source case was the one row a ship
   named no room for before it started, so a restart lost all of it.

## Decision

### Recorded rows are data, and never block

The policy says which model-carried rows a release records: `recorded: { suites: [...], cases: [...] }`. A row is
RECORDED when it is a model-carried row (`run: autonomous`) of a suite or a case named there. A control or a
verification is never recorded: a recorded suite's controls stay required, because a case whose checks do not
discriminate cannot even be recorded honestly. `policyOf` refuses a `recorded` name the catalog does not hold, and the
shipped policy records nothing yet, so every one of the 46 current cases keeps exactly what it requires
(`test/benchmark-release-policy.test.mjs`, beside the catalog held to `benchmark/suites/` both ways: moving a case into
`recorded` fails it, and an earlier ship's evidence no longer publishes, `POLICY_MOVED`).

The ship runs a recorded row like any model-carried row: once, under the normal retries policy (a restart's
interruption runs it again on its own bound, and `--retries` gives a miss another run). What its diagnosis would do --
stop the release, block it, wait for a person -- it is RECORDED as not held instead (`recordedDiag`,
`ship/machine.mjs`): it never fails a cycle, never keeps another model-carried row from running under fail fast, and
never blocks SHIPPABLE, which needs a recorded row only run to an end, held or not. One thing is never recorded away
(`UNEXCUSED`): the credential found in a recorded row's room (`LEAK`) stops the release as it would for a required row,
because a person looks before any release, whichever row's room it was in. The ship's result, `--status` and
`evidence.json` say each recorded row held or not, with its run's room.

`ship.mjs --evidence` re-derives recorded rows like every other row: a required row must be HELD (`INCOMPLETE`), a
recorded row must have a record in the evidence (`UNRECORDED`), and every row's room must still say what the evidence
says of it -- its commit and its outcome, and the coding host for a model-carried row that held (`UNTRUSTED`). A
recorded row that did not hold owes no host identity, and its room is held to what was said of it. The rows the gate
re-derives are the policy's whole catalog as the benchmark lists it now: a case the policy names that the listing does
not hold -- every case, when `run.mjs list` cannot be read -- is `CATALOG_UNREAD`, never a row fewer to hold.

Promoting a row is removing its suite or case from `recorded`, a change to the policy like any other: its digest moves,
and the evidence of an earlier ship no longer publishes.

### The precheck is a ship of its own mode

`ship.mjs --precheck` begins a ship whose manifest says `mode: "precheck"` (`SHIP_MODES`, `ship/machine.mjs`). It is one
task and one room like any ship, so `--resume` and `--status` carry it. It runs only the catalog's model-carried rows --
required and recorded -- each once: no `--retries`, no flaky retry, one cycle; a restart's interruption still runs a
row again. It stops at no failure. It needs no workspace (it repairs nothing) and holds no definition of done, but it
builds the release tree and the images and asks the host first, as a ship does, so a registry's 429 or a refused
credential shows there. Once every row ran, `PRECHECKED` ends it: `PRECHECK_HELD` (exit 0) or `PRECHECK_FAILED`
(exit 2), every row that did not hold said with its run's room and its diagnosis bundle. It fails only as a ship
would: on a required row, or a recorded one no recording excuses (`UNEXCUSED`); a recorded row that did not hold is
said, marked recorded, and leaves the precheck HELD -- the ship on that catalog would be SHIPPABLE. A precheck never
writes evidence, and `--evidence` never takes one for this checkout's newest ship. `--cycles`, `--attempts` and `--retries` are a ship's,
refused before anything starts -- on a resume too, whose `--usd` or `--minutes` is laid over the precheck's own limits
and never brings a ship's back. `--precheck` given with `--resume` of a ship is refused: it never resumes one.

### Diagnosis is read off the run's own records

A benchmark run's report carries a `diagnosis` (`benchmark/lib/core/diagnosis.mjs`): how the host's session ended,
round by round (`FINISH`: interrupted, the deadline, no session, the host's own result subtype); the budget it used
against what it was allowed; and, for a QA run, what the relay refused, what the engine stopped, and where a run a
`step` dispatched stopped short. For that last one, the relay log keeps one thing of an answer of 0: the
`result.stopped` the engine's own allow-listed view said, with its outcome and rule. Nothing else an answer said is
kept. `ship.mjs --status`, and a precheck's ending, print that bundle beside the run's room for every model-carried row
that did not hold. Every number in it is REPORTED, and what nobody said is `unknown`. It decides nothing.

### A resumed ship asks again what blocked it, and judges what it reads back like anything else

- **Images.** A cycle's build is the newest one that built its images. One that could not is asked again on resume.
- **Host check.** A refused host check stands only until a person's resume comes after it in the journal. Then the host
  is asked again, once per resume.
- **Order.** PREFLIGHT, which reads the catalog and each case's declaration, comes before RECONCILE in `NEXT`, so a run
  read back on resume is held to the cycle's content digest and its case's scope.
- **Stage.** A row, and a reconcile that carries one on, restages the cycle's testing stage.
- **Cost.** A run a restart interrupted is never charged its whole allowance. Its cost is UNKNOWN: what its ended rounds
  reported, if anything. It is said beside what was spent, never added into it -- how many such runs there were, and
  what they were allowed between them in dollars (`unknownRuns`, `unknownAllowedUsd` in `--status` and the evidence's
  `totals`), so the spend `--usd` does not count is never unnoticed. It is bounded by `INTERRUPTED_RUNS` (and by the
  resume every interruption takes), not by the budget. This amends ADR 0049's "an unreported one counts at the run's
  cap" for that one case only.
- **Repairs.** A repair whose round a restart cut short is `INTERRUPTED` in `REPAIR_CHECK`: never integrated, it spends
  no repair attempt and is never a repeat. A new repair runs, at most `INTERRUPTED_RUNS` more a cycle, then the ship
  blocks on the environment. A repair the environment blocked, or that bound, is asked again once a person resumes --
  and a repair the environment blocked is no attempt either: it never came to a candidate, so it neither spends one of
  `--attempts` (the last one included) nor makes two blocked runs with one signature a repeat.
- **Controls.** A control set keeps a room of its own (`controls <case> --run-id=<bnr-…>`). The ship names it before
  the set starts, as it does every row's room. A control's row is kept as it ends, and a control carried by a whole run
  has that run's id kept before the run starts. `resume <bnr-…>` carries a cut-short set on: what it kept stands, the
  rest runs, and a control's own run is read back or carried on, never started twice.

### Flag names

A limit out of bounds is refused by the flag a person typed (`--retries is 0..3`), from one table (`LIMIT_FLAGS`), and
before the ship starts a task -- or, on a resume, before anything is journaled: a refused resume leaves a blocked ship
blocked. What a person asks on a resume is laid over the limits the ship has as it stands, so a limit nobody asked
again keeps its value (one set when the ship began, a precheck's own), never the policy's default.

## Consequences

- A new suite can join the catalog the day its controls hold. Its model-carried rows are recorded on every release
  until the promotion rule moves them, and the evidence keeps each recording with its room for the reliability report
  (backlog B2).
- A release's model rows can be looked at in one pass before the ninety minutes of controls. `--precheck` is that pass,
  and it is resumable like a ship. It spends a model budget of its own and qualifies nothing.
- A failed row is diagnosed from `--status`. The room stays the evidence, and the bundle only reads it.
- A worker restart no longer costs a source case's control set, a repair attempt or the budget of a run nobody saw end.
  An interrupted run's real cost is unknown and is said so, with what such runs were allowed. The budget a person sets
  bounds what the hosts reported, and `INTERRUPTED_RUNS` bounds the rest -- which can therefore go past `--usd`, and
  `unknownAllowedUsd` says by about how much: each round's host is held near its allowance by its own budget flag, a
  bound it reports and the ship never verifies.
- A recorded row that never holds still gates nothing. Moving it to required is a person's change to the policy, read
  in review, never the ship's.

## Note, 2026-11-05 (0.5.0) — the effort, and the reliability report beside the evidence

- **The effort is part of the host.** The owner decided that 0.5.0's model-carried rows run on Sonnet 5.5 at medium
  effort (backlog open question 3). `ship.mjs --effort=<level>` (the benchmark's own `EFFORTS`, held equal to the ship's
  by a test, and refused before a ship starts a task) is handed to every model-carried row, every repair and the host
  check, beside `--model`. It is frozen in the ship's manifest when the ship begins: a resume naming another is refused
  before anything is written. A model-carried row, or a repair, whose run's own manifest says another effort is
  `WRONG_EFFORT` (`ROW_VERDICT`, `REPAIR_CHECK`): never that ship's evidence, whatever it came to -- after `LEAK`, which
  it never hides. `evidence.json` says the effort asked (`host.effort`, beside `host.models`) and each row's; `--evidence`
  reads every model-carried row's room again for it, and a row that held must have run at the ship's. A ship that asks
  none holds rows that asked none, as every ship before 0.5.0 did.
- **The reliability report.** SHIPPABLE asks the benchmark for `reliability --revision=<release commit>` -- as a
  command, like every other -- and keeps its answer as `reliability.json` beside `evidence.json`; the result and
  `--status` name it, and the release notes quote it (backlog B2). It is never a gate: nothing reads it to decide, the
  evidence names nothing of it, and a ship whose benchmark could not give one ships as its evidence says and says why. A
  precheck keeps none.
