# Campaign final-seated-060

Model claude-sonnet-5-5 at effort medium; Claude Code 2.1.322; limits per run: $1, 80 turns, 40 min, 2 CPU, 4096 MB. Budget $12: charged $1.03, left $10.97. Evaluator 78a4a56b01d2. Finished.

## Arms

- `orbit-0.5.0-seated`: claude+orbit @ v0.5.0 (commit 54aaf0b65bdb)
- `orbit-0.6.0-seated`: claude+orbit @ 6b25eb9ef227b8fe1e896d5d7aff0d22ad52a827 (commit 6b25eb9ef227)

## Per arm

Rate = RESOLVED / gradable; INFRA_ERROR is the environment's and is excluded from every rate. Usage = Skill calls / Agent calls / plugin CLI commands.

| arm | resolved | rate | regressed | false done | empty | unresolved | timeout | budget | ungradable | infra | median $ | median min | interventions | usage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| orbit-0.5.0-seated | 5 / 6 | 83% | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0.08 | 0.3 | 0 | 0 / 0 / 0 |
| orbit-0.6.0-seated | 5 / 6 | 83% | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0.08 | 0.4 | 0 | 0 / 0 / 0 |

## What the plugin wrote

From the plugin's own trail, kept in each run's room as metadata (orbit-trail.jsonl): holds by what they held for, advice by the fact it named, the plugin's scripts seen run.

| arm | runs with a trail | events | holds | advice | plugin scripts run |
|---|---|---|---|---|---|
| orbit-0.5.0-seated | 6 | 43 | none (0 run(s)) | none (0 run(s)) | none |
| orbit-0.6.0-seated | 6 | 50 | unverified 1 (1 run(s)) | none (0 run(s)) | none |

## Task by task

| task | orbit-0.5.0-seated | orbit-0.6.0-seated |
|---|---|---|
| swebench:pytest-dev__pytest-5809 | RESOLVED | RESOLVED |
| swebench:sympy__sympy-21596 | FALSE_DONE | FALSE_DONE |
| swebench:sphinx-doc__sphinx-11445 | RESOLVED | RESOLVED |
| swebench:pallets__flask-5014 | RESOLVED | RESOLVED |
| pack:lending-hld-004 | RESOLVED | RESOLVED |
| pack:lending-hld-003 | RESOLVED | RESOLVED |

## Infrastructure errors and runs not run

- none

## What this does not show

- With a handful of tasks per arm, a difference of one task is noise: this is a measured baseline, not a proof that one arm is better.
- Cost, tokens and turns are what the coding host reported in its own result line; an outcome is never decided by the host's word.
- An arm with a plugin runs the plugin's hooks and commands as well as the task: the extra context and latency they add are part of what is measured.
