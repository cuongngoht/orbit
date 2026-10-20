# Orbit Live companion for VS Code

Your AI CLI stays where it is: Claude Code, Codex or any other in a VS Code terminal on the left.
Orbit Live opens in a terminal split on its right. When Orbit wants a viewer beside that terminal,
the companion opens it. That happens when `/orbit-help` asks in a Claude Code session without the
docked pane, or when you ask your agent to "open Orbit Live" (`live open`). The companion uses VS
Code's own Terminal API: a split of the asking terminal, and the keyboard handed back to that
terminal.

## What it does, and what it will never do

- Orbit never drives VS Code. `live ensure` and `live open`, run inside a VS Code terminal, only
  leave a request in the Orbit store (`<store>/control/live/requests/`). This extension picks it up.
- It runs **Orbit's viewer and nothing else**: `<node> <…>/cli/live.mjs tui [<task>] [--lease=…]`,
  with Orbit's own variables only (`ORBIT_STORE_DIR`, `ORBIT_SESSION`, `ORBIT_HOST`,
  `ORBIT_HOST_PROTOCOL`, `NO_COLOR`). It refuses and removes any other request, or one older than a
  minute.
- It splits **the terminal whose shell started the request**. Orbit sends the process ancestry of
  the command that asked. If no terminal in a window matches, that window does nothing. Of two
  windows, the first to claim the request opens it.
- It says it is running through a heartbeat file in the store (`control/live/companions/`), so
  Orbit asks it only while it runs. Closing VS Code removes the file. Without the companion, Orbit
  prints the command in a VS Code terminal and never opens a window of another application over
  VS Code.
- Closing the Orbit Live terminal closes only the viewer. The agent, the task and its sandbox go on.

## What it trusts

An AI agent runs as you. From inside its sandbox it can write files you own: a request, a `node`, even a whole copy
of Orbit. The companion runs outside that sandbox. So it never runs anything a request supplies, and owning a file is
never proof of who wrote it:

- **`node` is the one you named.** Set `orbit.live.nodePath` to its absolute path. No PATH is searched. Until you set
  it, nothing opens and the companion tells you once.
- **Orbit runs only from a host's own plugin folder.** The viewer must be the `cli/live.mjs` of a Orbit install (its
  `plugin.json` names `orbit`) inside one of these folders in your home:
  - Claude Code's `~/.claude/plugins/cache` and `~/.claude/plugins/synced`
  - Codex's `~/.codex/plugins/cache`
  - Antigravity's `~/.gemini/config/plugins`

  Those folders are written by the hosts' plugin managers, never by an agent's tools. A request only says which
  install. Orbit run from anywhere else, such as a checkout loaded with `claude --plugin-dir`, is never run from VS
  Code: run `live tui` in a terminal yourself.
- **The whole install is checked.** Every file and folder in the install, and every folder above it up to the host's
  plugin folder, must be yours (or root's) and writable by nobody else. A link inside it is held to its owner and
  never followed. The paths run are the resolved ones.
- **A request is only words.** It may name a task, a lease or `--until-done`, a working directory, and Orbit's own
  variables. Its `ORBIT_STORE_DIR` may only be the store it was left in. It must be written within the last minute,
  never in the future. Its process ancestry may be at most 32 entries, Orbit's own bound.
- **Your stores only.** Requests are read from the default store, from the `ORBIT_STORE_DIR` VS Code itself was
  started with, and from `orbit.live.storeDirs`. Both settings (`storeDirs`, `nodePath`) are machine-scoped and read
  from your User or Remote settings alone. A repository you open cannot set them, and a workspace value is ignored.
  Paths must be absolute.
- **Your room and your files only.** The live room's folders below the store (`control/live/requests`) must be real
  folders of yours that nobody else may write. A request must be a file you own that nobody else may write, group
  included. The companion never follows a link: it opens the file, then checks it and reads it through the same
  descriptor. In a shared store, another person's request is left alone.

Orbit writes its requests with your umask. Under umask `002`, common on Linux, they are group-writable and the
companion refuses them. Use umask `022` in the shells your terminals start until Orbit writes requests owner-only.

Windows keeps no owner or mode bits, so the ownership checks are skipped there. A request still runs nothing but
the `node` you named and the `cli/live.mjs` of a Orbit install in a host's plugin folder.

## Install

The companion has no dependencies and no build step. Choose one:

- Copy this folder into VS Code's extensions folder and restart VS Code:
  `~/.vscode/extensions/orbit.orbit-live-1.8.5/` (on Windows
  `%USERPROFILE%\.vscode\extensions\orbit.orbit-live-1.8.5\`).
- Or try it for one window: `code --extensionDevelopmentPath=<this folder>`.

Then, in your User settings:

- `orbit.live.nodePath` (required): the absolute path of a `node` 20 or later. `command -v node` prints it.
- `orbit.live.storeDirs`: the stores, as absolute paths, if your terminals export `ORBIT_STORE_DIR`. The default store,
  `~/.orbit/projects`, is always watched.

## Limits

- VS Code splits a terminal group into equal parts. It offers no API to choose the new pane's
  width, so drag the divider once to set it.
- Only one Orbit viewer opens per session. Orbit's own lease decides that: a second request for the
  same session while one viewer is open is answered `ALREADY_ATTACHED` before it ever reaches this
  extension.
