# Orbit Satellite

Orbit Satellite takes any goal through an autonomous, multi-agent **mission**: a bug, a feature, an incident, a review,
a refactor, a design or a regression suite. It is not a fixed pipeline. A mission reads the goal into a structured
intent, investigates before deciding who does what, plans a work graph it revises only on evidence, and reuses or
generates the roles, agent templates, skills and workflows the work needs. Each work unit goes to a fresh agent run
under a least-privilege profile. Every result is read back from the owner that keeps it, and every action is
observable in Satellite Live.

The engine calls no model. The host's model decides one step at a time; Satellite judges each decision, journals it,
runs it through one execution gateway, and settles it only on evidence. Entry: `/orbit:satellite` on Claude Code, and
`node <orbit>/satellite/cli/satellite.mjs` on every host ([invocation](invocation.md)).

## Where it sits

Satellite is a **mission journal above Orbit's owners** ([ADR 0001](adr/0001-satellite-is-a-mission-journal-above-owners.md)).
It keeps its own state under `<storeRoot>/satellite/` and writes no other owner's journal:

- a source change happens only inside an Orbit **autonomous-engineering task's own workspace**, started through that
  owner's own CLI (`autonomous-engineering start`), and the primary checkout is never written;
- a check's verdict is the engineering task's, a QA outcome is the investigation's, and Satellite reads both back;
- a capability is asked only through Orbit's own door for it (`invokeBound`: the MCP broker narrowed to reading, or a
  project's capability pipeline with no case);
- a generated playbook goes through Orbit's skill factory (`factoryPort`), narrowed to scaffold, put, verify, register
  and read: a person's moves (status, archive, rollback) are not reachable.

Everything under `satellite/src/` imports only Orbit's leaves; the owners, the resolver, the factory and every spawned
command are bound in `satellite/cli/bind.mjs` and handed in ([contract map](contract-map.md)).

## The loop

| Step | Action | What the engine holds it to |
|---|---|---|
| Understand | `analyze` | facts, hypotheses, assumptions, constraints, acceptance criteria, unknowns and evidence kept apart; a fact cites the goal or an evidence id; criteria freeze after the first analysis; any language |
| Recall | `recall` (`context` or `knowledge`) | read-only, outside the lock; the answer goes to the host once and the journal keeps its digest |
| Plan | `plan`, `replan` | a bounded, acyclic graph of units (`explore`, `diagnose`, `design`, `review`, `verify`, `implement`, `build`, `test`); a revision is a new immutable file naming what it replaced and why, written only on a trigger |
| Staff | `resolve-role`, `resolve-template` | a role is REUSED when one answers for exactly those responsibilities, else COMPOSED or GENERATED and named from them; a role requests a profile and grants nothing; a template is reused across missions |
| Skills | `resolve-skill`, `write-skill`, `validate-skill`, `register-skill` | reuse first; a gap is generated only within Orbit's skill-factory limits, instruction-only; a capability a person disabled is BLOCKED, never generated around |
| Workflows | `resolve-workflow`, `plan` with `workflow` | a versioned template (`orbit.satellite.workflow/v1`) with parameters and bounds and no state; instantiated into fresh units |
| Dispatch | `dispatch` | a NEW agent run per dispatch, never one reused; mode and operation derived from the unit's kind; grants intersected from every source that bounds them; an envelope for the host |
| Ask | `invoke` | one capability, on behalf of an open run, through Orbit's door, once; nested on the run's mode |
| Report | `agent report` | the report contract, every reference read back from its owner, the checkout witnessed, the handoff published immutably; the run's outcome is the engine's word |
| End | `mission finish` | COMPLETED only when every criterion is VERIFIED by an independent owner; otherwise REPORTED with what is owed |

## Commands

`S` is `node <orbit>/satellite/cli/satellite.mjs`. Every answer is JSON; exit 0 is done, 2 is REFUSED, 3 is BLOCKED.

