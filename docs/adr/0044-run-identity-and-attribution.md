# ADR 0044 — A run knows its own identity, and a call is attributed only by evidence

## Status

Accepted (0.2.2). Builds on ADR 0016 (a viewer reads the journals), ADR 0030 (a declared playbook runs through the doors
that exist), ADR 0041 (Satellite is a mission journal above Orbit's owners) and Satellite's own ADR 0003 (Satellite Live
is one pure fold). Supersedes, for Satellite, the consequence of its ADR 0003 that per-run tool calls stay UNOBSERVED.

## Context

1. Orbit already records WHO ran: a Satellite mission journals every agent run (`agentrun.*`, with its parent, attempt,
   pins and native or serial dispatch); a coordinated workflow journals every declared skill run (`skillrun`, `skillstep`
   and `invocation` receipts, bound by the engine as it makes each call). It records WHAT the host's tools did in the
   session trail and the working set. The two were joined by heuristics, or not at all:
   - `trace usage` credited a command to the skill the session started most recently, so a subagent's work landed on its
     parent's skill;
   - Satellite declared a `tool.observed` journal kind nothing ever wrote, and drew every host tool call as UNOBSERVED;
   - a hook Claude Code delivered twice was two trail events, and no trail event named the call it was about.
2. Claude Code's hook payloads already say more than Orbit kept: a subagent's tool events carry its `agent_id` and
   `agent_type`, `SubagentStart` and `SubagentStop` mark its life, and the Agent call that launched it answers with its
   `agentId`. Codex, Antigravity CLI and Grok Build name no subagent on a call.
3. A correlation id is not a permission. Nothing that names a run may become a way past a gate.

## Decision

### One vocabulary, in a leaf

`src/attribution.mjs` imports nothing, for the reason `src/policy.mjs` is a leaf: the trail, Orbit Live, Satellite and
Control must say the same word about one call. Five words, each earned by its own kind of evidence, ranked in the order a
reader trusts them:

| Word | Earned by |
|---|---|
| `RUNTIME_BOUND` | Orbit itself bound the invocation to the run as it made the call (a declared skill's step and call, an engineering task's action) |
| `HOST_OBSERVED` | the host's own payload carried the link (an agent id on a call, the Agent call that launched it) |
| `REPORTED` | an agent or the session said so; nothing independent observed it |
| `UNATTRIBUTED` | nothing says which run made it: shown where it was observed (the session, the project) |
| `CONFLICTING` | two sources name different runs, or one agent is named for two runs: neither is chosen |

`settle({ observed, reported })` is the ordered table every reader uses. A Satellite run is said outside its mission as
`msn-<12 hex>/arn-<n>` (`RUN_REF`), because an agent run id is unique only inside its mission.

### Who owns each truth (unchanged), and the one canonical parent

| Truth | Owner |
|---|---|
| an agent run's lifecycle, parent, attempt, pins, dispatch | the mission journal (`agentrun.created.parentAgentRun` is THE parent) |
| a declared skill run's steps and calls | the coordinator task's journal (its receipts) |
| a host agent's start and stop, which agent made a call | the host's payload, kept by the trail and the working set |
| a tool's result | the trail and the working set (`ok`, `outcome`); unknown stays unknown |
| a verdict, a verification | the task, the investigation, the check's receipt -- never re-judged here |

Nothing new is written to hold an attribution. Satellite JOINS at read time (`satellite/src/hosts/attribution.mjs`,
pure) over the trail a port in `satellite/cli/bind.mjs` reads; the only new journal line is `agentrun.bound`, the
dispatcher's own word (`agent ack <msn> <arn> --host-agent=<agentId>`), hashed and REPORTED. `tool.observed` stays declared
and unwritten: the join supersedes it, and removing a kind is a protocol change of its own.

### Propagation at each boundary

| Boundary | What carries the identity |
|---|---|
| coordinator → agent dispatch | the envelope (`missionId`, `agentRunId`, and since 0.2.2 `parentAgentRunId`, `attempt`) under its API mark, pasted verbatim as the Agent prompt |
| Agent call → host agent | the call's `tool_use_id` (hashed: `call`) joins its PreToolUse, which names the run off the envelope's mark, to its PostToolUse, which names the launched `agentId` (hashed) |
| host agent → its calls | `agent_id` on each of its tool events (hashed: `agent`) |
| agent → nested agent or skill | the PreToolUse of the Skill or Agent call made inside the agent carries that agent; `agent.launched.agent` is the launching agent |
| skill run → its calls | the engine's own receipts (RUNTIME_BOUND); an approval names the step's ref, `<run>.<step>` |
| observation → trail → Live | `call`, `agent`, `run` fields on trail events; agent lines in the working set; per-agent folds in `src/live/session.mjs` |

Nothing is a global "current agent": every hook event carries its own ids; a subagent's command outlives its parent's
turn (a turn's end closes only the session's own runs, an agent's stop closes its own). No variable is exported to a
child for it, because a native subagent's shell inherits the session's, not the agent's.

### Privacy

The Claude adapter reads `agent_id` and `agent_type`, the `agentId` the Agent tool answers with (the one field of a
`tool_response` it reads, the way `grok.mjs` reads an exit code), and two ids off an Agent prompt that carries the
envelope's mark -- only for this plugin's Satellite agents. Agent ids and call ids are hashed by `hostSession()` before
anything keeps them. The prompt, `last_assistant_message` and `agent_transcript_path` are never read; tests carry a
sentinel through real hook processes and find it nowhere on disk. Claude's trail events now take their id from the call
(as protocol 2's always did), so a duplicate delivery is one event.

### What each host can show (and how it was shown)

| Host | Which agent made a call | Proven by |
|---|---|---|
| Claude Code | observed: agent ids on a subagent's calls, its start and stop, the launched id | fixtures of the documented payloads (`SubagentStart.json`, `SubagentStop.json`, `PreToolUse-Agent-envelope.json`, `PostToolUse-Agent-launched.json`), and the 2.1.309 native captures of a subagent's tool events; a native capture of SubagentStart/Stop is owed |
| Codex | none: a subagent's call cannot be told from the session's own | the 0.163.0 captures |
| Antigravity CLI | none | the 1.4.4 captures |
| Grok Build | unknown: a child session's end was seen, nothing names an agent on a call | the 1.0.62 captures |

`src/work/track/coverage.mjs` holds this as data (`namesAgents`, `agents`, `calls`), and every viewer says it beside the
calls it draws.

### Identity is never authority

`src/protected/`, the capability pipeline, the MCP broker and every approval read none of these ids or words.
`test/protected-bypass.test.mjs` sends a forged run reference, host agent, mode and attribution word through
`authorize()` and the pipeline: the verdict is the same and the protected call is still refused.

## Consequences

- The session trail gains fields (`call`, `agent`, `run`) and three event types (`agent.launched`, `agent.started`,
  `agent.ended`); `trace usage --json` gains `attribution` (per agent, the session's own calls, coverage) and `skills[].runs`
  beside the unchanged heuristic.
- The working set gains agent lines and finished Skill/Agent calls; `live status --json` gains `session.agents`, `own`,
  `invocations` and `coverage`; the pane draws an AGENTS block when a host names agents.
- A declared skill run shows its id, its attempts and RUNTIME_BOUND; `live watch --jsonl` carries `plan-view` and
  `skill-view`.
- Satellite Live's view is version 2: per run its host agent, word, basis, the host's lifecycle of the agent, its calls
  direct and through the agents it launched, a coverage section, and an inspector (select with j and k, enter).
- A dispatcher that paraphrases the envelope leaves the run UNATTRIBUTED -- correct, and the playbook says to paste it
  verbatim. A run carried serially is never bound to an agent.
- The integration source changed, so both native host acceptance records go stale until they are recorded again.
