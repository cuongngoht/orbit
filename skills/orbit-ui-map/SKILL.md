---
name: orbit-ui-map
description: >
  Fill and correct ui-tests/graph/ — the screens, controls and effects every case points into.
  Use when a case needs a control the map does not have, when `query verify` names records that
  drifted, when a screen is new, or when adopting the engine on a product whose map is still
  empty. Two halves the map already distinguishes: read the checkout the project declared to get
  candidates (`seen: "src"`), then confirm them in a live browser (`seen: "live"`). This skill
  names no framework, router or test-id convention — it reads what your project declared and
  holds you to it.
argument-hint: <screen id or route to map | "the map has no <control>" | "re-observe what verify flagged">
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

**Storage paths:** read `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`
and run `query storage --json` before working with project files. `$DATA`, `$SCRATCH`,
`$REPORTS`, `$RUNTIME` and `$EVIDENCE` below are the resolved paths from that command.


# Fill the map, so nothing downstream has to explore

Every other playbook here says *look it up, do not explore*. This is the one job allowed to look,
and what it writes is what the others read. So the bar is **provenance, not coverage**: a record
says where it came from (`seen`) and which build it came from (`fe_commit`), or it is a guess
wearing a record's clothes.

**Two shared references, the same for every `orbit-*` playbook.** Read the one you need; do not
re-derive what is in them:

- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` — which Claude Code tool does
  which QA job, what to do when an optional one (LSP, ToolSearch, a subagent, an MCP server) is not
  in this session, and the lines that do not move.
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/dsl.md` — how to read the JSON DSL off the
  tables that define it (`query.mjs dsl`) instead of from memory.

## 0. Read what the project declared — assume no stack

```bash
node <engine>/cli/query.mjs check              # a map with findings records nothing new
node <engine>/cli/query.mjs screens            # what is mapped already, and how healthy
node <engine>/cli/query.mjs find <text>        # before adding: is this control already here?
node <engine>/cli/query.mjs notes <screen>     # traps already recorded about this screen
cat $DATA/project.json                      # origin · frontend.roots + srcDir · launcher
cat $DATA/graph/meta.json                   # THIS product's layers[] and timings[]
```

A project seated in the machine store starts with no `$DATA/graph/`. A map file that is absent reads
as empty, and each one is created the first time it is written: `record-edge` writes `edges.json`,
and you write `screens.json`, `effects.json` and `meta.json` as §5 says.

| what you need | where it comes from | if it is not declared |
|---|---|---|
| where the app runs | `project.json` → `origin` | the live half is off — ask, never guess a host |
| where the code is | `frontend.roots` (first that exists; `ORBIT_FRONTEND_ROOT` wins), `frontend.srcDir` | the source half is off — say so and record live-only |
| how to open a signed-in browser | `project.json` → `launcher` | `orbit-browser`, or ask |
| the words an effect may use | `graph/meta.json` → `layers[]`, `timings[]` | a word not declared there is a `check` finding — add it **there**, never to the engine |

The engine ships no stack vocabulary and neither does this skill. A sentence of yours that names
a framework, a component library or an attribute convention belongs in the project's own playbook.

## 1. One screen is one unit of work — and the two halves split differently

Never sweep a frontend, and never read the map whole.

- **The source half fans out.** Spawn **`orbit-map-recorder`**, one agent per screen, together:
  reading is read-only and the screens are independent. Each writes its candidates to
  `$SCRATCH/<screen>.jsonl` and reports six lines, so no frontend enters this context.
- **The live half stays here, and it is serial.** There is one browser session, and clicking a
  real control touches real data — something a human must be able to watch, not a job to hand to
  five agents at once.

Only this session appends to the map, because only this session knows whether the browser it saw
was the build the record claims. And nothing is mapped "while we are here": an unrequested screen
is a line in the report, not a record.

## 2. Harvest from the declared checkout → `seen: "src"`

A source reading is a **hypothesis**: what the code says renders, never watched render. It earns
no `fe_commit`, because it was not observed at a build.

One JSON object per line (`//` and blank lines are skipped). `record-edge` requires all seven:

```jsonl
{"from":"home","via":"Add","kind":"button","selector":"getByRole('button',{name:'Add'})","opens":"dialog","to":"dlg-thing","seen":"src"}
```

- **`from`** and a non-null **`to`** must already be screens in the map — add the screen first (§5).
- **`via`** is the control's label; `from/via` is the key cases and effects address it by, and it
  is unique across the map.
- **`opens`**: `screen` navigates · `dialog` modal · `panel` inline/side panel · `inline` acts in
  place · `external` leaves the app · `none` no surface change. `to: null` when nothing opens.
- **`selector`** is a Playwright locator, defined here and nowhere else. `record-edge` refuses an
  empty one or `"UNKNOWN"`: a control you can read in code but cannot yet address is an **open
  question**, not a record.
- Flag what a case must respect: `required` on an input the commit control waits for,
  `destructive` on anything that deletes or hard-changes real data, `note` for the trap.

## 3. Confirm in a live browser → `seen: "live"`

Open the session the same way a run does — the project's launcher, `ORBIT_RUN_DIR` at the run
directory it printed — then look with the CLI directly:

```bash
playwright-cli snapshot                 # the accessibility tree: role + accessible name
playwright-cli find "<text>"            # the same tree, searched
playwright-cli --raw eval "<expr>"      # only when the tree cannot answer it
```