| Command | Does |
|---|---|
| `S mission start "<goal>"` · `--file=` · `--stdin` | seat a mission; the goal is kept as submitted, with its digest |
| `S mission context <msn>` | what stands, what is allowed now, and a filled-in example of the next decision |
| `S mission step <msn>` | one decision on stdin, through the gateway |
| `S mission reconcile <msn> [--abandon=<arn>]` | every open action read back from where it left a trace; nothing resent |
| `S mission finish <msn> [--stop=<REASON> --because="…"]` | the verdict, derived |
| `S mission show` · `goal` · `events` · `list` | the view, the goal read back with its digest checked, the events, the missions |
| `S agent envelope <msn> <arn>` · `ack` · `report` | the run's envelope again, the host's word it launched it, the run's report |
| `S definitions list` · `show <pin>` | roles, templates, skills and workflows, rebuilt from their records |
| `S host capabilities` · `detect` | the host matrix, and which host this command runs under |
| `S live status` · `watch` · `tui` · `open` · `where` | Satellite Live |
| `S settings` · `where` · `protocol` | the policy in effect, the store's paths, and every shape a host sends and receives |

## Modes, operations and permissions

A **mode** is a column on an action and an agent run, never a global state. There are nineteen: ANALYZING, RECALLING,
EXPLORING, PLANNING, ROLE_GENERATING, AGENT_GENERATING, SKILL_GENERATING, SKILL_VALIDATING, REUSING, DESIGNING,
IMPLEMENTING, BUILDING, TESTING, DIAGNOSING, REVIEWING, VERIFYING, DISPATCHING, HANDOFF and RECOVERING. A unit's mode
comes from its kind; a decision that names a mode is refused by name. A nested action (an `invoke` for an EXPLORING
run) puts its own mode on top of the run's while it is open, and the run's mode shows again when it closes.

Every action carries one **operation kind** (`repository.read`, `logs.analyze`, `provider.invoke`, `artifact.publish`,
`definition.register`, `source.patch`, `check.run`, `sandbox.test.run` …). A write kind names the only owner it may
happen through: `source.patch`, `check.run` and `sandbox.test.run` happen only through an engineering task. There is no
shell, secret, package-install, push, merge or deploy kind.

