---
name: orbit-release
description: >
  Release the orbit engine and get it into another repository. Use when asked to ship,
  tag or publish a new version of this plugin, to decide whether a change is major or minor, to
  install the engine in a product repo, to copy it onto a machine with no network, or when a
  consuming repo is on an old version and `query check` complains about a vocabulary it does not
  recognise. Covers the definition of done, the five version fields that must agree, the three
  install routes, and what the consuming repo owns afterwards.
argument-hint: <"ship it" | "is this major or minor" | "install the engine in <repo>" | "why is my copy stale">
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/orbit-release/*)
user-invocable: true
---

**Storage paths:** read `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`
and run `query storage --json` before working with project files. `$DATA`, `$SCRATCH`,
`$REPORTS`, `$RUNTIME` and `$EVIDENCE` below are the resolved paths from that command.


# Ship the engine, and copy it into a repo

Two jobs that are easy to confuse. **Shipping** is about this repository: prove the engine is
sound and give the change an honest version number. **Copying** is about a product repository:
get the engine there and scaffold the data it reads. Nothing about a product belongs in the
engine, and nothing about the engine belongs in a product's `$DATA/` — that line is the whole
design, and both halves below exist to keep it.

## 1. Ship it

```bash
node skills/orbit-release/ship.mjs                 # every gate, one command
node skills/orbit-release/ship.mjs --bump=added    # …and what the next version would be
node skills/orbit-release/ship.mjs --ci            # CI's run: host acceptance is awaited (`wait`), never failed
```

It runs the repo's definition of done and exits 2 if any gate fails. Eleven gates in one command,
because eleven separate commands is how a release goes out with ten of them run:

| gate | what a failure means |
|---|---|
| the suite passes, and says how many tests | a real regression, or a test that no longer means anything |
| every line holds to Five Lines | a function grew instead of being split |
| the fixture project is clean, **and check exits 0** | the engine's own example map or cases broke |
| `plan-check` on the fixture finds no errors | the engine's own example plan broke |
| `schema/case.schema.json` and `schema/plan.schema.json` are what the generator produces | the DSL moved and the published schema did not — every consuming repo will report drift |
| the five version files agree | a half-done bump, which is the one thing CI cannot fix for you |
| the layout, the manifest and the descriptions a host reads | a host **rejects the archive**: a top-level `bin/` goes on PATH without appearing on the surface an admin approves (so the entry points stay in `cli/`), and a `SKILL.md` or agent **description** containing `<angle brackets>` reads as XML and is refused — a placeholder belongs in `argument-hint` |
| every `SKILL.md` and agent has frontmatter a host parses | a host drops the skill silently |
| `test/no-compat-layer.test.mjs` passes | an alias, adapter or schema upgrade crept back in |
| native host acceptance (`docs/host-acceptance.json`) matches `hostSourceDigest` | a host was never smoke-tested on this source; recorded only from real runs |

Never edit a generated `schema.json` to make the fourth gate pass. Run
`node cli/schema.mjs --write` and commit what it produces.

### The version number is a promise

The rule is in `CLAUDE.md` and there is no third answer:

- **Changing** anything a consumer can observe is **major**: a CLI name or flag under `cli/`, an
  exit code, a `run-log.jsonl` record kind, a `ORBIT_*` variable, the `$DATA/` layout, a
  `project.json` or `graph/meta.json` key, or the DSL.
- **Adding** to one of those is **minor**.
- Anything else is a patch.

`--bump=changed|added|fixed` prints the next number. Set it by hand in all five: `package.json`, `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`, the root `plugin.json` and `.codex-plugin/plugin.json`. The gate
and CI both refuse when they disagree.

**A prerelease is the same rule read properly, not an exception.** The rule is about *published*
contracts, and `1.0.0-beta` publishes none — so a breaking change during a beta earns no major
bump, because there is nothing yet to break. Any change advances the prerelease
(`1.0.0-beta` → `1.0.0-beta.2`), and `--bump=release` is what turns it into `1.0.0`. The version
gate says so out loud while a prerelease is current, so nobody reads a beta as a promise.

A release documents the current contracts and breaking changes. Orbit is installed fresh: do not
introduce migration, compatibility aliases, automatic upgrades, historical imports or dual state paths.

## 2. Copy it into a repo

Three routes. They differ only in where the plugin comes from — pick by what the team needs, not
by what is shortest to type.

**(a) From GitHub — the normal case.** In a Claude Code session, in the product repo:

```
/plugin marketplace add cuongngoht/orbit
/plugin install orbit@orbit
```

**(b) From a local clone — while developing the engine.** Changes are picked up without a
release, so this is how to try an unreleased fix against a real product:

```
/plugin marketplace add /path/to/orbit
/plugin install orbit@orbit
```

or, for a whole session against the clone: `claude --plugin-dir /path/to/orbit`.

**(c) Pinned for the whole team.** Run (a) once, then **commit the `.claude/settings.json` it
wrote** — it carries `extraKnownMarketplaces` and `enabledPlugins`, and every teammate then gets
the plugin by opening the repo, with no command to remember. Let `/plugin` write that file:
hand-authoring those two keys means guessing at a shape, and a wrong guess fails quietly.

For a machine with no network, copy the clone onto it and use (b) against the local path.

**(d) As an archive, uploaded to a host.** Build it with `git archive`, never by zipping the
working directory — that is what applies `export-ignore` from `.gitattributes`, and it is the only
reason the one symlink this repository keeps (`.agents/cli`) stays out of the zip:

```bash
V=$(node -p "require('./package.json').version")
git archive --format=zip -o ../orbit-$V.zip HEAD
```

**No `--prefix`.** The host looks for `.claude-plugin/plugin.json` at the archive's ROOT; a
prefix puts it one directory down, and the upload is refused with "The archive must contain a
.claude-plugin/plugin.json manifest". `unzip -l ../orbit-$V.zip | grep ' .claude-plugin/plugin.json'`
shows it where the host will look.

A host validates the archive before anybody can install it, and what it refuses is the sixth gate
above. **Five** rules, each one paid for with a release:

- a top-level `bin/`, because the CLI would add it to PATH while the surface an admin approves
  never names it — so the entry points stay in `cli/`
- a `SKILL.md` or agent **description** that reads as XML, because `<feature>` in a rendered
  sentence is a tag — a placeholder belongs in `argument-hint`
- a **symbolic link**, anywhere in the zip, whatever it points at. This repository keeps two on
  purpose — `.agents/cli` → `../cli` and `hooks.json` → `.agents/hooks.json`, both for Antigravity
  and neither read by Claude Code — so `.gitattributes` `export-ignore`s them. The gate does not
  ask "are there symlinks"; it asks whether a **tracked** one would reach the archive, which is
  the only question the upload actually asks.
- a `SKILL.md` or agent **description** longer than **1024 characters**, counted as the host
  reads it — a folded `>` block joined into one sentence, indentation not counted
- the **plugin's own** description, in `.claude-plugin/plugin.json`, longer than **500**
  characters — a tighter limit than a skill's, and the one 1.6.3's first upload hit

All five are checked before the upload now, rather than by it.

### Where `<plugin>` is

The playbooks write `<plugin>` because it differs by context:

- inside a Claude Code session: `${CLAUDE_PLUGIN_ROOT}`
- from a shell, installed: `~/.claude/plugins/cache/orbit/orbit/<version>`
- from a shell, a clone: the clone

## 3. What the product repo does next

**First, before anything else, install and check what the machine needs:**

```bash
node <plugin>/cli/setup.mjs             # what is missing, and what can be installed for you
node <plugin>/cli/setup.mjs --install   # install it, then re-check that it is usable
node <plugin>/cli/query.mjs doctor      # the check on its own, any time
```

Installing the plugin installs the **engine**. It does not install the browser driver the engine
steers, or the database client a project pointed `sql.command` at — and a missing one of those does
not announce itself: the first case to run just fails somewhere that reads like a product defect.
`doctor` asks once, names what is missing, and **exits 1** until it is fixed. Which tools it
requires comes from what the project *declared* — no `sql.command`, no SQL client required.

`setup --install` installs the ones that have a package name, then **asks again** — because the
install is not the point, the tool being usable is, and on Windows a successful
`npm i -g @playwright/cli` still leaves a `.cmd` shim that the engine had to learn to unwrap.
A client the *project* pointed `sql.command` at is not the engine's to install, and `setup` says
so rather than pretending: it prints the fix and exits 2.

It also tells apart the two things that look identical and are not: *not installed*, and *installed
but not runnable from here*. The second is the normal case on Windows, where what sits on PATH is a
`.cmd` shim Node cannot spawn — so `doctor` says the tool is fine and the engine is the problem,
instead of sending somebody to reinstall software they already have.

Then the repo supplies the data the engine reads:

```bash
node <plugin>/cli/init.mjs . --origin=https://test.your-app.example
```

That seats the project in the machine store: the checkout's binding, then `$DATA/project.json` (its
name and the origin), `project.schema.json` and `schema/*.schema.json`. It writes nothing into the
checkout, never overwrites an existing file and creates no graph or screen; each map file appears
the first time something records into it. A team that commits its test data with the product's code
runs `init . --in-checkout --origin=…` instead, which writes the whole template tree into
`<checkout>/ui-tests/` and mirrors it into the store. A store-home project is published into the
checkout later with `storage export --all --move`, and only a person applies that. Then, in order:

1. **`$DATA/project.json`** — `origin`, and whatever this product actually needs:
   `sql.command`, `launcher`, `signIn.hosts`, `launch`, `frontend.roots`, `identity.audience`.
   Every key is documented in `README.md` §5, and `project.schema.json` sits beside it so the
   editor explains each one as you type.
2. **`$DATA/graph/`** — the screens, controls and effects a case points into. The
   `orbit-ui-map` skill fills it: read the checkout for candidates (`seen: "src"`), then confirm
   them in a browser (`seen: "live"`). Declare this product's own `layers` and `timings` in
   `graph/meta.json` — the engine ships only `sql` and `sync`, and `check` then holds the map to
   whatever it declared.
3. **`$DATA/screens/<screen>/cases/<id>.json`** — one file per case, in the folder of the screen it starts on. `orbit-test-plan` decides which cases are
   worth writing at all; `orbit` is the playbook for writing and running one.
4. **`node <plugin>/cli/query.mjs check`** — zero findings, and it exits 1 if there are any. This
   is the gate for the product's data, exactly as §1 is the gate for the engine.

A consuming repo usually also keeps its own playbook skill: the product's traps, its preflight
rules, its launcher script. That is product knowledge, and it deliberately stays out of this
plugin.

## 4. What the machine needs

`query doctor` (§3) checks all of this and names what is missing. The list, for reference — the
engine drives a browser somebody else opened, and reads a database through a command the project
configured, and neither ships with the plugin:

- **`playwright-cli` on PATH**, and a session already open and signed in. `orbit-browser`
  opens one from a profile on this machine; a project with its own launcher points `launcher` at
  it. A run with no session is REFUSED (exit 2), which is not a test failure.
- **`ORBIT_SQL_*`** if the product uses `sql` steps through `orbit-sql`. That login should
  hold `db_datareader` and nothing else.
- **`$RUNTIME/identities.json`** to map a case's `as` to a local profile.
  Signing in stays a human act; no password is ever read, stored or passed.

**Windows works now.** It did not until 1.0.0-beta.2: the engine spawned the bare name
`playwright-cli`, which on Windows is a `.cmd` shim Node refuses, and it surfaced as `BUSY`
("retry") rather than `NONE`, so the session gate never printed its useful message. The engine now
reads the shim to find the real entry point and runs that with its own node — no shell, so a
selector containing double quotes survives. `setup` and `doctor` ask the question exactly the way
the runner will.

## 5. What NOT to copy

- **Do not vendor `src/` into a product repo.** The engine is installed, not forked. A copy stops
  receiving fixes and starts drifting from the schema its own cases validate against.
- **Do not copy `$DATA/` between products.** It is the one directory that is entirely about
  one product.
- **Do not copy a profile, a token or a credential anywhere.** A REPORT is mailed and
  shared by design, so nothing secret may ever be written to it — that includes a value bound
  with `into`.
- **Do not hand-edit the schema copies** in a consuming repo. `node <plugin>/cli/schema.mjs --write`
  refreshes them, and `check` says when they are stale — which, right after an upgrade, they are.
