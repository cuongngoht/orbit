# Resolve storage before reading or writing project data

Run `node ${CLAUDE_PLUGIN_ROOT}/cli/query.mjs storage --json` first. Its fields are the
source of truth for paths. Any Git checkout is a Orbit project and nothing has to be initialized
before reading. `/orbit-help`, `node ${CLAUDE_PLUGIN_ROOT}/cli/init.mjs . --origin=<application-url>`
and a workflow's `start` SEAT the project in the machine store: the checkout's binding, a
`project.json` naming the project (and the `origin`, when one was given) and the generated schemas.
They write nothing into the checkout, and they invent no screen, case or graph. A UI run needs an
`origin`: `run-case` refuses until `$DATA/project.json` (or `ORBIT_ORIGIN`) names one.

`<engine>` in every playbook is `${CLAUDE_PLUGIN_ROOT}` — the installed plugin's root, or
the clone when a session was started with `--plugin-dir`. Every command is
`node <engine>/cli/<tool>.mjs`, invoked by path and never by name.

That variable cannot be replaced by a script, and the attempt is circular: running any
command needs the engine root, so a command that prints the engine root is one you cannot
invoke without already having it. It is the only thing that exists before anything runs,
which is also why `allowed-tools` matches it **literally** — write
`node "$(something)"/cli/x.mjs` instead and the permission pattern stops matching, so every
command prompts. What `query storage` does give you is `engineRoot`, for anything running
AFTER that first call: a subagent, a hook, a CI job, a launcher.

In the playbooks, `$DATA`, `$SCRATCH`, `$REPORTS`, `$RUNTIME` and `$EVIDENCE` mean the
returned `dataRoot`, `scratchDir`, `reportsDir`, `runtimeDir` and `evidenceDir` values.
Substitute those absolute paths; do not assume they are relative to the checkout.
For shell examples, set these task-local shell variables to those returned values.
They are notation for the examples, not additional engine configuration variables.

- The TEST DATA lives where `dataHome` says. For a new project that is the machine store:
  `dataRoot` is `<storeRoot>/ui-tests/` and the checkout stays untouched. A person explicitly selects checkout storage with `init --in-checkout` or a confirmed export. Either home holds the same tree, organised by
  SCREEN -- `screensDir` (`$DATA/screens/`):
  - a case: `$DATA/screens/<start-screen>/cases/<case-id>.json` (a case with no `start`:
    `$DATA/screens/_no-screen/cases/`), `"$schema": "../../../schema/case.schema.json"`
  - a plan: `$DATA/screens/<screen>/<plan-id>.plan.json` naming `"screen"`, the `.md` beside it,
    `"$schema": "../../schema/plan.schema.json"`
  - the generated schemas: `schemaDir` (`$DATA/schema/`)
  The folder is for people: an id is the file name and unique across the tree, and every
  command still takes the id (`run-case <id>`, a plan's case link). `query check` and
  `plan-check` report a file in the wrong screen's folder and an id held by two files.
- Each project has one active data home, read and written directly.
- Moving test data between the two homes is a person's decision, and nothing does it on its own.
  `node ${CLAUDE_PLUGIN_ROOT}/cli/storage.mjs where` says where the data lives and why.
  `storage import` copies a committed `ui-tests/` into the store and leaves the checkout's copy in
  place. `storage export --all` (or `--screen=`, `--case=`, `--plan=`) PREVIEWS what would be
  written into the checkout; only a person applies it, from Orbit Control or with
  `--apply --human` typed in a terminal of their own, confirming the preview's id. An agent's
  shell is refused: give the person the command the refusal prints, and never try to apply it.
- Drafts, lessons, architecture, ledger, notes and evidence stay store-only.
- Report HTML is written to the store, `$REPORTS` (`<storeRoot>/reports/`), never the checkout: a run's under
  `$REPORTS/<screen>/<case>/`, a screen page in `_screens/`, coverage in `_plans/`, review and
  exploration in `_sessions/`, investigations in `_investigations/`. It embeds the pictures and
  case JSON. Raw logs, screenshots, network captures and observations never go beside it. It
  shows the tenant's screens, so never copy one into the checkout to commit it.
- Candidate records, locator patches, exploration input and generated scripts go in `scratchDir`.
  Create that directory when needed. Never create `ui-tests/.local/` for a new project.
- Browser choices, Orbit profile copies, identity mappings and adapter configuration use
  `runtimeDir`; session/profile directories are further isolated by checkout. Use the optional
  adapter's printed paths rather than guessing a profile location.
- `draft promote` moves a case into `$DATA/screens/<its start>/cases/`, and refuses when another
  screen's folder already holds the id. Promotion needs the team's explicit request; a PASS is
  not a promotion request.
- Every Git checkout is layout 3, and `dataHome` (`store` or `checkout`) says where its data
  lives. `ORBIT_UI_TESTS` explicitly selects a test-data directory; it also uses layout 3 store rooms.
- `ORBIT_STORE_DIR` relocates the entire store. The default is
  `~/.orbit/projects/`. No part of the store may resolve inside a Git repository.
- Checkouts with the same normalized Git remote share data. `init --project-id=<id>` supplies
  a shared identity when clones have no remote. Runtime sessions and reports remain local to
  the active checkout. Reload a shared record before editing it; never overwrite a stale copy.
- SessionStart recalls Orbit directly. Do not write Orbit summaries, topic files or markers into
  Claude's `MEMORY.md`. Use `architecture facts/why` and `learn recall`.

- Project reports keep their settings, runs, frozen snapshots and the report parts a project
  added in that project's store (`<storeRoot>/project-report/`, `<storeRoot>/qc-tools/`); the
  connections they read through are machine-wide (`<storeBase>/control/connections/`). The page
  lands in `<storeRoot>/reports/project-reports/` unless the report settings name an
  absolute `output.dir`. `node ${CLAUDE_PLUGIN_ROOT}/cli/project-report.mjs where` prints all of it,
  and works in a checkout that never ran `init`.

- Autonomous QA keeps a person's approvals and every investigation in the project's store
  (`<storeRoot>/autonomous-qa/settings.json`, `…/investigations/<id>/journal.jsonl` and its
  `evidence/`). The journal is append-only and never pruned by the engine. Its report lands in
  `$REPORTS/_investigations/investigation-<id>.html`, redacted unless a person set `reports.internal`.

`run-case --out` is an evidence destination, not a report destination. For layout 3 it must
remain inside `evidenceDir`. `plan --out` writes inside `scratchDir`. Report commands may
export HTML to their explicit `--out` destination. `--dry` and path queries create nothing.

Original user browser profiles, installed tool binaries and their installation caches are not
Orbit project artifacts. Read the originals only to create the Orbit test copy; never move them.
