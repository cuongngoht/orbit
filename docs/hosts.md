# Orbit host integration

Orbit (`/orbit`, skill `orbit`, `cli/orbit.mjs`) uses the same host binding as other Orbit commands: resolve the plugin root from the installed skill path, bind `ORBIT_HOST`, `ORBIT_HOST_PROTOCOL` and `ORBIT_SESSION` on every shell invocation. Goal specifications use `--stdin` or `--file`, never argv, for large text.

One engine and one machine store serve Claude Code, Codex, Antigravity CLI and Grok Build. Repository identity selects a current layout 3 store. Resolve paths through `cli/query.mjs storage --json`.

## Contracts

Claude Code uses its native hook envelope. Native protocol fixtures protect the supported integrations. Claude hooks may be recognized by their native shape. Other integrations require `--host=codex --protocol=2`, `--host=antigravity --protocol=2` or `--host=grok --protocol=2` (1.8.9); unknown/conflicting selections safely do nothing. New adapters are lazy-loaded. Grok Build reads the root `plugin.json` first, so it names `./hooks/grok.json` and no agents; Antigravity ignores both keys ([Grok Build](grok.md)).

| Capability | Claude native | Codex v2 | AGY CLI v2 | Grok Build v2 |
| --- | --- | --- | --- | --- |
| Startup | SessionStart | SessionStart | First PreInvocation | SessionStart; its output reaches only the person (`systemMessage`), so no startup recall reaches the model |
| Automatic prompt router | Yes | UserPromptSubmit | Unavailable; explicit task workflow | Unavailable: Grok drops an allowing UserPromptSubmit hook's output; the hook still keeps the trail |
| Tool mapping | Unchanged | Bash, apply_patch; others unknown | Documented native file/search/command tools | `read_file`, `search_replace`, `write`, `run_terminal_command`, `grep` (measured on 1.0.62); others `other` |
| Outcome | Unchanged | Unknown without verified structured evidence; MCP isError establishes failure | Explicit error establishes failure; command completion remains unknown | A command's `exit_code` and `timed_out` decide it; an edit's applied edits establish success; PostToolUseFailure establishes failure; the rest is unknown |
| Finalizer | Existing SessionEnd observer | Stop/SessionEnd checkpoint | Stop checkpoint; never synthetic SessionEnd | Stop/SessionEnd checkpoint; the Stop Grok fires at teardown (`reason` other than `end_turn`) is no turn |
| Native memory hints | Existing provider | Unavailable | Unavailable | Unavailable |
| Orbit Live | 1.8.6 (ADR 0022): one view model -- the docked pane and the terminal's pane layout (`tui --layout=pane`, what every viewer opened beside a CLI starts in) draw the same checklist, NOW, six views, task and test progress and the evidence-driven LIVE indicator; `live doctor --claude` prints the surfaces. Terminal (`cli/live.mjs`: `watch`, and `tui` full screen in a second terminal or pane, `open` to start it beside the session) and an opt-in status line (`cli/host.mjs --kind=statusline`); SessionStart exports the session mark to the session's shell. `/orbit-help` runs `live ensure`: this session's viewer opens beside it by itself (1.8.5) -- only in an interactive session (`CLAUDE_CODE_SESSION_ATTENDED=1`), never under `claude -p`. In Claude Code it is a pane docked on the RIGHT inside it, drawn by the plugin's own pane module (`live pane`; fullscreen layout `CLAUDE_CODE_NO_FLICKER=1`, from 110 columns; above the prompt otherwise, saying so) | Terminal (`watch`, `tui`); `live ensure` answers HEADLESS_FALLBACK with the command -- Codex's attendance is not verified, so nothing opens by itself unless a person listed the host in the live settings (`attendedHosts`, 1.8.8) -- and when the PERSON asks, the agent runs `live open`: on the right in tmux, Windows Terminal, iTerm2, or VS Code's terminal with the Orbit Live companion (`integrations/vscode-orbit-live`), in the pane layout. No native dock: Codex has no pane or sidebar API. `live pane|statusline|doctor --host=codex --protocol=2` (1.8.6) answer for its session | As for Codex: HEADLESS_FALLBACK by itself, `live open` on the person's word; no panel API, so no native dock; `--host=antigravity --protocol=2` (1.8.6) | As for Codex: HEADLESS_FALLBACK by itself, `live open` on the person's word; a Grok plugin draws nothing in Grok's screen, so no native dock; `--host=grok --protocol=2` (1.8.9) |
| External MCP inventory | Existing read-only adapter | Bounded `codex mcp list --json` | Unknown; Orbit-managed MCP still works | Unknown; Orbit-managed MCP still works |
| Native agent execution | Existing | Unavailable until verified | Unavailable until verified | Unavailable until verified |
| Automation (`/orbit-help`, ADR 0017) | A step's agent dispatched natively (Agent tool); status line shows the coordinator | Each step's skill run in the main session, one step at a time | Same as Codex; `.agents/cli` exposes `cli/automation.mjs` | Same as Codex |
| Generated playbooks | Never a native skill: printed by `cli/skill-factory.mjs show` and followed in the session | Same | Same | Same |
| Work tracking (`cli/track.mjs`, README §4.18) | Edits, commands and each command's exit status observed from the hooks; session end reported (so `INTERRUPTED` can be told from a quiet session) | Only Bash and `apply_patch` are mapped, so an edit by any other tool is not seen; a command's exit status is not carried (results stay `unknown`); session end reported | Native file and command tools observed; a command's completion is not reported (results `unknown`) and there is no session end, so `INTERRUPTED` is never derived. A host with no row here is explicit-only: only what is reported through `track.mjs` is tracked and `coverage` says so | The five measured tools are observed, with each command's exit status; session end reported, though a plugin's SessionEnd hook gets about 1.5 seconds |
| Prompt trigger (`trigger.arbitraryPrompt`) | Advisory line only; starts nothing | Advisory line only | Unavailable (no prompt event) | Unavailable (the advisory never reaches the model) |

