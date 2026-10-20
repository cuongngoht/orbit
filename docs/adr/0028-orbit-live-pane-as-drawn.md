# ADR 0028 — The pane, as drawn

## Status

Accepted (0.0.2)

## Context

ADR 0027 gave Orbit Live its look, and a mockup of the pane a person keeps beside the AI CLI set out how it reads. It
has a header with a bordered badge on its right, each view's key over its label with the view's own words beside the
tabs, TASK EXECUTION with NOW on its right, the baseline as a bordered card, a workflow's milestones under their step,
the progress bars on the right edge and a status bar spread across the width. Two renderers draw the one view model
(ADR 0022): the terminal's pane layout (`src/live/tui/pane-frame.mjs`) and Claude Code's docked pane
(`hooks/live-pane.tsx`). The terminal drew the orbit once a second, so it jumped rather than turned.

## Decision

- **The header in three parts** (`headerParts`, `sections/top.mjs`): where the viewer stands, then the badge, then the
  task's kind and age. The badge holds the orbit, a dot (the indicator's own glyph in any state but ACTIVE) and the word.
  A terminal draws it on a chip and a docked pane in a round border. Beside an AI CLI the header no longer names the
  task's id, which is NOW's first line. The dashboard, where `c` moves between a workflow and its engineering task,
  keeps it. `live pane` answers `headerParts` beside the flat `header`.
- **The orbit turns at its own speed in a terminal.** A frame says whether its orbit turns (`orbiting`), and `live tui`
  paints every 100 ms while it does. Only rows that changed are written. Its motion rule is ADR 0027's, unchanged.
  The docked pane turns every parked orbit in the header, the badge's too.
- **Tabs.** Each view's key over its label, the picked label bright. On the right of the two rows is the picked view's
  HINT: its head's words without the keys a pane lacks, shared over the two rows and left out whole where it does not
  fit, never cutting a key. A view answers `hint`.
- **TASK EXECUTION … NOW.** One title row with NOW on its right and a rule under it. Wide puts the checklist and NOW
  side by side (the frame draws a two-column row, each column at its own width); otherwise NOW follows the checklist
  under a rule. A pane's rows always keep their right side: a step's detail and a check's status word sit on the
  right edge, and a nested step's detail and a run's runner words follow its label.
- **A card is a row's `box`.** The baseline's head (`▶ Baseline (before the change)`, `status`) and its runs share
  `box: "baseline"`. The terminal draws a round border (ASCII `+ - |`) whose border is the indent, and the docked pane
  a `borderStyle: "round"` Box. The head keeps the baseline's status for every count.
- **The step a person's eye goes to** is in the brand's tone: the running step of a workflow, else the newest that ran.
- **Events grouped by step, as a read.** ADR 0027 left this out because no journal line says which step an event
  belongs to. It is now a read of times the journal already holds (`src/live/tui/events-view.mjs`). A step's turn
  begins when the action its receipt names began, else when the receipt was written, and a milestone sits under the
  newest step whose turn had begun by its time. It is not a claim about cause and nothing is written. An engineering
  task, and every-line mode (`a`), keep the flat list. A milestone that warns is `▲`.
- **The bottom edge.** TASK and TESTS put their label on the left and the bar with its words on the right edge. A test
  run whose runner said every case passed is one sentence: `30 passed of 30, as the runner said`. The status bar's
  parts are spread across the width with a dot between each, and it ends in the indicator's WORD: its glyph is the
  badge's.

## Consequences

- `live pane` stays version 2: `headerParts`, a row's `box` and a view's `hint` are additive, and a pane that does
  not know them draws as before.
- `test/live-look.test.mjs` holds the terminal's drawing and the answer. `hooks/tests/live-pane.test.tsx` holds the
  docked pane's borders, spread and hint.
- Sixteen colours still have no orange: the brand's tone is magenta there, as in 0.0.1.
