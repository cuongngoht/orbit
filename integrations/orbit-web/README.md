# Orbit Web 0.8.0

A self-hosted, browser-based Claude Code experience with the [Orbit](../../README.md) plugin, in one Docker image.

Run the image, open http://localhost:3000 and **sign in with your own Claude account** -- it is Orbit Web's sign-in,
asked for before anything else opens -- then connect your GitHub account (and, if you work with Azure, your Azure
account), pick a repository, a branch and a Claude model, and ask. Claude Code runs with Orbit, as the Claude account
you signed in with, in a workspace of that chat's own; the page streams what it writes and every tool it runs, shows
the files it changed (read from git) and what Orbit says about the work.

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

`GET /api/setup/status` (and the Settings page) reports every one of these versions, the Orbit commit included.

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
CLI with `docker build --build-arg AZURE_CLI=0 …` (the Azure card then says it is not installed).

### Settings (environment variables)

| variable | default | meaning |
|---|---|---|
| `ORBIT_WEB_MAX_BUDGET_USD` | unset | a per-run spending cap passed to Claude Code (`--max-budget-usd`) |
| `ORBIT_WEB_ALLOWED_HOSTS` | loopback only | more host names to answer to (comma-separated); **requires** `ORBIT_WEB_ACCESS_TOKEN` |
| `ORBIT_WEB_ACCESS_TOKEN` | unset | token mode: every API call needs it (min. 16 characters) |
| `ORBIT_WEB_COOKIE_SECURE` | unset | `1` marks the access cookie Secure (behind an HTTPS proxy) |
| `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | unset | **ignored**: Orbit Web signs in with a Claude account only and gives no credential variable to any program; the sign-in page names the ones it ignored |
| `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `HTTPS_PROXY`, `NO_PROXY` | unset | passed to the CLIs, for a proxy or a private CA (`REQUESTS_CA_BUNDLE` is the Azure CLI's) |

The data directory, plugin directory and port are fixed by the image (`/data`, `/opt/orbit/plugin`, `3000`).

## Persistent storage

Everything a person creates lives in the volume mounted at `/data`, owned by the image's non-root user (`orbit`,
uid 10001) and private to it (mode 0700):

| directory | holds | owner of the format |
|---|---|---|
| `/data/app` | Orbit Web's SQLite database: settings, sessions, messages, events, runs | Orbit Web |
| `/data/claude` | the Claude CLI's sign-in -- Orbit Web's own sign-in -- and Claude Code's native session state (`CLAUDE_CONFIG_DIR`, set for the whole image) | Claude Code |
| `/data/github` | GitHub CLI's sign-in (`GH_CONFIG_DIR`, stored in plain text: a container has no keyring) | GitHub CLI |
| `/data/azure` | the Azure CLI's sign-in (`AZURE_CONFIG_DIR`; its token cache is a plain file for the same reason) | Azure CLI |
| `/data/orbit` | Orbit's machine store (`ORBIT_STORE_DIR`) | Orbit |
| `/data/workspaces/<session>/repository` | each chat's own clone | git |
| `/data/sessions/<session>/runs/` | a masked, bounded copy of each run's stream, for troubleshooting | Orbit Web |
| `/data/home` | the user's home (caches the agent's tools make) | — |

A restart keeps all of it. A run that was going when the container stopped is shown as **interrupted** afterwards and
is never started again by itself. Keep `hostname: orbit-web` (or `--hostname orbit-web`): Orbit's store names its
runtime room after the host name. A bind mount instead of the named volume must be writable by uid 10001.

## Sign in: your Claude account is Orbit Web's sign-in

Orbit Web opens on **Sign in to Orbit Web** and on nothing else. *Sign in with Claude* runs
`claude auth login --claudeai`; the page shows the URL the CLI printed; sign in there with your Claude account, copy
the code the page shows, and paste it into Orbit Web, which writes it to that one process's stdin -- nothing else.
Orbit Web is signed in when, and only when, `claude auth status` reports a Claude account (`authMethod: "claude.ai"`);
the header then shows who (your address, organisation and plan), and Claude Code runs as that account in every chat.

- **Always required, and enforced by the API, not only by the page.** Until the sign-in, every route but
  `GET /api/health`, `POST /api/access` (token mode) and the sign-in itself answers 401 `claude_sign_in_required` and
  runs nothing: no settings, no chats, no GitHub or Azure sign-in.