A command completion is not a QA verdict. Unknown/background outcomes cannot count as successful verification. Component switches only govern invocations Orbit can identify.

## Root and session binding

Resolve the plugin root from the actual installed SKILL.md path. Do not guess a cache/version path or copy skills per host. Startup context supplies the hashed session mark. Bind it on **every** Orbit shell invocation; a hook export does not persist into later shell tools (Claude Code is the exception: its SessionStart hook is handed a session environment file, and Orbit exports `ORBIT_SESSION` there once, so its shell commands carry the mark with no binding -- ADR 0016):

```sh
ORBIT_HOST=codex ORBIT_HOST_PROTOCOL=2 ORBIT_SESSION='codex:<hash-from-startup>' \
  node "$orbit_plugin_root/cli/context.mjs" --for-stdin --json < task.txt
```

`orbit_plugin_root` must be the resolved absolute installation root. AGY uses its own host/session. Missing or mismatched affinity refuses isolated runtime access; another host's browser and latest working set are never selected as fallback. Task input can be piped directly; Orbit does not create a task file or persist its contents.

AGY explicit workflow routing:

```sh
ORBIT_HOST=antigravity ORBIT_HOST_PROTOCOL=2 ORBIT_SESSION='antigravity:<hash-from-startup>' \
  node "$orbit_plugin_root/cli/resources.mjs" route --task-stdin --json < task.txt
```

Context forwards tasks to child commands through stdin. No transcript is used to reconstruct missing lifecycle events or prompts.

Grok Build binds itself (1.8.9). The shell Grok hands its agent's tools carries `GROK_SESSION_ID` (measured on 1.0.62), so a Orbit command that names no host takes `ORBIT_HOST=grok`, `ORBIT_HOST_PROTOCOL=2` and the hashed session from it (`skills/orbit-learn/hosts/settings.mjs`): the same mark its hooks derive from `session_id`, with nothing for the agent to type. An explicit `ORBIT_HOST` or `--host` always wins. A shell started inside a Grok session inherits the variable, so a different host run from there must be bound explicitly.

## Settings and finalization

`cli/host.mjs settings --host=codex` reads revisioned desired settings. An explicit update takes JSON on stdin and `--revision=<read revision>`. Precedence remains Orbit/PT overrides, supported native options, then defaults. An invalid Orbit value still suppresses PT fallback. New protocols ignore Claude plugin options. Native memory can be desired but unavailable. Settings never override policy.

