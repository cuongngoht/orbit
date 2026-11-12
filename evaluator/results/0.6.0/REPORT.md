# Orbit 0.6.0 — independent evaluation report

Evaluated 2026-11-12 by `evaluator/` (an independent package: it imports nothing of Orbit, and Orbit imports nothing of
it). Every result below was graded by **hidden tests the agent never saw**: the official SWE-bench harness for
SWE-bench rows, and the pack's hidden node tests for local packs. The agent's own word and Orbit's internal records
were never used to grade. Nothing here was edited by hand. The machine-readable record is `record.json`, and each
campaign's export sits beside it.

## Verdict

| Comparison (pre-registered, primary) | Paired tasks | Resolved | Verdict |
|---|---|---|---|
| Claude Code + Orbit 0.6.0 against plain Claude Code | 6 | 5 / 5 | **NO_DIFFERENCE** |
| Claude Code + Orbit 0.6.0 against Claude Code + Orbit 0.5.0 | 6 | 5 / 5 | **NO_DIFFERENCE** |

The release gate, run on release commit 6b25eb9 (`node skills/orbit-release/ship.mjs --evidence
--evaluation=evaluator/results/0.6.0/record.json`), answered:

```
PUBLISHABLE: the fast tier held on this tree, the evaluator's record holds for this very artifact (39ee159ff8e6),
complete, and the release's verdict is NO_DIFFERENCE
```

PUBLISHABLE means three things: no regression, evidence complete, and bound to this exact artifact. It does **not**
mean 0.6.0 was shown to be better. Whether to ship is the owner's decision.

On this held-out set, Orbit 0.6.0 neither improved nor worsened what the coding host resolved. It did not regress
anything, and no arm had a regression (a previously passing test now failing). The improvement the release aimed for
was **not demonstrated**. The rest of this report says why, and what the measurement can and cannot show.

## Setup (identical for every arm)

- **Host.** Claude Code 2.1.322, pinned in a read-only tools volume. Model `claude-sonnet-5-5` at effort `medium`.
- **Limits per run.** $1.00 cap, 80 turns, 40 minutes, 2 CPUs, 4 GB.
- **Tools.** Read, Edit, Write, Glob, Grep, Bash, Skill, Agent, TodoWrite. WebFetch and WebSearch are denied for every
  arm, so nobody can look up an upstream fix.
- **Network.** None, except the model API through an egress proxy that is checked before every run.
- **Fresh state.** Each run gets a fresh `HOME` and Orbit store. Claude Code's three built-in plugins are off in every
  arm.
- **Prompt.** The issue text plus one fixed closing paragraph, asking for the change and a final
  `EVAL_STATUS: DONE|BLOCKED`.
- **Arms.**
  - `plain`: Claude Code alone.
  - `orbit-0.5.0`: `--plugin-dir` = `git archive v0.5.0`.
  - `orbit-0.6.0`: `--plugin-dir` = `git archive 6b25eb9`, the release commit.
- **Pre-registration.** `prereg/0.6.0.json`, committed before any model run. Two amendments were committed before
  their own runs: `0.6.0-amendment-1.json` (seated condition) and `0.6.0-amendment-2.json` (seated memory). Neither
  changes anything registered.
- **Task sets.** Seeded selection, with dev and held-out drawn from different repositories.

  | Set | SWE-bench Verified | Packs |
  |---|---|---|
  | Dev | astropy-14365, pylint-4604, requests-1142 | orders-e2e-004, orders-e2e-003 |
  | Held-out | pytest-5809, sympy-21596, sphinx-11445, flask-5014 | lending-hld-004, lending-hld-003 |
- **Gold validation.** Every pre-registered SWE-bench instance's gold patch was graded RESOLVED by this evaluator
  before any arm was graded on it, so the grader is sound here.

## Held-out results (the verdict's runs: `final/`, at release commit 6b25eb9)

| Task | plain | Orbit 0.5.0 | Orbit 0.6.0 |
|---|---|---|---|
| swebench pytest-dev__pytest-5809 | RESOLVED | RESOLVED | RESOLVED |
| swebench sympy__sympy-21596 | FALSE_DONE | FALSE_DONE | FALSE_DONE |
| swebench sphinx-doc__sphinx-11445 | RESOLVED | RESOLVED | RESOLVED |
| swebench pallets__flask-5014 | RESOLVED | RESOLVED | RESOLVED |
| pack lending-hld-004 | RESOLVED | RESOLVED | RESOLVED |
| pack lending-hld-003 | RESOLVED | RESOLVED | RESOLVED |

