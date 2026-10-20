# ADR 0016 — A viewer reads the journals; Orbit Control is one viewer

**Status:** accepted, 1.8.1

## Context
Orbit Live 1.8.0 (ADR 0015) made a task watchable without a refresh, but only in Orbit Control. The people who start
autonomous tasks mostly work in Claude Code, and opening a web page to learn whether a task is building, testing or
waiting for them is a context switch they skip. They need the same answer in the terminal they are already in, with
or without Control running, and in Claude Code's own status row while it works.

Three things in 1.8.0 shaped the choice:

- The read side was already transport-free. `control-server/src/live/task-stream.mjs` wrote to an abstract sink, and
  `taskActivity` ran the whole replay with no socket. The HTTP-bound parts were the framing (`sse.mjs`) and the
  context taken from a URL path.
- Nothing linked a Claude Code session to the task it created. A task records `created.session`, the hashed
  `ORBIT_SESSION`, but Claude Code runs its native hook protocol and its shell never carried that variable, so the
  field was null for every task a Claude session made.
- A plugin cannot ship a status line. A plugin's `settings.json` applies only `agent` and `subagentStatusLine`,
  `settings.json` expands no plugin variable, and the plugin's own directory moves with every version.

## Options
| | A. A terminal reads Control's SSE | **B. A viewer reads the journals through a shared core** | C. A background broker |
|---|---|---|---|
| Works with Control stopped | no | yes | needs its own daemon |
| A status line once a second | a connection a second, plus a URL and token kept somewhere | one read, then exit | one socket read |
| Consistency with Control | same frames | same feed, keep-rule, cursor and fold | a second record |
| New moving parts | a Node SSE client | one extraction | a supervised process, a socket |
| Node floor | Control's 24.15 | the engine's 20 | a runtime of its own |

## Decision
1. **B.** `src/live/` is the live core, lifted out of Control: the follower registry, the cursor, the sources and
   the feed. Control keeps the transport (SSE, its routes, a context named by the path) and reaches the core
   through `core.mjs`, like everything else it uses. `cli/live.mjs` is a second composition root over the same
   core. Control's live tests pass unedited.
2. **The core imports no subject.** What a task's or an investigation's journal looks like, how it folds, and what a
   line says as activity are their owners' answers. Each owner declares them as a SOURCE (`TASK_SOURCE`,
   `QA_SOURCE`), and a composition root hands those in. The one timer in the core is the follower registry's, held
   only while a viewer holds a lease. The status line never takes one: it collects once.
3. **Which task is a table, not a guess** (`src/live/association.mjs`). A task is this session's only when its
   journal says so. To make that possible, the SessionStart hook Orbit already runs exports the session mark its own
   lifecycle events carry, through the host's session environment file, once per file. Then a task created from
   that shell records the mark. The rows, in order: named, pinned for this session, pinned for the checkout, this
   session's own, the one running in the checkout, AMBIGUOUS, recently finished, none. "The newest task on the
   machine" is not a row.
4. **A viewer's state is not the task's** (`src/live/presentation.mjs`). CONNECTING, UNAVAILABLE, RECONNECTING,
   DEGRADED, FINISHED, LIVE and IDLE describe the viewer's reads. LIVE needs a line written recently or an action
   still running; a refresh, a tick or a heartbeat never moves a viewer there.
5. **The status line is the person's to install, through the existing host-setup door.** One owned key goes in the
   person's own settings, receipted and backed up. A status line they already have is refused unless they choose to
   replace it (it returns on remove) or keep it (theirs runs first; not on Windows). The command names a shim Orbit
   copies from the plugin into its store. The shim finds the engine from where the host's hook last observed the
   plugin, verifies it on every call, and prints nothing rather than an error.
6. **Data never drives a terminal.** Every string from a journal passes `printable()` before the one module that
   writes escape sequences (`src/live/render/ansi.mjs`). JSONL escapes the C1 range and the reordering marks as
   well.

## Consequences
- A task can be watched with Control stopped, in a terminal or in Claude Code's status row, and a page and a
  terminal on one journal show the same lines with the same cursors (`watch --jsonl` sends Control's frames).
- The host's observed plugin root is an absolute path kept in the store, the one exception to "re-derived, never
  persisted". It is refreshed by the host's own hook at each session start, verified on every use, and never
  trusted as a receipt.
- A subagent's shell inherits the session file (probed on Claude Code 2.1.294 with a `general-purpose`
  subagent), so a task an agent creates carries its session's mark. A task created by any shell that does not
  carry the mark is shown by checkout or by a person's pin.
- Per-step live detail of a run-case run stays deferred (ADR 0015 §6). The status line shows a run-case case as
  one unit.
- Codex and Antigravity get the terminal viewer. No inline integration is proposed until a native status API is
  verified there.