Engineering observation is on by default (1.8.9): `ORBIT_ENGINEERING_OBSERVE=off`, the plugin option, or a host's stored `engineering_observe: false` turns it off, and only a checkout the machine knows is observed (one somebody used Orbit in, one that commits `ui-tests/`, or a directory named by `ORBIT_UI_TESTS`). A protocol-2 Stop or SessionEnd checkpoints metadata into the session's own room and starts a detached drain bound to the same session (`cli/finalize.mjs --hook`, `skills/orbit-learn/hosts/drain.mjs`), because the host's two or three seconds cannot hold an observation; context preflight, `help` and a workflow's finish drain it again when they run bound to that session. Existing milestone/budget/debounce rules still decide whether observation runs; a host that reports no command outcome reaches its session's end, never `VERIFIED` or `COMMITTED`. Claude Stop does not enqueue: Claude's hooks observe inline. `engineering doctor` shows the switches in effect, the observations per host, the queue and the findings a refusal left. Expired leases retry; stale workers cannot complete replacement leases. Journal-first ingestion repairs retried operations without adding support.

## Evidence and downgrade

Identical scoped evidence uses the largest provenance-domain session lane, deduplicated across evidence groups. Switching host does not independently confirm a fact. Same-host session semantics remain; dirty scope is unknown and a new commit alone is not new scoped evidence. Human adoption remains explicit; contradiction rules still apply.

Before the first journal v2 write, each affected memory room saves `backups/before-evidence-v1.json` and a policy marker. Historical confidence is retained. Complete journal provenance recovers session lanes; incomplete history holds credit conservatively with a diagnostic. Candidate JSON cannot supply infrastructure provenance or credit.

Old 1.6.3 writers/replay must not run against an activated room. An old executable cannot enforce a marker it does not understand. Full downgrade requires stopping writers and restoring the pre-policy snapshot; do not rewrite journal versions by guesswork.

## One project, one memory, every host

The machine store is keyed by REPOSITORY, never by host: Claude, Codex and AGY in project A read
and write the same project room, and project B gets its own. Only the browser/runtime session is
per host (affinity), so one host never drives another's browser. Measured for 1.6.4: all three
hosts' trail events for one checkout carry one project key, and a second checkout another.

