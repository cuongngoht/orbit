# Campaign selfcheck-20261112114705

Model — at effort —; Claude Code 2.1.322; limits per run: $0, 10 turns, 10 min, 2 CPU, 2048 MB. Budget $0: charged $0, left $0. Evaluator f9634ca3afe7. Finished.

## Arms

- `gold-done`: scripted — patch gold, says DONE
- `seat-gold-done`: scripted @ HEAD (commit f9634ca3afe7) — patch gold, says DONE
- `seat-writes`: scripted — patch gold, says DONE

## Per arm

Rate = RESOLVED / gradable; INFRA_ERROR is the environment's and is excluded from every rate. Usage = Skill calls / Agent calls / plugin CLI commands.

| arm | resolved | rate | regressed | false done | empty | unresolved | timeout | budget | ungradable | infra | median $ | median min | interventions | usage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gold-done | 1 / 1 | 100% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |
| seat-gold-done | 1 / 1 | 100% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |
| seat-writes | 0 / 0 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | — | — | 0 | 0 / 0 / 0 |

## Task by task

| task | gold-done | seat-gold-done | seat-writes |
|---|---|---|---|
| pack:orders-e2e-006 | RESOLVED | RESOLVED | INFRA_ERROR |

## Infrastructure errors and runs not run

- seat-writes__pack_orders-e2e-006__t1: INFRA_ERROR — SEAT: the seat did not hold before the agent started: the seat wrote the checkout (seat-wrote-this.txt): a seat writes only the store

## What this does not show

- With a handful of tasks per arm, a difference of one task is noise: this is a measured baseline, not a proof that one arm is better.
- Cost, tokens and turns are what the coding host reported in its own result line; an outcome is never decided by the host's word.
- An arm with a plugin runs the plugin's hooks and commands as well as the task: the extra context and latency they add are part of what is measured.
