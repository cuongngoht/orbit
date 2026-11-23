# ADR 0062 — Orbit Web is a Claude Code workspace: chats with or without a repository, two sources, model · effort · mode, a project's own skills and plugins, and event-driven streams

## Status

Accepted (Orbit Web 0.8.0), 2026-11-20, the owner's decision, given with three screenshots of claude.ai/code: a sign-in
page in that style; the chat always open, laid out like Claude Code; a chat that runs with no repository; every model
and effort; GitHub and Azure as connectors, presentation only ("just the interface design; everything else works as
before"); in the chat, choose Azure or GitHub, then the repository; on a repository's first fetch, load all of the
project's skills and plugins; the SSE streams redesigned as an event-driven architecture "so that later changes are
easier"; and only two modes, Autonomous (Claude Code's auto mode) and Plan (its plan mode). Builds on ADR 0060 and ADR
0061, for Orbit Web only. No engine contract changes: nothing under `src/`, `cli/`, `skills/`, `hooks/` or `agents/`
changes, the plugin stays 0.6.0, and the plugin archive is unchanged (`integrations/` is export-ignored). Amended by
ADR 0063: the credential switches are an operator's, and a governed deployment separates the agent from the sign-ins.

## Context

1. **0.7.0 was a setup wizard in front of a chat.** After the sign-in, a setup page held the chat closed until GitHub
   was connected; a chat needed a GitHub repository and a branch (both `NOT NULL`); three model aliases and no effort;
   Settings was a page of cards; two composers; a header.
2. **One permission mode, an allow-list.** Every run was `--permission-mode dontAsk`: what the allow-list did not name
   was denied, including writes to the paths Claude Code protects (`.claude/`, `.vscode/`, `.devcontainer/`,
   `.mcp.json` …), which `dontAsk` always denies.
3. **Events had grown by accretion.** An `EventHub.emit(sessionId, type, data)` stored a session's events and fanned
   them out to that session's SSE; about twenty call sites in four services emitted into it; GitHub, Azure and Claude
   sign-in flows each had an SSE route of their own; the session list and the connector cards polled.
4. **A repository's own Claude setup never reached Claude Code.** Runs use `--setting-sources user` (a repository's
   `.claude/settings.json` could set `env` -- an API base URL that would receive the credential -- or hooks that run
   before any tool call), and with it Claude Code loads neither the repository's `.claude/skills`, commands and agents
   nor its plugins. A plugin directory loaded with `--plugin-dir` is the documented carrier for skills, commands and
   agents; a declared plugin needs `claude plugin marketplace add` and `claude plugin install`, and is enabled for one
   run by `--settings '{"enabledPlugins":…}'`.
5. **What the CLI offers** (Claude Code 2.1.328): `--model opus|fable|sonnet|haiku` (Opus 5.5, Fable 5.2, Sonnet 5.5,
   Haiku 5.5), `--effort low|medium|high|xhigh|max` (every one of those models takes every level; `medium` is their
   default), `--permission-mode auto` (a classifier reviews each action before it runs; reads and edits in the working
   directory are approved without it; on entering auto mode, broad allow rules such as a bare `Bash` or any `Agent`
   rule are dropped; in `-p`, what it blocks is denied and reported, and the run goes on) and `--permission-mode plan`
   (read and plan, change nothing; in `-p` the `ExitPlanMode` call is denied, so the plan arrives in the stream as that
   call's input). Deny rules bind in every mode.
6. **Azure DevOps** (Microsoft Learn): the signed-in user's profile `app.vssps.visualstudio.com/_apis/profile/profiles/me`,
   their organisations `…/_apis/accounts?memberId=<id>`, an organisation's repositories
   `dev.azure.com/<org>/_apis/git/repositories`, a repository's branches `…/refs?filter=heads/` -- each readable with
   `az rest --resource 499b84ac-1321-427f-aa17-267ca6975798`, so the Azure CLI holds the token; Azure Repos accepts a
   Microsoft Entra access token for that resource as a git credential.

## Decision

**1. The workspace, laid out like Claude Code (web only).** Once signed in, the workspace is open: no setup gate, no
connector needed. A sidebar -- Orbit and a fold button; *New session*, *Search* (it filters the chats), *Customize*
(Settings → Skills); *Recents*, each chat with its source mark, a dot while it works or when it failed, and a menu to
rename or delete it; and at the bottom the Claude account, whose menu opens Settings or signs out. Beside it, a new
session's empty page or an open chat, and **one composer** at the bottom of both: the message box (Enter sends, Stop
while Claude works) and a toolbar -- what the chat starts from on the left (repository, branch), how it runs on the
right (model · effort, mode). On a new session the toolbar is the draft; in a chat the repository and branch are fixed
chips and the model, effort and mode are the chat's (`PATCH`, from its next message). The Changes and Orbit panels open
on the right. **Settings** is a dialog over any view (`#/…?settings=<section>`), with a search and the sections
Account, Appearance, Code, Connectors, Skills, Plugins and System; **Connectors** is a table in the style of Claude's
(Connector · Type · Authorization · Status, ✓ and the account or *Connect*), each row opening the CLI's own device
sign-in exactly as before. The sign-in page is restyled in the same language (*Continue with Claude*). Orbit's own brand
ramp, warm neutral surfaces, light and dark.

