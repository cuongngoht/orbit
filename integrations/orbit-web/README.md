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
| `ORBIT_WEB_ACCESS_TOKEN` | unset | token mode: every API call needs it (min. 16 characters); the page asks for it first (with *Show* and *Paste* beside the field), or takes it from an access link `https://<host>/#access=<token>`, then keeps it 30 days in an HttpOnly cookie (a browser restart or a redeploy asks again for nothing). Once in, **Settings → Account** offers the access link to copy or open in another browser -- never the sign-in page: the link is the token |
| `ORBIT_WEB_COOKIE_SECURE` | unset | `1` marks the access cookie Secure (behind an HTTPS proxy) |
| `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | unset | **ignored**: Orbit Web signs in with a Claude account only and gives no credential variable to any program; the sign-in page names the ones it ignored |
| `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `HTTPS_PROXY`, `NO_PROXY` | unset | passed to the CLIs, for a proxy or a private CA (`REQUESTS_CA_BUNDLE` is the Azure CLI's) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | turns on **Claude Code's telemetry** (OpenTelemetry) and names the collector; a signal's own `OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT` does too. Unset, nothing is exported |
| `OTEL_EXPORTER_OTLP_HEADERS` | unset | the collector's token, as OTLP headers (`Authorization=Bearer …`) |
| any other `OTEL_*` | the image's | overrides one of the telemetry attributes the image declares, or adds one (`OTEL_RESOURCE_ATTRIBUTES`) |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | unset | `1` turns telemetry on for a `claude` started from a terminal in the container too (Orbit Web turns it on for its own runs once a collector is named) |
| `ORBIT_WEB_DEPLOYMENT` | `single` | `governed`: the agent runs in a container of its own (`docker/compose.governed.yaml` sets this and the four below) -- [The governed deployment](#the-governed-deployment) |
| `ORBIT_WEB_RUNNER` | -- | governed: the agent container's runner, `host:port` (`orbit-agent:7070`) |
| `ORBIT_WEB_AGENT_NETWORKS` | -- | governed: the agent network, as CIDR; a request from it reaches the agent gateway alone |
| `ORBIT_WEB_AGENT_CONTROL_HOST` | -- | governed: this container's name on the agent network (the gateway's and the proxy's host) |
| `ORBIT_WEB_EGRESS_PROXY_PORT` | `3128` | governed: the egress proxy's port |
| `ORBIT_WEB_EGRESS_PRIVATE_ALLOW` | unset | governed: internal IPv4 ranges (CIDR) the proxy may reach; none unless named -- the Constitution still decides each connection |
| `ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB` | `25` | [Research](#research): the largest file a source may be uploaded as (1-200) |
| `ORBIT_WEB_RESEARCH_MAX_URL_MB` | `10` | Research: the most a URL's page may answer (1-100) |
| `ORBIT_WEB_RESEARCH_URL_IMPORT` | `on` | Research: `off` refuses importing sources from URLs at all (the server never fetches a page) |
| `ORBIT_WEB_RESEARCH_INGEST_CONCURRENCY` | `2` | Research: how many sources are read and indexed at once (1-8) |
| `ORBIT_WEB_RESEARCH_CONTEXT_CHARS` | `24000` | Research: how much retrieved text one question gives the model, at most (2000-200000 characters) |

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
| `/data/app` | Orbit Web's SQLite database: settings, sessions, messages, events, runs, what each repository brought, who owns each chat and who it is shared with -- and research: workspaces, the extracted text of every source revision and its full-text index, research sessions, their runs, citations, notes and findings | Orbit Web |
| `/data/research/workspaces/<workspace>/objects/` | the files research sources were read from (uploads, URL snapshots, pasted texts), each named by its SHA-256 -- never by a name a person typed -- and stored once per workspace | Orbit Web |
| `/data/claude` | the Claude CLI's sign-in -- Orbit Web's own sign-in -- Claude Code's native session state, and the plugins a project declared once installed (`CLAUDE_CONFIG_DIR`, set for the whole image) | Claude Code |
| `/data/github` | GitHub CLI's sign-in (`GH_CONFIG_DIR`, stored in plain text: a container has no keyring) | GitHub CLI |
| `/data/azure` | the Azure CLI's sign-in (`AZURE_CONFIG_DIR`; its token cache is a plain file for the same reason) | Azure CLI |
| `/data/orbit` | Orbit's machine store (`ORBIT_STORE_DIR`) | Orbit |
| `/data/workspaces/<session>/repository` | each chat's own clone -- or, for a chat without a repository, its own empty repository | git |
| `/data/sessions/<session>/project-plugin/` | the chat's copy of its repository's skills, commands and agents, as instructions only | Orbit Web |
| `/data/sessions/<session>/runs/` | a masked, bounded copy of each run's stream, for troubleshooting | Orbit Web |
| `/data/home` | the user's home (caches the agent's tools make) | — |
| `/data/governance` | governance's own database: the organization, operators and their sessions, the Constitution's revisions, agents, governed workspaces, approvals, findings, reports, and the hash-chained **audit record** -- deleting a chat never reaches it | Orbit Web |
| `/data/repos/<session>.git` | Orbit Web's own bare copy of a chat's repository: what a push is made from (and, governed, what the workspace is cloned and fetched from) | git |
| `/data/control` | the control plane's own room: its HOME for the CLIs it runs with a credential (governed) and a push's bundles in passing | Orbit Web |

In the governed deployment the agent's container mounts only `claude`, `workspaces`, `sessions`, `orbit` and `home` (and
`repos` read-only); a run's log is kept in `/data/app/run-logs/` instead of `/data/sessions/<session>/runs/`. `research`
is the control plane's alone: the isolation check requires it to be absent from the agent's container (a research run is
given the passages it needs on its standard input, never a path).

"Stored locally" means on the Orbit server -- in this volume, wherever the container runs (on Azure, on the disk
attached there) -- not on a person's laptop, and never in a browser or a repository.

### Back up and restore

Everything is in the volume. Stop the container (so SQLite's write-ahead log is folded in), archive the volume, start
it again:

```bash
docker compose stop orbit-web
docker run --rm -v orbit-web_orbit-web-data:/data:ro -v "$PWD":/backup debian:bookworm-slim \
  tar -C /data -czf /backup/orbit-web-data-$(date +%F).tgz .
docker compose start orbit-web
```

To restore, stop the container, empty the volume and unpack the archive into it with the owner kept
(`tar -C /data --same-owner -xzf …`, as root in the helper container), then start it. A backup holds the CLIs' sign-ins
(`/data/claude`, `/data/github`, `/data/azure`) and every research document: keep it as you would those. To keep only
research, `/data/app` and `/data/research` go together -- the database names the files by hash, and the files are
nothing without it.

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

### Each Claude account its own

Orbit Web is signed in to one Claude account at a time, and what it shows is that account's: the chats and research
workspaces it made, and those another account shared with its email. Sign in as another account and you see its own --
nothing of the first. Every route under a chat (its messages, stream, changes, project, share, push) answers 404 to an
account that may not open it; the sidebar, the customizations and the page's live notifications are filtered the same
way. **Share** (a chat's header, or a research workspace's) names the emails of other Claude accounts that may open it:
they read it and carry on with it as themselves; only its owner deletes it, shares it on or makes a public link. A chat
from before owners existed becomes the first signed-in account's, once. This separates accounts at the API and the
pages, not on disk (see [the limit](#security-model)); GitHub's and Azure's sign-ins and Settings stay the installation's.

**The models are the account's too.** At every sign-in Orbit Web asks the account's own Claude CLI which models it may
use and which effort levels each takes (its control protocol's `initialize`: restricted, no tool, no model called), so
a model a program gives an account -- a research preview, say -- appears for that account alone, and a model it cannot
use is not offered. Chats, research sessions and Settings' defaults are held to that list; picking a model whose
effort levels do not include the one chosen moves the effort to one it takes; a model that takes no effort level is given
none. When the CLI cannot be asked, the default list is shown (*Model · this session* says so) and the CLI decides.

## Use it

No connector is needed to start: once you are signed in, the chat is open. **New session** offers two kinds: **Chat /
Coding** (the default, below) and **[Research](#research)**.

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
3. **How it runs** -- on the right. **Model · Effort**: *Model · this session* lists the models your account may use
   ([above](#each-claude-account-its-own); by default Opus 5.5, Fable 5.2, Sonnet 5.5 and Haiku 5.5 -- the CLI's own
   aliases `opus`, `fable`, `sonnet`, `haiku`), and *Effort* the levels the chosen model takes -- Low, Medium
   (recommended), High, Extra and Max (`--effort low|medium|high|xhigh|max`: higher effort is more thorough, takes longer
   and uses your limits faster). A model auto mode is not available with plans only. **Mode**:
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
7. **The sidebar** keeps your chats and research sessions current as they change, in this tab or another: a code or a
   book icon for each kind, a dot while one works or when it failed, the source it came from, a people mark when
   another account shared it, *All · Chat · Research* to filter, *Search* over titles, repositories and workspaces, and
   each one's menu to rename or delete it (deleting a chat removes its workspace; a research session, its conversation). It folds away and stays folded. Continue any chat at any time, after a restart
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

## Research

A **research workspace** keeps knowledge that lasts: its sources, notes and findings. A **research session** is one
conversation in a workspace, over the sources it selects. Research needs no repository, no branch and no GitHub.

1. **New session → Research.** Name a new workspace (or pick one you have), choose the model and effort, and, if you
   want, a first question -- it is asked as soon as a selected source is ready. *Start research* opens the session.
2. **Sources** (the left panel): *Add* uploads files (pick or drop several; each shows its progress and what came of it),
   a **website** by URL, a **pasted text** (Markdown or plain), or -- for this session -- sources the workspace already
   has. Research reads **PDF** (selectable text, page by page; a PDF made of scanned images has no text and is said to
   have none: there is no OCR), **Word** (.docx), **text**, **Markdown** and **web pages** (.html, or a URL). A file is
   what its bytes say it is: anything else, or a file named as one thing and holding another, is refused and never
   stored. Each source shows its state -- queued, reading, ready, failed (and why; *Try again*), stale -- and a checkbox:
   **whether this session's questions may retrieve from it**, kept per session. *Select all* / *Deselect all*, *Search*,
   and per source *Preview*, *Rename*, *Fetch again* (a URL), *Delete*. A source added to the workspace is offered to
   every session of it that had all its sources selected, and to the one you added it from.
3. **Ask** (the middle panel): *Ask about your sources…*. The answer streams as it is written; *Stop* interrupts it (it
   is kept as cut off, never completed); *Ask again* repeats a question whose run did not complete. The composer says how
   many selected sources a question can search now (*Using N sources*). The mode is the one that is built: **selected
   sources only** -- no web search, no other workspace; when the passages do not answer, the answer says so.
4. **Evidence** (the right panel): **Citations** of the answer you choose -- each one a passage, its source, its page
   and section when the format has them, its revision -- and clicking one (or a citation chip in the answer) opens the
   source's extracted text at that passage, marked. **Notes** (Markdown; *Save as note* on an answer ties it to its
   first citation) and **Findings** (*Add as finding* on an answer; F-001, F-002 …) with their review status: draft →
   needs review → reviewed or rejected, back to draft; changing a reviewed finding's words makes it a draft again. A
   reviewed finding is a reviewed research conclusion -- **not an approved policy**: nothing in research writes to
   governance.
5. **Another session** in the same workspace reuses its sources -- nothing is uploaded or read again.

From 1440px the three panels sit side by side (the sources and the evidence fold away from the header); below, the
evidence opens as a drawer; on a phone, *Sources · Chat · Evidence* are tabs. **Share** (the header) shares the whole
workspace -- sources, sessions, notes, findings -- with other Claude accounts by email.

**How an answer is made.**

- **Ingestion.** A file is stored in the server's volume by its SHA-256, read in a worker thread (bounded in time and
  memory: a file that takes too long or expands too far fails, it does not stop the server), its text normalized and cut
  into passages (about a paragraph or a few, never across a page, anew at each heading), and indexed in SQLite's
  full-text search (FTS5: English words stemmed, diacritics folded -- "ro ri" finds "rò rỉ"). A URL is fetched by the
  server -- only on the public internet's web ports (80, 443), never this machine, a private network or a cloud's
  metadata address; every address its name resolves to is checked, the connection goes to the one checked, and each
  redirect (five at most) is checked again; no cookie or credential is sent; the size and time are bounded -- and kept
  as a **snapshot**, so the page changing later does not change your research.
- **Revisions.** A source's text is a series of immutable revisions. *Fetch again* makes a new revision only when the
  page's bytes changed; the earlier revision stays readable for the citations that cite it. A refresh that fails leaves
  the source **stale**: the snapshot it had is still used, as of its date.
- **Retrieval.** A question's evidence is frozen first: the revisions the selected sources are indexed at, and the
  passages retrieved from them alone -- ranked by BM25, ties broken by their place, with the opening passages of the
  sources added when few match (a broad "summarize these") -- within `ORBIT_WEB_RESEARCH_CONTEXT_CHARS`. Nothing of an
  unselected source, another workspace, or the rest of a document reaches the model. Changing the selection while an
  answer is written changes the next question.
- **The run.** The official Claude CLI, in a profile of its own: **no tool at all** (`--tools ""`), restricted (no
  settings file is read, so no hook, plugin or permission rule), no MCP server, no slash command, nothing persisted, a
  fixed system prompt, the model and effort you chose. It is given the conversation so far, the passages -- each labelled
  S1, S2 … with its source, revision, page and section, between tags that carry a random value made for this question,
  so no document can close them -- and the question, and told that the passages are data, never instructions; that every
  statement about the sources cites its passage; that it says so when they do not answer; and that it can approve
  nothing. A process that reports a tool or tries to use one is stopped, and the run fails as refused.
- **Citations are the server's.** The model can only write a label; each one is looked up in the passages this question
  was given, and only a label found there becomes a citation -- with the source, the revision, its place in the text and
  a copy of the passage, from the server's own record (never a page or a quote the model wrote). Any other label is
  removed from the answer.
- **What leaves the server.** Sources are stored on the Orbit server. The passages a question retrieves -- and the
  question and the conversation so far -- are sent to Claude (Anthropic) to answer it. Storing documents locally does
  not keep their passages from the model's provider; a local model is not built.

**Deleting.** Deleting a session removes its conversation and its runs; the workspace's sources, notes and findings
stay, and so do the citations a note or a finding keeps. Deleting a source removes it, its text and -- once no other
revision of the workspace stores the same bytes -- its file; citations that quoted it keep their copy, marked as from a
deleted source. Deleting a workspace (its owner types its name back to confirm) removes everything it holds, rows and
files; it is refused while one of its sessions is answering.

## Governance

Governance is administered by **operators** -- people Orbit Web verifies itself. The Claude account opens the
workspace; it is not an operator, and neither is the access token. Open **Governance** in the sidebar.

- **The first owner.** While governance has no owner, Orbit Web prints a one-time code on its own standard output at
  start: `docker logs orbit-web 2>&1 | grep -A3 one-time` from any folder (or Docker Desktop → Containers → orbit-web →
  Logs; the governed deployment: `docker compose -f compose.governed.yaml logs orbit-web`). Enter it in Governance with
  the organization's name, your username and a
  password (12+ characters). It works once, until Orbit Web restarts; it is never shown on a page, written to a file or
  given to Claude Code. Locked out, or the log gone? On the container itself:
  `docker compose exec -T orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js reset-password --username=<you> --owner < password.txt`
  (also `status`, `init-owner --username=<u> --organization=<name>`, `verify-audit`). Every use is in the audit record.
- **Operators and roles**: owner, security admin, policy editor, policy approver, auditor, agent operator. Roles are
  read on every request; an operator never changes their own; the organization keeps one active owner. A session
  lasts 12 hours (2 idle), in an HttpOnly cookie, and every change carries its CSRF token.
- **The Company Constitution** is a JSON document (`apiVersion: orbit.governance/v1`) of rules over a closed set of
  actions -- run an agent, read and write the workspace, run its commands, the web tools, network egress by
  `host:port`, credentials, privileged settings, pushes, production -- each `allow`, `require_approval` or `deny`, the
  default `deny`, the strictest winning. Start from the default (*Company Constitution → Start from the default*), tick
  what may happen in its table -- one row per action, *Allowed* and *A person approves first* (neither ticked: denied;
  what nobody may ever be granted cannot be ticked), the hosts the agent may reach as a list, the obligations as boxes;
  a rule the table cannot show is kept as written, and there is no JSON view. Git is one row (`repository.push`):
  *Allowed* alone lets an agent push the chat's own branch itself, at once (another branch, or a person who may not
  approve pushes, still asks); with *A person approves first* (the default) each push waits for one approval -- then
  validate, ask for
  approval, approve and publish. What a change loosens is worked out and shown before anybody approves
  or publishes it; a **high-risk** change (loosening a sensitive action, weakening an obligation) is approved by somebody
  who wrote none of it. A published revision never changes; a rollback is a copy published again. Overlays narrow it for
  one project, workspace or agent. *Simulate* asks a revision what it would decide, recording nothing.
- **Governed workspaces.** Register an agent (*Agents & workspaces*) and place a chat under it: from then on its runs
  are decided first -- the agent registered and active, a Constitution published, the agent's isolation checked just
  now (or the Constitution says isolation is optional), `agent.run.start` allowed -- and bound to it; it holds no CLI
  sign-in, and asks the **agent gateway** for anything more. A chat nobody governs runs as before.
- **Approvals.** A push the Constitution does not simply allow waits in *Approvals* with exactly what it is (repository, remote,
  branch, commit, where the remote's branch stood) and its fingerprint; approving binds that fingerprint, spends it once
  and carries the action out; anything that moved since is refused and asked for again.
- **Evidence.** *Policy decisions*, the *Audit timeline* (hash-chained, verified on demand and at every start),
  *Security findings* worked out from the record by rules (each citing its records), and *Daily reports* (by hand, or
  generated after a day ends when the Constitution asks).
- **Privileged switches**: turning on *Let Claude Code push … with this GitHub sign-in*, *… use this Azure sign-in* or
  *Run project plugins* needs an operator with that permission (and the Constitution's decision once one is published);
  turning one off needs nobody. A request from anyone else -- the agent's shell included -- is refused and recorded.

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

### Pushing a chat's branch (GitHub and Azure DevOps)

**Push** in a chat's header (a chat whose repository came from GitHub or Azure DevOps) pushes the chat's working branch
-- by Orbit Web itself, with the source's own sign-in (GitHub CLI's, or the Azure CLI's one-shot helper), never by
Claude Code. It is a protected action, so it is asked for by an operator signed in to Governance: *Prepare the push*
reads the branch's commit from the workspace, carries it into Orbit Web's own copy of the repository (every object
checked), asks the remote where the branch stands, and shows exactly what would be pushed and its fingerprint; *Approve
and push* pushes it (an operator without the right to approve leaves it in *Approvals*); where the Constitution simply
allows pushes, *Prepare the push* by an operator who may approve them pushes it at once. Never forced -- what is not a
fast-forward of the remote's branch is refused by git, so nobody's work is overwritten --, never to the repository's
default or a protected branch, and nowhere when the default cannot be established. A chat started from a working
branch (a story branch, neither default nor protected) pushes to that branch like any other. A governed agent asks for
the same push through its gateway: it is pushed at once where the Constitution allows it, and otherwise a person
approves it the same way.

### Python

The image has CPython 3.15.2 (python-build-standalone, pinned by SHA-256) with pip and venv, as `python3`, `python`
and `pip` for Claude Code. It is root's: a project installs into its own virtual environment (`python3 -m venv .venv`)
or with `pip --user`. `docker build --build-arg AGENT_PYTHON=0 …` leaves it out (the System card then says so).

## The governed deployment

```bash
cd integrations/orbit-web/docker && docker compose -f compose.governed.yaml up -d --build
docker compose -f compose.governed.yaml logs orbit-web     # the first owner's one-time code
```

The same image as two containers. **orbit-web**, the control plane: the API and the page, both databases, the CLIs'
sign-ins, Orbit Web's copies of the repositories and the **egress proxy**. **orbit-agent**: Claude Code and every
program that touches a workspace, started by the control plane through a runner. The agent's container mounts the
Claude configuration, the workspaces, the sessions, Orbit's store and a home -- and the repositories' copies read-only
-- on a read-only root; it has no Orbit Web database, no governance record and no sign-in of GitHub or Azure to read.
Its network is internal: it reaches the control plane's agent gateway and proxy and nothing else, and public names do
not resolve. Every connection it makes leaves through the proxy as a decision of the Constitution (none until one is
published: publish the default first), never to an address off the public internet. One exception, fixed: the Claude
sign-in (`claude auth login`, which runs in the agent's container and is not a run) holds a channel of its own while it
runs -- the Claude account's hosts (`api.anthropic.com`, `platform.claude.com`, `claude.ai`, port 443) and nothing
else, each connection recorded (`egress.sign_in`) -- so Orbit Web can be signed in before any Constitution exists, and
no Constitution can lock it out of its own sign-in. The control plane never writes or runs anything in a directory the
agent can write. Before every strict run Orbit Web checks the agent's container (Governance → Overview shows what was
checked) and records it.

In this deployment the GitHub and Azure switches are refused -- a push is Orbit Web's (above) -- and declared
marketplace plugins cannot be fetched: their install runs outside any run and has no way out (a repository's own
skills, commands and agents still load). Chats nobody governs run here too, isolated the same way and bound the same
way for the proxy.

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
  and gh are not available here, never chain them" or "push the branch you work on and open a pull request with gh";
  with the Azure CLI's sign-in allowed, a third fixed sentence says `az` is signed in to Azure DevOps and its
  azure-devops extension (`az boards`) is not here: read work items, repositories and pull requests with `az rest
  --resource 499b84ac-1321-427f-aa17-267ca6975798`, the way Orbit Web reads them. The model, effort and mode are the only words a
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
- **Each account its own** ([above](#each-claude-account-its-own)): a chat or a research workspace answers only the
  account that owns it and the accounts it was shared with; any other gets 404, on every route under it (a test reads
  every route the application declares and holds each one).
- **Research** ([above](#research)): a research run has no tool, reads no settings file, loads no MCP server, persists
  nothing and is never in a bypass mode; a process that reports or uses a tool is stopped. Documents' words reach it only
  between tags it cannot close, as data. Citations are verified against the passages the run was given. An upload is
  the one body that is not JSON, on one route, under the same header and origin rules; files are named by their hash.
  The URL fetcher reaches only the public internet's web ports, checks every address and every redirect, and connects
  to the address it checked. A research run's token (governed deployment) opens the egress proxy alone, never the
  agent gateway. What a run writes is masked by token shape before it is kept; no event keeps a source's text.
- **Governance** (above): operators verified by Orbit Web, the Company Constitution deciding every governed run and
  protected action, approvals spent once, and a hash-chained audit record apart from the chats' database. The agent is
  never an operator: no request it can make -- with its run's token or without -- reaches a governance route, turns a
  credential switch on, or approves anything; every attempt is refused and recorded.
- **The image**: a non-root user, `cap_drop: ALL`, `no-new-privileges`, no Docker socket, no credential in any layer.

**The limit, said plainly.**

- **The single deployment** (`docker/compose.yaml`): the coding agent's shell, the CLIs' sign-ins, governance's records
  and Orbit Web run in **one container as one user**. The API holds -- the agent cannot turn a switch on or administer
  governance through it -- but the files do not: a determined prompt injection could still read the GitHub CLI's stored
  token, the Azure CLI's, the telemetry collector's token, or governance's database, and change it. The environment
  scrub, the deny rules, auto mode's classifier, `--setting-sources user` and the private directories are **defence in
  depth, not isolation**; a governed workspace refuses to run here while the Constitution requires isolation. With
  GitHub's switch on, Claude Code pushes and opens pull requests as you by design.
- **The governed deployment** (`docker/compose.governed.yaml`) holds at the container: the databases, the sign-ins and
  the control plane's room are not in the agent's container, and its only way out is the proxy (the security lab,
  `tests/security-lab/`, shows each attack PREVENTED but one). That one: **every governed workspace shares the one agent
  container**, so an agent can read another workspace's files on disk (the gateway refuses another workspace's
  approvals, the disk does not) -- run trust domains that must not see each other as separate deployments. The Claude
  account's configuration is necessarily readable by the agent, and the model API is reachable by design. The
  isolation check is the agent container's own answer: a check of the wiring, not proof against a runner the agent has
  taken over. The audit chain is tamper evidence on this host, not proof against whoever controls the host.
- **Research.** The passages a question retrieves are sent to Claude (Anthropic). A research run's restrictions are the
  Claude CLI's own flags, not an operating system's: in the single deployment it runs as the same user as everything
  else in the container. Accounts are separated at the API and the pages, not on disk -- in the single deployment a
  chat's agent can read the files of another account's workspace -- and the CLIs' sign-ins and Settings are the
  installation's. Sharing has no read-only level.
- Open repositories you trust, keep *Run project plugins* off unless you trust them too, keep the port on loopback, and
  disconnect a source when you are done.

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
| *Model · this session* says it shows the default list | the account's own Claude CLI could not be asked which models it may use (its message says why); sign in again, or pick from the list -- the CLI decides |
| A chat or a research workspace is gone after signing in | it belongs to the account that made it: sign in as that account, or ask its owner to share it with your email |
| A source says *Failed* | its tooltip says why: a kind research does not read, a PDF with no selectable text (scanned), a protected or broken file, a page that could not be fetched; fix it and *Try again*, or add it again |
| A source says *Stale* | the page could not be fetched again; the earlier snapshot is still used -- *Fetch again* later |
| A URL never reaches its page | the server fetches only the public internet on ports 80 and 443, directly (no proxy); a page on an internal network or behind a proxy: save it as a file and upload it. `ORBIT_WEB_RESEARCH_URL_IMPORT=off` switches URL import off |
| *Ask* is not offered | no selected source is ready: select one, or wait for the selected ones to be read |
| An answer says the sources do not say | by design: it answers only from passages of the selected sources -- select more, or add a source that does |
| A run seems stuck | **Stop**; it ends as interrupted; send the next message to continue |
| Disk use grows | delete chats you no longer need (removes their workspaces); `docker system df -v` |
| Build behind a proxy | `node scripts/build-image.mjs --ca-file=<the proxy CA>` |
| Orbit panel says not seated / unavailable | the workspace is seated when it is prepared; the panel's message quotes Orbit |
| Turning on a GitHub/Azure switch says *needs an Orbit operator* | sign in under Governance (its first owner: the code in `docker logs orbit-web`) |
| A governed chat's run is refused | its message says why: no Constitution published, the agent suspended, or isolation not proven where it is required (the single deployment) |
| *Push* says nothing is allowed | publish a Constitution first (Governance → Company Constitution); a push needs an operator to approve it, unless the Constitution simply allows pushes |
| In the governed deployment Claude Code cannot reach a host | every connection is the Constitution's decision: *Policy decisions* shows the refusal; allow that `host:port` (a high-risk change) |

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
| web | `apps/web/src/**/*.spec.tsx` | the sign-in page, the workspace (sidebar, a new session and its pickers, the app stream), an open chat (streaming, tools, Stop, the plan card), Settings (connectors and their device sign-ins, Code, Skills, Plugins), the diff and the Orbit panel; research: the kind chooser, the sidebar's kinds and filter, the three panels at each width, selection, uploads, citations that open their passage, notes, the stream folded without doubling |
| accounts | `apps/api/tests/integration/accounts.spec.ts` | each account's own chats through every route under one, sharing by email and what only an owner does, the claim of chats from before owners, the model catalog per account (read at sign-in, held on chats and Settings, the fallback) |
| research | `apps/api/src/modules/research/**/*.spec.ts`, `apps/api/tests/integration/research*.spec.ts` | PDF, Word, HTML, Markdown and text read (pages, headings, encodings, a scanned PDF, a ZIP bomb), chunks and their places, what is refused (type, size, names, paths), URL import and SSRF (loopback, metadata, private ranges, IPv6 carrying IPv4, redirects, DNS answers, a drip-fed head), revisions and retries; retrieval only from the selected sources; the run's profile (no tool), a tool reported or used, prompt injection kept as data, secrets masked, citations verified and opening their passage, notes and findings, governance untouched, accounts kept apart through every research route, stop and restart interrupted and never run again |
| Docker | `tests/docker/smoke.mjs` | the image builds, starts, serves, holds the four programs, a loadable plugin and the Azure Repos credential helper, opens on the Claude sign-in with every other route closed, persists across restarts (with a stand-in Claude sign-in) |
| governance | `packages/governance-core/src/*.spec.ts`, `apps/api/tests/integration/governance-*.spec.ts`, `apps/api/src/runner/*.spec.ts`, `apps/api/src/infra/egress/*.spec.ts` | the decision, lifecycle, impact, approvals, audit chain and auditor as pure rules; operators, the first owner and the offline terminal; the Constitution's lifecycle over HTTP; governed runs, the gateway and pushes to GitHub (a local remote) and Azure DevOps; the runner, the isolation check and the egress proxy |
| security lab | `tests/security-lab/run.mjs` | the governed deployment for real (Docker): the 20-step demonstration and ten attacks from the agent's own container, each verdict read outside the agent; results in `results/0.8.0` |
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