Where the hosts cannot be identical, it is the host's payload, not Orbit: Claude reports a failed
shell command through `PostToolUseFailure`, so its `command.ran` says `ok`. Codex 0.157.1 hands a
Bash `PostToolUse` only the output text, and AGY 1.2.12 sends `error: ""` for a command that exited
non-zero -- neither carries an exit code, so both stay `unknown` rather than guessed from text. AGY
has no prompt event (no `prompt.submitted`) and no session end. Its tool payloads carry `stepIdx`
without `executionNum`; the step index counts across the whole conversation and a call's Pre and
Post share it, so it is the delivery key (what Codex's `tool_use_id` is), while `executionNum` is 0
on every Stop and names no turn.

Grok Build 1.0.62 sends a Claude-shaped envelope -- camelCase keys with Claude's snake_case aliases beside them -- and names its own tools. `run_terminal_command` reports `exit_code` and `timed_out`, so a Grok command's result is known; an edit reports the edits it applied. Its SessionStart output reaches only the person (`systemMessage`), it drops an allowing UserPromptSubmit hook's output, and it fires one more Stop at teardown with a `reason` other than `end_turn`, which is no turn. A turn is `promptId`, which tool events do not carry; a tool call is `tool_use_id`, shared by Pre and Post. A plugin's SessionEnd hook gets about 1.5 seconds, so it only checkpoints. Only the five tools whose payloads were seen are mapped (`read_file`, `search_replace`, `write`, `run_terminal_command`, `grep`); `hashline_edit`, `list_dir` and the rest stay `other` until a payload is seen.

## Orbit Satellite

Satellite (0.1.1, ADR 0041) uses the same root and session binding on every host. Its skill is discovered from the shared
`skills/` directory everywhere; its four plugin agents exist only on Claude Code. What each host can do for a mission is
one table, `satellite/src/hosts/matrix.mjs`, rendered in [satellite/docs/hosts.md](../satellite/docs/hosts.md): a cell
is `verified` only on a native acceptance receipt for the same source (`satellite/acceptance/host-acceptance.json`),
otherwise `reported` from what is said here.

### Claude Code

Each agent run is dispatched natively with the Agent tool as the plugin agent its envelope names
(`orbit:satellite-reader`, `-designer`, `-engineer`, `-verifier`); several may be in flight at once, up to the mission's
limit. The host enforces each profile through that agent's `tools:` allowlist; a plugin agent's `permissionMode` is
ignored. A run is stopped with `TaskStop`. The session's own tool calls are read from the working set Orbit's hooks keep
and shown beside the mission; which agent run made a call is UNOBSERVED. `ORBIT_SESSION` reaches every shell command
through the session's environment file. Satellite Live runs in a terminal beside the session (`live open`); there is no
docked pane.

### Codex

No native agents are proven: every envelope says `dispatch.mode: serial`, and the main session follows each run's
instruction itself, one at a time. Only Bash and `apply_patch` tool calls are observed; a command's outcome is unknown.
Bind the host and session on every command. Satellite Live runs in a terminal.

### Antigravity CLI

As for Codex: serial, in the main session. Native file, search and command tools are observed, with no session end and
no command outcome. Bind the host and session on every command. Satellite Live runs in a terminal.

### Grok Build

The root manifest declares no agents, so every run is serial in the main session. The five measured tools are observed,
with a command's exit code. The session is `GROK_SESSION_ID`, bound on every command. Satellite Live runs in a terminal.

## Acceptance status

Automated tests cover supported native contracts, resolution, evidence permutations/replay, leases, runtime containment, concurrent hook processes, delivery dedupe, privacy sentinels, revisioned setup and host visibility. Process tests are not native delivery acceptance.

0.0.2 was smoke-tested on AGY CLI 1.4.2 (every hook event it sends; its renamed file tools mapped) and, partly, on Codex 0.163.0 (SessionStart and UserPromptSubmit; the session ended before a tool ran) -- with Orbit Control running, so neither is native acceptance. Release still requires sanitized native captures and live smoke on Claude baseline, Codex 0.158.0 and AGY CLI 1.2.14 (the versions 1.7.2 was accepted on; Claude 2.1.286) in a temporary consuming repository/store, including trust, hook execution with Control stopped and uninstall preserving shared state. AGY IDE is not accepted. Grok Build 1.0.62 was measured -- its hook payloads were captured from a headless session in a scratch repository and sanitized into `test/fixtures/hooks/grok-v2/` -- and its native delivery acceptance is not yet recorded. The bundled plugin-creator validator rejects the officially documented `hooks` field; do not remove the explicit path to satisfy that older validator, because default discovery would load Claude hooks.

See [Codex](codex.md), [Antigravity](antigravity.md) and [Grok Build](grok.md).

0.1.1 was accepted natively on all four hosts (`docs/host-acceptance.json`): Claude Code 2.1.309, Codex 0.163.0, AGY CLI
1.4.4 and Grok Build 1.0.62, each in a fresh headless session in an isolated consuming checkout with its own store and
Orbit Control stopped. Every hook delivery was captured on its way into Orbit by a `node` shim first on PATH, so the
plugin and its digest stayed as shipped; the captures are sanitized fixtures (`test/fixtures/hooks/<family>/*-<version>.json`)
the conformance suite holds. Each plugin was then uninstalled and the isolated store compared by digest. Grok ran in a
`GROK_HOME` of its own: a person's Grok home that holds a local plugin with a large `node_modules` copies it on every
session start, which stalls headless sessions there. What the AGY and Codex notes above ask for and these runs did not
exercise -- AGY permission responses, recall output, multi-workspace containment, background outcomes and
retry/rollback, and Codex retry -- is listed under `notVerified` in the record.

The shipping command now requires `docs/host-acceptance.json` with schema 1, the current `hostSourceDigest`, and a record for each host in `TARGETS` (`skills/orbit-release/hosts.mjs`: Claude, Codex, AGY and, since 1.8.9, Grok Build). Each must name the native version and attest actual native dispatch, Control stopped, uninstall preserving the store, and sanitized fixtures. The receipt is created only after those runs; unit tests never manufacture it. Any integration-source change invalidates the digest. Missing native acceptance leaves the shipping result NOT shippable.
