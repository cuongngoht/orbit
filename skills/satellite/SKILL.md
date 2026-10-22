---
name: satellite
description: >
  Orbit Satellite -- take any goal (a bug, a feature, an incident, a review, a refactor, a design, a
  regression suite) through an autonomous multi-agent mission whose every step is journaled and judged.
  It reads the goal into a structured intent, investigates before choosing who does what, plans a work
  graph it revises on evidence, reuses or generates the roles, agent templates, skills and workflows
  the work needs, dispatches each work unit to a fresh agent run under a least-privilege profile,
  publishes every handoff immutably, and settles each acceptance criterion only on evidence an
  independent owner keeps -- never on an agent's word. Use when a person asks for Satellite, a mission,
  or a goal that needs several specialists. It never pushes, merges, deploys, edits the checkout outside
  an engineering task's own workspace, grants an approval, or calls a mission done that its journal does
  not prove.
argument-hint: 'the goal, in full | continue msn-… | status msn-…'
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/satellite/cli/satellite.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-engineering.mjs context*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-engineering.mjs step*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-engineering.mjs reconcile*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/task.mjs show*)
  - Read
  - Glob
  - Grep
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md's actual location and bind the host,
protocol and hashed session supplied at startup on every Orbit shell invocation. Follow
[the shared host contract](../../docs/hosts.md). On Claude Code, `${CLAUDE_PLUGIN_ROOT}` is the plugin root. Read
`${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` for which tool does which job, and
`${CLAUDE_PLUGIN_ROOT}/skills/satellite/protocol.md` for every shape you send and receive.

# A mission, one decided step at a time

Satellite keeps the state; you decide. Every step you send is ONE decision the engine judges before anything runs,
records before its side effect, and settles only on evidence an owner keeps. `S` below is
`node ${CLAUDE_PLUGIN_ROOT}/satellite/cli/satellite.mjs`. Every answer is JSON.

## 0. When a PERSON invoked /orbit:satellite: Satellite Live beside the session

Tell the person, in one line, that they can watch the mission live: `S live open` opens the full-screen viewer beside
this session where the terminal allows (tmux, Windows Terminal, iTerm2, a window), and `S live open --print` prints
the command for a second terminal. Run `S live open` only when they ask. Never run `S live tui` or `S live watch`
yourself: they need a terminal of their own. A viewer that cannot open never stops the mission.

## 1. Start, or pick up

```bash
S mission start --stdin            # the person's whole goal on stdin, exactly as given
S mission list                     # an earlier mission: continue it instead of starting another
S mission context <msn>            # what stands, what is allowed now, and `next`
S mission step <msn> < decision.json   # ONE decision: judged before anything runs, recorded before its effect
```

Read `context` before EVERY decision: its `revision` is your decision's `expectedRevision`, `allowed` says which
actions are possible, and `next.decide` is a filled-in example. A decision on a moved revision is refused
(STALE_REVISION): read again, decide again.

## 2. Understand, then recall

- `analyze`: read the goal -- in whatever language it is written -- into the structured intent: facts (each citing
  `goal@<digest8>` or an `evidence:evd-<n>` the mission holds), hypotheses, assumptions, constraints, acceptance
  criteria (what the outcome is held to: frozen after the first analysis), and unknowns (with the unit kinds they
  block). Keep a hypothesis a hypothesis: only an independent owner's evidence ever confirms one. Analyze again later
  to ADD what evidence taught and to settle unknowns with the evidence ids that settle them.
- `recall` (`via: context` or `via: knowledge`): what the project already knows, memory first, before any agent reads
  source.

## 3. Plan a graph -- investigate before deciding who changes what

