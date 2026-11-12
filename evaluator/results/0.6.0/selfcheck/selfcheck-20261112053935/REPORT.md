# Campaign selfcheck-20261112053935

Model — at effort —; Claude Code 2.1.322; limits per run: $0, 1 turns, 10 min, 2 CPU, 2048 MB. Budget $0: charged $0, left $0. Evaluator 45591529651f. Finished.

## Arms

- `gold-done`: scripted — patch gold, says DONE
- `noop-done`: scripted — noop, says DONE
- `half-blocked`: scripted — patch half, says BLOCKED
- `half-done`: scripted — patch half, says DONE
- `tamper-done`: scripted — patch tamper, says DONE
- `regress-done`: scripted — patch regress, says DONE
- `killed`: scripted — sleep, says NONE
- `over-time`: scripted — sleep, says NONE
- `no-api`: scripted — noop, says DONE

## Per arm

Rate = RESOLVED / gradable; INFRA_ERROR is the environment's and is excluded from every rate. Usage = Skill calls / Agent calls / plugin CLI commands.

| arm | resolved | rate | regressed | false done | empty | unresolved | timeout | budget | ungradable | infra | median $ | median min | interventions | usage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gold-done | 2 / 2 | 100% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |
| noop-done | 0 / 4 | 0% | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |
| half-blocked | 0 / 2 | 0% | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 2 | 0 / 0 / 0 |
| half-done | 0 / 2 | 0% | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |
| tamper-done | 0 / 2 | 0% | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |
| regress-done | 0 / 2 | 0% | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.0 | 0 | 0 / 0 / 0 |
| killed | 0 / 0 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | — | — | 0 | 0 / 0 / 0 |
| over-time | 0 / 1 | 0% | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | — | 0.5 | 0 | 0 / 0 / 0 |
| no-api | 0 / 0 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | — | — | 0 | 0 / 0 / 0 |

## Task by task

| task | gold-done | noop-done | half-blocked | half-done | tamper-done | regress-done | killed | over-time | no-api |
|---|---|---|---|---|---|---|---|---|---|
| pack:orders-e2e-006 | RESOLVED | EMPTY_PATCH | UNRESOLVED | FALSE_DONE | FALSE_DONE | REGRESSED | INFRA_ERROR | TIMEOUT | INFRA_ERROR |
| pack:lending-hld-001 | RESOLVED | EMPTY_PATCH | UNRESOLVED | FALSE_DONE | FALSE_DONE | REGRESSED | — | — | — |

## Infrastructure errors and runs not run

- killed__pack_orders-e2e-006__t1: INFRA_ERROR — KILLED: the task container ended while the agent ran (exit 137)
- no-api__pack_orders-e2e-006__t1: INFRA_ERROR — EGRESS: the network did not hold before the agent started: {"direct":"ENETUNREACH","outsideName":"EAI_AGAIN","api":{"connect":403,"http":null},"otherHost":403,"holds":false}

## What this does not show

- With a handful of tasks per arm, a difference of one task is noise: this is a measured baseline, not a proof that one arm is better.
- Cost, tokens and turns are what the coding host reported in its own result line; an outcome is never decided by the host's word.
- An arm with a plugin runs the plugin's hooks and commands as well as the task: the extra context and latency they add are part of what is measured.
