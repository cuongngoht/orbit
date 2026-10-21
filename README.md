# Orbit

**From Goal to Verified Outcome**

Orbit is a host plugin (Claude Code, Codex, Antigravity CLI, Grok Build) that keeps durable **goals**, **project knowledge**, **requirements**, **runtime understanding**, **UI tests**, **autonomous engineering**, **autonomous QA**, **Orbit Live**, and **Orbit Control** on your machine — with evidence and governance, no cloud dependency, and zero npm dependencies in the engine.

## Two entry points

| Entry | Use for |
|-------|---------|
| **`orbit`** | Full goals: multi-step work, PBIs, acceptance criteria, analyze → plan → execute → verify → report. Prefer `stdin` or `--file` for complete specification text. |
| **`orbit-help`** | Navigation and bounded coordination: where to start, one recommended workflow, continuing tracked work — not a second goal journal. |

Specialized skills (`orbit-develop`, `orbit-engineer`, `orbit-qa`, `orbit-ui-test`, …) and role agents (`orbit-qa-case-writer`, `orbit-engineering-agent`, …) handle one capability each; the engine enforces deterministic rules.

## Install

**Claude Code**

```bash
/plugin marketplace add cuongngoht/orbit
/plugin install orbit@orbit
```

Repository: [github.com/cuongngoht/orbit](https://github.com/cuongngoht/orbit) (public). First-time publish: [docs/github-orbit-repo.md](docs/github-orbit-repo.md).

**Local development**

```bash
claude --plugin-dir .
# or
node cli/orbit.mjs doctor
```

**Codex / Antigravity / Grok** — see [docs/hosts.md](docs/hosts.md), [docs/codex.md](docs/codex.md), [docs/antigravity.md](docs/antigravity.md), [docs/grok.md](docs/grok.md).

## CLI

```bash
orbit --help
orbit goal start --stdin
orbit goal status <goal-id>
orbit doctor
orbit live status
node cli/help.mjs --for="<task>"
```

The reliable form on any host is `node <plugin-root>/cli/orbit.mjs …`.

## Machine store

All durable state lives outside your product repository:

- Default: `~/.orbit/projects/<project-key>/`
- Override base: `ORBIT_STORE_DIR=/path/to/base` → `/path/to/base/<project-key>/`
- Test data (`ui-tests/`) defaults to the store; a person may explicitly select the checkout (see `node cli/storage.mjs where`).

Reports, evidence, lessons, goals, tasks, and generated instruction playbooks are store-only unless you explicitly export test data.

## Reusable skills (0.0.4)

When a coordinated workflow needs a capability nothing here provides, the skill factory drafts a project-scoped
playbook; the host writes its `SKILL.md` and -- when the work is a sequence of calls to capabilities this machine
already provides -- a declared `workflow.json`. The engine validates it, registers it in the machine store, and at the
playbook step RUNS it: pinned to one version, each step asked through its provider's own gate (the MCP broker or the
capability pipeline), every call a receipt of digests. A later workflow, in any session, reuses the pinned skill
instead of drafting again ([ADR 0030](docs/adr/0030-a-generated-skill-declares-a-workflow-the-engine-runs-through-owner-gates.md)).

```bash
node cli/skill-factory.mjs discover --for=release.readiness.verification   # REUSABLE (and its pin) or which gap
node cli/skill-factory.mjs workflow <id|pin>                               # its steps, in the order they run
node cli/skill-factory.mjs runs <id>                                        # what each run came to
node cli/skill-factory.mjs review <id>                                      # what the runs show; a successor proposed, never written
```

A step is VERIFIED only by a record its owner keeps and proves; a call that answered within its contract is reported.
Goals plan from a structured `intent` the host's model writes (`skills/orbit/SKILL.md`), never from the objective's
words, so a goal in any language plans the same.

## Orbit Live and Orbit Control

- **Orbit Live** — read-only viewer beside your session; one feed from journals (tasks, goals, checks). `/orbit` and `/orbit-help` open it (a docked pane in Claude Code, a split or a window elsewhere). Its header opens with an orbit whose satellite goes round its planet the whole time the viewer is open, in a peach-on-dark look on terminals with 256 or 24-bit colour (ADR 0027, 0029). The orbit is motion, never progress: the badge's word (`ORBITING`, `IDLE`, `BLOCKED`, `COMPLETED` …) says what the task does, and only on evidence. A tick redraws the orbit's row alone. The pane reads as its mockup does (ADR 0028): a bordered `ORBITING` badge, tabs with each view's words, `TASK EXECUTION` with `NOW`, the baseline as a card, a workflow's milestones under their step, and a footer of bars; a viewer waiting for a task shows a larger orbit. `pane.animation: off` keeps it still; `pane.orbitSpeed` (slow, normal, fast) sets its pace.
- **Orbit Control** — local panel for skills, MCP, tools, automation, and approvals (`orbit-control` skill or `control-server`).

VS Code: install the companion under [integrations/vscode-orbit-live](integrations/vscode-orbit-live) (machine-scoped settings: `orbit.live.storeDirs`, `orbit.live.nodePath`).

Current contracts and fresh-install behavior: [implementation inventory](docs/orbit-current-contract.md).

## Release quality

```bash
npm test
npm run lint
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs check
node skills/orbit-release/ship.mjs
```

## Check observation adapters (§4.15)

When a declared check runs beside an engineering task, Orbit binds one adapter by the command’s output. Each adapter names what it can show:

  | Adapter | Framework | Cases shown |
  | --- | --- | --- |
  | `dotnet-test` | the .NET test platform's console report (VSTest or Microsoft.Testing.Platform) | failures |
  | `tap` | a TAP stream (Test Anything Protocol 13 or 14) | reported |
  | `generic` | any command | none |

## Unified work tracking (§4.18)

A tracked work’s lifecycle is one of: `RECEIVED`, `IN_PROGRESS`, `INTERRUPTED`, `WAITING`, `BLOCKED`, `PAUSED`, `REPORTED_DONE`, `FAILED`, `CANCELLED`. Evidence (`none` · `observed` · `reported` · `verified`) and session liveness are separate axes.

## Architecture notes

Engine rules, module map, and extension guidance:

- [AGENTS.md](AGENTS.md) — invariants and commands
- [docs/agents/layout.md](docs/agents/layout.md) — module map
- [docs/agents/extend.md](docs/agents/extend.md) — how to extend safely

Orbit **Goal Orchestrator** (`src/goal/`, skill `orbit`) owns full-text goals; work, tasks, and evidence stay in their existing owners.

## License

MIT — see [LICENSE](LICENSE).