Turn each node into the record: the role is `kind`, the accessible name is `via` **and** the name
in the locator. Then click it and watch: what appeared answers `opens`, where you landed answers
`to`. A control whose `to` you did not see is `to: null` plus a note — not a plausible guess.

- **Do not click a `destructive` control to find out where it leads.** Record it `seen: "src"`,
  `destructive: true`, `to: null`, and leave the hypothesis standing.
- Stamp `fe_commit` = HEAD of the declared checkout, **in the same turn you observed**. A `live`
  record without it is refused, and rightly: the claim has no expiry date.
- Promote an existing `src` record by correcting it in place (§4), not by appending a second one.

## 4. Write through `record-edge`, never by hand

```bash
node <engine>/cli/record-edge.mjs $SCRATCH/candidates.jsonl --dry   # judge, write nothing
node <engine>/cli/record-edge.mjs $SCRATCH/candidates.jsonl         # 0 = appended
node <engine>/cli/query.mjs check                                          # must stay clean
```

`$SCRATCH/` is outside the repository; scratch belongs there. The tool validates every line, appends,
re-runs the **full** `check`, and **rolls the file back** if the map came out dirty, so a wrong
batch cannot land. It rejects: a missing field, a dangling `from`/`to`, a bad `opens`, an empty or
`UNKNOWN` selector, `"live"` with no `fe_commit`, and a `from/via` already in the map.

That last one is deliberate: **an existing record is corrected in place in `graph/edges.json`**,
never re-added. And a record that turned out wrong is *edited*, never deleted — a wrong record is
evidence of what changed, and deleting it loses that.

## 5. Screens and effects are hand-written, with the same discipline

`record-edge` appends edges only. Two files stay hand-edited, and `query check` is the gate:

- **`graph/screens.json`** — `id` + `name` required; `url` only if it has a route (`{param}` marks
  a templated segment); no url means a dialog, wizard tab or row menu. Same `seen` / `fe_commit`
  rules. Add the screen **before** the edges that point at it.
- **`graph/effects.json`** — one record per commit control, `on: "<screen>/<via>"`. `layers` uses
  only keys `meta.json` declares, and every entry carries its own `src` (`file:line → file:line`);
  a table name without one is a guess someone will query and pass on. **Omit** a layer to claim
  "does not touch it" (prints `—`); an untraced control prints `?`. Conflating the two is how
  somebody stops checking something that does happen — `partial: true` when a hop was not traced.

## 6. Re-observing what drifted

```bash
node <engine>/cli/query.mjs verify     # which records cite a file that changed since fe_commit
```

Work the list it prints: re-observe live, correct in place, re-stamp `seen` and `fe_commit` in the
same turn — a record re-observed but not re-stamped ages straight back into the same problem.

Correct it **through the tool**, not by opening the file:

```bash
node <engine>/cli/record-edge.mjs <patch.jsonl> --replace --dry   # judge it, write nothing
node <engine>/cli/record-edge.mjs <patch.jsonl> --replace         # then for real
```

`--replace` is the inverse of an append: the key must already exist, only the fields each line carries
are touched, and the write goes through the same `check` and the same rollback. So the note
somebody wrote at 2am and the `destructive` guard survive, the record keeps its place in the file,
and a correction that breaks the map leaves the map exactly as it was. A correction claiming
`seen: "live"` must bring its own `fe_commit` — the record's old one pins the old observation.

It prints the `was` and the `now`, and then the `note.mjs` command to record them. Run it: a
correction is the one write that erases the only copy of what the record used to say, and "this
was a different selector at abc1234" is what stops the same afternoon being spent twice.

When a case failed and it is not yet clear that the map is what is wrong, do not start here —
classify first (`orbit-test-suite` §2b, `query triage`, `orbit-failure-analyst`). A timeout on its
own is not evidence of drift, and `orbit-map-healer` refuses the job when that is all there is.

The healer's scope is **one record and one locator**: how to address a control that is otherwise
the same. When it returns `MAP_EVOLUTION` the work is yours, and it is this skill from §1: the
control's role, its label, where it leads or whether it exists at all has changed, and that is a
screen to re-observe rather than an address to patch. A locator fitted over a changed control
encodes the old meaning under a new address, which is worse than the drift it replaced.

**`graph/meta.json`'s own `fe_commit` is the map's expiry date, not a record's.** Move it only
after re-observing the map as a whole at that commit. Bumping it because one edge was refreshed
tells `verify` the whole map is current and silently switches off drift detection for everything.

What you learned that the record itself cannot hold — why this locator and not the obvious one is
already a `note` field on the edge, but *why the obvious one keeps coming back* is not — goes to
the project's memory instead:

```bash
node <engine>/cli/note.mjs "<screen>/<via>" "<title>" "<body>" --type=trap
```

## Done means all of these

- [ ] every new record names where it came from: `src` = read, `live` = watched, with a commit
- [ ] no `selector` is empty or `UNKNOWN`; what could not be addressed is an open question
- [ ] `destructive` and `required` are flagged — a case that walks here depends on them
- [ ] screens exist before the edges pointing at them; effects use only `meta.json`'s vocabulary
- [ ] `record-edge` exited 0 and `query check` prints no findings
- [ ] corrections went in place; nothing was deleted to tidy up
- [ ] the report says which screens were mapped, what stayed a hypothesis, and what is still open
