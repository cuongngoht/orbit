# Campaign dev2-060

Model claude-sonnet-5-5 at effort medium; Claude Code 2.1.322; limits per run: $1, 80 turns, 40 min, 2 CPU, 4096 MB. Budget $5.5: charged $0.3, left $5.2. Evaluator 02f2083f15ad. Finished.

## Arms

- `orbit-0.6.0`: claude+orbit @ edcfde231f38152a10ab08f6869c4c20e68c0154 (commit edcfde231f38)

## Per arm

Rate = RESOLVED / gradable; INFRA_ERROR is the environment's and is excluded from every rate. Usage = Skill calls / Agent calls / plugin CLI commands.

| arm | resolved | rate | regressed | false done | empty | unresolved | timeout | budget | ungradable | infra | median $ | median min | interventions | usage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| orbit-0.6.0 | 4 / 5 | 80% | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0.04 | 0.4 | 0 | 0 / 0 / 0 |

## Task by task

| task | orbit-0.6.0 |
|---|---|
| swebench:astropy__astropy-14365 | RESOLVED |
| swebench:pylint-dev__pylint-4604 | FALSE_DONE |
| swebench:psf__requests-1142 | RESOLVED |
| pack:orders-e2e-004 | RESOLVED |
| pack:orders-e2e-003 | RESOLVED |

## Infrastructure errors and runs not run

- none

## What this does not show

- With a handful of tasks per arm, a difference of one task is noise: this is a measured baseline, not a proof that one arm is better.
- Cost, tokens and turns are what the coding host reported in its own result line; an outcome is never decided by the host's word.
- An arm with a plugin runs the plugin's hooks and commands as well as the task: the extra context and latency they add are part of what is measured.
