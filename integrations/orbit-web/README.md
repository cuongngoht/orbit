# Orbit Web 0.8.0

A self-hosted, browser-based Claude Code experience with the [Orbit](../../README.md) plugin, in one Docker image.

Run the image, open http://localhost:3000 and **sign in with your own Claude account** -- it is Orbit Web's sign-in,
asked for before anything else opens. The workspace then opens at once, laid out like Claude Code: a sidebar (New
session, Search, Customize, your chats, your account) and the composer always at the bottom. Start a chat from a
repository on **GitHub** or **Azure DevOps** -- or from none, in an empty workspace of its own -- pick the model
(Opus 5.5, Fable 5.2, Sonnet 5.5, Haiku 5.5), the effort (Low to Max) and the mode (**Autonomous** or **Plan**), and
ask. Claude Code runs with Orbit, as the Claude account you signed in with, in that chat's own workspace, with the
repository's own skills, commands and agents; the page streams what it writes and every tool it runs, shows the files
it changed (read from git) and what Orbit says about the work.

Docker is the only thing to install. The image holds:

| | version | how it is pinned |
|---|---|---|
| Claude Code CLI (`claude`) | 2.1.328 | exact npm version |
| GitHub CLI (`gh`) | 2.89.0 | release tarball, SHA-256 per architecture |
| Azure CLI (`az`, optional) | 2.91.0 | the plugin's own hash-checked lock (`catalog/locks/`), on CPython 3.13.15 (SHA-256 per architecture) -- exactly as Orbit's catalog pins it |
| git | 2.39 (Debian 12) | the base image's digest |
| Node.js | 24 | the base image's digest (`node:24-bookworm`) |
| Orbit plugin | the commit the image is built from (0.6.0 today) | `git archive` of that commit |
| Orbit Web (NestJS API + React/Fluent UI v9 app) | 0.8.0 | `package-lock.json`, exact versions |
| tini | 0.19.0 | release binary, SHA-256 per architecture |

`GET /api/setup/status` (and Settings → System) reports every one of these versions, the Orbit commit included.

## Run it

```bash
cd integrations/orbit-web/docker
docker compose up -d --build        # builds from the repository root; the plugin is `git archive HEAD`
open http://localhost:3000
```

Or with `docker run` (the published image, once a release exists):

```bash
docker run -d --name orbit-web --hostname orbit-web \
  -p 127.0.0.1:3000:3000 -v orbit-web-data:/data \
  --cap-drop ALL --security-opt no-new-privileges:true \
  ghcr.io/cuongngoht/orbit-web:0.8.0
```

| what | command |
|---|---|
| restart (keeps everything) | `docker compose restart` |
| rebuild after a pull (keeps everything) | `docker compose up -d --build` |
| logs | `docker compose logs -f` |
| stop | `docker compose down` |
| delete every chat, workspace and every sign-in | `docker compose down -v` |

Build the image yourself: `node scripts/build-image.mjs [--tag=…] [--ref=<commit>] [--ca-file=<pem>]` (from this
directory; it runs `docker build -f integrations/orbit-web/docker/Dockerfile .` at the repository root). `--ref` picks
the Orbit commit to bundle; `--ca-file` hands a TLS-inspecting proxy's CA to the download steps as a BuildKit secret
(never kept in a layer). The image is about 3.5 GB unpacked, a third of it the Azure CLI; build it without the Azure
CLI with `docker build --build-arg AZURE_CLI=0 …` (Azure DevOps then says it is not installed, and the rest works).

### Settings (environment variables)

