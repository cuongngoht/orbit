# ADR 0027 — Orbit Live's look, and the orbit

## Status

Accepted (0.0.1)

## Context

Orbit Live's terminal viewer drew sixteen colours, a header ending in the viewer's own clock, and a starship lane after
the LIVE indicator. A design for the pane a person keeps beside the AI CLI asked for more: dark panels with a soft
peach accent, a header that opens with an orbit, the state as a pill, numbered tabs under the header, cards of checks,
and a footer of progress bars -- and for motion that says *Orbit*, without the viewer ever claiming the task moved when
it did not (ADR 0022).

## Decision

- **A palette by depth, as data.** `src/live/render/theme.mjs` holds `PALETTE` (each colour as 24-bit RGB and its
  nearest xterm-256 index), `LOOK` (a tone as a foreground, a background, bold) and `BANDS`. `ansi.mjs` is still the
  one emitter of escape sequences: a renderer is handed `colour` (sixteen colours, as before) or a PAINT
  `{ depth, band }`. The CALLER decides: `cli/live.mjs` hands the environment to `depthOf` -- 24-bit where `COLORTERM`
  says so or Windows Terminal is the host, 256 where `TERM` says so, else sixteen -- and draws bands only with more
  than sixteen colours and a background `COLORFGBG` does not call light. `NO_COLOR`, `TERM=dumb` and a pipe draw no
  colour at all.
- **Bands.** The header, the tabs, a card of checks (a baseline's runs, what a change is held to) and the footer each
  sit on a background across the row's whole width; the padding between and after a row's cells is on it too.
- **The pane layout.** The tabs head the column under the header; a block's title is in the brand's tone with a rule
  to the row's end; status words keep their own colours; the TASK bar is its done cells on a track; the TESTS line
  draws a bar only over a total its runner said. Nothing new is said: every word is still a journal's.
- **The header reads the one indicator table** (`indicatorFor`, ADR 0022) as a pill, so the header and the status bar
  never disagree. The viewer's wall clock left the header: a viewer's own clock is not evidence.
- **ORBITING is the word.** `PRESENTATION_WORDS.LIVE` and `INDICATOR_WORDS.ACTIVE` read `ORBITING` in a terminal, a
  docked pane and the status line. The state keys (`LIVE`, `ACTIVE`), the `ORBIT LIVE` badge and the `live` command
  are unchanged. Orbit Control's page badge -- its feed's connection, not a task -- keeps `LIVE`.
- **The orbit replaces the starship lane** (`src/live/orbit.mjs`): a planet and its satellite, three Braille cells
  (ASCII frames of their own). It turns only while the indicator is ACTIVE, with the newest evidence's phase --
  launched by each line, ten frames a second for three seconds, then four -- rests on its parked frame in a quiet tone
  otherwise, and stays still for `pane.animation: off`. A docked pane's header holds it parked, so `live pane`'s answer
  does not change on every ask; `orbit` in the answer hands the pane the frames, whether it moves and the time it
  turns from, and the pane turns it on its own clock. `pane.starship` is removed.
- **Width.** A text symbol (`▶ ⚠ ⏸`) is one cell, as terminals draw it: `Emoji_Presentation`, not
  `Extended_Pictographic`, makes a character two cells wide. A band and a right-hand column now end where they should.

## Consequences

- Motion is never progress: the orbit wraps and says no share, and `test/live-orbit.test.mjs` holds that no clock
  moves it outside ACTIVE and that a blocked task shows `■ BLOCKED`, parked.
- A light terminal theme gets no band; sixteen colours look as they did before 0.0.1.
- A live settings file that still holds `pane.starship` is refused as an unknown setting and left unchanged, as every
  unsupported key is.
- Not in 0.0.1: a theme a person picks, a viewer on the left (the right side stays, ADR 0021), events grouped by step
  (no journal line says which step an event belongs to). 0.0.2 groups them by step as a READ of times, and draws the
  pane as its mockup does (ADR 0028).
