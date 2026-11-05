# ADR 0049 — A release qualifies on Docker benchmark evidence carried by Claude Code, for the exact source

## Status

Accepted (release tooling; no engine contract changes, one additive CLI flag: `cli/task.mjs create --parent`). Builds on
ADR 0046 (the Docker benchmark), ADR 0047 (its QA cases), ADR 0048 (repair controls, failure classes, engineering
cases), ADR 0042 (protected boundaries) and ADR 0016 (one viewer, the journals). Changes what `ship.mjs` requires: native
host acceptance (Grok Build, Antigravity, Codex, Claude Code) and native backend acceptance become optional.

## Context

1. `node skills/orbit-release/ship.mjs` ran the definition of done and read two records -- native host acceptance on
   four hosts, native backend acceptance -- and nothing else. It never built the Docker benchmark, never ran one case,
   and never asked a coding host to do anything. A release could pass with every benchmark case failing.
2. The benchmark had a repair path that works (ADR 0048), and two known findings it keeps as `baseline: "FAIL"`
   (ORBIT-SRC-002, ORBIT-ORC-006). Nothing made a release care: a known finding that still fails was a finding, never a
   blocker.
3. Requiring four hosts' live acceptance for every release meant that a release waited on hosts a team may not have,
   while the one thing that actually exercises Orbit end to end -- the benchmark with a real model -- was not required
   at all.
4. Nothing tied a release to evidence about its exact source: a green fast CI, or a scripted control's PASS, read as
   well as a real run.

## Decision

### One command, a resumable state machine, a journaled task

`ship.mjs` with no flag is the AUTONOMOUS SHIP: PREFLIGHT → BUILD → BENCHMARK → DIAGNOSE → REPAIR → REBUILD → FULL_RETEST
→ SHIPPABLE, an ordered table (`NEXT`, `skills/orbit-release/ship/machine.mjs`) over facts folded every time from ONE
Orbit task (provider `release`, written only through `cli/task.mjs`) and the documents its actions leave in
`<store>/release/<shp-…>/`. Nothing about where a ship stands is kept beside the journal, so `--resume` is safe: an
action that never settled is read back -- a benchmark run that ended is settled from its room, one that did not (or whose
report, written last, does not agree with its ending) is carried on with `run.mjs resume`, never sent again. Orbit Live
shows a session's ship before the benchmark runs it starts; Mission Control shows it and each run (created with
`--parent`) beside it; a person pauses or cancels it there, and the ship stops its child and removes the child's
containers by their label.

### The benchmark is a black box the ship drives as a command

Nothing of the engine imports `benchmark/`, and the release skill does not either: every row is `node benchmark/run.mjs …
--json`, its room read back as files. The benchmark gained only what a ship must ask: `--tree` (measure a pristine
checkout of the release commit while the cases, the harness, the task door and the store stay the person's checkout's),
`--run-id` (the room named and journaled before the run starts), `--parent`, a drifted control as its own row, a
credential block that says its cause, and `doctor --host` (the runner image's Claude Code asked one question through the
egress proxy, on a budget of cents).

### The catalog and the host are policy, as data

`skills/orbit-release/ship/policy.json` names all forty-six cases of the nine suites, case by case -- a case that leaves
a suite, or joins one unnamed, is `CATALOG_DRIFT`. Every source case must hold its controls and PASS its real source
(its `baseline` earns it nothing); every QA and engineering case must hold its controls and PASS when the coding host
carries it; and ORBIT-SRC-001's planted fault must be REPAIRED_VERIFIED by the coding host on the final source: sixteen
model-carried rows a cycle. A row a model carries holds only when its run says basis `coding-host`, the Claude Code
version it reported is the one the runner image pins, and it named its model; a scripted, session or absent host never
satisfies it, and an `ANTHROPIC_BASE_URL` whose host the policy does not name blocks the ship. Claude Code is the one
coding host a release needs. Grok, Antigravity and Codex are never consulted; their acceptance records -- and the native
backend acceptance -- are reported as optional rows that never block.

### Every row is held to its own room

`ROW_VERDICT` (`ship/rows.mjs`) reads the run's manifest, ending and report: the commit, tree and content digest it froze
must be this cycle's, the harness and case digests the ones the ship first saw, no credential in its room, the outcome
one the row requires, and -- for a model-carried row -- the real host. A model-carried run whose report says a round was
interrupted (closed as interrupted when the run was resumed after a restart, its leftovers read back) keeps no identity
of its own: it is `INTERRUPTED`, never evidence, and -- not being the model's miss either -- the row runs again as a new
run, outside `--retries`, at most `INTERRUPTED_RUNS` times a cycle before the ship blocks on the environment; one that
says another host stays `WRONG_HOST`. `CONTROL_RULES` hold each control, with one narrow
rule: a control on a known finding's `real` variant that presupposes the defect (a known-good mutation, a repair control)
is SUPERSEDED, never held, once the case's real source passes the same verifier on the same digest; a FAIL-expected
control (allow-all, reject-all, a planted fault) must still hold, and the case is reported as a person's to bring up to
date.