| variable | default | meaning |
|---|---|---|
| `ORBIT_WEB_MAX_BUDGET_USD` | unset | a per-run spending cap passed to Claude Code (`--max-budget-usd`) |
| `ORBIT_WEB_ALLOWED_HOSTS` | loopback only | more host names to answer to (comma-separated); **requires** `ORBIT_WEB_ACCESS_TOKEN` |
| `ORBIT_WEB_ACCESS_TOKEN` | unset | token mode: every API call needs it (min. 16 characters); the page asks for it first, or takes it from an access link `https://<host>/#access=<token>`, then keeps it 30 days in an HttpOnly cookie (a browser restart or a redeploy asks again for nothing) |
| `ORBIT_WEB_COOKIE_SECURE` | unset | `1` marks the access cookie Secure (behind an HTTPS proxy) |
| `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | unset | **ignored**: Orbit Web signs in with a Claude account only and gives no credential variable to any program; the sign-in page names the ones it ignored |
| `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `HTTPS_PROXY`, `NO_PROXY` | unset | passed to the CLIs, for a proxy or a private CA (`REQUESTS_CA_BUNDLE` is the Azure CLI's) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | turns on **Claude Code's telemetry** (OpenTelemetry) and names the collector; a signal's own `OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT` does too. Unset, nothing is exported |
| `OTEL_EXPORTER_OTLP_HEADERS` | unset | the collector's token, as OTLP headers (`Authorization=Bearer …`) |
| any other `OTEL_*` | the image's | overrides one of the telemetry attributes the image declares, or adds one (`OTEL_RESOURCE_ATTRIBUTES`) |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | unset | `1` turns telemetry on for a `claude` started from a terminal in the container too (Orbit Web turns it on for its own runs once a collector is named) |

**Telemetry.** With a collector named, every Claude Code process Orbit Web starts exports as a person's own Claude
Code would with the same settings, and only Claude Code gets the variables (never git, gh, az or Orbit's own commands):
`CLAUDE_CODE_ENABLE_TELEMETRY=1`; metrics, logs and traces over OTLP `http/protobuf`; the metrics' repository,
version, entrypoint, session id, account id and resource attributes (`OTEL_METRICS_INCLUDE_*=1`); and the events'
tool details and managed settings (`OTEL_LOG_TOOL_DETAILS=1`, `OTEL_LOG_MANAGED_SETTINGS=1`) -- never a prompt, a
response, a tool's content or a raw API body (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
`OTEL_LOG_TOOL_CONTENT`, `OTEL_LOG_RAW_API_BODIES` are `0`). The image declares those attributes as `ENV` (a test holds
them equal to the code's), so any `claude` in the container uses them. Keep the endpoint and the token in the
container's env file (never in the image); a `*_HEADERS=` assignment a process prints is masked like a token.

The data directory, plugin directory and port are fixed by the image (`/data`, `/opt/orbit/plugin`, `3000`). What a
person chooses in the page -- theme, a new chat's model, effort and mode, whether a repository's skills load and its
plugins run, the web tools, whether Claude Code may use the Azure sign-in -- is kept in Settings (`/data/app`).

## Persistent storage

Everything a person creates lives in the volume mounted at `/data`, owned by the image's non-root user (`orbit`,
uid 10001) and private to it (mode 0700):

| directory | holds | owner of the format |
|---|---|---|
| `/data/app` | Orbit Web's SQLite database: settings, sessions, messages, events, runs, what each repository brought | Orbit Web |
| `/data/claude` | the Claude CLI's sign-in -- Orbit Web's own sign-in -- Claude Code's native session state, and the plugins a project declared once installed (`CLAUDE_CONFIG_DIR`, set for the whole image) | Claude Code |
| `/data/github` | GitHub CLI's sign-in (`GH_CONFIG_DIR`, stored in plain text: a container has no keyring) | GitHub CLI |
| `/data/azure` | the Azure CLI's sign-in (`AZURE_CONFIG_DIR`; its token cache is a plain file for the same reason) | Azure CLI |
| `/data/orbit` | Orbit's machine store (`ORBIT_STORE_DIR`) | Orbit |
| `/data/workspaces/<session>/repository` | each chat's own clone -- or, for a chat without a repository, its own empty repository | git |
| `/data/sessions/<session>/project-plugin/` | the chat's copy of its repository's skills, commands and agents, as instructions only | Orbit Web |
| `/data/sessions/<session>/runs/` | a masked, bounded copy of each run's stream, for troubleshooting | Orbit Web |
| `/data/home` | the user's home (caches the agent's tools make) | — |

A restart keeps all of it. A run that was going when the container stopped is shown as **interrupted** afterwards and
is never started again by itself. Keep `hostname: orbit-web` (or `--hostname orbit-web`): Orbit's store names its
runtime room after the host name. A bind mount instead of the named volume must be writable by uid 10001.

## Sign in: your Claude account is Orbit Web's sign-in

Orbit Web opens on **Sign in to Orbit Web** and on nothing else. The page starts `claude auth login --claudeai` by
itself and shows the whole URL the CLI printed, to open in a new tab or copy with *Copy link* (for another browser);
sign in there with your Claude account, copy the code the page shows, and paste it into Orbit Web, which writes it to
that one process's stdin -- nothing else. A sign-in you cancelled, or one that failed or timed out, is not started
again by itself: *Continue with Claude* does it.
Orbit Web is signed in when, and only when, `claude auth status` reports a Claude account (`authMethod: "claude.ai"`);
the account sits at the bottom of the sidebar (your address and plan; its menu shows the organisation), and Claude
Code runs as that account in every chat.

- **Always required, and enforced by the API, not only by the page.** Until the sign-in, every route but
  `GET /api/health`, `POST /api/access` (token mode) and the sign-in itself answers 401 `claude_sign_in_required` and
  runs nothing: no settings, no chats, no streams, no GitHub or Azure sign-in.