- **Only a Claude account.** An API key, a token, or an Anthropic Console sign-in is not one: the page says so and stays
  on the sign-in. `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are never given to Claude
  Code (it would use one before the account you signed in with); a container started with one is told it is ignored.
- **Sign out** (the header, or Settings → Claude Account) runs `claude auth logout` and returns to the sign-in page at
  once; the API is closed again. It is refused while Claude Code works in a chat or a workspace is being prepared:
  stop it (or wait) first. Your chats are kept for the next sign-in.
- **One account per Orbit Web**, kept until you sign out, for one person (see the security model).

If the sign-in does not finish in the browser, sign in from a terminal instead, then reload the page (the image's
`claude` keeps its sign-in in `/data/claude`, where Orbit Web reads it):

```bash
docker exec -it orbit-web claude auth login --claudeai
```

## Connect your accounts

**GitHub.** Once signed in, the setup page (or Settings) → GitHub Connection → *Connect GitHub* runs
`gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key --insecure-storage`. The page shows the
URL (https://github.com/login/device) and the one-time code **GitHub CLI** printed; enter the code there and authorize.
*Connected* needs both `gh auth status` and `gh api user` to answer. There is no GitHub App, no OAuth application of
Orbit Web's own and no personal access token. GitHub CLI asks for its usual scopes (`repo`, `read:org`, `gist`).
*Disconnect* runs `gh auth logout --hostname github.com --user <login>`; that ends the CLI's sign-in here, and GitHub
keeps the authorization until you revoke it under GitHub → Settings → Applications. An expired sign-in shows
*Expired*; your chats stay.

**Azure (optional).** Settings → Azure Account → *Connect Azure* (optionally naming a tenant: its id or a domain)
runs `az login --use-device-code --allow-no-subscriptions --output none [--tenant <t>]` with the Azure CLI pinned the
way Orbit pins it (no broker, no interactive subscription picker, no telemetry). The page shows the URL and the
one-time code the Azure CLI printed; enter it there and sign in. *Connected* is what `az account show` says (who,
which tenant and subscription); *Sign out* runs `az logout`. Orbit Web never asks the CLI for a token. The chat
workspace never waits for Azure. **Claude Code is not given this sign-in unless you turn on "Let Claude Code use this
Azure sign-in"**: with it on, Claude Code's `az` finds the profile and may run any `az` command as that account in any
chat; with it off, `az` is refused to it and its file tools are refused `/data/azure`. Orbit's own Azure connections
(project reports, ADR 0043) never use this sign-in: Orbit signs in through its own Azure CLI profile, in its store.

## Use it

0. **Sign in** with your Claude account (above); the setup page then asks for GitHub, and the chat workspace opens once
   it is connected.
1. **New chat**: search your repositories (owned, collaborator, organisation member: every page of the API plus
   `gh repo list`; *Refresh* reads them again), pick a branch (default first) and a model (Sonnet, Opus or Haiku -- the
   CLI's own aliases; a model your account cannot use fails with the CLI's own error), and write what to do.
2. Orbit Web clones the repository into the chat's workspace with `gh repo clone`, creates a branch of its own
   (`orbit-web/<id>`) so the branch you picked is never written, sets a local commit identity (your GitHub name and
   noreply address), and seats it with Orbit. Then it sends your message.
3. The chat streams Claude's text as it is written and every tool call with its real input and output; a subagent's
   calls sit under the Agent call that started them. **Stop** interrupts the run (SIGINT to its process group, then
   SIGTERM, then SIGKILL); an interrupted run is never shown as completed. Enter sends; Shift+Enter is a new line.
4. **Changes** lists what git says changed against the commit the chat started from (committed and uncommitted,
   untracked files, renames, conflicts, line counts) and shows each file's diff, highlighted. Binary and very large files
   are named, not rendered.
5. **Orbit** shows Orbit's own record of the work: the task, its lifecycle and stage, the checks the change is held to,
   verification rows, unmet completion rows, approvals waiting at a protected boundary, and the commands Orbit saw run.
   It says **Verified** only when Orbit itself does, and **Unknown** until then. Claude finishing is not a verification.
6. Continue the chat any time, after a restart too: the next message resumes the same Claude Code conversation
   (`--resume`).

Nothing is ever pushed. `git push` and `gh` are refused to the agent; a push in an Orbit workflow is a protected
boundary that only Orbit Control can approve, and Orbit Web shows such an approval but cannot grant it.

## How it works

```
browser ── React + Fluent UI v9 ──HTTP/SSE──▶ NestJS API (one origin, /api)
                                               ├─ claude auth …            (Claude Code CLI)
                                               ├─ gh auth … / gh api … / gh repo clone   (GitHub CLI)
                                               ├─ az login --use-device-code / az account show / az logout   (Azure CLI, optional)
                                               ├─ claude -p --plugin-dir /opt/orbit/plugin …  ──▶ Orbit's hooks, skills, agents
                                               ├─ git status / git diff    (the chat's workspace)
                                               └─ node /opt/orbit/plugin/cli/{live,task,autonomous-engineering}.mjs  (Orbit, read-only)
```

- **One way to start a program**: a file and an argument list (no shell), an explicit working directory, an
  allow-listed environment, its own process group. No endpoint accepts a command.
- **The Claude runner**: `claude -p --output-format stream-json --verbose --include-partial-messages --model <alias>
  --plugin-dir /opt/orbit/plugin (--session-id <id> | --resume <id>) --permission-mode dontAsk --allowedTools
  Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite --disallowedTools "Bash(git push:*)" "Bash(gh:*)" … WebFetch
  WebSearch --setting-sources user --strict-mcp-config [--max-budget-usd <n>]`, the prompt on stdin, cwd the
  workspace. The web tools are added only when Settings allows them. Tools the allow-list does not name are refused,
  and every refusal is shown in the chat. Never a bypass mode.
- **Events**: one pure mapper turns Claude Code's stream-json into application events (`session.started`,
  `message.started|delta|completed`, `tool.started|completed|failed`, `permission.denied`, `orbit.updated`,
  `verification.updated`, `session.completed|failed|interrupted`, …). Durable events are stored with a per-session
  sequence number and sent with it as the SSE id, so a reconnect gets exactly what it missed; text deltas are
  transient and carry their offset, so they never double. The outcome of a run is decided from its exit status and the
  CLI's own result line.
- **API**: `GET /api/health`, `GET /api/setup/status`; `GET /api/claude/status` (the sign-in: state, method, and the
  account's email, organisation and plan), `POST /api/claude/login` (no body: always `--claudeai`),
  `POST /api/claude/login/code`, `POST /api/claude/login/cancel`, `GET /api/claude/login/events`,
  `POST /api/claude/logout` (409 `run_active` / `workspace_preparing` while Claude Code works); the same five for
  `/api/github` and `/api/azure` (no code route; Azure's login takes an optional `tenant`); `GET /api/repositories[?refresh=1]`,
  `GET /api/repositories/:owner/:repo/branches`; `GET|POST /api/sessions`, `GET|PATCH|DELETE /api/sessions/:id`,
  `POST /api/sessions/:id/messages`, `GET /api/sessions/:id/events` (SSE), `POST /api/sessions/:id/stop`,
  `GET /api/sessions/:id/changes`, `GET /api/sessions/:id/changes/file?path=`, `GET /api/sessions/:id/verification`;
  `GET|PATCH /api/settings`; `POST /api/access` (token mode). Errors are `{ "error": { "code", "message" } }`. Until
  the Claude sign-in, every route but `GET /api/health`, `POST /api/access` and the five `/api/claude/status|login…`
  routes answers 401 `claude_sign_in_required` (a global guard: a route is closed unless it is marked open).

## Security model

For one person, on their own machine, by default:

- **Loopback only.** Compose publishes `127.0.0.1:3000`; the API answers only Host names on an allow-list (localhost,
  127.0.0.1, ::1), which also defeats DNS rebinding. Answering another host name requires `ORBIT_WEB_ACCESS_TOKEN`
  (Orbit Web refuses to start otherwise); then every API call needs the token, traded once for an HttpOnly,
  SameSite=Strict cookie. Put it behind an authenticated HTTPS reverse proxy before exposing it anywhere else.
- **The Claude sign-in gates the API.** Until the Claude CLI is signed in to a Claude account, a global guard answers
  401 to every route but the health check, the access token and the sign-in, before any program runs. It is the
  sign-in of this Orbit Web, not of a browser: whoever reaches the API (loopback, or the access token in token mode)
  works as the one Claude account signed in here. So it adds to the loopback rule and the access token, and replaces
  neither.
- **Changes need proof of origin**: every POST/PATCH/DELETE needs the `X-Orbit-Web` header (a cross-site page cannot
  send it without a CORS preflight, which is never answered), a matching Origin when the browser sends one, and a JSON
  body; bodies are limited to 256 KB.
- **Inputs are validated** against closed rules (repository and branch names, models, titles, prompts); a repository
  opens only if the GitHub account lists it; a workspace path is built only from a server-made id and checked to
  resolve inside `/data/workspaces`; a diff is served only for a path git listed as changed.
- **Credentials stay with the CLIs.** Orbit Web never reads, stores or sends a token: it never runs `gh auth token`
  or `az account get-access-token`, never puts a credential in a remote URL or a git config, never passes
  `GH_*`/`GITHUB_*` to Claude Code (nor the Azure profile, unless you turn that on), and gives no program Claude
  Code's own credential variables (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`). Everything a process printed is masked by token shape before it is
  stored, logged or shown. A strict Content-Security-Policy, Markdown without raw HTML, and highlighting that escapes.