### Repairs only through the benchmark, integrated only in the ship's own workspace

`DIAGNOSE` (`ship/diagnose.mjs`) repairs only a source case's real variant failing on a cause the case declares
repairable; a QA or engineering case carried by the model is never repaired against its hidden truth (a fix told what a
QA case plants would be fitted to the test), and its failure stops the release with its evidence. A repair is `run.mjs
run <case> --repair` -- Claude Code in the runner driving one Orbit engineering task, judged by the benchmark's
independent verifier. Only REPAIRED_VERIFIED proceeds, and `REPAIR_CHECK` holds it again: `verified.json` names this run,
case and source; the patch is byte-for-byte the one verified; git itself reads what it touches (`apply --numstat`), all
inside the case's scope and outside the policy's protected paths (the harness, the checks, the release, the pipelines),
and no existing test loses a line. Integration is `authorize()`'s AUTO class -- a write to the task's own workspace --
asked before a byte moves: `git apply` into the ship task's workspace (`src/orchestration/workspace.mjs`) and the release
commit made by the delivery (`src/frontend/local-clones.mjs`), never the person's checkout and never its `.git`. The
release commit is a new digest, so every earlier row is stale by construction; REBUILD and FULL_RETEST run the whole
catalog on it. A cycle repairs every repairable case on the newest release commit before it closes, and a model-carried
row never runs on a cycle a repair will invalidate.

### SHIPPABLE is evidence, and publishing asks for it again

SHIPPABLE writes `evidence.json`: the release commit, its git tree, the content digest every run froze, the protected and
policy digests, the artifact (built with `git archive`, held to what a host refuses on the archive itself, digested by
its bytes and by its content), the harness and images, the host (Claude Code, the image's pinned version, the versions
and models reported), every gate, row and repair, and the optional rows. When repairs were integrated, the qualified
source is not the person's HEAD: the ship writes `release.patch` and `release.bundle` and says how to apply them; nothing
is pushed. `ship.mjs --evidence` is the publish gate: `PUBLISH` (`ship/evidence.mjs`) refuses while a ship is pending,
blocked or failed, when the checkout's HEAD tree is not the qualified tree or is dirty, when the protected paths or the
policy moved, when a row the policy requires has no held evidence, when a run's own room no longer agrees, or when the
artifact is not the one. Only PUBLISHABLE exits 0.

### Limits, and what stops a ship

Wall time, USD (REPORTED costs; an unreported one counts at the run's cap and only ever refuses), cycles and repair
attempts per case come from the policy, within its bounds; a person raises them on `--resume`, journaled as their own
action. A spent limit blocks the ship (resumable, the evidence kept); the same case failing with one signature, or one
patch, twice is NO_PROGRESS; the environment, the host or its credential is BLOCKED; everything else that fails is NOT
SHIPPABLE. A resume of a blocked ship is journaled as its own action (`release.resume`), and a row blocked before it runs
again as a new run -- once per resume. The ship never falls back to another host, a scripted host or a model mock.

### CI

`ci.yml` keeps `ship.mjs --ci`: the definition of done, the optional rows, and the autonomous ship AWAITED -- a green fast
CI is never qualification. No workflow runs the autonomous ship or a real coding host (0.5.0, backlog B8): a
model-carried run happens only in a Claude Code cloud session a person starts, where the coding host's credential is an
environment variable of that session, never a repository secret (CLAUDE.md, "Shipping a release from Claude Code
cloud"). The `release.yml` workflow that once ran the ship from GitHub Actions, and the benchmark workflow's
`autonomous` job, are gone; the benchmark workflow keeps its conformance tier (`controls`, `scripted`), which needs no
credential.

## Consequences

- A release is qualified only by a ship that ran every case on its exact source, every model-carried row carried by the
  real Claude Code CLI in the benchmark's runner, and every repair verified independently and retested in full.
- The two known findings block a release until they are repaired: the first autonomous ship repairs them through the
  benchmark, integrates them in its own workspace and hands a person a patch to apply; their stale controls are reported
  for a person to bring the cases up to date. Until a person does, the repository's own case tests fail on the repaired
  source (a repair may not touch them), so the ship that repaired a known finding ends NOT SHIPPABLE at its next gates;
  0.4.0 took the verified repairs, rebaselined both cases in the same commit, and qualified on a second ship.
- A full ship takes hours and a model budget, more than a GitHub-hosted runner holds: it runs in a Claude Code cloud
  session, whose worker restarts every hour or two, and `--resume` carries it on from its journal each time. Each benchmark run keeps its own checkout: a full
  ship keeps a few gigabytes in the machine store.
- A host's model, version and cost are REPORTED and never verified; the verdict never rests on them, and a row with no
  Claude Code identity is never evidence.
- Native host and backend acceptance stay available, recorded as before, and reported beside every ship; they no longer
  block one.