| Arm | Resolved | Regressed | False done | Infra | Median $ / run | Median min / run | Orbit usage (Skill / Agent / CLI) |
|---|---|---|---|---|---|---|---|
| plain | 5 / 6 | 0 | 1 | 0 | 0.04 | 0.3 | — |
| Orbit 0.5.0 | 5 / 6 | 0 | 1 | 0 | 0.05 | 0.3 | 0 / 0 / 0 |
| Orbit 0.6.0 | 5 / 6 | 0 | 1 | 0 | 0.05 | 0.3 | 0 / 0 / 0 |

- **sympy-21596** is FALSE_DONE in every arm. The agent said DONE while 1 hidden fail-to-pass test still failed.
- **Interventions.** No run ended asking the person anything.
- **Replication.** The same pre-registered phase was first run at `a9c3c8d` (`final-a9c3c8d/`). That commit has the same
  product code; it differs only in three documentation and test files. Its words were identical, task by task. Its
  medians were $0.06, $0.08 and $0.08, and 0.4 minutes per run.

## Secondary: the seated condition (amendment 1; reported, never read by the release gate)

**Why it was added.** On the dev passes, every Orbit arm made 0 Skill, 0 Agent and 0 Orbit CLI calls. The cause is a
deliberate product rule (ADR 0025, `knownCheckout`): Orbit's hooks observe only a checkout the machine knows, meaning
one where a person has used Orbit at least once. A fresh evaluation container is never known. So the registered
condition measures "the plugin installed, never used in this repository": the advice after a failed check and the
unverified hold cannot act there.

**What it does.** The amendment adds the adopter's case. Before the agent starts, the controller runs the plugin's own
adoption command once (`cli/help.mjs`, what `/orbit-help` runs to seat a project). It then verifies the checkout is
byte-identical, because the seat writes only Orbit's store.

| Comparison | Paired | Resolved | Verdict |
|---|---|---|---|
| Orbit 0.6.0 seated against plain | 6 | 5 / 5 | NO_DIFFERENCE |
| Orbit 0.6.0 seated against Orbit 0.5.0 seated | 6 | 5 / 5 | NO_DIFFERENCE |

- **Words.** Same as the primary table: sympy-21596 FALSE_DONE, the rest RESOLVED.
- **Cost.** Median $0.08 per run for both seated arms, against $0.05 unseated. A seated session receives Orbit's
  session-start context, and that context costs tokens.
- **What the plugin's trail shows** (kept in each run's room as metadata):
  - The 0.6.0 unverified hold acted **once**, on flask-5014. It held the turn naming 1 linked test file; the run had
    12 turns and was RESOLVED either way.
  - No advice line was recorded on any held-out run.
  - No Orbit skill, agent or command was used by the host in any run.

## Secondary: memory (registered, plus amendment 2)

Two pairs of lending tasks were run: the second task with the first task's Orbit store kept, against its own cold run.
Every run was RESOLVED.

| Pair (second task) | Cold, seated | Kept, seated | Cold, unseated | Kept, unseated |
|---|---|---|---|---|
| hld-004 → **hld-001** | 5 turns, $0.098 | 4 turns, $0.060 | 6 turns, $0.105 | 5 turns, $0.067 |
| hld-003 → **hld-002** | 4 turns, $0.104 | 5 turns, $0.076 | 5 turns, $0.106 | 5 turns, $0.075 |

The kept runs cost 25–40% less, **but that happens in the unseated arm too, where Orbit writes nothing a later session
could reuse**. The saving is therefore not attributable to Orbit's memory. It is most likely the model API's prompt
cache between two runs started minutes apart. No memory effect is demonstrated.

## The development passes, and what they changed

These passes informed development and never feed the verdict.

| Campaign | Commit | What | Resolved | Notes |
|---|---|---|---|---|
| `pilot/` | — | plain, orders-e2e-004 | 1 / 1 | $0.12; it priced a task, and the counts were fixed after it |
| `baseline/` | — | dev × {plain, 0.5.0} | 4 / 5 each | pylint-4604 FALSE_DONE in both arms |
| `dev1/` | b2ec735 | dev × 0.6.0 | 4 / 5 | Orbit usage 0/0/0 |
| `dev2/` | edcfde2 | dev × 0.6.0, P3b | 4 / 5 | Orbit usage 0/0/0 |
| `dev3/` | a9c3c8d | dev × 0.6.0, seated | 4 / 5 | the unverified hold acted on pylint-4604 |

