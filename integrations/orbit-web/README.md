# Orbit Web 0.8.0

Orbit's **Governed Agentic Workplace** ([what it is](../../README.md)), self-hosted in Docker: a **virtual office of AI
employees**, each working in containers of its own under the account's policy, approvals and audit record -- and,
beside it, a browser-based Claude Code experience with the [Orbit plugin](../../docs/plugin.md).

Run it (the image beside PostgreSQL and the allocator), open http://localhost:3000 and **sign in to Orbit Web**: its own
accounts, a username and a password, independent of every AI CLI. The first administrator is set up with a one-time
code the server's terminal prints ([Sign in](#sign-in-orbit-webs-own-accounts)); a localhost-only trial starts with
`admin` / `123456`. Then **Settings → AI Connections** connects the CLIs your account works with -- Claude Code, OpenAI
Codex, Google Antigravity -- each with a login or an API key of its own: never the server's, never another account's
([AI connections](#ai-connections)). Then:

- **Chat / Coding**, laid out like Claude Code: a sidebar (New session, Search, Customize, your chats, the Office, your
  account) and the composer always at the bottom. Start a chat from a repository on **GitHub** or **Azure DevOps** -- or
  from none, in an empty workspace of its own -- pick the model (Opus 5.5, Fable 5.2, Sonnet 5.5, Haiku 5.5), the effort
  (Low to Max) and the mode (**Autonomous** or **Plan**), and ask. Claude Code runs with Orbit on your account's Claude
  Code connection, in that chat's own workspace, with the repository's own skills, commands and agents; the page streams
  what it writes and every tool it runs, shows the files it changed (read from git) and what Orbit says about the work.
- **[Research](#research)**: your documents and pages, asked in conversation, every answer cited to a frozen passage.
- **[The Office](#the-office-ai-employees)**: hire AI employees -- a CLI, a model and an effort each, and a personal
  sandbox with limits of its own -- give them work, and review what they hand in. Every attempt runs in two containers of
  its own; you request a revision or accept, and the employee takes its next work. Work may pin research sources, be
  split across a team, or recur on a schedule.
- **[Governance](#governance)**: each account's policy, approvals and hash-chained audit record.

Docker is the only thing to install. Orbit Web keeps its records in **PostgreSQL 17 with pgvector** (the compose
files run the pinned `pgvector/pgvector:0.8.1-pg17` image beside it). The image holds:

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

An AI employee's attempts are made of three more images, built from the same Dockerfile (its targets) and never pulled
or built by Orbit Web itself: **workstation**, the tool plane -- the same pinned Debian base with git, a C toolchain, the
pinned CPython with pip and venv, Node and npm, and jq, as one non-root user with no sudo --, **model-plane** -- the CLI
that holds a connection's login (Claude Code as pinned above) with Orbit Web's runner and tool bridge, and no
`/etc/claude-code` -- and **storage-helper**, the filesystem tools the allocator uses for the employees' storage quotas.

## Run it

```bash
cd integrations/orbit-web/docker
printf 'ORBIT_WEB_DB_PASSWORD=%s\nORBIT_WEB_POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 16)" > .env
(umask 027 && openssl rand -hex 32 > allocator.secret) && sudo chown 0:10001 allocator.secret
(cd ../../.. && for t in workstation model-plane storage-helper; do
  docker build -f integrations/orbit-web/docker/Dockerfile --target "$t" -t "ghcr.io/cuongngoht/orbit-web-$t:0.8.0" . ; done)
docker compose up -d --build        # builds from the repository root; the plugin is `git archive HEAD`
docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner setup-code
open http://localhost:3000          # "Set up Orbit Web", with the code printed above
```

Three services start: **postgres** (PostgreSQL with pgvector, on an internal network only Orbit Web joins, never
published on this machine); **orbit-web**, which waits for it, migrates it and refuses to start without it -- it never
falls back to anything else; and **orbit-allocator**, the only holder of the Docker socket, which makes the two
containers of each attempt of an AI employee and keeps the employees' storage. The allocator answers Orbit Web alone, on
a private network, to requests signed with `allocator.secret` (readable by root and uid 10001 only), publishes no port,
and takes no image, path, mount or privilege from a request ([The Office](#the-office-ai-employees)). The first start of the database volume runs `docker/postgres/init/10-orbit.sh`: it creates Orbit
Web's role (a login, **not** a superuser) and its database, and enables pgvector there. Set the two passwords in `.env`
(URL-safe characters) **before** that first start; without a `.env` the compose files fall back to local-only defaults.

**The first administrator.** A new installation's page offers only *Set up Orbit Web*, which takes a one-time code:
`governance.js owner setup-code` (above) prints it once -- it is kept only as its hash, lasts 30 minutes and is used once
(of two browsers, one wins). With it you choose the username (`admin` by default) and a password, and give your full
name, your company's name and its time zone ([Sign in](#sign-in-orbit-webs-own-accounts)).

**A test installation's standing code.** Where the first administrator is made again and again (every reset of a test
installation), put `ORBIT_WEB_SETUP_CODE=<8-64 characters>` in `.env`: while nobody is set up, the setup page shows that
code already filled in, and it makes the first administrator -- never another account or a reset password, and nothing
once an administrator exists. It is never stored, so it survives every reset; Orbit Web says at start that it is set.
While nobody is set up, whoever can open the page can use it: leave it unset wherever that matters, and the one-time
code above is the only way in again.

**A trial on this machine** skips the code: `docker compose -f compose.yaml -f compose.trial.yaml up -d --build` turns
trial mode on, with the account `admin` / `123456` made at the first start, a red bar on every page until its password
is changed, and the port published on 127.0.0.1 alone. Because that password is public, Orbit Web refuses to start in
trial mode unless only this machine can reach it -- loopback host names, no access token, the single deployment, no
public origin, no Secure cookie setting -- and names the condition that failed. Never use it for anything another
person can reach.

**The published images, without this repository.** [`docker/compose.published.yaml`](docker/compose.published.yaml) is
one file that runs `ghcr.io/cuongngoht/orbit-web*:0.8.0-rc02` (linux/amd64 and linux/arm64: macOS, Windows with WSL2,
Linux) with nothing built: the database's first-start script is written into it, and a one-shot `secret-init` service
makes the allocator's secret in a volume. Copy it alone into an empty directory as `compose.yaml`, then
`docker compose pull && docker compose up -d` and the setup code above; its header lists the settings a `.env` may give
(`ORBIT_WEB_PORT`, `ORBIT_WEB_NAME` for a second installation on one machine, the passwords, `ORBIT_WEB_SETUP_CODE`).

Or with `docker run` (the published image), against a PostgreSQL of your own where pgvector is
enabled (`CREATE EXTENSION vector;` once, as a superuser) -- without an allocator, AI employees then run on the
development-only `process` provider, which has no container, no limit, no isolation and no shell, and says so on every
attempt:

```bash
docker run -d --name orbit-web --hostname orbit-web \
  -p 127.0.0.1:3000:3000 -v orbit-web-data:/data \
  -e ORBIT_WEB_DATABASE_URL=postgres://orbit:<password>@<host>:5432/orbit \
  --cap-drop ALL --security-opt no-new-privileges:true \
  ghcr.io/cuongngoht/orbit-web:0.8.0-rc02
```

| what | command |
|---|---|
| restart (keeps everything) | `docker compose restart` |
| rebuild after a pull (keeps everything) | `docker compose up -d --build` |
| logs | `docker compose logs -f` |
| the database: schema version and pgvector | `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js status` |
| migrate without starting (Orbit Web also migrates at every start) | `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js migrate` |
| check pgvector by hand | `docker compose exec postgres psql -U orbit -d orbit -c "SELECT extversion FROM pg_extension WHERE extname = 'vector'"` |
| the first administrator's one-time code (`--purpose=new_account` for another account) | `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner setup-code` |
| a one-time code for a user's new password | `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner reset-password --username=<name>` |
| sign a subscription connection in from a terminal (its card's Sign in does the same from the browser) | `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/connect.js <connectionId>` |
| what the host gives employees, and each account's authorization | `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js budget show` |
| authorize an account's budget (vCPU, GiB, attempts), or give it back to the host's capacity | `… governance.js budget set --account=<id> [--cpu=2 --memory=8 --employee-cpu=1 …] \| --from-capacity` |
| stop | `docker compose down` |
| empty the database and start afresh (refused unless it names the database; `--with-data` also empties Orbit Web's rooms in `/data`) | `docker compose stop orbit-web && docker compose run --rm orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js reset --confirm=orbit` |
| delete every record, chat, workspace and every connection's login | `docker compose down -v` (Orbit Web's, the database's and the allocator's volumes) |
| delete the employees' storage (the allocator made it) | `docker compose run --rm --entrypoint node orbit-allocator /opt/orbit-web/apps/api/dist/allocator/main.js destroy-storage --confirm=orbit-web-workforce` |

**A fresh start.** 0.8.0 is Orbit Web's initial schema, and it starts from an empty database: nothing of an earlier Orbit
Web is imported -- not the SQLite files of an older one (`/data/app/orbit-web.db`, `/data/governance/governance.db` stay
in the data volume until you remove them), and not the Claude CLI's sign-in in `/data/claude` (each account connects its
own CLIs). A database a development build or release candidate of 0.8.0 migrated -- 0.8.0-rc01's included: rc02 changed
the initial schema in place (appointments, department policies, data shares, questions) -- is refused at start, with the
command that empties it (`db.js reset --confirm=<database name> --with-data`, above), or remove the volumes. Nothing is
migrated from rc01.

Build the image yourself: `node scripts/build-image.mjs [--tag=…] [--ref=<commit>] [--ca-file=<pem>]` (from this
directory; it runs `docker build -f integrations/orbit-web/docker/Dockerfile .` at the repository root; the employees'
images are the same Dockerfile's `--target workstation`, `model-plane` and `storage-helper`). `--ref` picks
the Orbit commit to bundle; `--ca-file` hands a TLS-inspecting proxy's CA to the download steps as a BuildKit secret
(never kept in a layer). The image is about 3.5 GB unpacked, a third of it the Azure CLI; build it without the Azure
CLI with `docker build --build-arg AZURE_CLI=0 …` (Azure DevOps then says it is not installed, and the rest works).

**Keeping what the image holds up to date.** Every program the image holds is pinned (`docker/Dockerfile`), and a newer
release of one does not have to wait for a new Orbit Web. *Settings → System → Updates* says, for each, what is here and
its publisher's newest release (npm for the two npm CLIs, GitHub's releases for GitHub CLI and the Orbit plugin, PyPI for
the Azure CLI, nodejs.org for Node.js -- whose own word marks a **security** release): asked when a person checks (at
most once a minute) and, unless `ORBIT_WEB_UPDATE_CHECK=off`, a minute after start and daily -- plain GETs of public
feeds, nothing of this installation sent. A publisher that cannot be asked is *Couldn't check*, never *Up to date*. To
take them: `node scripts/update-pins.mjs` shows what would move (Claude Code and OpenAI Codex to npm's newest, GitHub
CLI to its newest release with both Linux archives' SHA-256 from that release's checksums file) and says what a person
moves by hand (the Azure CLI's hashed lock, Antigravity's manifest, the base images' digests, Python's builds);
`--apply` writes the pins. Then build the images again (above) and `docker compose up -d`.

### Settings (environment variables)

| variable | default | meaning |
|---|---|---|
| `ORBIT_WEB_DATABASE_URL` | -- | **required**: the PostgreSQL database, `postgres://user:password@host:5432/database`, pgvector enabled in it (the compose files set it). Never printed, never given to any program Orbit Web starts |
| `ORBIT_WEB_DATABASE_URL_FILE` | unset | instead of the variable: a file holding the URL (a container secret) |
| `ORBIT_WEB_DATABASE_POOL_MAX` | `10` | the most connections Orbit Web holds at once (1-100) |
| `ORBIT_WEB_SESSION_HOURS` | `168` | how long a browser's session lasts after its sign-in, at most (hours) |
| `ORBIT_WEB_SESSION_IDLE_HOURS` | `24` | a session not used for this long ends (hours, at most the above) |
| `ORBIT_WEB_MAX_BUDGET_USD` | unset | a per-run spending cap passed to Claude Code (`--max-budget-usd`) |
| `ORBIT_WEB_ALLOWED_HOSTS` | loopback only | more host names to answer to (comma-separated); Orbit Web's own sign-in is the gate (ADR 0061), an access token an optional perimeter in front of it |
| `ORBIT_WEB_ACCESS_TOKEN` | unset | optional token mode (a perimeter before the sign-in, ADR 0061): every API call needs it (min. 16 characters); the page asks for it first (with *Show* and *Paste* beside the field), or takes it from an access link `https://<host>/#access=<token>`, then keeps it 30 days in an HttpOnly cookie (a browser restart or a redeploy asks again for nothing). Once in, **Settings → Account** offers the access link to copy or open in another browser -- never the sign-in page: the link is the token |
| `ORBIT_WEB_SIGN_IN_ON_PAGE` | `1` | `0`: a subscription connection is signed in only in a terminal of the server (`connect.js`); its card shows the command alone and the sign-in routes refuse (ADR 0061) |
| `ORBIT_WEB_COOKIE_SECURE` | unset | `1` marks the access cookie and the session's cookies Secure (behind an HTTPS proxy) |
| `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | unset | **ignored**: no credential of the server's own is given to any program; each account connects its CLIs ([AI connections](#ai-connections)) |
| `ORBIT_WEB_SETUP_CODE` | unset | a test installation's standing setup code (8-64 characters): the setup page fills it in until the first administrator exists; never stored ([Run it](#run-it)) |
| `ORBIT_WEB_TRIAL` | unset | `1`: the localhost-only trial with `admin` / `123456` (`docker/compose.trial.yaml` sets it); refused at start unless only this machine can reach Orbit Web |
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
| `ORBIT_WEB_EGRESS_PRIVATE_ALLOW` | unset | governed: internal IPv4 ranges (CIDR) the proxy may reach; none unless named -- the run's account policy still decides each connection |
| `ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB` | `25` | [Research](#research): the largest file a source may be uploaded as (1-200) |
| `ORBIT_WEB_RESEARCH_MAX_URL_MB` | `10` | Research: the most a URL's page may answer (1-100) |
| `ORBIT_WEB_RESEARCH_URL_IMPORT` | `on` | Research: `off` refuses importing sources from URLs at all (the server never fetches a page) |
| `ORBIT_WEB_RESEARCH_INGEST_CONCURRENCY` | `2` | Research: how many sources are read and indexed at once (1-8) |
| `ORBIT_WEB_RESEARCH_CONTEXT_CHARS` | `24000` | Research: how much retrieved text one question gives the model, at most (2000-200000 characters) |
| `ORBIT_WEB_SANDBOX` | `container` with an allocator, else `process` | [the Office](#the-office-ai-employees): where an employee's attempts run -- `container` (two containers each, made by the allocator; both compose files) or `process` (development only: no container, no limit, no isolation, no shell) |
| `ORBIT_WEB_ALLOCATOR_URL` / `ORBIT_WEB_ALLOCATOR_SECRET_FILE` | -- | the allocator (`http://orbit-allocator:7171`) and the shared secret both sides read (at least 32 characters) |
| `ORBIT_WEB_SANDBOX_HOST` | `orbit-web` | the name an attempt reaches Orbit Web by, on the attempt's own networks (its egress proxies and the tool endpoint) |
| `ORBIT_WEB_CAPACITY_CPU` / `_MEMORY` / `_STORAGE` | detected | what employees' containers may use in all, instead of what the allocator detects |
| `ORBIT_WEB_CAPACITY_RESERVE_CPU` / `_MEMORY` / `_STORAGE` | `10%` | the OS's and the container runtime's reserve: an amount (`1`, `2g`) or a share |
| `ORBIT_WEB_CONTROL_PLANE_LIMITS` | the compose files' | the control plane's own fixed limits (`name:cpus:memory,…`), taken from what employees may use |
| `ORBIT_WEB_MODEL_PLANE_<CLAUDE\|CODEX\|AGY>_CPU` / `_MEMORY` | per runtime | what one attempt's model plane reserves beside the employee's own limits |
| `ORBIT_WEB_ACCEPT_SOFT_STORAGE` | `0` | `1`: a shell may run where storage areas are only measured, and only while the host's disk is protected |
| `ORBIT_WEB_WORKFORCE_POOL_SIZE` / `_PREALLOCATE` | `20g` / `1` | the loop-backed pool the employees' storage lives in, where this host's kernel enforces its quotas |
| `ORBIT_WEB_ATTEMPT_SUBNETS` | Docker's own pools | IPv4 ranges (CIDR) the attempts' internal networks -- two per running attempt, a /28 each -- are cut from |
| `ORBIT_WEB_SANDBOX_EGRESS_PORT` / `ORBIT_WEB_MODEL_EGRESS_PORT` | `3128` / `3129` | the employees' egress proxy (a tool plane's only way out) and the model planes' (the AI providers' hosts, port 443 only) |
| `ORBIT_WEB_MODEL_EGRESS_HOSTS` | unset | more hosts a model plane may reach, comma-separated (a provider's endpoint of your own) |
| `ORBIT_WEB_EGRESS_MAX_CONNECTIONS_PER_RUN` | `256` | the proxy's own cap on one run's connections at once, always on |
| `ORBIT_WEB_AGING_MINUTES` / `ORBIT_WEB_STARVATION_GUARD_MINUTES` | `30` / `60` | admission: how fast waiting work gains priority, and how long a large attempt may be passed by smaller ones before freed capacity is kept for it |

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
plugins run, the web tools, whether Claude Code may use the Azure sign-in -- is kept in Settings, per account, in the
database.

## Persistent storage

Every RECORD lives in PostgreSQL (the compose files' `orbit-web-postgres` volume), in four schemas: `app` -- accounts
(each with its OrbitId), their users, browser sessions and one-time codes (as hashes), settings, the AI connections and
their plugin grants, chats with their messages, event journal, runs, shares and images' records; `research` --
workspaces, sources and their immutable revisions, the extracted text of every revision and its full-text index,
research sessions, their runs, citations, notes and findings; `governance` -- each account's policy revisions and
overrides, run bindings, approvals, findings' resolutions, reports, isolation checks and the **audit record**, one chain per account (deleting a chat or a research workspace never removes its audit); `workforce`
-- the office: departments, employees with their profile and resource revisions, personal sandboxes,
missions, assignments, handoffs and artifacts' records, runs with their resources, usage and network log, the
account's compute and storage budget, team rooms, schedules, occurrences, deliveries, and the office's event journal. Every table carries the account it belongs to; the
deployment's own records belong to a reserved system account. pgvector is enabled in it; nothing stores a vector yet.

Everything else a person creates lives in the volume mounted at `/data`, owned by the image's non-root user (`orbit`,
uid 10001) and private to it (mode 0700):

| directory | holds | owner of the format |
|---|---|---|
| `/data/app/images/` | the images chat messages carried (pasted, dropped or picked), each a file named by an id the server made; an upload no chat claims is removed after a day, and a chat's images go with the chat | Orbit Web |
| `/data/research/workspaces/<workspace>/objects/` | the files research sources were read from (uploads, URL snapshots, pasted texts), each named by its SHA-256 -- never by a name a person typed -- and stored once per workspace | Orbit Web |
| `/data/connections/<OrbitId>/<connectionId>/` | each AI connection's own home: its CLI's login and state, the plugins a project declared once installed (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, Antigravity's settings), written by that CLI alone | the CLI |
| `/data/github` | GitHub CLI's sign-in (`GH_CONFIG_DIR`, stored in plain text: a container has no keyring) | GitHub CLI |
| `/data/azure` | the Azure CLI's sign-in (`AZURE_CONFIG_DIR`; its token cache is a plain file for the same reason) | Azure CLI |
| `/data/orbit` | Orbit's machine store (`ORBIT_STORE_DIR`) | Orbit |
| `/data/workspaces/<session>/repository` | each chat's own clone -- or, for a chat without a repository, its own empty repository | git |
| `/data/sessions/<session>/project-plugin/` | the chat's copy of its repository's skills, commands and agents, as instructions only | Orbit Web |
| `/data/sessions/<session>/runs/` | a masked, bounded copy of each run's stream, for troubleshooting | Orbit Web |
| `/data/home` | the user's home (caches the agent's tools make) | — |
| `/data/repos/<session>.git` | Orbit Web's own bare copy of a chat's repository: what a push is made from (and, governed, what the workspace is cloned and fetched from) | git |
| `/data/control` | the control plane's own room: its HOME for the CLIs it runs with a credential (governed), a push's bundles in passing, and `credentials/` -- an API-key connection's key, one 0600 file each, never mounted where an agent runs | Orbit Web |

In the governed deployment the agent's container mounts only `connections`, `workspaces`, `sessions`, `orbit` and `home`
(and `repos` read-only); a run's log is kept in `/data/app/run-logs/` instead of `/data/sessions/<session>/runs/`. `research`
is the control plane's alone: the isolation check requires it to be absent from the agent's container (a research run is
given the passages it needs on its standard input, never a path).

The employees' areas -- each desk and toolbox, dependency cache, attempt scratch and team room -- are the allocator's,
in the `orbit-web-workforce` volume (and, where this host's kernel enforces quotas, a loop-backed pool in
`orbit-web-workforce-store`), never in `/data` and never mounted in Orbit Web's container; an employee's accepted
deliverables are artifacts, kept in the control plane by their hash.

"Stored locally" means on the Orbit server -- in these volumes, wherever the containers run (on Azure, on the disk
attached there) -- not on a person's laptop, and never in a browser or a repository.

### Back up and restore

A backup is two things taken together: the database (a `pg_dump`) and the data volume. Stop Orbit Web (nothing writes
while they are taken), dump the database, archive the volume -- into a directory of your own outside any repository (the
archive holds sign-ins) -- and start it again:

```bash
mkdir -m 700 -p ~/orbit-web-backups
docker compose stop orbit-web
docker compose exec -T postgres pg_dump -U orbit -d orbit --format=custom > ~/orbit-web-backups/orbit-web-db-$(date +%F).dump
docker run --rm -v orbit-web_orbit-web-data:/data:ro -v ~/orbit-web-backups:/backup debian:bookworm-slim \
  tar -C /data -czf /backup/orbit-web-data-$(date +%F).tgz .
docker compose start orbit-web
```

To restore, stop Orbit Web, restore the dump into an empty database where pgvector is enabled
(`pg_restore -U orbit -d orbit --clean --if-exists < …dump`), empty the volume and unpack the archive into it with the
owner kept (`tar -C /data --same-owner -xzf …`, as root in the helper container), then start it. A backup holds the CLIs'
sign-ins (`/data/connections`, `/data/github`, `/data/azure`), the API keys (`/data/control/credentials`) and every research
document: keep it as you would those. The employees' storage is the allocator's volume: back it up the same way, beside
the database, while no attempt runs. The
database and `/data/research` go together -- the database names research's files by hash, and the files are nothing
without it.

A restart keeps all of it. A run that was going when the container stopped is shown as **interrupted** afterwards and
is never started again by itself. Keep `hostname: orbit-web` (or `--hostname orbit-web`): Orbit's store names its
runtime room after the host name. A bind mount instead of the named volume must be writable by uid 10001.

## Sign in: Orbit Web's own accounts

Orbit Web opens on its own sign-in, in each browser, and on nothing else: a **username and a password** of Orbit Web's,
independent of every AI CLI. Signing in starts no provider's login, and a CLI's login opens nothing here.

- **The first administrator** is set up with a one-time code from the server's terminal (`governance.js owner
  setup-code`, [Run it](#run-it)). Until then the page offers only *Set up Orbit Web*: the code, a username (`admin` by
  default), a password, your full name, your company's name and its time zone -- and the browser is signed in. Each
  further account is set up the same way (`owner setup-code --purpose=new_account`). An account is a tenant, its id the
  **OrbitId**, and every record Orbit Web keeps belongs to one.
- **Passwords** have at least 12 characters, never contain the username, are not one or two characters repeated, not a
  keyboard or number sequence and not one of the commonest passwords. They are kept as scrypt hashes (N = 2^17, r = 8,
  p = 1, a salt each). A forgotten one: `owner reset-password --username=<name>` prints a one-time code that sets a new
  one.
- **Guessing is slowed down.** Every attempt is counted -- against the username typed, whether anybody has it, and
  against the client's address (hashed) -- before the password is checked: a few are free, then each waits a delay that
  doubles (429 `too_many_attempts`, with Retry-After), and a user who keeps failing is locked for a while that grows.
  Which count held an attempt back, and whether the username exists, is never said.
- **The session.** An HttpOnly, SameSite=Strict cookie (Secure behind HTTPS with `ORBIT_WEB_COOKIE_SECURE=1`); Orbit Web
  keeps only its hash. A new one at every sign-in; it lasts `ORBIT_WEB_SESSION_HOURS` (7 days) and ends after
  `ORBIT_WEB_SESSION_IDLE_HOURS` (24 hours) unused; every change the page makes carries its CSRF token. Changing the
  password ends the user's other sessions. **Settings → Account** lists the open sessions (end any of them) and *Sign
  out everywhere*; from a terminal, `owner revoke-sessions [--username=<name>]`.
- **Always required, and enforced by the API, not only by the page.** Until a browser has a session, every route but
  `GET /api/health`, `GET /api/auth/status`, the sign-in and the setup, `POST /api/access` (token mode) and a shared
  chat's link answers 401 and runs nothing.
- **No AI connection is needed to sign in or to look around.** The Office and its departments, Research's sources and
  Governance work without one; a chat, a research question and an employee's work need one, and say so with a link to
  Settings → AI Connections.

**Trial mode** (`compose.trial.yaml`, [Run it](#run-it)) adds one account, `admin` / `123456`, made once at the first
start and never reset: the sign-in page shows it, a red bar on every page asks for a new password until it is changed,
and every start in trial mode is written in the deployment's audit record. The password rules are waived for that seed
alone; changing the password ends the waiver.

### Each account its own

What a browser shows is its account's: the chats and research workspaces it made, those another user shared with it,
its office and its governance. Every table carries the account it belongs to (`account_id`, the OrbitId: a test reads
the database's catalog and holds every table to it), and the database holds each child to its parent's account
(composite foreign keys), so a record of another account answers 404 through every route under it. The deployment's
own records belong to a reserved system account that never signs in. No request names its account: it is always the
session's.

**Share** (a chat's header, or a research workspace's) names other **users** of this Orbit Web -- by username, or by an
email that is that user's verified email (an unverified email names nobody) -- who read it and carry on with it as
themselves; only its owner deletes it, shares it on, makes a public link or governs it. Settings are each account's.
This separates accounts at the API and in the rows: a chat's agent is not isolated on disk ([the
limit](#security-model)), an employee's attempts are ([the Office](#the-office-ai-employees)).

## AI connections

**Settings → AI Connections** has a card for each CLI Orbit Web can run -- **Claude Code**, **OpenAI Codex** and **Google
Antigravity** -- and under each the account's connections to it. A connection is the **account's**: its CLI keeps its
login in a home of its own on the server, `/data/connections/<OrbitId>/<connectionId>/` (`CLAUDE_CONFIG_DIR`,
`CODEX_HOME`, Antigravity's settings), written by that CLI alone, mounted into that connection's model-plane containers
and never into an employee's sandbox, and never read for another account. An account may hold several connections of
one CLI (a subscription and an API key, say), each labelled, one of them the default.

A connection signs in the provider's own way, and nothing else is accepted as a credential. Each method shows the
provider's words it rests on, with their source:

- **A subscription** is signed in by its owner with the unmodified official CLI's own sign-in, against that
  connection's home -- **from its card** (ADR 0061): *Add a connection* starts it at once, *Sign in* (or *Reconnect*)
  starts it again. Orbit Web runs `claude auth login --claudeai` (or `codex login --device-auth`) on the server and
  shows the browser that started it the link the CLI printed: open it and sign in; for **Claude Code** paste back the
  code its page shows (it goes to the CLI's stdin and nowhere else), for **OpenAI Codex** enter the one-time code the
  card shows on OpenAI's page -- nothing comes back. The card turns *Connected* once the CLI's own status names who it
  is signed in as (for Codex, whose `login status` names no ChatGPT account, its own app server's `account/read`: the
  email and the workspace). Another browser of the account sees that a sign-in is under way and by whom, never its link or code;
  no link, code or token is kept anywhere (the audit record says that a sign-in started and how it ended). **Or** in a
  terminal of the server, where nothing of the sign-in passes through Orbit Web's pages -- the card shows the command:

  ```bash
  docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/connect.js <connectionId>
  ```

  (`docker compose -f compose.governed.yaml exec …` in the governed deployment); `ORBIT_WEB_SIGN_IN_ON_PAGE=0` leaves
  only this way. Google Antigravity has no sign-in Orbit Web offers (its CLI has no sign-in command, and its terms do
  not permit its Google sign-in from another product). For Claude Code, the hire step quotes Anthropic: the usage limits of the Pro, Max and
  Ultra plans "assume ordinary, individual usage of Claude Code and the Agent SDK" -- for autonomous employees an API
  key is recommended.
- **An API key** (a Claude Console key; an OpenAI key, which Orbit Web hands to `codex login --with-api-key` on its
  standard input) is entered in the browser once and kept by the server's credential store -- one file each under
  `/data/control/credentials`, mode 0600, never in a connection's home, a route's answer, a log or an event -- and
  given to that connection's process alone.
- **A cloud provider** (Amazon Bedrock, Google Vertex AI, Microsoft Foundry, for Claude Code) can be saved and is shown
  *blocked*: documented by Claude Code, not verified on this installation, never used.
- **Never accepted**: a subscription token pasted by hand, a copied `.credentials.json` or `auth.json`, a "setup token"
  for anybody else's use. `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` in the server's own
  environment are given to no program.

**Status, each read from the CLI and never inferred**: *Installed* or *Not installed* (the binary runs and names its
version); *Connected* only when the CLI's own status, run against that connection's home, names the identity (read at
the time shown); *Disconnected*; *Authentication required* (signed out, expired, or another identity than the one
linked); *Connection error*. A provider identity is connected to one account at a time: connecting it to a second is
refused (`identity_already_connected`). Each card also shows the CLI's version, the identity, the **models** and
**effort levels** read from the account (a fallback list is labelled as such and never used for an employee) -- Claude
Code's from its control protocol, OpenAI Codex's from its own app server's `model/list` (the models its picker offers
that account; when it cannot answer, the catalog bundled in the binary, labelled fallback), none for Antigravity, which
has no command that lists them -- the runtime's capabilities as observed (Claude Code's from its `--help`; Codex's from
its help and the web search modes its configuration takes, asked in a scratch home where nothing is signed in), whether
an employee can run on it and why not, and, for Claude Code, the **Orbit plugin**: loaded only for the use cases you
approved (chats, employees), and only for the plugin's exact digest you saw -- an upgraded plugin waits for you again.
*Re-check* asks the CLI now; *Disconnect* runs the CLI's own logout and removes the home's login (work running on it
stops and is reconciled); a connection an employee runs on cannot be removed.

Research questions run on the account's **default Claude Code connection**; a chat runs on that one too unless it is
started on another connection of the account -- Claude Code or **OpenAI Codex** ([Use it](#use-it)). An employee runs on a CLI only
where its installed version was observed to switch every built-in tool off and take Orbit Web's tools instead (the
*tool-plane split*). Claude Code does: its `--help` lists the flags, and the CLI's own first line is checked on every
run. **OpenAI Codex** does when its binary is SEEN doing it: Orbit Web stands in for the model provider for one turn on
the loopback, runs `codex exec` exactly as an employee's model plane runs it -- every feature that runs, writes or reads
locally switched off, Orbit's bridge the one MCP server (required, its tools approved), and the model's own catalog
entry made Orbit's (no patch tool, no code mode, no sub-agents, no tool search, text only, given to the CLI as
`model_catalog_json`, which then is its whole catalog) -- and reads every tool the request offers the model, then asks
for the image viewer once to see it refuse. Only a model observed that way is offered (the observation is kept per
binary version and entry; *Re-check* makes it for the recommended model, a hire for the model chosen), and the run is
stopped at the first item that is not Orbit's tools, a message or the search it was given. Antigravity is shown with the
reason it does not. Both CLIs are in
the image beside Claude Code (OpenAI Codex CLI from its npm package at an exact version, the Antigravity CLI `agy` from
its release archive pinned by SHA-512; Settings → System names their versions), so their cards say *Installed*.

### Claude connectors

**Settings → Claude connectors** lists what Claude may use as the account's default Claude Code connection: the
connectors that account connected at claude.ai (Claude Docs, Gmail, Drive …) and the MCP servers of the plugins
installed for it -- each with its state (*Connected*, *Sign in at claude.ai* until you do, *Failed*) and two boxes:
**Chat** and **Research**. A box checked lets Claude use that connector there, as far as the account's policy allows
(each checked connector is a decision of `tool.connector` when a run starts); unchecked, it is denied by name. Every
connector is checked for both until you uncheck it. The list is the connection's own CLI's answer (its control
protocol's `mcp_status`, no model called), read with *Read again*; the choices are that account's alone. In the
governed deployment a run reaches no connector. A connector acts as your account -- it reads and writes in that service
-- so in research, where your sources are documents Claude reads, check only what you want research to act with.

## Use it

A chat runs on your account's default Claude Code connection: connect one first ([AI connections](#ai-connections));
until then the composer says so, with a link. With another connection connected (an **OpenAI Codex** one, say), the new
chat's composer offers *AI connection*: the chat runs on the one chosen for its whole life, with that connection's own
models and efforts. A chat on Codex runs `codex exec --json` in the chat's workspace, in that connection's own home.

**Each run in a sandbox of its own.** Where the allocator is (the default `docker/compose.yaml`), every chat's and every
research question's run starts its CLI in a container made for that run alone -- Orbit Web's own image, its runner, as
Orbit Web's user, read-only, no capability, its own CPU, memory and process limits, on a network of its own whose only
other member is Orbit Web -- holding that chat's workspace (read-only for a *Plan* run on Codex) and project room, that
connection's home and that account's own Orbit store, and nothing else of Orbit Web's data: no other chat, no other
account, no database, none of Orbit Web's own rooms (the GitHub or Azure sign-in only where the account turned that
switch on; a research run holds its connection's home alone). The container is removed when the run ends, however it
ends. At most `ORBIT_WEB_SESSION_SANDBOX_MAX` (4) run at once -- a run beyond waits and says so -- each with
`ORBIT_WEB_SESSION_SANDBOX_CPU` / `_MEMORY` / `_PIDS` (1 vCPU, 2g, 1024). A run's start says *own sandbox*. There,
Codex's commands run, held by the container (Codex's own sandbox, which a container without user namespaces cannot
start, is not asked for). Without an allocator (a development setup), a Codex chat's commands run only CONFINED: where
Codex's own sandbox starts (`codex sandbox -- true`, asked once), a permission profile lets them read the system but
nothing of Orbit Web's data except the chat's own room, with no network; where it cannot, the chat gets no shell at
all, answers, and says so. What the account's policy does not allow it does not have (no execution: no shell); a spending cap
(`ORBIT_WEB_MAX_BUDGET_USD`), which Codex cannot be held to, refuses its runs. It runs with no configuration of
anybody's, no MCP server (Claude's connectors and the Orbit plugin are Claude Code's) and none of Codex's apps, plugins,
hooks, browser or desktop tools; each message resumes the thread the first one started, and its images are files beside
the workspace it is named. No source connector is needed. **New session** offers two kinds: **Chat /
Coding** (the default, below) and **[Research](#research)**. The **[Office](#the-office-ai-employees)** has its own entry in
the sidebar.

1. **New session** (the sidebar, or the empty page you land on): write what to do in the composer at the bottom.
   Enter sends; Shift+Enter is a new line. **`/` at the start of a message lists the skills and commands** the chat
   can run -- the repository's own first (*This project*), then Orbit's -- by the names Claude Code gives them
   (`/<plugin>:<skill>`, e.g. `/orbit:orbit-help`), each with what it takes and what it does. Typing narrows the list (a
   skill's own name, then its plugin's, then a word of what it does); ↑ ↓ move, Enter or Tab writes `/<name> ` into the
   message for you to finish, Escape closes it. The list is what that chat's runs load: in a new chat, Orbit's, and the
   chosen repository's as an earlier chat of it read them (it says so; a repository is read once a chat opens it).
   **Images go with a message**: paste a screenshot (⌘V / Ctrl+V), drop images on the box, or pick them with its image
   button. Each shows as a thumbnail and is uploaded at once; Send waits until all are up (one that failed says why and
   stays until you take it out). PNG, JPEG, GIF or WebP, at most 6 a message, 5 MB and 8000 pixels a side each -- what
   Claude itself takes; a message may be an image alone. Claude Code is given them with the words, and the chat shows
   them again (each opens full size). Research takes no images: its runs read only their passages.
2. **What it starts from** -- the composer's toolbar, on the left. The repository picker has a tab per source:
   **GitHub** and **Azure DevOps**. Search, pick a repository, then a branch (the default first). A source that is not
   connected offers *Connect* (Settings → Connectors); *Refresh* reads the list again. **No repository** (the default)
   starts the chat in an empty repository of its own (`git init`, one empty commit to start from), for a question, a
   prototype or anything that needs no code yet.
3. **How it runs** -- on the right. **Model · Effort**: *Model · this session* lists the models your account may use
   (read from its connection, [above](#ai-connections); by default Opus 5.5, Fable 5.2, Sonnet 5.5 and Haiku 5.5 -- the CLI's own
   aliases `opus`, `fable`, `sonnet`, `haiku`), and *Effort* the levels the chosen model takes -- Low, Medium
   (recommended), High, Extra and Max (`--effort low|medium|high|xhigh|max`: higher effort is more thorough, takes longer
   and uses your limits faster). A model auto mode is not available with plans only. **Mode**:
   - **Autonomous** -- Claude Code's auto mode (`--permission-mode auto`): it reads, edits and runs commands on its own;
     reads and file edits in the workspace go ahead, and Claude Code's classifier reviews every other action before it
     runs. What it refuses is shown in the chat as *Permission denied*.
   - **Plan** -- Claude Code's plan mode (`--permission-mode plan`): it reads and plans, and changes nothing. Its plan
     arrives as a **Plan** card; *Run it in Autonomous* switches the chat to Autonomous and asks Claude to carry out
     the plan above, in the same conversation.

   A new chat starts with the defaults in Settings → Code, chosen in the same order: the **AI** (Claude Code until you
   choose another you signed in), then a model of that AI's own, its effort and the mode (Sonnet 5.5, Medium,
   Autonomous on Claude Code until you change them). With no AI signed in yet, Settings → Code and the new chat offer no
   model at all: they point to Settings → AI Connections, to sign one in with your subscription first.
4. **Sending the first message creates the chat** and opens it. Orbit Web prepares its workspace, step by step in the
   chat: the clone (GitHub with `gh repo clone`; Azure DevOps with `git clone`, see Connectors) or the empty repository,
   a branch of its own (`orbit-web/<id>`, so the branch you picked is never written), a local commit identity (GitHub's
   name and noreply address, the Azure account's user, or -- with no repository -- your email in Settings → Account), Orbit
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
token or an Orbit Web account -- and sees nothing else of Orbit Web: not the workspace, its files, the changes, Orbit's
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
| `.mcp.json` | listed, never started: Claude Code starts a project's server only once settings approve it, and only the user's settings are read |
| the rest of `.claude/settings.json` (hooks, `env`, permissions) | never read: Claude Code runs with `--setting-sources user` |

The chat says what was loaded ("Loaded from this repository: 2 skills, 1 command, 0 agents · plugins: …"), and
**Settings → Skills** and **Settings → Plugins** list everything, Orbit's own included, with each project plugin's state
(*Loaded*, *Installed*, *Installing…*, *Not run*, *Failed* with the CLI's own words). Both switches are in
Settings → Code.

## Research

A **research workspace** keeps knowledge that lasts: its sources, notes and findings. A **research session** is one
conversation in a workspace -- a conversation like a chat, whose selected sources are **references**: Claude reads the
passages of them that bear on each question, cites what it takes from them, says what comes from elsewhere, and can use
your [Claude connectors](#claude-connectors) (ask it to make a Claude Doc of an answer, and it gives you the link).
Research needs no repository, no branch and no GitHub, and a question needs no source.

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
3. **Ask** (the middle panel): *Ask anything…*. The answer streams as it is written; *Stop* interrupts it (it is kept as
   cut off, never completed); *Ask again* repeats a question whose run did not complete. The composer says how many
   selected sources are read with a question now (*Using N sources*). A statement taken from a source carries its
   citation; what Claude adds from its own knowledge says so and carries none; asked what the sources say where they say
   nothing, it says so. It has no tool of its own (no web, no files, no commands); a connector checked for research is
   used when your message asks for it (*Using Claude Docs…* says so while it runs).
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
  into passages (about a paragraph or a few, never across a page, anew at each heading), and indexed in PostgreSQL's
  full-text search (a `tsvector` of the passage with its diacritics folded by Orbit Web -- "ro ri" finds "rò rỉ" --,
  English words stemmed, no word dropped as a stop word). A URL is fetched by the
  server -- only on the public internet's web ports (80, 443), never this machine, a private network or a cloud's
  metadata address; every address its name resolves to is checked, the connection goes to the one checked, and each
  redirect (five at most) is checked again; no cookie or credential is sent; the size and time are bounded -- and kept
  as a **snapshot**, so the page changing later does not change your research.
- **Revisions.** A source's text is a series of immutable revisions. *Fetch again* makes a new revision only when the
  page's bytes changed; the earlier revision stays readable for the citations that cite it. A refresh that fails leaves
  the source **stale**: the snapshot it had is still used, as of its date.
- **Retrieval.** A question's evidence is frozen first: the revisions the selected sources are indexed at, and the
  passages retrieved from them alone -- ranked by PostgreSQL's full-text rank (`ts_rank_cd`), ties broken by their
  place, with the opening passages of the sources added when few match (a broad "summarize these") -- within
  `ORBIT_WEB_RESEARCH_CONTEXT_CHARS`. Every search names the account, the workspace and the frozen revisions in the query
  itself: nothing of an unselected source, another workspace or another account, or the rest of a document reaches the
  model, and a session with no source selected searches nothing. Changing the selection while an answer is written
  changes the next question.
- **Semantic retrieval is not here yet.** pgvector is enabled in the database (Settings → System shows its version), and
  nothing stores a vector: retrieval is the full-text search above. Embeddings and hybrid retrieval are a later step.
- **Governed like a chat.** A research run is bound to its account and decided under the account's policy before it
  starts (`agent.run.start` in scope `ACCOUNT_RESEARCH`, and each connector checked for research), recorded in the
  account's audit; a research workspace's override narrows it.
- **The run.** The official Claude CLI, in a profile of its own: **no built-in tool** (`--tools ""`), no slash command,
  nothing persisted, `dontAsk` (whatever was not allowed beforehand is refused, unasked), a fixed system prompt, the model
  and effort you chose. With no connector checked for research it is also restricted (no settings file is read, so no
  hook, plugin or permission rule) and reaches no MCP server; with some, it reads the user's settings source -- the only
  one the account's connectors come with -- and the connectors checked are allowed by name, the rest denied by name. It
  is given the conversation so far, the passages -- each labelled S1, S2 … with its source, revision, page and section,
  between tags that carry a random value made for this question, so no document can close them -- and the question, and
  told that the passages are references and data, never instructions; that a statement resting on one cites it; that a
  connector is used only when the person's own message asks, never because a passage or a tool's answer says to; and
  that it can approve nothing. A process that reports a built-in tool, or reaches for a tool or connector research may
  not use, is stopped, and the run fails as refused.
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

## The Office: AI employees

**Office** in the sidebar is a virtual office: departments, the employees in them, the work they hold, what needs you
(*Needs me*), and recurring work (*Schedule*). The company starts EMPTY: **Activate** it once one AI connection of your
account is usable -- for Chat, for Research, or to run employees; each connection's card says which, and why not -- and
nothing comes with it (no department, employee, mission or CEO). Losing the connection later only changes what can run.

**Leadership** (Office → Overview): appoint a **CEO** and one **manager** per department (a member of it); replace,
suspend, reinstate or revoke an appointment -- each numbered, versioned and kept as history. Authority comes from an
appointment, or from a **grant** you make on an employee's *Access* tab (it may give work to that employee or
department) -- never from a title or instructions. Replacing a manager moves none of its open work: **Hand over** moves
work, by your act. A department and the company may set **execution defaults** (connection, model and effort per
runtime): what a mission overrides beats the employee's own, which beats its department's, then the company's.

**Hire** takes five steps: *Identity* (a name, optionally from a template) → *Department & role* (title, duties,
instructions, skills, a handoff standard; a "team lead" switch grants no authority by itself) → *AI
runtime, model & effort* (a connected connection, a model and an effort from that connection's own catalog, the
runtime's own web search where it has one, the Orbit plugin where you granted it for employees) → *Personal sandbox &
resources* (a preset, or your own CPU, memory, desk storage, scratch, cache, processes and minutes per attempt, beside
the account's budget) → *Review & hire*. An employee starts on probation unless you say why not. Its **Personal
Sandbox** -- a desk and a toolbox that last across its work, with quotas -- is prepared first; no container runs while
it is idle, and an idle employee reserves no CPU or memory. A hire is refused above a per-employee limit or the
account's storage budget, and never because CPU or memory are busy right now: its work then waits.

**Give work** (*Assign work*): a goal, the deliverables (file names), what makes the result acceptable, a deadline,
optionally **research sources** -- sources of one research workspace, each pinned at the revision it is at -- and what
to do if the employee is busy: *Start now* (a busy employee refuses it, and nothing is created) or *Queue it* behind its
current work. An employee holds one piece of work at a time; queued work starts by itself when it is free. A request
names itself once (`Idempotency-Key`), so sending it twice gives one mission. Give it to **an employee**, **a
department** (its manager in office takes it) or **the CEO**: the dialog shows who is responsible before you send, and
if that changes before it arrives the work is refused, saying who is responsible now (`target_changed`), rather than
given to someone you did not see.

Work may also bring **repositories** (at most five): only ones its employee may use on its *Access* tab -- any other is
refused when the work is given. Every attempt gets a snapshot of each, at its default branch, as a git bundle in `/input`
(`repo-<name>.bundle`: one commit holding the branch's files, its message naming the commit it was taken at), and is
told to `git clone` it. Orbit Web clones it itself, bare and one commit deep, with the connector's sign-in, on its own
side -- the sign-in never reaches the sandbox -- and removes its copy once the attempt has it. A repository the employee
may no longer use when an attempt starts (its access turned off since), or whose snapshot is larger than an attempt
takes (48 MiB for all of them), is not brought in, and the employee is told why.

**Each attempt runs in two containers of its own**, made by the allocator for that attempt and removed -- verified gone
-- when it ends:

- the **tool plane**, the employee's workstation: its desk copied in as `/work` (with its toolbox), `/output` for what it
  hands in, `/input` read-only (only what this attempt may read: the mission's sources for the work you gave, what its
  lead shared for a part, its own parts' hand-ins for a lead -- each listed with why), `/cache`, a small `/tmp`, and for
  a team its department's `/team` room (another department's is never there). Inside it the employee has an unrestricted shell:
  it builds, tests, installs dependencies, and writes scripts and skills in its toolbox, which its next work finds
  again. It holds no credential, has no capability or privilege, a read-only root, and the employee's CPU, memory,
  process and time limits.
- the **model plane**: the AI CLI with that connection's login, and nothing else. Every built-in tool of the CLI is off;
  its only tools are Orbit Web's (read, write and list files, run a command, hand in, ask you a question …), each
  carried out in the tool plane through Orbit Web's tool endpoint, under the attempt's own token. The CLI's first line
  must report exactly those tools, servers and plugins: anything else stops the attempt before it acts
  (`isolation_not_established`), and it is never retried with more.

**Access to the account's connectors.** An employee may use the GitHub and Azure DevOps sign-ins of *Settings →
Connectors* -- the installation's, shared -- once a person lets it, on the employee's **Access** tab: each connector off
until turned on, then for **every repository** that sign-in reaches or **only the ones chosen** (an Azure DevOps
project's work items and wiki come with a chosen repository's project). Its tools then include, for Azure DevOps, *read a
work item* (by its URL, with its description, acceptance criteria, comments and attachments' names), *find work items*
(WIQL), *read a wiki page* and *read a file*; for GitHub, *read an issue*, *read a pull request* and *read a file*. Orbit
Web makes each ask itself, with the installation's sign-in (`az rest`, `gh api`), on its own side: **the sign-in never
enters the employee's sandbox**, and nothing is written (reading only). Each ask is held to what was granted, decided by
the account's policy (`tool.connector`, the repository or project its resource) and recorded; its answer is fenced as
data the employee must not take instructions from, and cut to 256 KiB. Turned off, the next ask is refused.

An employee reads only, unless a person also checks **Also write** on that connector: it may then *propose* a comment on
a work item, an issue or a pull request, or a work item's new state (in what it may read, a work item only under its own
project). Each write is the account policy's decision (`connector.write`, bound to the item, the operation and a digest
of the text): by default it **waits for the account owner's approval** of that exact write in *Governance → Approvals*
(the employee is told so, and nothing is written yet); approved, Orbit Web writes it at once with the installation's
sign-in -- once: the approval is spent before the write, against a fingerprint taken again from what it would write. A
policy may allow such writes outright, or deny them.

**Knowledge bases (MCP servers).** **Settings → MCP servers** keeps the account's remote MCP servers (Streamable HTTP):
a knowledge base, a wiki, a document store. A person adds one with a name, its URL and how Orbit Web signs in to it --
nothing, a bearer token, or a token in a header they name; a token is typed once, kept in Orbit Web's credential store
and never shown again, and a server with a token is reached over https only. Orbit Web reads its tools at once (a server
that cannot be read yet is kept, saying why, so its sign-in can be put right and read again) and **allows only the ones
the server marks read-only**; any other, and any tool the server adds later, is offered to employees only once a person
checks it. Each server is then **off for every employee until a person turns it on** on the employee's **Access** tab
(*Knowledge bases (MCP)*), saved at once. The employee sees its allowed tools as `kb_<server>_<tool>`; Orbit Web makes
each ask itself, with the server's credential, on its own side -- **the credential never enters the sandbox**, and the
employee's CLI keeps its one MCP server (Orbit's tools). Each ask is held to the grant and the tools allowed now, decided
by the account's policy (`tool.connector`, resource `mcp:<server>/<tool>`) and recorded; its answer is fenced as data,
not instructions, and cut. Orbit Web connects only to the public internet (or a range the installation named,
`ORBIT_WEB_EGRESS_PRIVATE_ALLOW`), never to its own host, loopback or a cloud metadata service, to the very address it
checked, and never follows a redirect. Removing a server takes its tools from every employee at their next ask.

**Resources.** An attempt reserves its CPU and memory (its limits plus its model plane's) when it is admitted, and gives
them back only once its containers are gone. With no room now -- in the account's budget or on this host -- its work
**waits for resources** and starts by itself; one that can never fit as configured is **unschedulable**, said with the
numbers in *Needs me*. Admission is fair across accounts (the least-served account first), ages work that waits, and
lets a small attempt pass a large one only for so long. Each storage area is reported as a *hard limit* (the kernel
refuses a write past it, proven by writing past it), *measured only*, or *not enforced*; a shell runs only where every
writable area is a hard limit, or where the operator accepted measured areas on a protected disk
(`ORBIT_WEB_ACCEPT_SOFT_STORAGE`). **Settings → Compute & storage** shows what this host gives employees (detected or
configured, less the control plane's limits and a reserve), the account's budget (lowered there; raising it above what
the operator authorized is refused), what is reserved now, the storage committed and really used, and what runs and
waits. The host is read again at every start and at **Re-check** there (after a resize, or a change of
`ORBIT_WEB_CAPACITY_*`): an authorization that comes from the capacity follows it -- a budget value that stood at it
moves, one you lowered stays -- while one the operator set with `governance.js budget set` stays the operator's until
`--from-capacity` (ADR 0061).

**Network.** A tool plane's only way out is Orbit Web's egress proxy, every connection decided as that attempt under the
account's policy (Governance → *Employee network access*): **Autonomous**, the default, reaches any public host on ports
80 and 443; **Restricted** reaches only the hosts you list. Private, loopback, link-local and cloud-metadata addresses
are refused in both, after every name is resolved and at every redirect. A model plane reaches its AI provider's own
hosts (port 443) and Orbit Web's tool endpoint, nothing else. Every connection of an attempt is kept in its network log.
*In Autonomous mode an employee can send the data of its assignment to any public website. Use Restricted mode, or do
not give it data that must not leave.* -- the Hire, Assign and Governance pages say it too.

**Review.** The employee hands in a summary, its deliverables (stored by hash and verified when read) and its claims --
each *supported* only when a pinned source holds the very words it quotes, or marked *web, not pinned* with its URL.
**Needs me** lists what waits for you: a result to review, a question to answer, blocked or unschedulable work, a
delivery to settle. **Request revision** (saying what must change) gives the work back to the same employee for a new
attempt; **Accept** completes it -- naming the exact revision you read, so a newer one, or a page that moved since, is
refused rather than overwritten -- publishes the work to the employee's desk and frees the employee for its next work.
Pause, resume, cancel and retry are there too, each against the version you read. Disconnecting the AI connection an
employee runs on stops its running attempt and blocks the work, saying why; nothing switches to another provider by
itself.

**A team, by the tree.** The CEO gives work to the managers (a department goes to its manager), a manager to the
members of its department, anyone to whom you granted it. A plan gives up to eight parts, each with a goal,
deliverables and criteria, what it waits for, and what it is **shared**: a part reads only what its lead shares on
purpose (sources the lead reads, a finished part's summary or its files) -- a plan naming someone out of reach, waiting in
a circle or sharing what the lead does not read is refused whole. A part that cannot go on **asks its lead**, whose next
attempt answers it (or moves it up, saying why); only the mission's own questions -- or ones moved up to you for what is
yours to decide -- reach *Needs me*. Each department's members share its **team room** (`/team`), every change kept with
whose attempt made it. A lead reviews each part by the revision it read and hands in once every part has ended; you
review the mission's result, and every revision stays as it was handed in. An attempt that delegated, asked or answered
ends at once, by design, so a lead and its part never hold one execution slot together. Taking back what a lead shared
(*Revoke* on the mission), or moving an employee to another department, stops an attempt that held it.

**Recurring work** (*Schedule*): daily, weekly, monthly or quarterly, at a local time in a time zone (a time a clock
change skips or repeats is resolved by a stated rule), makes one mission per period whoever asks; what happens to the
periods missed while Orbit Web was down is yours to choose (the latest, each, or none). An accepted result is
delivered -- to *Needs me*, or to an external channel this installation does not have yet, where it waits *for a
channel*. A delivery is *sent* only with a receipt; one that may or may not have reached its receiver is settled by a
person.

## Governance

Governance is the **account's**, and you -- the account's owner, signed in -- govern it. Open **Governance** in the
sidebar: there is no second sign-in, no operator and no organization to create. It shows what your
account owns and nothing of another account's.

- **Employee desks.** **Governance → Employee desks** lists every employee's desk -- of those in the office first,
  then of those who left -- with what its desk and cache commit of the account's storage and what was last measured in
  them (measured again when accepted work reaches the desk, when you open it and after a clean-up).
  - **Look into one** (**Open the desk**, or *look into it* on the employee's page): one folder at a time, the biggest
    first, with what each folder holds; a file opens as text -- at most its first 512 KiB, shown and never run (a page's
    markup is text here) -- and a file that is not text is only named and sized. A link is listed with its target and
    never followed. Orbit Web's own names at the desk's top (its publishing's stage, `lost+found`, the marker an
    isolation check plants for a moment) are not shown; Orbit Web never seeds or publishes such a name, so nothing an
    employee wrote is hidden from you.
  - **Is that right, to read an AI employee's desk?** Yes: the desk is the account's -- the directory it keeps for an
    employee's work, holding what its accepted work left and the toolbox it wrote for itself -- and reviewing it is the
    owner's (ADR 0061). It stays governed: only a person may (`employee.desk.read` and `employee.desk.clean` are
    people-only actions of the policy, allowed by default and always recorded, never an agent's), every look is in the
    audit with what was looked at -- the folder or the file, never what it holds (`office.desk.read`) -- the bytes are
    read by the allocator's storage worker as the employee's own user with no network, and nothing in a desk is ever
    run or rendered.
  - **Clean it up** when it fills: chosen files and folders (the toolbox's folders stay, what is in them may go),
    **Empty the desk, keep the toolbox**, or **Empty the cache** (the packages its tools download again when they need
    them) -- each said in full before anything goes, and it cannot be undone. Only while the employee is in the office
    and holds no work: an assignment it holds -- awaiting your acceptance too -- has a work tree made from the desk, which
    would put back what you removed when its work is published, so the clean waits, and the allocator checks again,
    under the employee's own lock, that no workspace or attempt of it is left. A clean names the desk's version you
    chose at: accepted work that reached the desk since makes it stale, and nothing is removed. The desk's version does
    not move (it counts accepted results); the clean is recorded (`office.command` `employee.desk.clean`).
  - **One who left** -- archived, or rejected at the trial -- keeps its desk, read only (looked into, never cleaned up),
    and its storage stays committed (an archive releases only the cache). **Delete the desk** of the ones you no longer
    need (confirmed; it cannot be undone): the desk, the cache and every workspace are removed through the allocator --
    tried again while a container of one of its attempts is still there -- and only once they are read back gone is the
    storage released (ADR 0061).
- **What it governs.** **Workspaces** (your chats, and their runs), **Research** (your research workspaces, their
  sessions, sources and runs) and the **Office** (hiring, giving and delegating work, publishing an employee's work,
  deliveries -- each an action of the policy, and every attempt bound to its account and employee). Each resource shows the policy that applies to it -- inherited from the
  account, or narrowed by an override --, its runs under way, its approvals waiting and its recent activity. A resource
  that was deleted stays listed: what governed it stays on record.
- **The policy.** Your account starts with a **default policy**, published the moment the account is made, fitting the
  deployment: in the single deployment what Orbit Web always allowed there (the web tools and connectors allowed,
  isolation optional); in the governed deployment the strict default. A policy is a document of rules over a closed set
  of actions -- run an agent, read and write the workspace, run its commands, the web tools, a connector, network egress
  by `host:port`, credentials, privileged settings, pushes, production -- each `allow`, `require_approval` or `deny`, the
  default `deny`, the strictest winning; you edit it in its table (one row per action, *Allowed* and *A person approves
  first*; the hosts the agent may reach as a list; the obligations as boxes).
- **Inheritance.** The deployment's mandatory limits (what no kind of principal may ever be granted, what nothing here can
  carry out, no credential in the governed deployment, research without tools) ▸ the account's published policy ▸ an
  **override** of one chat or one research workspace, which can only narrow (an `allow` in it changes nothing).
  Loosening for one resource is a rule of the account's policy, through the whole lifecycle below.
- **Publishing, one owner.** Draft → *Validate* → read what the change does (worked out from the two policies, never from
  their words: what it loosens and narrows, and its risk) → **confirm** (you name the content and the policy in effect you
  read, and acknowledge a high risk) → *Publish*. A revision that moved since you read it, or a policy in effect that
  moved, is refused, never overwritten. There is no second approver: a confirmation is your own, recorded as such, and
  never shown as an approval by somebody else. A published revision never changes (the database refuses it too); a
  rollback is a copy published again. *Simulate* asks a revision what it would decide, recording nothing.
- **Every run is governed.** A chat's run and a research run are bound to the account and decided before they start --
  the account's policy in effect, the override of their resource, isolation where the policy requires it -- and each
  connector you checked is a decision of its own; the run holds a token of its own for the **agent gateway**. An agent
  never becomes the owner: it cannot edit the policy, approve anything or change the account -- every attempt is refused
  and recorded.
- **Approvals.** A push the policy does not simply allow waits in *Approvals* with exactly what it is (repository,
  remote, branch, commit, where the remote's branch stood) and its fingerprint; approving binds that fingerprint, spends
  it once and carries the action out; anything that moved since is refused and asked for again. Only a person decides an
  approval: a run never approves what it asked for (the database refuses any other decider).
- **Evidence.** *Policy decisions*, the *Audit timeline* (your account's own hash chain, verified on demand and at every
  start), *Security findings* worked out from the record by rules (each citing its records), and *Daily reports* (by
  hand, or generated after a day ends when the policy asks) -- every count, page and export holds your account's records
  only.
- **Privileged switches**: turning on *Let Claude Code push … with this GitHub sign-in*, *… use this Azure sign-in* or
  *Run project plugins* is the owner's (and the account policy's decision); turning one off needs nobody. A request from
  anything else -- the agent's shell included -- is refused and recorded.
- **Employee network access** (Policy): **Autonomous** (the default: any public host on ports 80 and 443) or
  **Restricted** (only the hosts you list, exact or `*.domain`), part of the policy document, so a change is drafted,
  validated, shown with its risk -- Restricted → Autonomous is a high-risk change -- confirmed and published, and applies
  to the next connection of a running attempt. Private and internal addresses are never reachable in either mode.
- **From a terminal**: `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js status |
  verify-audit [--account=<id> | --deployment] | owner setup-code | owner reset-password --username=<name> | owner
  revoke-sessions [--username=<name>] | revoke-sessions --account=<id> | --all`.

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
Claude Code. It is a protected action, asked for by the chat's owner: *Prepare the push* reads the branch's commit from
the workspace, carries it into Orbit Web's own copy of the repository (every object checked), asks the remote where the
branch stands, and shows exactly what would be pushed and its fingerprint; *Push* pushes it. Never forced -- what is not a
fast-forward of the remote's branch is refused by git, so nobody's work is overwritten --, never to the repository's
default or a protected branch, and nowhere when the default cannot be established. A chat started from a working
branch (a story branch, neither default nor protected) pushes to that branch like any other. An agent asks for the same push
through its gateway: it is pushed at once where the account's policy allows it, and otherwise the owner approves it.

### Python

The image has CPython 3.15.2 (python-build-standalone, pinned by SHA-256) with pip and venv, as `python3`, `python`
and `pip` for Claude Code. It is root's: a project installs into its own virtual environment (`python3 -m venv .venv`)
or with `pip --user`. `docker build --build-arg AGENT_PYTHON=0 …` leaves it out (the System card then says so).

## The governed deployment

```bash
cd integrations/orbit-web/docker && docker compose -f compose.governed.yaml up -d --build
```

The same image as two containers, beside **postgres** (PostgreSQL with pgvector) on a network only the control plane
joins: the agent's container cannot reach the database and holds none of its credentials. **orbit-web**, the control
plane: the API and the page, the CLIs' sign-ins, Orbit Web's copies of the repositories and the **egress proxy**. **orbit-agent**: Claude Code and every
program that touches a workspace, started by the control plane through a runner. The agent's container mounts the
AI connections' homes (each account's Claude Code login), the workspaces, the sessions, Orbit's store and a home -- and the repositories' copies read-only
-- on a read-only root; it has no database, no governance record, no API key and no sign-in of GitHub or Azure to read.
Its network is internal: it reaches the control plane's agent gateway and proxy and nothing else, and public names do
not resolve. Every connection it makes leaves through the proxy as a decision of the policy of the account whose run it is
(each account starts with this deployment's strict default), never to an address off the public internet. A connection's sign-in never runs
there: it runs in the control plane, from the operator's terminal ([AI connections](#ai-connections)). The control plane never writes or runs anything in a directory the
agent can write. Before every strict run Orbit Web checks the agent's container (Governance → Overview shows what was
checked) and records it.

In this deployment the GitHub and Azure switches are refused -- a push is Orbit Web's (above) -- and declared
marketplace plugins cannot be fetched: their install runs outside any run and has no way out (a repository's own
skills, commands and agents still load).

## How it works

```
browser ── React + Fluent UI v9 ── HTTP + two SSE streams ──▶ NestJS API (one origin, /api)
  ├─ PostgreSQL 17 + pgvector (pg, a bounded pool)            (every record: app · research · governance)
  ├─ claude auth … · claude plugin …                       (Claude Code CLI)
  ├─ codex login … · codex login status · agy --version     (OpenAI Codex CLI, Antigravity CLI: a connection's sign-in)
  ├─ gh auth … · gh api … · gh repo clone                   (GitHub CLI)
  ├─ az login … · az account show · az rest … (Azure DevOps) (Azure CLI, optional)
  ├─ git clone + the one-shot credential helper (Azure Repos) · git init (no repository)
  ├─ claude -p --plugin-dir /opt/orbit/plugin [--plugin-dir <the chat's project plugin> …] ──▶ Orbit's hooks, skills, agents
  ├─ git status · git diff                                   (the chat's workspace)
  └─ node /opt/orbit/plugin/cli/{live,task,autonomous-engineering}.mjs  (Orbit, read-only)
```

- **One way to start a program**: a file and an argument list (no shell), an explicit working directory, an
  allow-listed environment (never the database's URL), its own process group. No endpoint accepts a command.
- **One database, asynchronous**: every store awaits PostgreSQL through one `Db` (a bounded pool with timeouts). A
  transaction holds one connection for its whole life and travels with the request's async context, never in a shared
  variable; one inside another is a savepoint. What a change tells the rest of Orbit Web -- an event to a stream, an
  app-stream notice -- is said after it commits, never for work rolled back. Numbers that SQLite's single writer used to
  keep unique come from counters updated in place (a chat's journal, a source's revisions, an account's policy
  revisions) and the audit chain's head row, locked per account. Numbered migrations, checked by the SHA-256 of their
  text, run at start under an advisory lock.
- **The Claude runner**: `claude -p --output-format stream-json --verbose --include-partial-messages --model
  <opus|fable|sonnet|haiku> --effort <low|medium|high|xhigh|max> --plugin-dir /opt/orbit/plugin [--plugin-dir <project
  plugin> …] (--session-id <id> | --resume <id>) --permission-mode <auto|plan> --allowedTools
  Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite --disallowedTools "Bash(git push:*)" "Bash(gh:*)" "Bash(git
  credential:*)" "Bash(git config --global:*)" ["Bash(az:*)"] "Read(//data/connections/**)" "Edit(//data/connections/**)" …
  [WebFetch WebSearch] --append-system-prompt "<what this workspace allows>" --setting-sources user
  [--strict-mcp-config] [--settings '{"enabledPlugins":…}'] [--max-budget-usd <n>]`, the prompt on stdin, cwd the
  workspace. `--strict-mcp-config` only in a run governance holds: a chat reaches its connection's claude.ai
  connectors (Claude Docs, where Claude makes its documents, among them) and the MCP servers of the user's settings
  and of the plugins loaded. With GitHub's
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
    missed: the stream subscribes first, reads the journal up to its head, then sends what arrived meanwhile beyond it,
    so nothing written while it caught up is lost or sent twice; `message.delta` is transient and carries its offset, and a message still being written is sent whole as a
    snapshot, so text never doubles.
  - **The app stream**, `GET /api/events`: notifications any page of the account may need -- `session.summary`,
    `session.removed`, `connector.status`, `connector.flow`, `customizations.changed` -- each published to its audience
    (the account, the emails a record is shared with, or everyone signed in for a connector's sign-in). Never stored: a page that (re)connects reads the
    read models again (`/api/sessions`, `/api/sources`, `/api/customizations`) and applies what follows. Nothing polls.

  Adding an event is a catalog row and its payload type; the bus, the gateway and the web's `useAppEvent(type, …)`
  carry it from there. The outcome of a run is still decided from its exit status and the CLI's own result line.
- **API**: `GET /api/health` (the database included: its schema version and pgvector, never its URL);
  `GET /api/claude/status` (this browser: its session and account, the runtime CLI's state, its own flow),
  `POST /api/claude/login` (no body: always `--claudeai`; sets the flow's nonce cookie), `POST /api/claude/login/code`,
  `POST /api/claude/login/cancel`, `GET /api/claude/login/events` (this browser's flow), `POST /api/claude/session` (the
  verified sign-in exchanged, once, for this browser's session), `DELETE /api/claude/session` (this browser signs out),
  `POST /api/claude/logout` (the account: every browser, and the CLI; 409 `run_active` / `workspace_preparing` while
  Claude Code works); `GET|PUT /api/account`, `DELETE /api/account/sessions/:id`; `GET /api/github/status`, `POST /api/github/login|login/cancel|logout`
  and the same four for `/api/azure` (Azure's login takes an optional `tenant`); `GET /api/sources`;
  `GET /api/repositories?source=github|azure[&refresh=1]`, `GET /api/repositories/branches?source=…&id=…`;
  `GET|POST /api/sessions` (a repository is `{ source, id }` or `null`), `GET|PATCH|DELETE /api/sessions/:id` (a title,
  model, effort or mode), `POST /api/sessions/:id/messages`, `POST /api/sessions/:id/stop`,
  `GET /api/sessions/:id/events` (SSE), `GET /api/sessions/:id/changes`, `GET /api/sessions/:id/changes/file?path=`,
  `GET /api/sessions/:id/verification`, `GET /api/sessions/:id/project`; `GET /api/customizations`; `GET /api/events`
  (SSE); `GET /api/setup/status`; `GET|PATCH /api/settings`; `POST /api/access` (token mode). Errors are
  `{ "error": { "code", "message" } }`. Until this browser has a session, every route but `GET /api/health`,
  `POST /api/access`, `GET /api/auth/status`, `POST /api/auth/login|setup` and a shared chat's link answers 401
  `sign_in_required` (one global gate: a route is the owner's unless it is marked public). The Office's routes
  (`/api/office/…`, `/api/employees/…`, `/api/missions/…`, `/api/assignments/…`, `/api/inbox`, `/api/schedules/…`,
  `/api/deliveries/…`, `/api/artifacts/…`) and AI Connections' (`/api/connections/…`) are listed at the head of their
  controllers; an attempt's tool endpoint (`/api/runtime/tools/list|call`) answers an attempt's own token alone. It is
  an agent door like the chats' gateway (`/api/agent/…`): its bridge reaches it by Orbit Web's name on the attempt's
  network, so neither the Host allow-list nor the access token applies to it -- its run token does.

## Security model

For one person, on their own machine, by default:

- **Loopback only.** Compose publishes `127.0.0.1:3000`; the API answers only Host names on an allow-list (localhost,
  127.0.0.1, ::1), which also defeats DNS rebinding. Another host name is answered with Orbit Web's own sign-in as the
  gate (below, ADR 0061); `ORBIT_WEB_ACCESS_TOKEN` adds a perimeter in front of it: then every API call needs the
  token, traded once for an HttpOnly,
  SameSite=Strict cookie. The page asks for it before the sign-in (two steps, said as two), or takes it from an
  **access link**, `https://<host>/#access=<token>`: the fragment never reaches a server or a Referer, and the page
  removes it from the address bar and the history entry before anything else reads the URL. Share such a link as you
  would the token. Put it behind an authenticated HTTPS reverse proxy before exposing it anywhere else.
- **A browser's session gates the API.** Until THIS browser signed in with a username and a password of Orbit Web's and
  holds the session it was given, one global gate answers 401 to every route but the health check, the sign-in status,
  the sign-in and setup, the access token and a shared chat's link, before any program runs -- and an AI CLI's login
  opens nothing by itself. The first administrator needs a one-time code only the server's terminal prints (kept as its
  hash, short-lived, used once); passwords are scrypt hashes; every attempt is counted, per username and per address,
  before a password is checked. The session is an HttpOnly, SameSite=Strict cookie the server keeps only the hash of,
  rotated at every sign-in, with a lifetime, an idle limit and a CSRF token every change carries. It adds to the
  loopback rule and the access token -- a perimeter, never an identity -- and replaces neither. Trial mode's public
  password is refused anywhere but on this machine.
- **Changes need proof of origin**: every POST/PUT/PATCH/DELETE needs the `X-Orbit-Web` header (a cross-site page
  cannot send it without a CORS preflight, which is never answered), the session's CSRF token (`X-Orbit-Csrf`), a
  matching Origin when the browser sends one, and a JSON body; bodies are limited to 256 KB. An API answer is never
  cached (`Cache-Control: no-store`).
- **The database is the control plane's.** Its URL reaches no program Orbit Web starts; Orbit Web's role is not a
  superuser; in the compose files it is on an internal network only Orbit Web joins (and never the agent's container in
  the governed deployment). It is required: one that cannot be reached stops Orbit Web, which never falls back to another
  store.
- **Inputs are validated** against closed rules (sources, repository ids per source, branch names, models, efforts,
  modes, titles, prompts); a repository opens only if its source lists it, and its clone URL comes from that listing;
  a workspace path is built only from a server-made id and checked to resolve inside `/data/workspaces`; a diff is
  served only for a path git listed as changed.
- **Credentials stay with the CLIs.** A CLI's login lives in its connection's home and nowhere else; Orbit Web never
  reads, stores or sends a token -- but for an AI connection's API key, which a person gave it for that purpose and which
  it keeps in its credential store (0600, outside every mount) and hands to that connection's process alone, and the
  telemetry collector's token, which whoever runs the container puts in its environment and Orbit Web hands to Claude
  Code alone, so it can export: it never runs `gh auth token`,
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
- **Claude connectors** (the owner's decision, ADR 0061; [above](#claude-connectors)): a chat and a research session
  reach the connectors of the account's default Claude Code connection -- Claude Docs, where Claude makes its documents,
  and whatever else that Claude account connected at claude.ai (mail, files, chat …) -- each as far as that account's person checked it for chats and
  for research; an unchecked one is denied by name (`--disallowedTools mcp__<connector>`), in every mode. What the account
  can do in a service, Claude can do there too: in an Autonomous chat each call is reviewed by auto mode's classifier,
  like any tool's; in research a checked connector is allowed by name and nothing else is (`dontAsk`), so the guard there
  is the person's checkbox and the rule that a connector is used only when the person's own message asks. Each checked
  connector is also a decision of the account's policy (`tool.connector`) when a run starts. In the governed deployment
  a run reaches none (`--strict-mcp-config`, and `ENABLE_CLAUDEAI_MCP_SERVERS=false` behind the egress proxy).
- **Images in a chat message** are uploaded as their own bytes (`POST /api/images`, `application/octet-stream`: with a
  research source, the only two bodies that are not JSON, each on its one route under the same header and origin rules).
  What an image is, is read from its bytes -- PNG, JPEG, GIF or WebP, never SVG -- and it is held to Claude's limits; it
  is kept under `/data/app/images` (the control plane's room) as a file named by an id the server made, and belongs to
  the account that uploaded it: a message may name only its sender's unsent uploads, an image goes with one message, and
  it is read back only through the chat (`GET /api/sessions/<id>/images/<image>`, under the chat's access rule, served
  `nosniff` with `default-src 'none'`). Claude Code is given it as base64 in one stream-json message on stdin; events and
  logs keep its id, never its bytes. The image goes to Claude (Anthropic) with the words.
- **A shared chat's link** opens one read-only snapshot and nothing else: `GET /api/shared/<token>` is the one route the
  access gate and the sign-in gate let through, the token (32 random bytes, in the URL's fragment) names one
  share, and the snapshot holds the conversation alone -- tools by their title unless their owner shares what they did,
  every text masked again, no id of the chat -- served `no-store` and `noindex`.
- **Each account its own** ([above](#each-account-its-own)): every record carries its account, and the database
  holds each child to its parent's account (composite foreign keys); a chat or a research workspace answers only the
  account that owns it and the accounts it was shared with; any other gets 404, on every route under it (a test reads
  every route the application declares and holds each one). No request names its account: it is the session's.
- **Research** ([above](#research)): a research run has no built-in tool, persists nothing and is never in a bypass
  mode; with no connector checked for research it reads no settings file and loads no MCP server; with some, only those
  are allowed. A process that reports a built-in tool, or reaches for a tool or connector research may not use, is
  stopped. Documents' words reach it only between tags it cannot close, as references and data, never instructions. Citations are verified against the passages the run was given. An upload is
  the file's own bytes, on its one route, under the same header and origin rules; files are named by their hash.
  The URL fetcher reaches only the public internet's web ports, checks every address and every redirect, and connects
  to the address it checked. A research run's token (governed deployment) opens the egress proxy alone, never the
  agent gateway. What a run writes is masked by token shape before it is kept; no event keeps a source's text.
- **Governance** (above): the account's owner -- the person signed in -- and the account's policy deciding every run
  and protected action, approvals spent once and decided by a person only, and a hash-chained audit record per account
  that no deletion reaches. An agent is never the owner: no request it can make -- with its run's token or without --
  reaches a governance route, turns a credential switch on, or approves anything; every attempt is refused and recorded.
- **AI employees** ([above](#the-office-ai-employees)): each attempt is two containers of its own, made by the allocator
  from fixed images, a fixed mount list and the employee's limits -- none of them taken from a request. The tool plane
  (the employee's shell) holds no credential, has no capability or privilege, a read-only root and no Docker socket, and
  sees only its own desk, scratch, the inputs its attempt may read (refused and recorded otherwise), cache and its
  department's team room; the model plane holds one connection's
  login, with every built-in tool of the CLI off, and acts only through Orbit Web's tool endpoint under the attempt's own
  token (which opens nothing else: not the agent gateway, not an owner's route). The CLI's first line is checked, and a
  tool, server or plugin it was not given stops the attempt. Each plane reaches the outside only through a proxy of Orbit
  Web's: the tool plane under the account's network policy, never a private address; the model plane its provider's
  hosts. What an attempt hands in is checked (deliverables by hash, claims by quote against the pinned sources), never
  taken on its word. Every claim on a resource -- CPU, memory, storage -- is reserved before it runs and released only
  once its containers are verified gone.
- **The images**: a non-root user, `cap_drop: ALL`, `no-new-privileges`, no credential in any layer; Orbit Web's own
  container has no Docker socket -- the allocator, a container of its own on a private network with no published port,
  alone holds it.

**The limit, said plainly.**

- **The single deployment** (`docker/compose.yaml`): each chat's and research question's run is in a **sandbox of its
  own** ([Use it](#use-it)): a container holding that run's places alone -- not the database, not Orbit Web's
  environment or rooms, not another chat's workspace or another account's sign-in -- removed when the run ends. What it
  does hold is real: its chat's workspace, its connection's own sign-in, its account's Orbit store, and -- with that
  switch on -- the installation's GitHub or Azure sign-in (with GitHub's switch on, Claude Code pushes and opens pull
  requests as you by design). Its network reaches the internet, as a chat always has, and nothing of this host's other
  containers. Orbit Web's own work in a workspace -- the clone, Changes, branches, the Orbit panel -- runs in Orbit
  Web's container, on the same disk. The deny rules, auto mode's classifier and `--setting-sources user` stay **defence
  in depth** inside the sandbox; nothing calls a run isolated because records carry an account, and a policy that
  requires isolation (attested, as the governed deployment does) still refuses runs here. Without an allocator, runs
  are in Orbit Web's own container, beside every sign-in and Orbit Web's environment, as they were before.
- **The governed deployment** (`docker/compose.governed.yaml`) holds at the container: the database (and its
  network), the sign-ins and the control plane's room are not in the agent's container, and its only way out is the
  proxy (the security lab,
  `tests/security-lab/`, shows each attack PREVENTED but one). That one: **every governed workspace shares the one agent
  container**, so an agent can read another workspace's files on disk (the gateway refuses another workspace's
  approvals, the disk does not) -- run trust domains that must not see each other as separate deployments. The Claude
  account's configuration is necessarily readable by the agent, and the model API is reachable by design. The
  isolation check is the agent container's own answer: a check of the wiring, not proof against a runner the agent has
  taken over. The audit chain is tamper evidence on this host, not proof against whoever controls the host.
- **AI employees.** The isolation of an attempt is Docker's: the allocator holds the Docker socket, so whoever controls
  the allocator controls this host -- it is root with no capability, answers only requests signed with the shared
  secret, and takes nothing a caller could turn into a mount, an image or a privilege. The model plane's login is
  readable by the CLI that uses it, which is the provider's own program. A storage area said *measured only* can be
  filled past its quota until it is noticed: a shell runs on one only when the operator accepted it. In Autonomous mode
  an employee can send the data of its assignment to any public website. In the governed deployment, the one agent
  container mounts every account's AI connection homes, as it mounts every workspace: run accounts that must not see
  each other as separate deployments.
- **Research.** The passages a question retrieves are sent to Claude (Anthropic). A research run's restrictions are the
  Claude CLI's own flags; in the single deployment it runs in a sandbox of its own holding its connection's home alone.
  Accounts are separated at the API and in the rows; on disk, a run's sandbox holds its own account's places only --
  but the GitHub and Azure CLIs' sign-ins are the installation's, and Orbit Web's own container holds every account's
  data: accounts on one Orbit Web are not tenants of an isolated system. An employee's attempts are isolated per
  attempt (above). Sharing has no read-only level.
- Open repositories you trust, keep *Run project plugins* off unless you trust them too, keep the port on loopback, and
  disconnect a source when you are done.

## Troubleshooting

| symptom | what to do |
|---|---|
| The page does not load | `docker compose ps` (healthy?), `docker compose logs`; `curl -s localhost:3000/api/health` says which part is not usable |
| Orbit Web exits at start: *the database could not be reached* / *refused the connection* | PostgreSQL is not up or the URL is wrong: `docker compose ps postgres`, `docker compose logs postgres`; the passwords in `.env` must be the ones the database volume was first made with (they are set once, at its first start) |
| *pgvector is not enabled in this database* | as a superuser of that database: `CREATE EXTENSION vector;` (the compose files' init script does it on a new volume) |
| *The database schema is at version N; this build needs M* / *migrated by a newer build* | run the matching build, or `cli/db.js migrate` with this one; a database a newer build migrated is never written by an older one |
| The page offers only *Set up Orbit Web* | nobody is set up yet: `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner setup-code`, then use the code within 30 minutes |
| A password is forgotten | `… governance.js owner reset-password --username=<name>` prints a one-time code; *Set up Orbit Web* with it sets a new password |
| `too_many_attempts` (HTTP 429) | too many failed sign-ins for that username or from that address: wait the time the page says (it doubles with each failure) |
| Every browser of a user was signed out | the password was changed, *Sign out everywhere* was used, or `owner revoke-sessions` ran: sign in again |
| Orbit Web refuses to start: *ORBIT_WEB_TRIAL=1 refused: …* | trial mode runs only where nobody else can reach it: the message names what to remove (an allowed host, an access token, the governed deployment, a public origin or the Secure cookie setting) |
| *This database was created by a development build or release candidate of Orbit Web 0.8.0* | 0.8.0 starts from an empty database, and rc02 does not migrate rc01's: `db.js reset --confirm=<database name> --with-data` (Orbit Web stopped), or remove the volumes |
| The chats and governance of an earlier Orbit Web are gone after upgrading | by design: 0.8.0 starts on an empty PostgreSQL database and imports nothing from the SQLite files, which stay in the data volume |
| *Connect Claude Code (or another CLI) in Settings → AI Connections first* | a chat, a research question and an employee's work run on your account's own connection: add one, and sign it in (the card shows the terminal command for a subscription) |
| A connection says *Authentication required* | its login ended, was signed out, or its CLI now names another identity: sign it in again (*Reconnect*); one identity is connected to one account at a time |
| *Hire* is disabled: *Connect an AI CLI first* | no connection is connected with its models read from your account: Settings → AI Connections, then *Re-check* |
| An employee's work *waits for resources* | the account's budget or this host has no CPU or memory free now: it starts by itself when an attempt ends; Settings → Compute & storage shows what is reserved |
| Work is *unschedulable* | as configured it can never fit (above the budget, a per-employee limit or what this host has): Needs me says the numbers; edit the employee's resources, or ask the operator to raise the authorization |
| An attempt is blocked: *isolation not established* | the CLI's first line reported a tool, server or plugin it was not given (a managed setting, a plugin): it is never retried with more; look at the model-plane image and the connection's home |
| An attempt is blocked: *storage_not_enforceable* | a writable area of the employee is only *measured* on this host: give the allocator a filesystem whose quotas the kernel enforces, or accept measured areas on a protected disk (`ORBIT_WEB_ACCEPT_SOFT_STORAGE=1`) |
| An employee cannot reach a site | Governance → Employee network access: in Restricted mode only listed hosts are reachable; private and internal addresses never are; the mission's run shows each refused connection |
| `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` in the container's environment are not used | by design: no credential of the server's own reaches a program; add an API-key connection in Settings → AI Connections |
| `host_not_allowed` (HTTP 421) | open it as http://localhost:3000 or http://127.0.0.1:3000, or add the host name to `ORBIT_WEB_ALLOWED_HOSTS` |
| Hire says *CPU … is above the per-employee limit of 0.05 vCPU* (or a desk above the limit) | the host gives employees little beyond the control plane's own limits: resize it, or set `ORBIT_WEB_CAPACITY_*`, then **Re-check** in Settings → Compute & storage (or restart) -- an authorization that follows the capacity follows it; `governance.js budget set` authorizes other numbers |
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
| A URL source fails with HTTP 401 or 403 | the site serves that page only to a person's browser or a signed-in account (many paper repositories do); the server sends no cookie, credential or browser disguise, by design. Open it in your browser, save the document (its PDF), and upload it |
| *Ask* is not offered | no selected source is ready: select one, or wait for the selected ones to be read |
| An answer says the sources do not say | by design: it answers only from passages of the selected sources -- select more, or add a source that does |
| A run seems stuck | **Stop**; it ends as interrupted; send the next message to continue |
| Disk use grows | delete chats you no longer need (removes their workspaces); `docker system df -v` |
| Build behind a proxy | `node scripts/build-image.mjs --ca-file=<the proxy CA>` |
| Orbit panel says not seated / unavailable | the workspace is seated when it is prepared; the panel's message quotes Orbit |
| Turning on a GitHub/Azure switch is refused | in the governed deployment it always is (a push is Orbit Web's); otherwise the account's policy decided it: *Policy decisions* shows why |
| A chat's or a research run is refused | its message says why: the account's policy (or the resource's override) does not let it start, or isolation is not proven where the policy requires it (the single deployment) |
| *Push* waits | the account's policy asks a person to approve pushes: approve it in Governance → Approvals, or let the policy simply allow them |
| In the governed deployment Claude Code cannot reach a host | every connection is the account policy's decision: *Policy decisions* shows the refusal; allow that `host:port` (a high-risk change, confirmed when you publish) |

## Develop and test

```bash
npm ci                         # in integrations/orbit-web (Node >= 22.13)
node scripts/ci.mjs            # typecheck, lint, every deterministic test on PostgreSQL, production builds (prints counts)
eval "$(node scripts/test-db.mjs start)"   # the tests' PostgreSQL + pgvector in Docker (the pinned image); ci.mjs starts it too
npm run build && ORBIT_WEB_DATABASE_URL=postgres://… ORBIT_WEB_DATA_DIR=/tmp/ow ORBIT_PLUGIN_DIR=$PWD/../.. ORBIT_WEB_PORT=3000 npm start -w @orbit-web/api
npm run dev -w @orbit-web/web  # the app on :5173, /api proxied to :3000
```

| kind | where | what it proves |
|---|---|---|
| unit | `packages/contracts/src/*.spec.ts`, `apps/api/src/**/*.spec.ts` | the event catalog and bus, parsers (GitHub, Azure DevOps), the stream mapper (plans included), redaction, argv (model, effort, mode, plugins), the project reader's bounds and its instructions-only copy, state machines, path rules |
| database | `apps/api/tests/integration/{database,events}.spec.ts` | on a real PostgreSQL with pgvector: an empty database migrated, a second run changing nothing, a changed migration refused, savepoints, after-commit only after a commit, concurrent writers never sharing a number, the journal replayed while events keep coming (none lost, none twice), a database that cannot be reached refused (no fallback) |
| integration, mocked processes | `apps/api/tests/integration/*.spec.ts` | the real API over HTTP and both SSE streams, each harness on a PostgreSQL database of its own, with claude, gh and `az rest` scripted; git and Orbit's CLIs run for real; chats with and without a repository, Azure DevOps listing and clone (no credential in `.git/config`), a repository's skills and plugins, Orbit Web's own sign-in (the setup code used once, passwords, the throttle, rotation, CSRF, sign-out, trial mode and its refusals) and its gate over every route the application declares, AI connections (each account's own home, methods, status, one identity per account, disconnect), a Stop that comes before Claude Code was started (the run interrupted, nothing started) |
| web | `apps/web/src/**/*.spec.tsx` | the sign-in and setup pages, AI Connections (what each connection can be used for), the Office (activating an empty company, Leadership and the floor's managers, execution defaults, the five-step Hire with its budget, Assign to an employee, a department or the CEO with who is responsible, the busy answer and a changed target, Work, a mission's tree, who is responsible now, questions and their route, shares and their revocation, handoffs by revision, review on the root only, hand over and repin, Needs me, Schedule, an employee's role, grants, sandbox and resources), Compute & storage (observed use), Employee network access, the workspace (sidebar, a new session and its pickers, the app stream), an open chat (streaming, tools, Stop, the plan card), Settings (connectors and their device sign-ins, Code, Skills, Plugins), the diff and the Orbit panel; governance: the account's overview, its policy edited, reviewed and confirmed by its owner (the risk acknowledged above low; its delegation to departments and each rule's binding), Departments and each department's policy (rows against the company's, drafts within the delegation, publication against the company revision read, rollback, simulation), Workspaces and Research with their overrides, approvals, decisions, audit, findings, reports, and Push asked for and approved by the chat's owner; research: the kind chooser, the sidebar's kinds and filter, the three panels at each width, selection, uploads, citations that open their passage, notes, the stream folded without doubling |
| accounts | `apps/api/tests/integration/{accounts,identity,trial,database}.spec.ts` | local accounts and users, each account's own chats through every route under one, an account id in a request never deciding, sharing by username or verified email and what only an owner does, a run token never a person, the model catalog per account's connection; every table carrying its account (read from the database's catalog), the system account, the fresh start and `db.js reset` |
| office | `apps/api/src/contexts/**/*.spec.ts`, `apps/api/tests/integration/office*.spec.ts` | the Office end to end over HTTP on PostgreSQL, with a fake sandbox provider and a scripted CLI that calls the real tool endpoint: hire, assign (claimed, queued, busy, replayed), hand in, request revision, accept, the next work from the desk; stale versions and handoffs refused; pause, cancel, a question and its answer, a model plane reporting a tool it was not given, two claims of one employee at once, a lost lease recovered once, unschedulable then admitted, schedules and deliveries, a research mission's claims checked by quote, a connection disconnected mid-attempt; a team's plan, its waits, its room and the lead's review; every employee's desk listed, looked into (each look recorded, never what it holds) and cleaned up -- refused while its employee holds work, at a stale version or once it left; admission fairness, the state machines and the runtime adapters as pure rules |
| sandbox | `apps/api/tests/sandbox/sandbox.spec.ts` (`npm run test:sandbox -w @orbit-web/api`, needs Docker and the three employee images) | an attempt in real containers: limits applied (`docker inspect`) and observed (the cgroup files) and behaving (an OOM kill, a fork loop stopped), storage refusing a write past its quota (or said to be measured only, with why), the connection's login and another employee's desk invisible from the tool plane, no way out but the proxy, removal read back; a desk looked into by a storage worker -- its links listed, never followed -- and cleaned only with no workspace left, at its version |
| research | `apps/api/src/modules/research/**/*.spec.ts`, `apps/api/tests/integration/research*.spec.ts` | PDF, Word, HTML, Markdown and text read (pages, headings, encodings, a scanned PDF, a ZIP bomb), chunks and their places, what is refused (type, size, names, paths), URL import and SSRF (loopback, metadata, private ranges, IPv6 carrying IPv4, redirects, DNS answers, a drip-fed head), revisions and retries; retrieval only from the selected sources; the run's profile (no tool), a tool reported or used, prompt injection kept as data, secrets masked, citations verified and opening their passage, notes and findings, governance untouched, accounts kept apart through every research route, stop and restart interrupted and never run again |
| Docker | `tests/docker/smoke.mjs` | the image builds, starts beside the pinned PostgreSQL (its role not a superuser, pgvector enabled), refuses to start without a database and keeps nothing elsewhere, serves, holds the four programs, a loadable plugin and the Azure Repos credential helper, opens on Orbit Web's own sign-in with every other route closed, sets the first administrator up with a code from its terminal, and persists the state and the session across restarts |
| governance | `packages/governance-core/src/*.spec.ts`, `apps/api/tests/integration/governance-*.spec.ts`, `apps/api/src/runner/*.spec.ts`, `apps/api/src/infra/egress/*.spec.ts` | the decision, lifecycle, impact, approvals, audit chain and auditor as pure rules; the account's owner publishing alone, overrides that only narrow, a published revision immutable in the database, accounts kept apart through every governance read and export, concurrent audit appends keeping the chain; chat and research runs decided under the account's policy, the gateway and pushes to GitHub (a local remote) and Azure DevOps; the runner, the isolation check and the egress proxy |
| security lab | `tests/security-lab/run.mjs` | the governed deployment for real (Docker, beside its PostgreSQL): the 22-step demonstration -- a browser signed in through Orbit Web's own flow as the account's owner, its policy tightened and confirmed by that owner alone, an override, a push approved once, a restart, a sign-out -- and ten attacks from the agent's own container (its policy, the account's owner, the database, the audit record among them), each verdict read outside the agent; results in `results/0.8.0` |
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
