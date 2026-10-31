# ADR 0048 — The benchmark proves Orbit's self-healing loop without a model, classifies every failure, and measures goals end to end

## Status

Accepted (development tooling; no engine contract changes). Extends ADR 0046 (the Docker benchmark) and ADR 0047 (its
QA cases). Builds on ADR 0019 (a change is held to what it reaches), ADR 0042 (protected boundaries) and ADR 0044 (run
identity and attribution).

## Context

1. The benchmark had two source cases. Nothing held the governance leaves, memory and learning, self-improvement,
   orchestration, Satellite or the verdict rules to independent checks, so a regression in any of them would ship.
2. The repair path -- `SCOPE`, the regression-test proof, `NEXT`, resume -- could be exercised only by a paid model run.
   Nothing showed that a real repair passes the judge, or that each way of cheating a verifier is refused, without one.
3. `CAUSES` folded different failures into one word: a broken spec read as an invalid benchmark, two disagreeing
   verifications as missing evidence, a candidate that hung as an environment that blocked -- and a candidate that hung
   left every failure denominator altogether.
4. A run had one shape: the subject is Orbit's source, the host repairs it. Nothing measured whether a GOAL -- a bug
   report, a feature, a change across modules, a goal with a rule missing -- is taken through Orbit's own goal entry,
   workflow and engineering task to a verified change.
5. Each run had its report and nothing compared runs: no success rate, no cost per verified outcome, no history by
   revision, and nothing kept a scripted control apart from a model's work.

## Decision

### One candidate definition, three uses

A candidate is a definition (`controls/<id>.json`): exact mutations, files it brings as lines, files it deletes. The
same shape plants an engineering case's variant, drives a scripted host, and builds a candidate for the judge. A
definition that no longer matches is `FIXTURE_DRIFT`, as a variant is.

### Repair controls, carried to the judge or through the engine

A source case may declare `repairs[]`. A **judge** control builds its candidate over the run's own copy of the variant
and holds it to `SCOPE`, the hidden checks, the gates and its own regression test, in the verifier's containers, by the
very rule a round's candidate is held to. An **engine** control is a whole `run --repair` whose host is
`scripted:<id>`: `images/runner/scripted.mjs` drives the round's one engineering task through
`cli/autonomous-engineering.mjs`, decision by decision, making the definition's edits in the task's own workspace, with
no network and no credential. The adversarial set -- a test deleted, weakened or skipped, the harness or a check
touched, a process or a new import smuggled in, a path out of scope, no regression test, one that passes before the
change, a partial fix, a candidate that hangs, a "success" that only prints -- must each be refused BY NAME.

### Every failure has a class

`CAUSES` keeps its rows and gains a `class` column from one fixed taxonomy (`FAILURE_CLASSES`): ORBIT_SOURCE_DEFECT,
BENCHMARK_DEFECT, VERIFIER_DEFECT, ENVIRONMENT_BLOCKED, PROVIDER_FAILURE, INFRASTRUCTURE_FAILURE, NON_DETERMINISTIC,
INSUFFICIENT_EVIDENCE, BUDGET_EXHAUSTED, HUMAN_APPROVAL_REQUIRED, UNKNOWN. A spec that fails its self-test is a
VERIFIER_DEFECT, and `controls` refuses to run on one. A verifier container that fails on the SUBJECT is
INFRASTRUCTURE; on a CANDIDATE, its own time and memory are its own failure (`hidden:probe:TIMEOUT`), its gates are not
run, and it is rejected, never blocked. Only a cause the case declares repairable opens a round.

### NEXT stops what would only spend budget

`WAITING_FOR_PERSON` blocks a run whose engineering task waits for an approval -- a benchmark never approves.
`REPEATED_CANDIDATE` ends a round that left exactly an earlier round's candidate, failing as it did. `CUT_SHORT`
continues a round stopped at its deadline with its task still open. Each round keeps its decision, what it regressed
and improved, and its cost with its basis (REPORTED, or ESTIMATED only to refuse a round). A verified candidate is kept
in `verified.json` -- commit, digests, patch, results, how to reproduce it -- and never applied to a checkout: that
stays a person's act at the primary checkout write boundary. A person's pause or cancel stops a running round's
container within fifteen seconds; the round is read back on `resume`, never sent again.

### Engineering cases: a goal on a frozen fixture, Orbit beside it

`kind: "engineering"` reuses the source flow. The subject is a fixture project under `benchmark/fixtures/` with the
case's variant applied (one behaviour taken away, the public tests that would reveal it deleted), checked out with one
commit; Orbit's frozen source, without the harness, is the plugin beside it. The host is handed the goal, not a repair
brief; no task is started for it. The verdict is the source verifier's plus RECORD checks over what Orbit's owners say,
read back through Orbit's own commands: a change delivered by a completed engineering task, or -- for a goal that
leaves out its rule -- a unit left unresolved for a missing prerequisite and nothing delivered. A case's spec may add
records (an interrupted action closed and taken again as a new action, nothing left running). Whether the change came
through a goal is reported as OBSERVED, beside the verdict, never as its ground. Every runner container of a run goes by
one host name, so a later round can ask whether a process an earlier round recorded still runs.

### Metrics are a fold, apart by host basis

`metrics` folds the kept runs' own records into numerators over denominators -- success, self-healing, detection,
false alarms, regressions, interventions, rounds, time and REPORTED cost per verified outcome, reproducibility, the
verifier's own controls, history by revision -- with what it left out by why and `unknown` when nothing qualifies.
Host basis `none`, `scripted` and `coding-host` are never mixed: a scripted PASS is conformance of the controller and
the engine, never autonomy. A known finding (`baseline: "FAIL"`) that still fails is never counted as a regression.

### CI has three tiers

The fast tier is `node --test` (no Docker). Conformance -- every case's verifier and judge controls in containers, and
scripted hosts through both loops -- runs on a pull request that touches the benchmark. A real coding host runs only
when a person dispatches it, from an environment that holds the credential, inside a budget they give.

## Consequences

- Thirty-one source cases across seven suites and eight engineering cases hold the engine to what it promises. Known
  findings are declared as a `FAIL` baseline with a known-good control and kept until a repair passes them; the first
  repaired this way -- a goal that did not move past a unit whose task ended -- was fixed by a `--repair` run whose
  candidate the verifier passed, applied at a person's request, and its case now plants the defect back as a variant.
- The whole repair loop -- the judge, the engine's loop, the scripted host, `NEXT`, `verified.json` -- is proved in
  every pull request that touches it, with no model and no secret.
- A real host's run is the only evidence of autonomy, and needs a credential; without one it ends BLOCKED, and the
  report names the command that would run it.
- The benchmark never mutates the developer's checkout, `main`, or anything outside a run's room and its containers;
  a scripted host's commands are Orbit's own CLIs as a host runs them, through every gate Orbit already has.
