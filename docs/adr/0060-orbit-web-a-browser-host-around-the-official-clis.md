# ADR 0060 — Orbit Web: a browser host around the official CLIs, with two scoped workflows

## Status

Accepted (Orbit Web 0.7.0), 2026-11-19, the owner's decisions (version, the workflow exception, the real run, the
permission mode). Adds `integrations/orbit-web/`, `.github/workflows/orbit-web-ci.yml` and
`.github/workflows/orbit-web-release.yml`. No engine contract changes: nothing under `src/`, `cli/`, `skills/`,
`hooks/` or `agents/` changes, the plugin stays 0.6.0, and the plugin archive is byte-for-byte what it would be without
Orbit Web (both directories are export-ignored). Amends ADR 0057's "no GitHub workflow" for Orbit Web only.

## Context

1. Orbit runs inside a coding host's CLI. A person without a terminal session -- or who wants one place that holds the
   CLI, its sign-ins, the plugin and the repositories -- had no way to use it.
2. The pieces exist and each owns its part: the official Claude Code CLI does the AI work and keeps its own sign-in;
   GitHub CLI owns GitHub's sign-in and repository access; Orbit keeps tasks, evidence and verdicts in its own store.
   What was missing is a process that starts them, carries a browser's request to them, and shows what they say.
3. The 0.6.0 decision (backlog Q8, ADR 0057) removed every GitHub workflow because the gates that matter for a plugin
   release run where the release is made. A Docker image published to a registry is a different artifact: building it
   and pushing it are what a registry workflow is for, and a pull request that changes the web app has no model run in
   it to wait for.

## Decision

**Orbit Web is an integration layer, in `integrations/orbit-web/`.** npm workspaces of its own (contracts, a NestJS
API, a React + Fluent UI v9 app) with their own lockfile and dependencies; the plugin's zero-dependency gate reads only
the plugin's manifests, and Orbit Web imports nothing of the plugin -- it runs the plugin's CLIs as programs. Its specs
are `*.spec.ts(x)` outside any `test/` directory, so the plugin's `node --test` never collects them.

- **Every program is a file and an argument list** (one process port; no shell; an allow-listed environment; a
  process group per child). No endpoint takes a command.
- **Accounts only through the official CLIs.** `claude auth login|status|logout` and `gh auth login --web` (the device
  flow) with `gh auth status` and `gh api user`. No GitHub App, no OAuth application of Orbit Web's own, no personal
  access token typed anywhere, no token ever asked of a CLI (`gh auth token` is never run). Success is what the CLI's
  status command says, never its words. The CLIs keep their sign-ins in their own directories on the volume.
- **Claude Code runs headless with the plugin**: `claude -p --output-format stream-json --include-partial-messages
  --plugin-dir /opt/orbit/plugin`, `--session-id` on the first turn and `--resume` after, the prompt on stdin,
  `--permission-mode dontAsk` with an allow-list and deny rules (`git push`, `gh`, the sign-in directories) -- never a
  bypass mode -- `--setting-sources user` (a repository's own `.claude/settings.json` is untrusted: its `env` could
  send the credential to another API host, its hooks run before any tool call) and `--strict-mcp-config`. The run's outcome is its exit status and the CLI's result line; a stopped run is `interrupted`, never
  `completed`, and a restart of Orbit Web resumes nothing on its own.
- **Orbit decides what Orbit decides.** The Orbit panel copies `live status`, `task show` and
  `autonomous-engineering context`; it says Verified only where Orbit does, and Unknown where Orbit has not spoken.
  Claude finishing is not a verification. Approvals at a protected boundary are shown, never granted: only Orbit
  Control proves a person.
- **Azure, optional, at the owner's request.** The Azure CLI is in the image, installed from the plugin's own
  hash-checked lock (`catalog/locks/azure-cli-2.91.0-linux-*.lock`) on CPython 3.13.15, exactly as Orbit's catalog pins
  its own copy (`azure-cli-private`). `az login --use-device-code --allow-no-subscriptions`, `az account show`,
  `az logout`, with Orbit's own pins (no broker, no new login experience, no telemetry) and a profile of Orbit Web's own
  (`/data/azure`): never Orbit's profile, which Orbit keeps for its own connections (ADR 0043), and never a token asked
  of the CLI. Claude Code is given it only when a person turns on "Let Claude Code use this Azure sign-in"; otherwise
  `Bash(az:*)` and the directory are refused to it. The original scope left Azure DevOps integrations and Azure
  deployment out; this adds only the official CLI and its sign-in, which is still all it adds.
- **Changes are read from git in the workspace** (with hooks, fsmonitor, external diff and textconv off), never from
  what the model said it did.
- **One container, said plainly.** The coding agent's shell and the CLIs' sign-ins share a container and a user. The
  environment scrub, the deny rules and the private directories are defence in depth, not isolation; the README says
  so, and separating them is left to a later version.

**Two workflows, scoped to Orbit Web.** `orbit-web-ci.yml` fires only for a pull request that touches
`integrations/orbit-web/**` (or these workflow files): Orbit Web's `scripts/ci.mjs`, the plugin's `node --test` and
strict Five Lines lint, a check that the plugin archive holds neither directory, and the image's Docker smoke test --
no credential. `orbit-web-release.yml` runs only by hand, only on `main`, only after a reviewer of the
`orbit-web-release` environment approves, only for the version `integrations/orbit-web/package.json` holds; it builds
and smoke-tests each architecture, pushes `ghcr.io/<owner>/orbit-web:<version>`, moves `latest` only when asked,
records the immutable digest and writes the release notes from `CHANGELOG.md`. Each step calls a script that runs the
same in any shell, so nothing they check needs GitHub. `.github/` is export-ignored. The plugin's release gates stay
`ship.mjs` (ADR 0057): neither workflow decides anything about a plugin release.

## Consequences

- A person needs Docker only: `docker compose up -d --build`, then http://localhost:3000.
- The image pins its inputs: the base image by digest, npm packages by lockfile and exact versions, GitHub CLI and tini
  by SHA-256 per architecture, Claude Code by exact version, the plugin by the commit it was archived from.
- Orbit Web's version (0.7.0) is its own; the plugin's five manifests keep the plugin's version, and the image records
  both (`GET /api/setup/status`).
- What a real run needs a person for -- the Claude browser sign-in, GitHub's device flow, listing and cloning a real
  repository -- is reported BLOCKED by the acceptance run, never passed (`integrations/orbit-web/tests/acceptance/`).