- **Only a Claude account.** An API key, a token, or an Anthropic Console sign-in is not one: the page says so and stays
  on the sign-in. `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are never given to Claude
  Code (it would use one before the account you signed in with); a container started with one is told it is ignored.
- **Sign out** (the account menu at the bottom of the sidebar, or Settings → Account) runs `claude auth logout` and
  returns to the sign-in page at once; the API is closed again. It is refused while Claude Code works in a chat or a
  workspace is being prepared: stop it (or wait) first. Your chats are kept for the next sign-in.
- **One account per Orbit Web**, kept until you sign out, for one person (see the security model).

If the sign-in does not finish in the browser, sign in from a terminal instead, then reload the page (the image's
`claude` keeps its sign-in in `/data/claude`, where Orbit Web reads it):

```bash
docker exec -it orbit-web claude auth login --claudeai
```

## Use it

No connector is needed to start: once you are signed in, the chat is open.

1. **New session** (the sidebar, or the empty page you land on): write what to do in the composer at the bottom.
   Enter sends; Shift+Enter is a new line. **`/` at the start of a message lists the skills and commands** the chat
   can run -- the repository's own first (*This project*), then Orbit's -- by the names Claude Code gives them
   (`/<plugin>:<skill>`, e.g. `/orbit:orbit-help`), each with what it takes and what it does. Typing narrows the list (a
   skill's own name, then its plugin's, then a word of what it does); ↑ ↓ move, Enter or Tab writes `/<name> ` into the
   message for you to finish, Escape closes it. The list is what that chat's runs load: in a new chat, Orbit's, and the
   chosen repository's as an earlier chat of it read them (it says so; a repository is read once a chat opens it).
2. **What it starts from** -- the composer's toolbar, on the left. The repository picker has a tab per source:
   **GitHub** and **Azure DevOps**. Search, pick a repository, then a branch (the default first). A source that is not
   connected offers *Connect* (Settings → Connectors); *Refresh* reads the list again. **No repository** (the default)
   starts the chat in an empty repository of its own (`git init`, one empty commit to start from), for a question, a
   prototype or anything that needs no code yet.
3. **How it runs** -- on the right. **Model · Effort**: *Model · this session* lists Opus 5.5, Fable 5.2, Sonnet 5.5
   and Haiku 5.5 (the CLI's own aliases `opus`, `fable`, `sonnet`, `haiku`; a model your account cannot use fails with
   the CLI's own error), and *Effort* Low, Medium (recommended), High, Extra and Max (`--effort low|medium|high|xhigh|max`:
   higher effort is more thorough, takes longer and uses your limits faster). **Mode**:
   - **Autonomous** -- Claude Code's auto mode (`--permission-mode auto`): it reads, edits and runs commands on its own;
     reads and file edits in the workspace go ahead, and Claude Code's classifier reviews every other action before it
     runs. What it refuses is shown in the chat as *Permission denied*.
   - **Plan** -- Claude Code's plan mode (`--permission-mode plan`): it reads and plans, and changes nothing. Its plan
     arrives as a **Plan** card; *Run it in Autonomous* switches the chat to Autonomous and asks Claude to carry out
     the plan above, in the same conversation.

   A new chat starts with the defaults in Settings → Code (Sonnet 5.5, Medium, Autonomous until you change them).
4. **Sending the first message creates the chat** and opens it. Orbit Web prepares its workspace, step by step in the
   chat: the clone (GitHub with `gh repo clone`; Azure DevOps with `git clone`, see Connectors) or the empty repository,
   a branch of its own (`orbit-web/<id>`, so the branch you picked is never written), a local commit identity (GitHub's
   name and noreply address, the Azure account's user, or -- with no repository -- the Claude account's address), Orbit
   seated in it, and **what the repository brings** (below). Then it sends your message.
5. **In the chat**, Claude's text streams as it is written and every tool call shows its real input and output; a
   subagent's calls sit under the Agent call that started them. **Stop** interrupts the run (SIGINT to its process
   group, then SIGTERM, then SIGKILL); an interrupted run is never shown as completed. The repository is the chat's for
   good; the model, effort and mode can change at any time and apply from the next message.
   **The working branch** -- the branch button in the toolbar (`main → orbit-web/<id>`) -- is where Claude Code works
   and commits. Between runs, choose another: a branch of the repository (fetched for it through the source's sign-in,
   into a clone of Orbit Web's own outside the workspace, then into the workspace), a branch the workspace already has
   (the chat's own, one Claude made), or **a new branch** made from the work as it is (what is uncommitted comes along).
   The repository's default branch is listed and never offered; a switch to an existing branch waits until the work is
   committed (or discarded); and no message is sent while a branch moves, nor does it move while Claude works. Changes
   are then read against where the working branch left the branch the chat started from, and the move is a line in
   the conversation.
6. **Changes** (top right) lists what git says changed against the commit the chat started from (committed and
   uncommitted, untracked files, renames, conflicts, line counts) and shows each file's diff, highlighted. **Orbit**
   shows Orbit's own record of the work: the task, its lifecycle and stage, the checks the change is held to,
   verification rows, unmet completion rows, approvals waiting at a protected boundary, and the commands Orbit saw run.
   It says **Verified** only when Orbit itself does, and **Unknown** until then. Claude finishing is not a verification.
7. **The sidebar** keeps your chats current as they change, in this tab or another: a dot while one works or when it
   failed, the source it came from, *Search* over titles and repositories, and each chat's menu to rename or delete it
   (deleting removes its workspace). It folds away and stays folded. Continue any chat at any time, after a restart
   too: the next message resumes the same Claude Code conversation (`--resume`).

**Share** (the chat's header) makes a read-only link to the conversation as it is now: `https://<host>/#/share/<token>`
(32 random bytes, in the fragment, so no server or Referer sees it). Anyone with the link reads it -- without the access
token or a Claude account -- and sees nothing else of Orbit Web: not the workspace, its files, the changes, Orbit's
record or your other chats. It is a snapshot: what comes after is in it only once you press *Update to now* (the same
link). Tools are shown by their title (`$ npm test`, `Edit sum.mjs`) unless you include what they did -- their input
and output, which may hold the repository's code; every text is masked by token shape again. *Stop sharing* ends the
link at once (sharing again makes a new one), and deleting the chat ends it too. The one route a link opens is
`GET /api/shared/<token>`: the access gate lets that read through and nothing else, and the token is checked by the
share itself.

