# Pre-registrations

A pre-registration says what will be run and how it will be judged, and is committed **before** any model run it
governs. `0.6.0.json` is the 0.6.0 release's. It is data the evaluator reads, not prose beside it:

- `node evaluator/cli.mjs prereg verify` re-derives the registered order from the file's own selection rule -- the
  packs always, the SWE-bench Verified rows and their digests when the pinned dataset is cached under
  `$ORBIT_EVAL_HOME/datasets/` -- and fails when the file says anything else (`checks/prereg.check.mjs` runs it too).
- `node evaluator/cli.mjs prereg campaign <phase> [--rev=<commit>] [--id=<id>] [--ca-file=<pem>]` writes that phase's
  campaign from the file and nothing else: the tasks are the top `counts` of the registered order, the arms, model,
  effort and limits are the registered ones, the runs go task by task with each task's arms in a seeded order, and the
  campaign's budget is the phase's line of the ledger. An arm registered at the release candidate (`rev: null`) is
  named with `--rev` when its campaign begins, and frozen in its `campaign.json`.

## What 0.6.0 registers

**Dataset.** SWE-bench Verified (`princeton-nlp/SWE-bench_Verified`, test split, 500 rows) at revision
`c104f840cc67f8b6eec6f759ebc8b2693d585d4a`; the rows are cached outside the repository and every registered instance
names its row's sha256 (of its canonical JSON).

**Selection, fixed before any run** (seed 60):

1. Candidates: difficulty `<15 min fix` or `15 min - 1 hour`, from a repository whose instance image fits the disk --
   compressed size at most 1.2 GB (one image measured on disk: 1.03 GB compressed was 3.84 GB). matplotlib, xarray,
   scikit-learn and seaborn are over; astropy, django, flask, requests, pylint, pytest, sphinx and sympy are within.
2. The eligible repositories, shuffled with the seed, are dealt alternately to dev and held-out, so the two sets never
   share a repository: dev = astropy, pylint, requests, django; held-out = pytest, sympy, sphinx, flask.
3. Each set's instances are ordered one repository at a time in turn; an instance whose own image is over the limit
   is passed over (the top ten of each list were measured; none was).
4. Packs: the `orders` packs are dev, the `lending` packs held-out, each shuffled with the seed.

The **order** is fixed now. The pilot decides only how many are taken from the top of each list (`counts`).

