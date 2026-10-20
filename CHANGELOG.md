# Changelog

## 0.0.2

- Orbit Live's pane as drawn (ADR 0028): a bordered badge on the header (the orbit, a dot, `ORBITING`) with the
  workflow's age, the views' keys over their labels with the view's words beside them, `TASK EXECUTION` with `NOW` on
  its right, the baseline as a bordered card, the step in focus in the brand's tone, a workflow's milestones under the
  step whose turn it was, progress bars on the right edge and a status bar spread across the width -- in a terminal and
  in Claude Code's docked pane alike. `live pane` adds `headerParts`, a row's `box` and a view's `hint` (version 2).
- `live tui` draws every frame of the orbit while it turns, instead of one a second.
- The release skill lists all eleven gates `ship.mjs` runs.
- Found by running a consumer-style project end to end (six cases, ui · api · sql): a pretty-printed `eval` result is
  read whole; a `${PARAM}` in an api match stands for the map's templated segment; an exclusion may name the
  `technique` that settles a security obligation (plan schema, optional); effect coverage asks only controls that
  commit; a log or report outside the checkout prints whole; `init`, `draft write` and `qa-plan` say what is next.
- Antigravity CLI 1.4.2's file tools (`read_file`, `write_file`, `edit_file`) are observed, with captures; a command
  whose result a host did not report shows `not reported` in the trail, never failed; a host session's missing browser
  names its own run directory.

## 0.0.1

Orbit's first open-source release, under the MIT License ([LICENSE](LICENSE)): plugin `orbit`, skills `orbit-*`, CLI `orbit`, store `~/.orbit`, configuration `ORBIT_*`. Repository: [cuongngoht/orbit](https://github.com/cuongngoht/orbit).

- Goal orchestration (`orbit`, `src/goal/`, API `orbit.goal/v1`).
- Orbit Help (`orbit-help`) for navigation and bounded coordination.
- Direct extension API `orbit.extension/v2` and capability API `orbit.capability/v1`.
- Fresh-install-only layout 3 storage, MCP state schema 3 and automation settings schema 3.
- Unsupported state and contracts are refused unchanged; no automatic conversion or aliases.
- Orbit Live's terminal look (ADR 0027): a palette at 256 or 24-bit colour with bands (none on a light background), tabs under the header, an orbit that circles only while the task moves, and `ORBITING` as the moving state's word. The starship lane and `pane.starship` are gone.
- `/orbit` opens Orbit Live as `/orbit-help` does.
