---
name: orbit-browser
description: >
  Pick a browser and a signed-in profile from THIS machine and open a test session on a copy of
  it, for running UI test cases through playwright-cli. Use when a run is REFUSED with no
  playwright-cli session or a signed-out one, when asked which browsers or profiles are available
  here, when setting up a machine to run cases for the first time, or when wiring `launcher` in
  ui-tests/project.json. Chromium family (Chrome, Edge, Chromium); no password is ever read.
argument-hint: <"open a browser for testing" | "which profiles do I have" | "why is the session signed out">
allowed-tools:
  - Read
  - AskUserQuestion
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/orbit-browser/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

**Storage paths:** read `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`
and run `query storage --json` before working with project files. `$DATA`, `$SCRATCH`,
`$REPORTS`, `$RUNTIME` and `$EVIDENCE` below are the resolved paths from that command.


# Pick a browser and profile, then run the cases

This is the **optional adapter** behind `project.json` → `launcher`. The engine knows only "a
script that opens a signed-in browser and prints where it is"; this skill is one such script, for
machines whose tester is already signed in through Chrome or Edge. A team that opens its browser
another way writes its own and the engine does not change.

Two commands, one pure list and one launcher:

```bash
node <plugin>/skills/orbit-browser/pick.mjs --json     # what is on this machine
node <plugin>/skills/orbit-browser/open.mjs …          # the launcher the engine spawns
```

## 1. Wire it once

```jsonc
// $DATA/project.json
"launcher": "${CLAUDE_PLUGIN_ROOT}/skills/orbit-browser/open.mjs",
"launch": { "channel": "chrome", "env": "test" }
```

No repo-local browser state or `.gitignore` change is needed for layout 3.

Then the environment, **outside the repository** — one variable per deployment:

| variable | meaning |
|---|---|
| `ORBIT_BROWSER_URL_<ENV>` | the url for that `--env`, e.g. `ORBIT_BROWSER_URL_TEST`. A `-` in the name becomes `_` |
| `ORBIT_ORIGIN` | the fallback when a project has one deployment and sets nothing else |
| `ORBIT_RUN_DIR` | where the session lives; the launcher prints the one it used, and `run-case` reads it |
| `ORBIT_PROFILE` · `ORBIT_CHANNEL` · `ORBIT_MODE` | the engine's own overrides for profile, channel and headed/headless |

## 2. Choosing — the list is the point

**A profile's directory and its display name are different strings.** On a real machine the
directory `Profile 1` is shown as "Profile 2" and `Profile 2` as "qs sol". Never guess one from
the other, and never pass a display name to `--profile`.

1. `node <plugin>/skills/orbit-browser/pick.mjs --json` — browsers actually installed here,
   each with its profiles as `{ dir, name, email }`.
2. Ask the human which browser, with **AskUserQuestion**; offer only what the list returned.
3. Ask which profile, showing `name` and `email` so they recognise the account — and pass `dir`.
4. Copy it:

```bash
node <plugin>/skills/orbit-browser/pick.mjs --use --channel chrome --profile "Profile 2" --as work
```

The copy lands in the checkout-specific profile directory printed by `pick.mjs` — **outside every repository**, beside the
`identities.json` the engine already keeps there, because it holds cookies. Only the parts that
carry a session are copied (a few hundred KB, not the gigabytes of `Cache/`). The choice itself is
recorded under the checkout session directory in `$RUNTIME`, outside the repo.

**Close the browser first.** The tool refuses while Chrome or Edge is running, because a profile
copied mid-write opens signed *out* — which reads exactly like the product logging you out.
`--force` overrides it; the refusal is usually right.

To run a case as a named identity, map it once — the engine reads this file:

```bash
echo '{"admin": "work"}' > "$RUNTIME/identities.json"
```

## 3. Opening, then running

```bash
node <plugin>/skills/orbit-browser/open.mjs --channel chrome --headed --env test --profile work
# run directory : <dir>
# target        : <url>
ORBIT_RUN_DIR=<dir> node <plugin>/cli/run-case.mjs <id> NAME=TC-… --dry
```

Those two lines are the contract: the engine parses them, and `run-case` drives the session in
that directory. The launcher writes `.playwright/cli.config.json` there, which is how
`playwright-cli` finds the browser and how the engine reports which profile a run used.

The **first** open of a fresh copy should be `--headed`: if the app wants the session refreshed, a
human finishes it once in that window and every later run is headless.

Opening again on the same profile is safe — the launcher closes the previous session first, because
playwright-cli will not run two browsers on one profile. But a playwright-cli session is named, not
scoped to its directory: everything here shares the session `default`, so **one profile is open at
a time**. Opening a second profile replaces the first rather than joining it.

## 4. When it does not work

| what you see | what it means |
|---|---|
| `is running — close every window of it` | the source browser is open; close it, then copy again |
| `has no profile directory "…"` | a display name was passed where a `dir` belongs — re-read the list |
| `no copied profile "…"` | `--use` has not run on this machine, or `--as` used a different name |
| `no url for env "…"` | set `ORBIT_BROWSER_URL_<ENV>` or `ORBIT_ORIGIN` in this shell |
| `playwright-cli is not on PATH` | `npm i -g @playwright/cli` |
| the window opens signed **out** | the copy was taken while the browser ran, or the session simply expired — re-copy with the browser closed, then open `--headed` and sign in once |
| `run-case` says `no playwright-cli session` although a window is open | `ORBIT_RUN_DIR` does not point at the directory the launcher printed |
| `Browser is already in use` | a session is open on that profile outside the launcher — `playwright-cli close-all`, then open again |

A signed-out session is never a product finding. Fix the session, or say the case could not be
verified — do not downgrade the case and call it a pass.

Which browser, which profile and which flag finally worked is a fact about **this machine**. The
notes are kept in Orbit memory and each one is stamped with the host that wrote it, so read what the team
already knows — `node <plugin>/cli/query.mjs notes machine` — check the host on anything you find,
and write yours once you know it:

```bash
node <plugin>/cli/note.mjs "machine" "Edge profile 2, not Chrome" "<what worked here>" --type=trap
```
