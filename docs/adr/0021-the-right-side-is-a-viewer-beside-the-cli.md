# 0021 — The right side is a viewer beside the AI CLI

Status: accepted (1.8.5)

## Context

The person works in an AI CLI: Claude Code or Codex, often inside VS Code's integrated terminal. They want Orbit Live
on the right of it, showing what the work is doing, with the CLI untouched: its transcript, prompt, keyboard focus and
session. Before this decision Orbit Live opened beside the session as one of the following:

- a tmux pane, a Windows Terminal pane or a macOS Terminal **window** (ADR 0020)
- in Claude Code, a pane Orbit's own mod docks, inline above the prompt unless Claude Code drew in its fullscreen layout
- nothing at all in VS Code's terminal (a Terminal window opened over VS Code on macOS)
- nothing at all under Codex and Antigravity, which never say that a person is at the session (`HEADLESS_FALLBACK`)

The pane showed the dashboard's sections, not the work as a person reads it: no checklist, and no single place saying
what runs, on what, how far it got and what blocks it. A test runner that aborted before any case, as VSTest does
when a sandbox denies the socket it opens to its test host, showed as zero cases reported, which reads like a pass.

## Decision

1. **The viewer is a separate program, beside the CLI and never in it.** It never draws in the CLI's terminal, reads
   its input or takes its keyboard. It never owns, pauses or cancels the execution, and its failure is its own. Every
   way of opening it asks for the person's share of the width (`live settings` `pane.widthPercent`, 36 by default).
   It hands the keyboard back to the CLI (`pane.focusCli`, on).
2. **Claude Code draws it itself.** Orbit's pane module (`hooks/live-pane.tsx`, a Claude Code mod the `orbit` plugin carries) docks a pane inside Claude Code. It asks `live pane` and draws
   the answer, adding no word and deciding nothing. It docks on the right only in Claude Code's fullscreen layout,
   from 110 columns. That limit is the host's, so above the prompt the pane says so, in words from the host adapter
   (`PANE_HINTS`), never from `src/`.
3. **Elsewhere, an opener splits to the right where the terminal can.** Each row of `OPENERS` says what it can do:
   - tmux: `-l <share>%`
   - Windows Terminal: a `.cmd` launcher that keeps the store and session variables, with `--size`, then the focus
     moved back
   - iTerm2: a vertical split, then the asking session selected again
   - Apple's Terminal: a window, said to be one, because it cannot split
   - otherwise: the command, printed
   A row that can only print says so (`prints`), and `live ensure` refuses with that row's own reason, only when a
   viewer would actually have to be opened.
4. **VS Code is reached through an extension a person installs, never by Orbit driving it.** In VS Code's terminal,
   Orbit leaves a request in its own store's live room and starts nothing. The request holds the viewer's argument
   list, the variables it may pass, the working directory, the asking process's ancestry, the share and focus. The
   Orbit Live companion (`integrations/vscode-orbit-live`):
   - splits the terminal whose shell is among those ancestors, through VS Code's own Terminal API
     (`location: { parentTerminal }`)
   - shows the viewer without the keyboard and gives the keyboard back to the CLI's terminal
   - runs Orbit's viewer and nothing else, refusing and removing any other request
   - chooses what runs itself, because an AI agent runs as the person and can write their files, even a whole copy of
     Orbit, from inside its sandbox, while the companion runs outside it. Owning a file is never proof of who wrote
     it. `node` is the one the person named in `orbit.live.nodePath`; no PATH is searched, and unset, nothing opens.
     The viewer must be the `cli/live.mjs` of a Orbit install (`plugin.json` names `orbit`) inside a host's own plugin
     folder in the person's home, which only the host's plugin manager writes. A request only says which install, and
     Orbit run from anywhere else is never run from here. The whole install, and every folder above it up to that
     plugin folder, must be the person's or root's and writable by nobody else.
   - takes a request only from the person's own stores. Every setting it reads is machine-scoped and read from User
     or Remote settings alone. The live room's folders must be real folders of theirs nobody else may write. A request
     file must be theirs and writable by nobody else, group included; it is opened without following a link, then
     checked and read through one descriptor. A request speaks only for the store it was left in. One from the future,
     or with an ancestry longer than Orbit's process port reads (32), is refused. Another person's request in a shared
     store is left alone.
   - reports that it is running only through a heartbeat
   Without the companion nothing opens over VS Code, and the command is printed.
5. **A host that cannot say a person is there opens nothing by itself, and a person can always ask.** No environment
   variable promotes a headless run (`codex exec`, `agy -p`) to an interactive one. `HEADLESS_FALLBACK` carries the
   command, and the playbook offers to run `live open` on the person's word. That is their choice each time, through
   the same openers.
6. **The pane shows the work as a checklist, a NOW block and seven status words, each needing its evidence.**
   `src/live/tui/workspace.mjs` builds, from the snapshots the full-screen viewer draws:
   - **the checklist:** a workflow's plan steps, pending ones included, with the engineering child under its step;
     or an engineering task's own steps in the journal's order, with the baseline's runs, the change's files and the
     checks the change is held to nested under them
   - **NOW:** task, stage, action, goal, program and declared check, component, files, time, what the runner
     reported, status, blocker and next
   - **a status bar and views:** events, tests, changes, notices
   - **seven status words:** PASSED, FAILED, BLOCKED, NOT RUN, RUNNING, UNKNOWN, UNAVAILABLE
   A step nothing recorded is never drawn. A baseline that recorded a failure is a baseline taken, and its runs say
   what they came to. The pane has tiers of its own (wide side by side, medium stacked, narrow NOW only), because the
   full screen's tiers were made for a whole terminal.
7. **A runner that aborted is an environment's doing.** The .NET adapter reads VSTest's `Test Run Aborted.` and the
   exception before it as `runner.aborted` (category `environment`), an observation and never a verdict. The pane
   shows it as BLOCKED, with the engine's own verdict beside it (for example `held as REGRESSED`). The receipt, the
   verification and failed-as-before are decided exactly as before.
8. **An observation may name the program, never its arguments.** Its command carries `program` (`npm`, `dotnet`), so
   NOW can say what runs without writing an argument list that might carry a path or a value.

## Consequences

- Claude Code docks the pane on the right only in its fullscreen layout. VS Code splits a terminal group equally,
  with no API for the width. Both limits are said, not worked around.
- The VS Code companion is code Orbit ships but never installs. Installing it is the person's act.
- Windows Terminal, iTerm2 and the companion inside real VS Code are held by unit tests of their plans and requests,
  and by an end-to-end run of `live open` to the companion against a fake of VS Code's API. A host that was not
  available is reported as NOT TESTED, never as verified.
