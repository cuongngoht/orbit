# ADR 0025 — Learning is on by default, bounded, and fed by verified task evidence

**Status:** accepted (1.8.9)

## Context
Until 1.8.8 `engineering_observe` defaulted to false in four places (`src/host/config.mjs`, `cli/learn-hook.mjs`,
`cli/finalize.mjs`, `.claude-plugin/plugin.json`), so a machine learned how its project builds code only after a
person found the switch. On Codex and Antigravity (protocol 2) the finalizer queue was drained only by an isolated
`cli/context.mjs` run, so most of those sessions' checkpoints were never observed. A finished engineering task -- the
strongest evidence Orbit holds about how a change here is verified -- taught nothing. Nothing read the observer's
findings, so when learning did nothing, nobody could tell why.

## Decision
1. **The observer is on by default, bounded exactly as before.** It runs at a milestone only, at most four times a
   session, debounced ten minutes, never stronger than `observed`, through the same untrusted door
   (`observed`, `admitted`, `ingest`). A person turns it off with `ORBIT_ENGINEERING_OBSERVE=off` or the plugin's
   `engineering_observe` option; `ORBIT_LEARN=off` and `ORBIT_WORKING_SET=off` still hold.
2. **The hooks observe only a checkout the machine knows** (`knownCheckout`): one bound by a person's use of Orbit, one
   that commits its test data, or a loose directory named on purpose. Opening a repository with the plugin enabled
   writes nothing anywhere.
3. **A protocol-2 session is drained by a process of its own.** `skills/orbit-learn/hosts/drain.mjs` starts
   `cli/finalize.mjs --hook` detached (silent, always exit 0) after a hook queues a checkpoint, and again from the
   session's own `help` and a task's finish, never inside a hook's budget. The queue's lease keeps two drains apart.
4. **A COMPLETED engineering task teaches once** (`src/engineering/observe/task.mjs`, operation `task:<id>`, which
   ingest's dedupe makes idempotent). It offers the places the task changed and, for each declared check whose
   verification row a succeeded `check:` receipt satisfies, a `workflow` fact "a change here is verified by …"
   (analyser `verified`), at most `observed`. A task that did not complete, a failure as before, a reported action
   with no receipt and a check that never ran teach nothing. The finish links a `learning` receipt that says what was
   kept or why nothing was, and learning never changes a finish's exit code.
5. **Learning is diagnosable.** The trail event `learning.observed` carries host, milestone, operation, candidates and
   accepted, and nothing else. `engineering doctor` prints the switches in effect and who set each, the last
   observation per host, the queue, and the last twenty findings -- the first reader of the observer's findings.

## Consequences
- A machine learns from its first session, within the same bounds. A person who does not want it turns it off once.
- One frozen hook hash moved: `.claude-plugin/plugin.json` (the new default, and the `types` key a host refused).
  `hooks/hooks.json`, `.agents/hooks.json` and the host adapters are unchanged, because the drain is started by the
  hooks' own code rather than by a new hook entry.
- Coverage differs by host and is stated, never filled in: Codex sends no `PostToolUseFailure`, and Antigravity sends
  no `SessionEnd`, so its last checkpoint is drained by the next queued one or the next `/orbit-help`.
- A file a task created exists only in its workspace until a person merges it, so a fact citing it is refused by the
  judge as untracked. That is a finding in `engineering doctor`, never a crash and never a weaker rule.