- **The image**: a non-root user, `cap_drop: ALL`, `no-new-privileges`, no Docker socket, no credential in any layer.

**The limit, said plainly.** The coding agent's shell, the CLIs' sign-ins and Orbit Web run in **one container as one
user**. Claude Code's tools are a coding agent's: it runs commands in the repository you opened, and that repository's
contents are untrusted input to it. The environment scrub, the deny rules (`git push`, `gh`, reading the sign-in
directories), `--setting-sources user` (a repository's own `.claude/settings.json` is never read) and the private
directories are **defence in depth, not isolation**: a determined prompt injection in a repository could still reach
the GitHub CLI's stored token, the Azure CLI's (whether or not Claude Code is allowed to use it) or Orbit Web's local
API. Open repositories you trust, keep the port on loopback, and
disconnect GitHub when you are done. Separating the sign-ins from the code execution (another container or user) is
work for a later version.

## Troubleshooting

| symptom | what to do |
|---|---|
| The page does not load | `docker compose ps` (healthy?), `docker compose logs`; `curl -s localhost:3000/api/health` says which part is not usable |
| `host_not_allowed` (HTTP 421) | open it as http://localhost:3000 or http://127.0.0.1:3000, or set `ORBIT_WEB_ALLOWED_HOSTS` with `ORBIT_WEB_ACCESS_TOKEN` |
| Claude sign-in never finishes | `docker exec -it orbit-web claude auth login --claudeai`, then reload the page |
| The page asks to sign in although the container was started with `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` | by design: Orbit Web signs in with a Claude account only and ignores those variables; sign in on the page |
| "… which is not a Claude account" | the Claude CLI was signed in some other way (an Anthropic Console account, a key): *Sign in with Claude* replaces it with your Claude account |
| *Sign out* is refused | a chat is running or its workspace is being prepared: stop it (or wait), then sign out |
| GitHub: `x509: certificate signed by unknown authority` | you are behind a TLS-inspecting proxy: mount its CA and set `SSL_CERT_FILE` (and `NODE_EXTRA_CA_CERTS`) to it |
| GitHub sign-in expired | Connect GitHub again; chats and workspaces stay |
| Azure: `Please run 'az login'` in a chat | the Azure card is not connected, or "Let Claude Code use this Azure sign-in" is off |
| Azure: an organisation needs a specific tenant | type its tenant id or domain in the Azure card before *Connect Azure* |
| A repository is missing | *Refresh*; an organisation that restricts OAuth apps must approve GitHub CLI for your account |
| "The workspace could not be prepared" | the chat's message says which step failed (clone, branch, identity); delete the chat and try again |
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
| unit | `packages/contracts/src/*.spec.ts`, `apps/api/src/**/*.spec.ts` | parsers, mapper, redaction, argv, state machines, path rules |
| integration, mocked processes | `apps/api/tests/integration/*.spec.ts` | the real API over HTTP/SSE with claude and gh scripted; git and Orbit's CLIs run for real; the Claude sign-in gate over every route the application declares |
| web | `apps/web/src/**/*.spec.tsx` | the sign-in page and the account menu, setup, login progress, pickers, chat streaming, tool activity, stop, history, diff, Orbit panel |
| Docker | `tests/docker/smoke.mjs` | the image builds, starts, serves, holds the four programs and a loadable plugin, opens on the Claude sign-in with every other route closed, persists across restarts (with a stand-in Claude sign-in) |
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