- **dev1.** The pylint run said "I didn't run the test suite or add a regression test" and stopped. The unverified hold
  could not act: no runtime component declares a check for a Python checkout. Fix **P3b**: what a turn owes is named
  from the facts the engine has, meaning a declared check, else the tests the relation adapters link to the edited
  files. The Python adapter reads the test patterns the checkout itself declares for pytest.
- **dev2.** The hold was still silent. The agent's last command ran pylint itself and was read as a passing lint check.
  Fix **P3c**: only evidence that the change works clears what a turn owes, meaning a test, or the component's own
  declared verifying check, never a generic build or lint. While diagnosing this, the unknown-checkout rule was found,
  which led to amendment 1.
- **dev3.** The hold acted on pylint-4604. The agent then ran the linked tests and added a regression test, but the run
  was still FALSE_DONE: 21 hidden fail-to-pass tests still fail. Holding a turn for verification did not, here, make
  the fix correct.

## Spend

| Campaign | Charged |
|---|---|
| pilot | $0.12 |
| baseline | $1.76 (includes a $1.00 cap charged for a run a worker restart interrupted) |
| dev1 | $0.46 |
| dev2 | $0.30 |
| dev3 | $0.44 |
| final at a9c3c8d | $1.31 |
| final at 6b25eb9 | $0.86 |
| final seated | $1.03 |
| memory | $0.52 |
| memory seated | $0.47 |
| **Total** | **$7.27 of the owner's $50** |

All of this ran on the Claude Code arms. The mini-SWE-agent arms spent nothing.

## What this does not show

- **Small n.** Six held-out tasks, one trial each. A difference of one task would be noise, and none was seen. This is
  a first measured baseline, not a proof either way.
- **A ceiling.** Sonnet 5.5 resolves 5 of 6 held-out tasks in 3–12 turns, in about 20 seconds, with no help. Tasks this
  easy leave little room for any plugin to add value. The one it misses (sympy-21596), it misses in every arm.
- **Orbit was never invoked.** In every run of every arm, the host called no Orbit skill, agent or command. The routing
  and right-sizing are doing what they were built to do: they stay silent on a single-issue fix. As a result, Project
  Understanding, the workflows and research were never exercised by these tasks. What this evaluation measured is that
  Orbit's passive presence (hooks and session context) costs a little and changes no outcome.
- **The mini-SWE-agent arms (plain, and + Orbit) were not run.** Their credential (`ORBIT_EVAL_ANTHROPIC_API_KEY`) was
  never supplied. Both arms are implemented and self-checked with the deterministic model.
- **Research was not exercised.** Web tools are denied to every arm, by design, to prevent contamination.
- **The memory comparison is confounded** by the API's prompt cache (see above).
- **Interventions.** Only "the run ended asking the person something" is measured, and it never happened. A headless
  run cannot receive an answer.

## Reproduce

```bash
# Docker running (in the cloud session: dockerd --registry-mirror=https://mirror.gcr.io); TLS inspected: --ca-file
export ORBIT_EVAL_HOME=~/.orbit-eval
node evaluator/cli.mjs checks                                         # the evaluator's own checks (no Docker)
node evaluator/cli.mjs selfcheck --ca-file=<pem>                      # self-controls without a model
node evaluator/cli.mjs prereg verify                                  # the registered order, re-derived from its rule
node evaluator/cli.mjs prereg campaign final --rev=<release commit> --id=<id> --ca-file=<pem> --out=<c.json>
CLAUDE_CODE_OAUTH_TOKEN="$ORBIT_CODE_OAUTH_TOKEN" node evaluator/cli.mjs run <c.json> --ca-file=<pem>   # detached-safe; `resume <id>` after a restart
node evaluator/cli.mjs record --campaign=<final>,<final-seated>,<memory>,<memory-seated> --prereg=evaluator/prereg/0.6.0.json --out=record.json
node skills/orbit-release/ship.mjs --evidence --evaluation=record.json   # the release gate
```

## The mini-SWE-agent phase (registered)

`mini/`: held-out x {mini-SWE-agent, mini-SWE-agent + Orbit 0.6.0}, 12 runs, every one NOT_RUN (credential: the
controller's environment had no `ORBIT_EVAL_ANTHROPIC_API_KEY`), charged $0. The pre-registration allows NOT_RUN only
for that reported comparison, so the record is complete without it; the comparison itself is INCONCLUSIVE (0 paired).