**2. A chat runs with or without a repository.** With none, its workspace is an empty repository of its own
(`git init -b main`, one empty commit to start from, the `orbit-web/<id>` branch, the Claude account's address as the
local identity, Orbit seated in it), so Changes, the Orbit panel and resuming work as for any chat. The `sessions`
table keeps its columns: a migration adds `source`, `repository_id`, `effort` and `mode`, and an empty `repository` and
`branch` mean none -- no table rebuild, so no cascade can fire.

**3. Two sources, behind one interface.** `modules/sources/` holds GitHub (moved from `modules/repositories`) and
Azure DevOps, each listing repositories and branches and cloning one; `GET /api/sources`,
`GET /api/repositories?source=`, `GET /api/repositories/branches?source=&id=`. A repository is named back by its source
and the id that source listed it under, and opens only if that source lists it; its clone URL comes from the listing,
never from a request. Azure DevOps reads the profile, up to 50 organisations four at a time, their repositories
(disabled ones left out) and a repository's branches through `az rest`, and keeps the list five minutes. Its clone is
`git clone -c credential.helper= -c credential.helper=<image helper>`: `docker/git-credential-azure-cli.mjs` answers
git's `get` for `dev.azure.com` and `*.visualstudio.com` only, by asking the Azure CLI (Orbit Web's profile) for an
Azure DevOps access token -- **the one place a token is asked for**: it goes from az to git for that clone, never through
Orbit Web's process, and is never written; the remote URL and `.git/config` carry nothing, and Claude Code has no
helper.