**Commit, push, pull request.** Claude Code commits on the chat's branch whenever you ask. It pushes and opens pull
requests only when you turn on *Let Claude Code push and open pull requests with this GitHub sign-in* (Settings →
Connectors → GitHub); otherwise `git push` and `gh` are refused to it, it is told so (so it commits on its own instead of
losing the commit in a refused `git commit … && git push`), and you push. A push in an Orbit workflow is a protected
boundary that only Orbit Control can approve, and Orbit Web shows such an approval but cannot grant it.

### What Claude Code may do in a chat

In **Autonomous**, Claude Code creates, edits, renames and deletes files and directories in the chat's workspace,
including files the repository already had (`Write`/`Edit`, and `rm`, `mv`, `mkdir` through its shell), and commits
on the chat's branch; with GitHub's switch on, it also pushes and opens pull requests. The workspace is owned by the image's user, so nothing at the file-system level stands in
the way; what decides is Claude Code's own permission system: edits in the working directory are approved by auto mode
itself, and shell commands go to its classifier, which may refuse a destructive command on files that existed before
the session (`git reset --hard`, `git clean -fd`, a broad `rm -rf`) when you did not ask for it -- say what you want
removed, and it goes ahead. It can never write the image's programs or the Orbit plugin (they belong to root), its
file tools are refused the sign-in directories and Orbit Web's database, and the deny rules below bind in every mode.
In **Plan** it changes nothing.

**The internet.** In Autonomous, Claude Code reaches the internet as part of the work: reading pages, documentation
and package registries, calling public APIs, installing packages (`curl`, `wget`, git over https, a package manager),
and -- unless you switch them off in Settings → Code → Tools -- the web tools, `WebFetch` and `WebSearch` (on by
default, never pre-approved: a fetch can carry data in its URL, so each one is reviewed like a `curl`). Auto mode's
classifier is told so: Orbit Web keeps the CLI's own environment for it (`claude auto-mode defaults`, read once) and
replaces its two "None configured" entries, *Network posture* (open internet egress: the public documentation,
registries, repositories and APIs the task needs are ordinary work, checking that one answers included; probing
endpoints unrelated to the task -- webhook or request-capture sites, paste and file-sharing services, tunnels, DNS
resolvers -- is still reconnaissance) and *Host containment* (a container that keeps the CLIs' sign-ins, never to be
read or sent). No allow rule lets a network command past the classifier, and its rules stay the CLI's own, so it still
refuses sending a credential, a sign-in or the workspace's secrets anywhere.

### What a repository brings

On a repository's **first fetch** (the workspace's last step), Orbit Web reads what the repository has for Claude
Code -- from its files only: regular files, never through a symbolic link, bounded (200 items of each kind, 256 KB a
file, 4 levels deep, 2,000 entries a directory):

| read | what becomes of it |
|---|---|
| `.claude/skills/*/SKILL.md`, `.claude/commands/**/*.md`, `.claude/agents/*.md` | with **Load project skills** on (the default): copied into a plugin of the chat's own and loaded with `--plugin-dir`, **as instructions only** -- their frontmatter rebuilt from `name`, `description`, `model` and `argument-hint` alone (no hooks, no `allowed-tools`), every pre-run `` !`command` `` made plain text, and a file whose frontmatter never closes left out |
| a repository that is a plugin (`.claude-plugin/plugin.json`), or a marketplace of local plugins | with **Run project plugins** on (**off** by default): loaded with `--plugin-dir` |
| the plugins `.claude/settings.json` enables (`name@marketplace`) and the marketplaces it names | with **Run project plugins** on: `claude plugin marketplace add`, `claude plugin install --scope user`, then `claude plugin disable --scope user` (uninstalled again if that fails), and enabled for **that chat's runs only** (`--settings '{"enabledPlugins":…}'`); off, they are listed as *Not run* |
| `CLAUDE.md` | read by Claude Code itself from the working directory |
| `.mcp.json` | listed, never started (`--strict-mcp-config`) |
| the rest of `.claude/settings.json` (hooks, `env`, permissions) | never read: Claude Code runs with `--setting-sources user` |