**Arms.** `plain` (Claude Code), `orbit-0.5.0` (Claude Code + the plugin at tag v0.5.0), `orbit-0.6.0` (Claude Code +
the plugin at the release candidate), `mini` and `mini-orbit-0.6.0` (mini-SWE-agent, plain and with the plugin
listed). Model `claude-sonnet-5-5`, effort `medium`, Claude Code 2.1.322, mini-SWE-agent 2.4.6. Per run: $1.00, 80
turns (mini: 80 steps), 40 minutes, 2 CPUs, 4096 MB. The prompt is the task's text and one closing paragraph, verbatim
in the file. The shared conditions (the built-in plugins switched off in every Claude Code arm, the network, the mini
arms' shell) are listed in `host.sharedConditions`.

**Outcomes.** One word per run, from what the controller and the grader observed. `INFRA_ERROR` and `NOT_RUN` are
excluded from every rate and always listed; every task stays in the table.

**Phases and ledger.** A hard ledger: a run never starts when its campaign's budget has less left than its cap.

| phase | runs | budget |
|---|---|---|
| pilot | 1: `plain` on the first dev pack | $1 |
| baseline | dev x {plain, 0.5.0}, before any 0.6.0 behaviour change | $11 |
| dev1, dev2 | dev x 0.6.0 at a working commit, one pass each; never part of the verdict | $5.50 each |
| final | held-out x {plain, 0.5.0, 0.6.0} | $20 |
| memory | 2 pairs of lending packs, the second run after the first with the store kept, and its cold run | $7 |
| mini | held-out x {mini, mini+orbit}, its own ledger; NOT_RUN while `ORBIT_EVAL_ANTHROPIC_API_KEY` is absent | $15 |

The Claude Code phases add up to $50 and the mini phase has its own $15. The targets (dev 3 SWE-bench + 2 packs,
held-out 4 + 2) cost at most $45 at the $1.00 cap, so they hold whatever the pilot costs, except that a pilot ending
`BUDGET` or `TIMEOUT` drops dev to 2 + 2 (held-out never below 4 + 2; the cap is never raised).

**Comparisons and verdict.** On the held-out set: 0.6.0 against plain and 0.6.0 against 0.5.0 -- resolved count,
regressions, FALSE_DONE, median cost and minutes -- over the tasks both arms have a rated word on.

| when | verdict |
|---|---|
| fewer than 4 paired tasks | INCONCLUSIVE |
| resolved difference <= -2, or 2 or more regressions beyond the other arm's | REGRESSED |
| resolved difference >= 2 | IMPROVED |
| resolved difference 0 | NO_DIFFERENCE |
| resolved difference exactly 1 | INCONCLUSIVE |

The release's verdict is REGRESSED if either comparison is, IMPROVED or NO_DIFFERENCE only if both are, else
INCONCLUSIVE; the mini comparison is reported beside it. **Why a one-task difference is INCONCLUSIVE:** with six
held-out tasks run once each, one task is a sixth of the set, and one run of a non-deterministic model on one task is
noise; such a difference cannot tell two arms apart. This is a first measured baseline, not a proof of superiority.

**Memory track.** Reported apart from the cold-start table, with no verdict: for each pair, the second task's word,
cost and minutes with the store kept, against its own cold run.

## Amendment 1: the seated condition (`0.6.0-amendment-1.json`)

Committed on 2026-11-12, before any run of its own phases and before any seated run on the held-out set. The registered
`final` campaign (final-060) had begun before it was committed; none of its outcomes was read in writing it, and it
changes nothing that campaign is run or judged by. An amendment is a file of its own beside the registration, naming
the registration's digest (`amends`); the registration itself is never edited.

**Why.** The dev passes (dev1-060, dev2-060) and baseline-060 made 0 Skill, 0 Agent and 0 plugin CLI calls in every
plugin arm, and the 0.6.0 behaviours that act on their own (the advice after a failed check, the unverified hold) never
acted. By the plugin's own deliberate rule, which stays, its hooks observe only a checkout the machine knows -- one a
person has used the plugin in -- and every evaluator container is a fresh checkout nobody ever used it in. The
registered condition measures the plugin installed and never used in the repository; the amendment adds the plugin as
an adopter has it.

**Unchanged.** The registered phases, tasks, order, arms, model, effort, limits, prompt, outcomes, scoring, comparisons,
verdict rule and ledger lines. The registered `final` comparisons stay the PRIMARY comparison and the release's
verdict; the release gate reads the registered file a record names and nothing of an amendment.

**The seated condition.** Before the agent starts, the evaluator runs once, in the task container, the plugin's own
adoption command -- `node <plugin>/cli/help.mjs` in the checkout, what `/orbit-help` runs the first time a person asks
in a repository -- with the run's fresh HOME and store, as the agent's user, with no credential. The checkout must then
be byte for byte the start tree, else the run is `INFRA_ERROR` (`SEAT`) and no agent runs. No turn of the agent is spent
on it; it is the same for v0.5.0 and the 0.6.0 candidate; the manifest says `seated: true` and the command's argv.

| phase | runs | budget |
|---|---|---|
| dev3 | dev x orbit-0.6.0 seated; informational, never part of any verdict | $3 |
| final-seated | held-out x {orbit-0.5.0 seated, orbit-0.6.0 seated} | $12 |

**Secondary comparison.** orbit-0.6.0 seated against plain (the registered `final` campaign's plain runs: plain carries
no plugin, so it is the same in both conditions) and against orbit-0.5.0 seated, by the registered verdict rule; their
overall verdict is the SECONDARY one, reported beside the primary in the record (`secondary`) and never read by the
gate (`gate: false`). The registered `memory` phase names its arm and stays as registered; no seated memory phase is
added. The amendment's $15 is inside the owner's $50: $2.64 spent before it, at most $27 more for the registered
`final` and `memory`, at most $15 here.
