# ADR 0018 — A full-screen viewer is one more viewer of the journals

**Status:** accepted, 1.8.2

## Context
Orbit Live (ADR 0015, 0016) shows a task in Orbit Control, in a terminal (`live watch`, painted in place) and in Claude
Code's status line. `watch` is one task, four keys and one sandbox stream (stdout). A person following a coordinated
workflow (ADR 0017) wanted one screen with the workflow, its engineering task's checks, its QA, its sandbox console
with both streams, the evidence and the approvals, and a way to move between tasks and checkouts -- without opening
Control, and without anything that could change the task.

What constrained the choice:

- `src/live/` may use no clock, no timer (but the follower registry's), no `process`, no `node:tty`, `node:readline`
  or `node:fs`, and no product word (`test/live-core.test.mjs`). Only a composition root reaches it.
- `src/live/render/ansi.mjs` is the one module that writes an escape sequence; a renderer returns colour only.
- The engine runs on Node 20 with no dependency; a hosted plugin may add no `bin/`.
- Claude Code, Codex and Antigravity own the terminal they run in: a second full-screen program cannot draw there.

## Options
| | A. A TUI library | **B. A pure viewer in `src/live/tui/` and an adapter in `cli/`** | C. `watch` grown in place |
|---|---|---|---|
| Dependencies | one at least | none | none |
| Reads the same feed, cursor, fold | through an adapter | yes, the same `openFeed` | yes |
| Testable without a terminal | partly | entirely: state, frame and diff are pure; the adapter takes a fake TTY | no: its state lives in the CLI |
| `watch`'s contract | untouched | untouched | changes (`--plain` detection, keys) |
| The boundary test | needs an exception | holds as written | holds |

## Decision
1. **B.** `src/live/tui/` is pure: one ephemeral state (`model.mjs`), a table of transitions (`reducer.mjs`), keys
   by table (`keys.mjs`), a layout by width tier (`layout.mjs`), sections and overlays as rows of `{ text, tone }`
   segments, one frame (`frame.mjs`, the only caller of `drawn` there) and a row diff (`diff.mjs`). The boundary test
   covers it unchanged.
2. **The adapter is `cli/live-tui.mjs`, handed a world.** It owns the raw keyboard, the alternate screen, the timers,
   the signals and the feeds, and opens and closes feeds to match what the state WANTS (`wanted`): the task shown,
   and a workflow's engineering task as well. `cli/live.mjs tui` binds the world from the helpers `watch` already
   uses; there is one follower registry per viewer process, so nothing is polled twice.
3. **A viewer is still a reader.** `tui` is a READ row in `src/live/governance.mjs`. No key approves, rejects,
   resumes, pauses, cancels, stops or runs anything; an approval is shown with where a person decides it (Orbit
   Control). The sandbox console reads only through the runtime's `sandbox-logs`, after the journal's claim is
   witnessed by the checkout (`src/live/logs.mjs`), the same chain `watch` uses, shared in one function.
4. **The terminal is given back on every way out, once.** q, Ctrl+C, SIGINT, SIGTERM, SIGHUP, a write that failed,
   a start that failed and the process's own exit all run one teardown: timers cleared, feeds and log leases
   released, raw mode off, colour reset, line wrap on, the cursor shown, the alternate screen left -- and only then
   one printable line on stderr. SIGKILL cannot be caught; `reset` restores a terminal it left.
5. **No line wraps and no sequence escapes.** Every frame line is exactly `columns - 1` cells by display width, line
   wrap is off while the viewer paints, and each changed row is positioned and cleared before it is written. Data
   reaches the terminal only through `drawn` (printable, cut, coloured); the adapter's writes hold nothing but
   `ansi.mjs`'s sequences (`OWN_SEQUENCE`).
6. **Nothing is invented.** A bar is a count with its total (steps of the ACTIVE plan's own count, stages of twelve,
   bytes read of a log's size); there is no time estimate. A field the record lacks says NOT RECORDED; what the
   viewer has not read says UNKNOWN; a reported action says it is not proof.
7. **It needs an interactive terminal.** A pipe or `TERM=dumb` is refused (exit 2) before a byte is written, and
   pointed at `watch --plain` or `--jsonl`. Beside an AI CLI it runs in a second terminal, tab or pane; Orbit starts
   none.

## Amendment, 1.8.3 — beside the session, when a person chooses
A viewer is still never opened by itself. `live open` is a person's act, each time (typed, or asked of the agent,
which runs it for them): it starts `live tui --until-done` beside the session -- a tmux pane, a Windows Terminal
split pane, a macOS Terminal window -- and returns at once, and the viewer leaves by itself once the task ended.
It is the one `live` command of the class `OPEN`: it starts nothing but Orbit's own viewer, as an argument list (the
macOS window runs a fixed, quoted line from a file in Orbit's own store), passes on only the variables that find the
same store and session, and prints the command wherever it can open nothing. Opening one for EVERY task by default
was weighed and refused: a window that appears from a background process surprises, breaks headless runs
(`claude -p`, CI) and multiplies with concurrent tasks. What a person may switch on instead is Automation's
`live.open` (off by default, set through Orbit Control's door like every automation setting): a workflow THEY start
through `orbit-help` opens one viewer, once, at its start -- never on a resume, never while Live is off, and only while
a host says a person is at the session (`skills/orbit-learn/hosts/attended.mjs`; a host with no verified mark is
unattended). `cli/live-open.mjs` AUTO_OPEN is that rule, a row per reason not to.

## Consequences
- A coordinated workflow and its engineering task are shown together and followed live; a child appears the moment
  the workflow's journal names it.
- `watch`, `status`, `statusline` and Control are unchanged; a person who knows `watch` keeps `q`, `a`, `l`, `c`.
- Showing Live inside an AI CLI's own interface is a different surface: Claude Code's status line (installed by the
  person) exists; a Claude Code mod (a pane or a band above the prompt) is possible but changes the plugin's frozen
  hook contract and is not part of this decision. Codex and Antigravity have no surface Orbit can use.
- Native acceptance in a real terminal of each host, Windows Terminal and tmux stays owed until it is recorded.
