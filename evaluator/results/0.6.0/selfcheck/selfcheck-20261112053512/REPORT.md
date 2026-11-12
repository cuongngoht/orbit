# Campaign selfcheck-20261112053512

Model — at effort —; Claude Code 2.1.322; limits per run: $0, 1 turns, 10 min, 2 CPU, 2048 MB. Budget $0: charged $0, left $0. Evaluator 055cc4ebf8d8. Finished.

## Arms

- `gold-done`: scripted — patch gold, says DONE
- `noop-done`: scripted — noop, says DONE

## Per arm

Rate = RESOLVED / gradable; INFRA_ERROR is the environment's and is excluded from every rate. Usage = Skill calls / Agent calls / plugin CLI commands.

| arm | resolved | rate | regressed | false done | empty | unresolved | timeout | budget | ungradable | infra | median $ | median min | interventions | usage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gold-done | 2 / 2 | 100% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |
| noop-done | 0 / 2 | 0% | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |

## Task by task

| task | gold-done | noop-done |
|---|---|---|
| swebench:pytest-dev__pytest-7982 | RESOLVED | EMPTY_PATCH |
| swebench:pallets__flask-5014 | RESOLVED | EMPTY_PATCH |

## Infrastructure errors and runs not run

- none

## What this does not show

- With a handful of tasks per arm, a difference of one task is noise: this is a measured baseline, not a proof that one arm is better.
- Cost, tokens and turns are what the coding host reported in its own result line; an outcome is never decided by the host's word.
- An arm with a plugin runs the plugin's hooks and commands as well as the task: the extra context and latency they add are part of what is measured.