A role requests a **profile**: READ_ONLY, DESIGN, IMPLEMENT or VERIFY; the engine acts as ORCHESTRATOR. The policy
evaluates profile, operation, mode, owner and grants together, in order, and a denial is a journal line
(`permission.denied`) a viewer shows. Grants are the intersection of the profile, the mode, Orbit's own automation
limits (a person's), the mission's budget and a parent run's grants: each can only take away. On Claude Code the
host enforces each profile's tools through a plugin agent's `tools:` allowlist (`agents/satellite-*.md`).

## Evidence

Levels, weakest first: UNKNOWN, BLOCKED, TOOL_COMPLETED, CONTRACT_MET, BEHAVIOR_OBSERVED, VERIFIED. A report names
references (`file:`, `task:`, `check:`, `investigation:`, `handoff:`, `definition:`); each is read back from its owner
when the report comes in. Only an engineering task's own verification rows, a check its runner ran and a QA
investigation's outcome are **independent**, and only they make a criterion VERIFIED. A report while an owner's record
is still moving is refused (`EVIDENCE_PENDING`); a run whose checkout changed under it is `violated`; a report that
claims an outcome, a level or a mode is refused by name.

## Recovery

An action whose provider runs outside the lock is preceded by a durable intent and a **lease** (`running/<act>.json`:
host, pid, the pid's start time, a token). A worker settles only while it still holds its lease; one that wakes after
reconcile closed its action is FENCED and writes nothing. `mission reconcile` reads every open action back
([ADR 0004](adr/0004-recovery-reads-owners-and-never-resends.md)):

| Open action | Read back from | Becomes |
|---|---|---|
| any, its worker alive and young | the lease | STILL_RUNNING, untouched |
| a read whose worker is gone | the lease | INTERRUPTED: decided again by a new decision |
| an engineering start whose worker is gone | the tasks started since its intent, for that objective | none: INTERRUPTED · one: adopted · more: AMBIGUOUS |
| another write whose worker is gone | the lease | AMBIGUOUS: never resent, a person decides |
| an engineering run | the task's own record | still moving: STILL_RUNNING · ended: concluded on that record · unreadable: AMBIGUOUS |
| a host's run | the host's word, or its age | STILL_RUNNING, INTERRUPTED on `--abandon=<arn>` or after six hours |

## Satellite Live

A viewer of one mission's journal and nothing else ([ADR 0003](adr/0003-satellite-live-is-one-pure-fold.md)). Every
line is named as an `orbit.satellite.event/v1` event by the same fold the engine decides with, so a replay and an
incremental read are the same events. `live status` is one look; `live watch` follows the journal (`--plain`, `--jsonl`,
`--since=o=<n>` to resume without a duplicate); `live tui` is the full screen, with nine views (Mission, Agents, Roles,
Skills, Workflows, Tools, Memory, Timeline, Verification), keys `1`-`9`, `tab`, `j`/`k`, `g`/`G`, `space` to freeze,
`r`, `?` and `q`, and `--ascii`; `live open` starts it beside the session through Orbit Live's own openers. The
viewer's word (ORBITING, IDLE, FINISHED …) is the viewer's, never the mission's lifecycle, and the orbit in its header
is motion, never progress. Since 0.2.2 (Orbit's ADR 0044) each run in the Agents view says which of the host's agents
carries it and how anybody knows -- HOST_OBSERVED when the hooks saw the Agent call that carried its envelope launch that
agent, REPORTED when only the dispatcher said so (`agent ack --host-agent`), CONFLICTING when two words disagree or one
agent is named for two runs, UNATTRIBUTED for a serial run or when nothing was observed -- with the calls that agent made,
direct and through the agents it launched, counted apart. `j`/`k` select a run there and `enter` (or `o`) inspects it:
its pins, its parent and children, its host agent and the basis of the word, its calls and the records behind it. The
Tools view counts each run's calls, keeps the session's own calls apart (UNATTRIBUTED: attributed to no agent run),
lists the agents the hooks saw that no run is bound to, and says what the join stood on.

## Storage

Everything is in the machine store, under `<storeRoot>/satellite/`: `missions/<msn>/` (the journal, the goal, plan
revisions, agent runs, handoffs, artifacts, evidence, checkpoints, running leases), `definitions/{roles,agent-templates,
skills,workflows}/<id>/<version>-<digest8>.json` (immutable; a pin is `id:version:digest8`), `registry/sessions/`,
`policy/settings.json` and `live/`. Nothing is created on a read; every registry is rebuilt from the records on every
read. Default limits: 12 agent runs, 3 at once, delegation 2 deep, 6 generated definitions, 12 units, 32 handoffs.

## Hosts

[hosts.md](hosts.md) is the matrix, cell by cell, and [ADR 0002](adr/0002-a-host-adapter-says-only-what-is-verified.md)
why a cell is `verified` only on a native acceptance receipt for this very source. Claude Code dispatches agent runs
natively and in parallel; Codex, Antigravity CLI and Grok Build run them serially in the main session, and the
envelope says so.

## What is not here

- Which agent run made a host tool call is known only where the host's payload names the agent (Claude Code); on Codex,
  Antigravity CLI and Grok Build every call stays UNATTRIBUTED to a run. On Claude Code the SubagentStart/SubagentStop
  shape is taken from the host's documentation and fixtures until a native capture records it.
- An AMBIGUOUS action has no door in Orbit Control yet; reconcile refuses to resend it, and a person decides.
- Satellite's policy has no writer outside Orbit Control's door, which does not exist for Satellite yet: the defaults
  in code apply.
- There is no docked pane in Claude Code, and the VS Code companion opens only Orbit's own viewer: in VS Code,
  `live open` prints the command.
- A capability that reads through a connection's credential, or one that waits for a person's approval, is refused.
- An engineering start whose worker died is adopted by matching the unit's objective to the tasks started since.

## Tests

```bash
node --test satellite/test/*.test.mjs                                   # the suite: no network, no sleeps
ORBIT_SATELLITE_E2E=1 node --test satellite/test/e2e-engineering.test.mjs   # a real engineering task, end to end
node cli/check-five-lines.mjs satellite/src satellite/cli satellite/acceptance --strict
```
