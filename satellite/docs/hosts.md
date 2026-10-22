# Satellite on each host

What each host can actually do for a mission, cell by cell. The table is the one in `satellite/src/hosts/matrix.mjs`,
rendered; `satellite/test/docs.test.mjs` fails the moment the two differ. `node satellite/cli/satellite.mjs host
capabilities [--host=<id>] --json` prints the same cells with their grounds, as they stand on this source.

A cell is **verified** only while `satellite/acceptance/host-acceptance.json` holds a receipt, recorded from a real
session of that host, whose result passed on THIS source (its digest covers `satellite/src`, `satellite/cli`,
`skills/satellite` and `agents/satellite-*`). Without one, a claimed cell is **reported**: what the host's own
documentation or Orbit's [docs/hosts.md](../../docs/hosts.md) says. Any edit to that source makes every receipt
stale ([ADR 0002](adr/0002-a-host-adapter-says-only-what-is-verified.md)). A person records one with
`node satellite/acceptance/record-host-acceptance.mjs --host=<id> --version="<host version>" --result=<host>:<test>:<ops>:<passed|failed>`.

| Capability | Claude Code | Codex | Antigravity CLI | Grok Build |
| --- | --- | --- | --- | --- |
| nativeAgentDispatch | verified once `claude:agent-dispatch` passes, else reported | unavailable | unavailable | unavailable |
| parallelism | verified once `claude:agent-parallel` passes, else reported (at most 20 at once) | unavailable (at most 1 at once) | unavailable (at most 1 at once) | unavailable (at most 1 at once) |
| toolObservation | reported | reported | reported | reported |
| toolOutcomeReliability | reported | unknown | unknown | reported |
| filesystemIsolation | unavailable | unavailable | unavailable | unavailable |
| permissionEnforcement | reported | unknown | unknown | unknown |
| modelSelection | unavailable | unavailable | unavailable | unavailable |
| cancellation | reported | unavailable | unavailable | unavailable |
| sessionAffinity | reported | reported | reported | reported |
| liveIntegration | reported | reported | reported | reported |

- **Claude Code, toolObservation.** The session's own tool calls, read from the working set Orbit's hooks keep and shown beside the mission; which agent run made a call is UNOBSERVED.
- **Claude Code, toolOutcomeReliability.** PostToolUseFailure names a failed call.
- **Claude Code, filesystemIsolation.** An agent runs in the checkout; source changes are isolated by an engineering task's own workspace.
- **Claude Code, permissionEnforcement.** A plugin agent's tools: allowlist is the host's; permissionMode is ignored.
- **Claude Code, cancellation.** TaskStop.
- **Claude Code, sessionAffinity.** ORBIT_SESSION through the session's environment file.
- **Claude Code, liveIntegration.** Satellite Live in a terminal beside the session; no docked pane.
- **Codex, toolObservation.** Bash and apply_patch only.
- **Codex, sessionAffinity.** An explicit binding on every command.
- **Codex, liveIntegration.** Satellite Live in a terminal.
- **Antigravity CLI, toolObservation.** PreToolUse and PostToolUse; no session end.
- **Antigravity CLI, sessionAffinity.** An explicit binding on every command.
- **Antigravity CLI, liveIntegration.** Satellite Live in a terminal.
- **Grok Build, nativeAgentDispatch.** The manifest declares no agents.
- **Grok Build, toolObservation.** Five measured tools.
- **Grok Build, toolOutcomeReliability.** Exit codes.
- **Grok Build, sessionAffinity.** GROK_SESSION_ID.
- **Grok Build, liveIntegration.** Satellite Live in a terminal.

## What a host with no native agents does

On Codex, Antigravity CLI and Grok Build an envelope says `dispatch.mode: serial`: the main session follows the role's
instruction itself, one run at a time, then reports. It is never shown as parallel, and the mission's concurrency is 1.
On Claude Code the host launches each run with its Agent tool as the plugin agent the envelope names --
`orbit:satellite-reader` (Read, Glob, Grep), `orbit:satellite-designer` (Read, Glob, Grep), `orbit:satellite-engineer`
(Read, Glob, Grep, Bash, Edit, Write; it drives an engineering task in that task's own workspace) and
`orbit:satellite-verifier` (Read, Glob, Grep, Bash) -- and several may be in flight at once, up to the mission's limit.
A READ_ONLY or DESIGN run cannot run a command, so the host reports for it.
