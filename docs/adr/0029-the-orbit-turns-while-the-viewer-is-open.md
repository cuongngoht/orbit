# ADR 0029 — The orbit turns while the viewer is open

## Status

Accepted (0.0.3). Amends ADR 0027's motion rule; the rest of ADR 0027 and ADR 0028 stand.

## Context

ADR 0027 gave the header an orbit that turned only while the LIVE indicator was ACTIVE, launched by each new line and
parked in a quiet tone otherwise. A viewer beside an AI CLI is idle, waiting, blocked or finished much of the time, and
there the orbit stood still: the viewer looked stopped while it was reading the journals as well as ever. The look the
pane is drawn to asks for a satellite that goes round its planet the whole time the viewer is open, in the header and
in the badge, a larger orbit where the viewer waits for a task, and a pace a person can set.

Three things the old rule kept apart still have to stay apart:

1. **The orbit** is the viewer's own motion: a picture.
2. **The task's activity** is the indicator's word (ADR 0022), moved only by evidence: ORBITING, IDLE, WAITING,
   BLOCKED, COMPLETED and the rest.
3. **The viewer's connection** is the presentation state: CONNECTING, RECONNECTING, UNAVAILABLE, DEGRADED. The engine
   says DISCONNECTED where a page would say OFFLINE.

The full-screen viewer also drew a whole frame on every paint while the orbit turned, every section of it, to move a
few dots.

## Decision

- **Motion is the viewer's, the word is the task's.** The orbit (`src/live/orbit.mjs`) turns in every state of the
  indicator, on the viewer's own clock. A terminal hands in `orbitMs`, a monotonic time (`performance.now()`, or a
  test's fake timers) that is never the view model's `nowMs`, which every "ago" and the evidence rule read. Nothing in
  the orbit reads evidence, and the indicator, a lifecycle, a count and a freshness are the same at every moment of it.
  What the state changes is the satellite's tone (`MOTION`): peach while the task moves, grey otherwise. The speed does
  not change, so the orbit never jumps when the state changes.
- **Still only on a person's word.** `pane.animation: off` (reduced motion) stands it on one frame. With no clock --
  a docked pane's `live pane` answer, which must be the same answer however often it is asked -- it is parked as one
  segment per row, and the pane turns it itself. TERM=dumb and a pipe never get the full-screen viewer at all.
- **Frames are geometry, never drawn by hand.** `src/live/orbit/geometry.mjs` holds the SIZES -- `mini` (3×1 cells, the
  badge's and a narrow pane's header), `compact` (5×1, the header), `expanded` (9×3, a waiting viewer's) -- as an
  ellipse on a grid of Braille dots, two by four to a cell. A size's ring is the fewest samples of its ellipse in which
  the satellite never moves more than one dot, from the top and clockwise: 12, 22 and 42 positions.
  `src/live/orbit/raster.mjs` draws every frame of a size once, Braille or ASCII. The ASCII frames are their own: a
  satellite reads `'`, `-` or `.` by where it is in its cell, `O` in front of the planet, and hidden behind it. Every
  frame of a size has one shape, and the planet keeps its cells.
- **Depth is colour.** The planet is peach. The satellite is light peach on the half in front of the planet and dark
  peach behind it, both grey in a state that is not ACTIVE. A dim track shows the ring where there is colour beyond
  sixteen; in sixteen colours and in one colour there is no track, because it would hide the satellite. No orbit tone
  is bold: a terminal that draws a Braille cell bold may fall back to a font that draws all eight of its dots.
- **Two orbits, one angle.** The header opens with `compact` (`mini` below 60 columns) and its badge holds `mini`. Both
  take their frame from the same share of one revolution, so they turn together. `pane.orbitSpeed` -- slow, normal,
  fast: 6, 3 and 1.5 seconds a revolution -- is the one pace.
- **An orbit tick draws the orbit's rows and nothing else.** A row that holds the orbit says so (`orbit: { part, k }`).
  `frameOf` reports them (`orbitRows`), and `orbitFrameOf` draws only those rows again, over the last frame, from the
  same state and the same derived picture. The terminal adapter (`cli/live-tui.mjs`) keeps its one 100 ms paint: a data
  frame when anything changed, else an orbit tick, else nothing. It adds no timer. It skips a tick while the terminal
  has not drained the last write, never a data frame, and the orbit loses nothing by it, because its phase is the
  clock's. Within a second the state is left as it is, so the picture is reused.
- **The screen is a table of regions.** `src/live/tui/regions.mjs` `REGIONS` holds the top (the header, its rule), the
  body and the bottom (a rule, the footer). The body is given what the others leave, so a region added or dropped
  moves nothing else. Beside an AI CLI on bands the two rules give way to the bands, as the look draws them. The
  dashboard, sixteen colours and no colour keep them.
- **The pane, closer to its look.** The badge has edges (`▏ … ▕`), the brand's while the task orbits and the
  indicator's own colour otherwise. A docked pane draws its own border, so the edges are left out of its answer. The
  tabs are a table: one row where they fit with the widest hint beside them; each key over its label with the hint over
  the two rows, as the look draws them; two rows of three in a pane of 40 to 55 columns, so no label is cut; else each
  key over its label. NOW's labels share one column (`LABEL_CELLS`). A header names a task's kind (`PROVIDER_WORDS`),
  never `autonomous-engineering`. Below 60 columns the header keeps the badge whole and leaves out the task's kind and
  age, and the footer is compact: a shorter bar and the same counts. A viewer with no task shows the expanded orbit in
  the middle, over what it waits for.
- **`live pane`'s `orbit`** is `{ moving, revMs, variant, rings: [{ size, parked, frames }] }`. Its frames are
  segments, and it holds no time. It stays in version 2: the docked pane ships with the engine that answers it. A pane
  that does not know the shape draws the parked header, as it would an answer without an orbit.

## Consequences

- The orbit turns in every state the tests name: ACTIVE, IDLE, WAITING, BLOCKED, COMPLETED, FAILED, CANCELLED,
  DEGRADED, DISCONNECTED and NONE. `test/live-orbit.test.mjs` holds that the orbit's clock moves nothing but the orbit:
  at two moments the indicator, the lifecycle rows, the progress and every other row of the frame are the same.
- In a real pseudo-terminal (`test/live-tui-pty.test.mjs`), a viewer left alone draws many header frames with one
  clear of the screen. `q`, Ctrl+C and SIGTERM each give the terminal back, and the process ends: no timer outlives it.
- What it costs is measured, not claimed (`ORBIT_BENCH=1 node --test test/perf/live-orbit.bench.mjs`). On the release
  machine an orbit tick took about 0.03 ms, against 0.4 to 2 ms for the whole frame 0.0.2 drew on each paint. A tick
  wrote at most the header's row, about 700 bytes at 24-bit colour. `live tui` itself spent about 0.35% of one core
  more with the orbit turning than with it still.
- `pane.orbitSpeed` is a new setting, additive to schema 1. `pane.animation` keeps its two words.
- ADR 0027's `ORBIT_GLYPHS`, `KICK_MS` and the evidence-launched phase are gone, and so is the ASCII table's Braille
  rows. An ASCII viewer is drawn ASCII frames.
- Not in 0.0.3: an orbit in Orbit Control's page, a separate pace per state, or a frame rate above the paint's ten a
  second.