**4. Model · effort · mode, as the CLI's own words.** Contracts hold three closed lists (`MODEL_CHOICES`,
`EFFORT_CHOICES`, `MODE_CHOICES`), their labels and defaults (Sonnet 5.5, Medium, Autonomous; Settings → Code changes
them for new chats); a request's value is checked against its list and passed as typed (`--model`, `--effort`,
`--permission-mode`), so no dated model id is written anywhere and a model an account cannot use fails with the CLI's
own error. **Two modes, and no third**: Autonomous is `--permission-mode auto`, Plan is `--permission-mode plan`;
`dontAsk` and any bypass are gone. The allow-list and every deny rule stay on the command line (in auto mode Claude Code
itself drops the bare `Bash`; the deny rules -- `git push`, `gh`, `git credential`, a global git config, `az` unless a
person allows it, the sign-in directories and Orbit Web's database for the file tools -- bind in both modes). A plan
mode run's `ExitPlanMode` input becomes a durable `plan.proposed` event (bounded and redacted) and a **Plan card** whose
*Run it in Autonomous* switches the chat's mode and asks Claude to carry out the plan above, in the same conversation;
the denied `ExitPlanMode` call is not shown as a tool.

**5. What a repository brings, read on its first fetch.** A last workspace step, *project*, reads the repository's files
only -- regular files, never through a symbolic link (every path component checked), bounded (200 items a kind, 256 KB
a file, 4 levels, 2,000 entries a directory): `.claude/skills/*/SKILL.md`, `.claude/commands/**/*.md`,
`.claude/agents/*.md` (their `name` and `description`), `CLAUDE.md`, `.mcp.json` (its server names, never started), from
`.claude/settings.json` only `enabledPlugins` and `extraKnownMarketplaces`, and `.claude-plugin/plugin.json` /
`marketplace.json`. Two switches in Settings → Code decide what becomes of it:

- **Load project skills** (on by default): the skills, commands and agents are copied into a plugin of the chat's own
  (`/data/sessions/<id>/project-plugin/`) and loaded with `--plugin-dir`, **as instructions only**: the frontmatter is
  rebuilt from `name`, `description`, `model` (a model word) and `argument-hint` -- so no `hooks`, no `allowed-tools`
  -- every pre-run `` !`command` `` (and a fence opened with `!`) is made plain text, and a file whose frontmatter never
  closes is left out. On by default because instructions are what the person asked for and run nothing by themselves.
- **Run project plugins** (off by default): a repository that is a plugin, or a marketplace of local plugins, is
  loaded with `--plugin-dir`; a declared plugin is installed once (`claude plugin marketplace add`, `claude plugin
  install --scope user`, then `claude plugin disable --scope user`, uninstalled again if disabling fails, so it is never
  left on for every chat) and enabled for that chat's runs only (`--settings '{"enabledPlugins":…}'`). Off by default
  because a plugin is code -- hooks at session start, MCP servers -- that would run in the container that holds the
  sign-ins. Off, each declared plugin is listed as *Not run*.

Every state is an event (`project.inventory`, `project.plugin`); a failure is reported and never fails the workspace;
`GET /api/sessions/:id/project` and `GET /api/customizations` (Orbit's own skills and agents, read once from the
plugin, beside every chat's project) feed Settings → Skills and Plugins. `CLAUDE.md` is read by Claude Code itself; the
rest of the repository's settings, its hooks, `env` and MCP servers are never loaded.

**6. Event-driven streams.** `packages/contracts/src/events/catalog.ts` is the one list of the events there are: each
type, the stream it travels on (`session` or `app`) and whether it is stored. Every event is one envelope
`{ id, type, stream, sessionId, seq, runId, at, data }`. Producers publish to one **event bus**
(`apps/api/src/core/events/event-bus.ts`), which refuses a type the catalog lacks or a stream it does not travel on,
stores what is durable (a session's events, with its per-session sequence, as before) **before** delivering, then
hands each event to the subscribers that asked for its type and stream; a throwing subscriber is logged and the others
still get it. Subscribers: the live text of open messages (so a reconnect gets a message being written whole), the
transcript, the **session directory** (a chat's own events become the app stream's `session.summary` and
`session.removed`), the Orbit refresh, the connectors' flows and statuses, the customizations, and the **stream
gateway**, which serves both SSE streams: `GET /api/sessions/:id/events` (replay after `Last-Event-ID`, then live) and
`GET /api/events`, the app stream -- notifications only, never stored: a page that (re)connects reads the read models
again (`/api/sessions`, `/api/sources`, `/api/customizations`) and applies what follows. The GitHub and Azure sign-in
flows move onto the app stream (their own SSE routes go); the Claude sign-in keeps `/api/claude/login/events`, the only
stream open before the sign-in. In the web app one `AppEventsProvider` holds the app stream and a component asks for
what it needs with `useAppEvent(type, handler)`; nothing polls. **Adding an event is a catalog row and its payload type.**

**7. Commit always; push and open pull requests when a person allows it.** Claude Code is told what this workspace
allows in one fixed sentence (`--append-system-prompt`, one of two texts, nothing a request or a repository wrote): it
creates, edits and deletes files and commits locally, and -- since the owner, testing, saw a `git commit … && git push …`
refused whole and the commit lost with it -- it never chains a refused push into another command. A switch beside
Azure's, *Let Claude Code push and open pull requests with this GitHub sign-in* (`githubForClaude`, off by default),
follows the pattern ADR 0060 set for Azure: with it on, the run's environment names GitHub CLI's configuration
(`GH_CONFIG_DIR`, never a token variable) and gives git a credential helper for `https://github.com` alone
(`GIT_CONFIG_*`: `gh auth git-credential`; no git configuration file is written), in a chat whose repository came from
GitHub and no other; `git push` and `gh` leave the deny list, while `gh auth`, `gh api`, extensions, aliases, gh's
configuration, workflows, runs, releases, gists, secrets, variables, the account's keys, codespaces, the organisation,
rulesets, caches, deleting, renaming, archiving or editing a repository, and `git credential` stay on it (an allow-list
cannot be had: an allow rule never carves an exception out of a deny rule), and the file tools stay refused
`/data/github`; the sentence then says to push the branch it works on and open a pull
request, never force-push and never push to the default branch.

## Consequences

- The API is the web app's own, shipped with it in one image: `POST /api/sessions` takes `{ repository: { source, id }
  | null, branch, model, effort, mode, prompt }`; repositories and branches are asked per source; `SetupStatus.ready`
  and the GitHub and Azure `/login/events` routes are gone; the session envelope gains `id` and `stream`; Settings gains
  `defaultEffort`, `defaultMode`, `projectSkills` and `projectPlugins`. The acceptance run's API calls follow.
- **What Claude Code may do changes with the mode, not the allow-list.** In Autonomous it creates, edits, renames and
  deletes files in its workspace -- seen with the real CLI and these exact arguments (`Write`, `Edit`, `rm`, `rm -r`,
  `mv`, `mkdir`, a clean-up that named no file, Claude Code's protected paths, a local commit: no permission denial)
  while its file tools and `rm` were refused the sign-in directory -- and the image's user owns the workspaces while the
  programs and the plugin stay root's (a Docker smoke check holds both). What the 0.7.0 allow-list refused outright
  is now the classifier's to judge, and a destructive command on files that existed before the session may be refused
  unless the person asked for it. Plan changes nothing.
- With GitHub's switch on, the agent can push and open pull requests as the person, and -- like Azure's -- reach the
  stored sign-in through a subprocess if a prompt injection drives it there; and since the agent reaches Orbit Web's
  local API, a misled one could turn either switch on itself. The switches are the person's, off by default, and the
  README says all of this. The stronger design -- Orbit Web pushing and opening the pull request itself at a person's
  click, the agent never holding the sign-in, or the agent as another Unix user -- is later work.
- A repository is untrusted input in one more way: its skills now reach Claude Code, as instructions. Its plugins reach
  it only when a person turns them on, and they are then code running beside the sign-ins -- which the README's
  "limit, said plainly" now names.
- The streams are now extended in one place: a new kind of notification is a catalog row, a payload type and a
  subscriber or a `useAppEvent`; a page never opens a stream of its own for it.
- Not in this change: a session per browser or a chat per account; attachments and voice; "Ultracode" and "more
  models" (no CLI flag or alias stands behind them); a project's `.mcp.json` servers, its settings' hooks and `env`; the
  macOS-only `workspace-path` containment test failure (the temporary directory under a symbolic link), which is
  pre-existing.
