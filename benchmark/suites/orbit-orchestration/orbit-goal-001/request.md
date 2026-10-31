# ORBIT-GOAL-001 — a goal moves on past a unit whose task ended

A goal (`/orbit`, `src/goal/`) plans one work unit per kind of work, each waiting for the one before it. Stepping the
goal (`stepGoal`) starts the next unit's coordinated workflow and links the unit to that workflow's task; the unit is
then `running`. Resuming the goal (`resumeGoal`) reads the goal's journal back together with the views of the tasks it
started (`ports.taskSummaries()`: one row per task, its `lifecycle` spelled as the task views spell it --
`COMPLETED`, `FAILED`, `CANCELLED`, `EXECUTING`, `PAUSED`, … -- and its `stopReason`).

The behaviour this source must have:

- Resuming a goal settles every unit whose task has ended, and the settlement is kept in the goal's journal, so the
  goal reads it back on every later look:
  - a unit whose task `COMPLETED` is `completed`, and the unit after it becomes what may start next (the next
    `stepGoal` starts it);
  - a unit whose task `FAILED`, or was `CANCELLED`, while the unit ran is `failed`: it is neither running nor
    completed, and nothing after it starts.
- A unit whose task has not ended -- running, paused, blocked, waiting for a person -- stays `running`, and nothing
  after it starts.
- A task that ended changes nothing until the goal is resumed. Resuming again changes nothing more.
- A goal whose units have all completed has nothing left to start, and its lifecycle is `verifying`; one with a failed
  unit is `blocked`; one with a unit running is `running`; otherwise it is `ready`.

Make the smallest change in `src/goal/` that gives this behaviour, and add a regression test under `test/` that fails
before your change and passes after it. Do not change or delete an existing test.