The chat says what was loaded ("Loaded from this repository: 2 skills, 1 command, 0 agents · plugins: …"), and
**Settings → Skills** and **Settings → Plugins** list everything, Orbit's own included, with each project plugin's state
(*Loaded*, *Installed*, *Installing…*, *Not run*, *Failed* with the CLI's own words). Both switches are in
Settings → Code.

## Connectors: GitHub and Azure DevOps

**Settings → Connectors** is a table of the two repository sources -- connector, type (the CLI that signs in),
authorization, status (✓ and the account, or *Connect*). A row opens its detail, where each CLI's own device sign-in
runs as before; its progress reaches every open page on the app stream.

**GitHub.** *Connect GitHub* runs `gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key
--insecure-storage`. The page shows the URL (https://github.com/login/device) and the one-time code **GitHub CLI**
printed; enter the code there and authorize. *Connected* needs both `gh auth status` and `gh api user` to answer. There
is no GitHub App, no OAuth application of Orbit Web's own and no personal access token. GitHub CLI asks for its usual
scopes (`repo`, `read:org`, `gist`). *Disconnect* runs `gh auth logout --hostname github.com --user <login>`; that ends
the CLI's sign-in here, and GitHub keeps the authorization until you revoke it under GitHub → Settings → Applications.
Its repositories are every page of `user/repos` (owner, collaborator, organisation member) merged with `gh repo list`.
**Claude Code is not given this sign-in unless you turn on "Let Claude Code push and open pull requests with this
GitHub sign-in"**: with it on, its `gh` finds GitHub CLI's sign-in (`GH_CONFIG_DIR`) and its `git` asks `gh` for the
credential of github.com -- and of github.com alone -- through a helper named in its environment (no git configuration
is written) -- in a chat whose repository came from GitHub, and in no other. `git push`, `gh pr …` and the like are no
longer refused, but `gh auth` (printing the token, signing out), `gh api`, extensions, aliases, gh's configuration,
workflows and runs, releases, gists, secrets and variables, the account's keys, codespaces, the organisation, rulesets,
caches, deleting, renaming, archiving or re-configuring a repository, and `git credential` still are, and its
instructions say never to force-push or push to the default branch -- rules on the command as written, beside auto
mode's classifier, not a wall. With it off, `gh` and `git push` are refused to it and it is not told where the sign-in
is.

**Azure DevOps (optional).** *Connect Azure* (optionally naming a tenant: its id or a domain) runs
`az login --use-device-code --allow-no-subscriptions --output none [--tenant <t>]` with the Azure CLI pinned the way
Orbit pins it (no broker, no interactive subscription picker, no telemetry). The page shows the URL and the one-time
code the Azure CLI printed; enter it there and sign in. *Connected* is what `az account show` says; *Sign out* runs
`az logout`.

- **Its repositories** are read with `az rest --resource 499b84ac-1321-427f-aa17-267ca6975798` (Azure DevOps), so the
  Azure CLI holds the token: your profile (`app.vssps.visualstudio.com/_apis/profile/profiles/me`), the organisations
  you belong to (`_apis/accounts?memberId=…`, up to 50, four at a time), each one's repositories
  (`dev.azure.com/<organisation>/_apis/git/repositories`; disabled ones are left out) and a repository's branches
  (`…/refs?filter=heads/`). The list is kept five minutes; *Refresh* reads it again. A repository is named back by its
  organisation and id, and opens only if the list holds it.
- **Its clone** is `git clone` with `-c credential.helper= -c credential.helper=/opt/orbit-web/docker/git-credential-azure-cli.mjs`,
  the URL taken from that list (never from the browser). The helper answers git's `get` for `dev.azure.com` and
  `*.visualstudio.com` only, by asking the Azure CLI -- Orbit Web's own profile -- for an Azure DevOps access token:
  the token goes from az to git for that one clone, never through Orbit Web, and is never written; the remote URL and
  the workspace's `.git/config` carry nothing, and Claude Code has no such helper.
- **Claude Code is not given this sign-in unless you turn on "Let Claude Code use this Azure sign-in"**: with it on,
  Claude Code's `az` finds the profile and may run any `az` command as that account in any chat; with it off, `az` is
  refused to it and its file tools are refused `/data/azure`. Orbit's own Azure connections (project reports, ADR 0043)
  never use this sign-in: Orbit signs in through its own Azure CLI profile, in its store.

## How it works

```
browser ── React + Fluent UI v9 ── HTTP + two SSE streams ──▶ NestJS API (one origin, /api)
  ├─ claude auth … · claude plugin …                       (Claude Code CLI)
  ├─ gh auth … · gh api … · gh repo clone                   (GitHub CLI)
  ├─ az login … · az account show · az rest … (Azure DevOps) (Azure CLI, optional)
  ├─ git clone + the one-shot credential helper (Azure Repos) · git init (no repository)
  ├─ claude -p --plugin-dir /opt/orbit/plugin [--plugin-dir <the chat's project plugin> …] ──▶ Orbit's hooks, skills, agents
  ├─ git status · git diff                                   (the chat's workspace)
  └─ node /opt/orbit/plugin/cli/{live,task,autonomous-engineering}.mjs  (Orbit, read-only)
```

- **One way to start a program**: a file and an argument list (no shell), an explicit working directory, an
  allow-listed environment, its own process group. No endpoint accepts a command.
- **The Claude runner**: `claude -p --output-format stream-json --verbose --include-partial-messages --model
  <opus|fable|sonnet|haiku> --effort <low|medium|high|xhigh|max> --plugin-dir /opt/orbit/plugin [--plugin-dir <project
  plugin> …] (--session-id <id> | --resume <id>) --permission-mode <auto|plan> --allowedTools
  Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite --disallowedTools "Bash(git push:*)" "Bash(gh:*)" "Bash(git
  credential:*)" "Bash(git config --global:*)" ["Bash(az:*)"] "Read(//data/claude/**)" "Edit(//data/claude/**)" …
  [WebFetch WebSearch] --append-system-prompt "<what this workspace allows>" --setting-sources user --strict-mcp-config
  [--settings '{"enabledPlugins":…}'] [--max-budget-usd <n>]`, the prompt on stdin, cwd the workspace. With GitHub's
  switch on, `"Bash(git push:*)" "Bash(gh:*)"` give way to `"Bash(gh auth:*)" "Bash(gh repo delete:*)" …`. The
  appended text is one of two fixed sentences (no request or repository writes it): commit locally, and either "pushing
  and gh are not available here, never chain them" or "push the branch you work on and open a pull request with gh". The model, effort and mode are the only words a
  request puts on this line, each checked against its closed list first; the web tools are added only when Settings
  allows them. In auto mode Claude Code itself drops the broad `Bash` allow rule and reviews each command; the deny
  rules bind in every mode. Never a bypass mode.
- **Events, driven by one catalog.** `packages/contracts/src/events/catalog.ts` names every event there is, the stream
  it travels on and whether it is stored -- the one list of what exists. Every producer (the workspace, the runner and
  its stream mapper, the sign-ins, the sources, the project reader, Orbit) publishes to one **event bus**, which refuses
  a type the catalog does not have or a stream it does not travel on, stores what is durable first, then hands the
  event to its subscribers (a throwing subscriber is isolated): the open messages' live text, the transcript, the
  session directory (which turns a chat's events into the app stream's `session.summary` and `session.removed`), the
  Orbit refresh, the SSE gateway. Each event is one envelope, `{ id, type, stream, sessionId, seq, runId, at, data }`.
  - **The session stream**, `GET /api/sessions/:id/events`: the chat's durable events (`workspace.*`,
    `project.inventory|plugin`, `session.status|started|completed|failed|interrupted`, `message.started|completed`,
    `tool.started|completed|failed`, `permission.denied`, `plan.proposed`, `run.notice`, `orbit.updated`,
    `verification.updated`) with a per-session sequence number as the SSE id, so a reconnect gets exactly what it
    missed; `message.delta` is transient and carries its offset, and a message still being written is sent whole as a
    snapshot, so text never doubles.
  - **The app stream**, `GET /api/events`: notifications any page may need -- `session.summary`, `session.removed`,
    `connector.status`, `connector.flow`, `customizations.changed`. Never stored: a page that (re)connects reads the
    read models again (`/api/sessions`, `/api/sources`, `/api/customizations`) and applies what follows. Nothing polls.

  Adding an event is a catalog row and its payload type; the bus, the gateway and the web's `useAppEvent(type, …)`
  carry it from there. The outcome of a run is still decided from its exit status and the CLI's own result line.
- **API**: `GET /api/health`; `GET /api/claude/status` (state, method, and the account's email, organisation and plan),
  `POST /api/claude/login` (no body: always `--claudeai`), `POST /api/claude/login/code`, `POST /api/claude/login/cancel`,
  `GET /api/claude/login/events` (the one stream open before the sign-in), `POST /api/claude/logout` (409 `run_active` /
  `workspace_preparing` while Claude Code works); `GET /api/github/status`, `POST /api/github/login|login/cancel|logout`
  and the same four for `/api/azure` (Azure's login takes an optional `tenant`); `GET /api/sources`;
  `GET /api/repositories?source=github|azure[&refresh=1]`, `GET /api/repositories/branches?source=…&id=…`;
  `GET|POST /api/sessions` (a repository is `{ source, id }` or `null`), `GET|PATCH|DELETE /api/sessions/:id` (a title,
  model, effort or mode), `POST /api/sessions/:id/messages`, `POST /api/sessions/:id/stop`,
  `GET /api/sessions/:id/events` (SSE), `GET /api/sessions/:id/changes`, `GET /api/sessions/:id/changes/file?path=`,
  `GET /api/sessions/:id/verification`, `GET /api/sessions/:id/project`; `GET /api/customizations`; `GET /api/events`
  (SSE); `GET /api/setup/status`; `GET|PATCH /api/settings`; `POST /api/access` (token mode). Errors are
  `{ "error": { "code", "message" } }`. Until the Claude sign-in, every route but `GET /api/health`,
  `POST /api/access` and the `/api/claude/status|login…` routes answers 401 `claude_sign_in_required` (a global guard:
  a route is closed unless it is marked open).

## Security model

For one person, on their own machine, by default:

- **Loopback only.** Compose publishes `127.0.0.1:3000`; the API answers only Host names on an allow-list (localhost,
  127.0.0.1, ::1), which also defeats DNS rebinding. Answering another host name requires `ORBIT_WEB_ACCESS_TOKEN`
  (Orbit Web refuses to start otherwise); then every API call needs the token, traded once for an HttpOnly,
  SameSite=Strict cookie. The page asks for it before the Claude sign-in (two steps, said as two), or takes it from an
  **access link**, `https://<host>/#access=<token>`: the fragment never reaches a server or a Referer, and the page
  removes it from the address bar and the history entry before anything else reads the URL. Share such a link as you
  would the token. Put it behind an authenticated HTTPS reverse proxy before exposing it anywhere else.
- **The Claude sign-in gates the API.** Until the Claude CLI is signed in to a Claude account, a global guard answers
  401 to every route but the health check, the access token and the sign-in, before any program runs. It is the
  sign-in of this Orbit Web, not of a browser: whoever reaches the API (loopback, or the access token in token mode)
  works as the one Claude account signed in here. So it adds to the loopback rule and the access token, and replaces
  neither.
- **Changes need proof of origin**: every POST/PATCH/DELETE needs the `X-Orbit-Web` header (a cross-site page cannot
  send it without a CORS preflight, which is never answered), a matching Origin when the browser sends one, and a JSON
  body; bodies are limited to 256 KB.
- **Inputs are validated** against closed rules (sources, repository ids per source, branch names, models, efforts,
  modes, titles, prompts); a repository opens only if its source lists it, and its clone URL comes from that listing;
  a workspace path is built only from a server-made id and checked to resolve inside `/data/workspaces`; a diff is
  served only for a path git listed as changed.
- **Credentials stay with the CLIs.** Orbit Web never reads, stores or sends a token (but for the telemetry collector's
  token, which an operator puts in the container's environment and Orbit Web hands to Claude Code alone, so it can
  export): it never runs `gh auth token`,
  never puts a credential in a remote URL or a git config, never passes a token variable to Claude Code and tells it
  where GitHub's or Azure's sign-in is only when you turn that on, and gives no program Claude Code's own credential variables
  (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`). The one place a token is asked for is the
  Azure Repos clone: the image's credential helper asks the Azure CLI and hands the answer to git, for that clone only
  (above); Orbit Web's own process never sees it. Everything a process printed is masked by token shape before it is
  stored, logged or shown. A strict Content-Security-Policy, Markdown without raw HTML, and highlighting that escapes.
- **What a repository brings is untrusted input.** Its skills, commands and agents load as instructions only (their
  frontmatter rebuilt from four keys, pre-run commands made text); its settings, hooks, `env` and MCP servers are never
  loaded. **Its plugins are code** -- hooks that run at session start, MCP servers -- that would run in this container,
  where the sign-ins are; so they run only once you turn on *Run project plugins*, and then only for the chats of
  repositories that declare them.
- **A shared chat's link** opens one read-only snapshot and nothing else: `GET /api/shared/<token>` is the one route the
  access gate and the Claude sign-in gate let through, the token (32 random bytes, in the URL's fragment) names one
  share, and the snapshot holds the conversation alone -- tools by their title unless their owner shares what they did,
  every text masked again, no id of the chat -- served `no-store` and `noindex`.
- **The image**: a non-root user, `cap_drop: ALL`, `no-new-privileges`, no Docker socket, no credential in any layer.

**The limit, said plainly.** The coding agent's shell, the CLIs' sign-ins and Orbit Web run in **one container as one
user**. Claude Code's tools are a coding agent's: it runs commands in the repository you opened, and that repository's
contents are untrusted input to it. The environment scrub, the deny rules (`git push`, `gh`, reading the sign-in
directories), auto mode's classifier, `--setting-sources user` (a repository's own `.claude/settings.json` is never
read) and the private directories are **defence in depth, not isolation**: a determined prompt injection in a
repository could still reach the GitHub CLI's stored token, the Azure CLI's (whether or not Claude Code is allowed to
use them), the telemetry collector's token (it is in Claude Code's environment) or Orbit Web's local API -- through which it could also turn on the switches that hand it a sign-in. With
GitHub's switch on, it pushes and opens pull requests as you by design. Open repositories you trust, keep *Run project plugins* off unless you trust them
too, keep the port on loopback, and disconnect a source when you are done. Separating the sign-ins from the code
execution (another container or user) is work for a later version.

## Troubleshooting

| symptom | what to do |
|---|---|
| The page does not load | `docker compose ps` (healthy?), `docker compose logs`; `curl -s localhost:3000/api/health` says which part is not usable |
| `host_not_allowed` (HTTP 421) | open it as http://localhost:3000 or http://127.0.0.1:3000, or set `ORBIT_WEB_ALLOWED_HOSTS` with `ORBIT_WEB_ACCESS_TOKEN` |
| Claude sign-in never finishes | `docker exec -it orbit-web claude auth login --claudeai`, then reload the page |
| The page asks to sign in although the container was started with `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` | by design: Orbit Web signs in with a Claude account only and ignores those variables; sign in on the page |
| "… which is not a Claude account" | the Claude CLI was signed in some other way (an Anthropic Console account, a key): *Continue with Claude* replaces it with your Claude account |
| *Sign out* is refused | a chat is running or its workspace is being prepared: stop it (or wait), then sign out |
| The repository picker says *Connect* | that source is not connected: Settings → Connectors |
| GitHub: `x509: certificate signed by unknown authority` | you are behind a TLS-inspecting proxy: mount its CA and set `SSL_CERT_FILE` (and `NODE_EXTRA_CA_CERTS`) to it |
| GitHub sign-in expired | Connect GitHub again; chats and workspaces stay |
| A GitHub repository is missing | *Refresh*; an organisation that restricts OAuth apps must approve GitHub CLI for your account |
| Azure DevOps lists nothing, or not every organisation | the account must be a member of the organisation (the list reads at most 50); an organisation that needs another tenant: connect again naming its tenant; *Refresh* |
| Azure DevOps clone fails with an authentication error | sign out of Azure DevOps and connect again (the helper asks the Azure CLI for a token each time); for an organisation of another tenant, name that tenant when you connect |
| Azure: `Please run 'az login'` in a chat | Azure DevOps is not connected, or "Let Claude Code use this Azure sign-in" is off |
| *Permission denied* in Autonomous | Claude Code's classifier (or a deny rule) refused that action: say exactly what you want done (name the files to remove, for instance), or ask for another way |
| *Permission denied* on `git push` or `gh` | GitHub's switch is off (Settings → Connectors → GitHub → *Let Claude Code push and open pull requests…*): turn it on, or push yourself; Claude Code still commits |
| Plan mode changed nothing | by design: *Run it in Autonomous* on its plan card |
| A project plugin says *Not run* | *Run project plugins* is off (Settings → Code); turn it on only for repositories you trust, then start a new chat |
| A project plugin says *Failed* | its tooltip quotes the CLI (a marketplace that cannot be fetched, a plugin it does not have); the chat still runs without it |
| "The workspace could not be prepared" | the chat's message says which step failed (clone, init, branch, identity, orbit); delete the chat and try again |
| A model is refused | the chat shows the CLI's own error: your account cannot use that model; pick another |
| A run seems stuck | **Stop**; it ends as interrupted; send the next message to continue |
| Disk use grows | delete chats you no longer need (removes their workspaces); `docker system df -v` |
| Build behind a proxy | `node scripts/build-image.mjs --ca-file=<the proxy CA>` |
| Orbit panel says not seated / unavailable | the workspace is seated when it is prepared; the panel's message quotes Orbit |

## Develop and test

```bash
npm ci                         # in integrations/orbit-web (Node >= 22.13)
node scripts/ci.mjs            # typecheck, lint, every deterministic test, production builds (prints counts)
npm run build && ORBIT_WEB_DATA_DIR=/tmp/ow ORBIT_PLUGIN_DIR=$PWD/../.. ORBIT_WEB_PORT=3000 npm start -w @orbit-web/api
npm run dev -w @orbit-web/web  # the app on :5173, /api proxied to :3000
```

| kind | where | what it proves |
|---|---|---|
| unit | `packages/contracts/src/*.spec.ts`, `apps/api/src/**/*.spec.ts` | the event catalog and bus, parsers (GitHub, Azure DevOps), the stream mapper (plans included), redaction, argv (model, effort, mode, plugins), the project reader's bounds and its instructions-only copy, state machines, path rules |
| integration, mocked processes | `apps/api/tests/integration/*.spec.ts` | the real API over HTTP and both SSE streams with claude, gh and `az rest` scripted; git and Orbit's CLIs run for real; chats with and without a repository, Azure DevOps listing and clone (no credential in `.git/config`), a repository's skills and plugins, the Claude sign-in gate over every route the application declares |
| web | `apps/web/src/**/*.spec.tsx` | the sign-in page, the workspace (sidebar, a new session and its pickers, the app stream), an open chat (streaming, tools, Stop, the plan card), Settings (connectors and their device sign-ins, Code, Skills, Plugins), the diff and the Orbit panel |
| Docker | `tests/docker/smoke.mjs` | the image builds, starts, serves, holds the four programs, a loadable plugin and the Azure Repos credential helper, opens on the Claude sign-in with every other route closed, persists across restarts (with a stand-in Claude sign-in) |
| real | `tests/acceptance/` | one capped real run with a real Claude model; see its README |

Specs are named `*.spec.ts(x)` and live outside any `test/` directory, so the plugin's own `node --test` never collects
them. Mocked tests prove Orbit Web's handling of the CLIs, not the CLIs themselves; only the acceptance run uses a real
model.

## Release

Two workflows, scoped to Orbit Web (ADR 0060): `.github/workflows/orbit-web-ci.yml` runs `scripts/ci.mjs`, the
plugin's suite and lint, and the Docker smoke test for pull requests that touch this directory;
`.github/workflows/orbit-web-release.yml` is started by hand on `main`, waits for a reviewer of the `orbit-web-release`
environment, checks that the version asked is the one in the tree (`scripts/release.mjs verify`), builds and
smoke-tests the image, pushes `ghcr.io/<owner>/orbit-web:<version>` (and `latest` only when asked), records its digest
and writes the release notes from `CHANGELOG.md` (`## Orbit Web <version>`). Both call scripts that run the same
without GitHub.
