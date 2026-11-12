# Campaign mini-060

Model claude-sonnet-5-5 at effort medium; Claude Code 2.1.322; limits per run: $1, 80 turns, 40 min, 2 CPU, 4096 MB. Budget $15: charged $0, left $15. Evaluator 78a4a56b01d2. Finished.

## Arms

- `mini`: mini
- `mini-orbit-0.6.0`: mini+orbit @ 6b25eb9ef227b8fe1e896d5d7aff0d22ad52a827 (commit 6b25eb9ef227)

## Per arm

Rate = RESOLVED / gradable; INFRA_ERROR is the environment's and is excluded from every rate. Usage = Skill calls / Agent calls / plugin CLI commands.

| arm | resolved | rate | regressed | false done | empty | unresolved | timeout | budget | ungradable | infra | median $ | median min | interventions | usage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mini | 0 / 0 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — | 0 | 0 / 0 / 0 |
| mini-orbit-0.6.0 | 0 / 0 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — | 0 | 0 / 0 / 0 |

## What the plugin wrote

From the plugin's own trail, kept in each run's room as metadata (orbit-trail.jsonl): holds by what they held for, advice by the fact it named, the plugin's scripts seen run.

| arm | runs with a trail | events | holds | advice | plugin scripts run |
|---|---|---|---|---|---|
- none

## Task by task

| task | mini | mini-orbit-0.6.0 |
|---|---|---|
| swebench:pytest-dev__pytest-5809 | NOT_RUN | NOT_RUN |
| swebench:sympy__sympy-21596 | NOT_RUN | NOT_RUN |
| swebench:sphinx-doc__sphinx-11445 | NOT_RUN | NOT_RUN |
| swebench:pallets__flask-5014 | NOT_RUN | NOT_RUN |
| pack:lending-hld-004 | NOT_RUN | NOT_RUN |
| pack:lending-hld-003 | NOT_RUN | NOT_RUN |

## Infrastructure errors and runs not run

- mini__swebench_pytest-dev__pytest-5809__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini__swebench_sympy__sympy-21596__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini__swebench_sphinx-doc__sphinx-11445__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini__swebench_pallets__flask-5014__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini__pack_lending-hld-004__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini__pack_lending-hld-003__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini-orbit-0.6.0__swebench_pytest-dev__pytest-5809__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini-orbit-0.6.0__swebench_sympy__sympy-21596__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini-orbit-0.6.0__swebench_sphinx-doc__sphinx-11445__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini-orbit-0.6.0__swebench_pallets__flask-5014__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini-orbit-0.6.0__pack_lending-hld-004__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY
- mini-orbit-0.6.0__pack_lending-hld-003__t1: NOT_RUN — credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY

## What this does not show

- With a handful of tasks per arm, a difference of one task is noise: this is a measured baseline, not a proof that one arm is better.
- Cost, tokens and turns are what the coding host reported in its own result line; an outcome is never decided by the host's word.
- An arm with a plugin runs the plugin's hooks and commands as well as the task: the extra context and latency they add are part of what is measured.