`plan` proposes work units: `explore`, `diagnose`, `design`, `review`, `verify` (host-run, read or design only), and
`implement`, `build`, `test` (through an Orbit engineering task, in its own workspace). Do not assume the domain: a
"payment succeeded but no email" goal starts by exploring where the event goes, not by choosing a developer. A small
task skips what it does not need. Each unit names the acceptance criteria it serves and, when it rests on another,
`dependsOn`. The engine refuses a cycle, an unknown dependency, a unit over budget, an effect its kind's mode can
never carry. When evidence moves the plan, `replan` with the cause the engine's trigger named.

## 4. Staff each ready unit, reuse first

- `resolve-role`: the unit's responsibilities as `{ activity, subject }` pairs, the profile it needs (READ_ONLY,
  DESIGN, IMPLEMENT, VERIFY), a purpose, restrictions and completion criteria. A role that already answers for exactly
  those is REUSED; otherwise one is GENERATED and named from its responsibilities. A role's name grants nothing.
- `resolve-template`: the agent template for that role and the unit's provider; the same one is reused across
  missions.
- `resolve-skill` for a capability a unit needs: a playbook this project already pinned is REUSED, one the resolver
  finds is WRAPPED, and only a gap Orbit's own skill-factory limits allow is GENERATED -- an instruction-only draft
  you fill with `write-skill`, then `validate-skill` and `register-skill`. A capability a person disabled or a policy
  blocks is BLOCKED, and you never generate around it.
- `plan` with `workflow` and `params` instantiates a pinned workflow template (`resolve-workflow` validates and pins
  one first): its units are fresh, and a template never carries a state.

## 5. Dispatch, run the agent, report

- `dispatch` answers an ENVELOPE. On Claude Code run its agent with the Agent tool: `subagent_type` is
  `envelope.agent.subagentType` (`orbit:satellite-reader`, `-designer`, `-engineer`, `-verifier`), and the prompt is
  the envelope itself (its instruction, context slice, grants and report shape) -- never the conversation. Several
  ready units may be in flight at once, up to the mission's concurrency; when `envelope.dispatch.mode` is `serial`
  (no native agents on this host), follow the instruction yourself in this session, one run at a time.
- When a run needs what a managed server or a project capability answers, `invoke` asks it ONCE on the run's behalf
  -- before you launch the run's agent, or on a serial host while you follow its instruction:
  `{ "kind": "invoke", "capability": "<dotted>", "agentRun": "<arn>", "tool": "…", "input": {…}, "expects": [...] }`.
  The answer comes back once in `result.answer`: hand it to the run, because the journal keeps only its digests. Only a
  run whose mode reads through a provider (EXPLORING) may ask; a provider that waits for a person's approval, a host's
  own server, and one that reads through a connection's credential are refused, with nothing asked.
- Right after launching a run, `S agent ack <msn> <arn>` records that you launched it (your word, said as such).
- When the agent returns its report JSON, pipe it unchanged: `S agent report <msn> <arn> < report.json`. The engine
  reads every evidence reference back from its owner and decides what the run came to. `EVIDENCE_PENDING` means an
  owner's record is still moving (an engineering task still running): report again once it has ended.

## 6. End on evidence

`S mission finish <msn>` derives the verdict: COMPLETED only when every acceptance criterion is VERIFIED by an
independent owner (an engineering task's own verification, a declared check, a QA investigation); otherwise REPORTED,
with what is still owed. `S mission finish <msn> --stop=<REASON> --because="…"` records a stop the journal shows.
`S mission reconcile <msn> [--abandon=<arn>]` reads back anything left open -- it never sends anything again.

## You never

- put an outcome, a verdict, a status, a mode, an operation kind, a level or a lifecycle in a decision or a report;
- invent an evidence reference, or report a check as passing that an owner's record does not show;
- edit the developer's checkout -- source changes only inside an engineering task's own workspace;
- pass `--human`, approve anything, or raise a limit;
- send a secret in a goal, an input or a report -- a secret is named, never sent;
- resend a step that did not settle, or report a run twice;
- run `S live tui` or `S live watch` in your own terminal;
- commit, push, merge or deploy;
- say a mission succeeded when its verdict is not VERIFIED.
