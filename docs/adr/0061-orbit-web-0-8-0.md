# ADR 0061 — Orbit Web 0.8.0: its own accounts as the boundary of every record, AI connections and governance per account, a Claude Code workspace, research, and a virtual office of AI employees in sandboxes of their own

## Status

Accepted (Orbit Web 0.8.0), 2026-11-20 to 2026-11-23, the owner's decisions -- the specification "Orbit 0.8.0 — the
virtual office" and its review notes, the tasks for the workspace, research, governance and PostgreSQL, and the answers
given while 0.8.0 was built, verified and deployed, quoted where a decision rests on one -- stated here once, as they
stand ("consolidate all of 0.8.0 into one single ADR, since this is the first version"). Numbers in parentheses name
sections of the Decision.

For Orbit Web only: nothing under `src/`, `cli/`, `skills/`, `hooks/` or `agents/` of the plugin changes, the plugin
stays 0.6.0, and its archive is unchanged (`integrations/` is export-ignored). It amends ADR 0060 (Orbit Web 0.7.0):

- **Replaced**: the one `claude auth login` of the whole instance -- Orbit Web signs people in with accounts of its own
  (1) and each account connects its own AI CLIs (3); the access token's rule -- optional beyond loopback (1); the one
  permission mode (`dontAsk` with an allow-list) -- Autonomous and Plan, with `--strict-mcp-config` only in the governed
  deployment (4); "one container, said plainly" -- two deployments (7), a run's own sandbox (4) and an attempt's two
  containers (8).
- **Amended**: the Orbit plugin loads only where the account's owner approved it (3); "Let Claude Code use this Azure
  sign-in" is the owner's privileged switch, decided by the policy (6); beside Docker a person needs PostgreSQL and, for
  AI employees, the allocator and its images (2, 8, 11).
- **Kept**: every program a file and an argument list, no endpoint taking a command; GitHub CLI's and the Azure CLI's
  device sign-ins, the installation's; Orbit decides what Orbit decides, and a protected boundary of the plugin is
  shown, never granted; changes read from git; a restart resumes no run; the pinned image; the two scoped workflows.

## Context

1. Orbit Web 0.7.0 held one Claude Code CLI signed in for the whole instance: whoever reached the API worked as that
   account, in one container beside the sign-ins, the database files and the agent's shell. A chat needed a GitHub
   repository and ran in one permission mode; the records were two SQLite files.
2. The owner wants a person to sign in to Orbit Web and be in their own account -- its chats, research, office and
   governance, nothing of another's -- and an office: hire AI employees (a CLI, a model, an effort), give them work, let
   each work in a place of its own, review what they hand in, ask for a revision or accept it.
3. Anthropic's terms ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)): a product may not
   offer Claude.ai login or "collect, store, or intermediate Claude.ai credentials or session tokens"; products use API
   keys or a cloud provider; an end user may sign the unmodified Claude Code binary in with their own subscription,
   including where a platform hosts it.
4. The CLIs, read from themselves (Claude Code 2.1.328, codex-cli 0.169.0, agy 1.5.14): `claude auth login --claudeai`
   prints a URL and asks for a code; `codex login --device-auth` prints a link and a one-time code, and `codex login
   status` names no ChatGPT account; `agy` has no sign-in command and no non-interactive mode with a closed tool set,
   and Antigravity's terms do not permit its Google sign-in from another product. Claude Code takes an image headless
   only inside a stream-json user message, and answers its control protocol (`initialize`, `mcp_status`) calling no
   model.
5. Documents, screenshots and an office's work may be confidential; storing them on the server does not keep them from
   the model's provider.

## Decision

### 1. Orbit Web's own accounts, and one gate

- **An account is a tenant; its id is the OrbitId.** Orbit Web signs a person in with ITS OWN login -- a username and a
  password, independent of every AI CLI -- in each browser, and opens on nothing else; signing in starts no provider's
  login, and an AI CLI's login opens nothing. The user signed in is the account's OWNER (the one role). The Office,
  research sources and governance work with no AI connection; a chat, a research question and an employee's work need
  one, and say where to connect it.
- **The first administrator**, and each further account (`--purpose=new_account`), is made with a one-time code a
  terminal of the server prints (`cli/governance.js owner setup-code`): kept only as its hash, 30 minutes, used once (of
  two browsers, one wins); with it a person chooses a username and a password and gives their full name, their
  company's name and its time zone. A test installation set up again after every reset may name a STANDING code
  (`ORBIT_WEB_SETUP_CODE`, 8-64 characters, unset by default): shown filled in while nobody is set up, it makes the
  first administrator alone, in the same advisory-locked transaction as a printed code, and nothing once one exists; it
  is never stored, Orbit Web warns at start that it is set, and the audit record says when it was used. The TRIAL
  (`ORBIT_WEB_TRIAL=1`, `compose.trial.yaml`) seeds `admin` / `123456` once, shows a red bar on every page until the
  password changes and records every start in trial mode; its password being public, Orbit Web refuses to start in
  trial mode unless only this machine can reach it (loopback host names, no access token, the single deployment, no
  public origin, no Secure cookie) and names what failed.
- **Passwords** have at least 12 characters, never contain the username, and are not one or two characters repeated, a
  keyboard or number sequence or one of the commonest; they are scrypt hashes (N = 2^17, r = 8, p = 1, a salt each; no
  Argon2id: no built-in, no native dependency); `owner reset-password` prints a one-time code that sets a new one. Every
  attempt is counted -- against the username typed, whether anybody has it, and the client's hashed address -- BEFORE
  the password is checked: a few are free, then a delay that doubles (429 `too_many_attempts`, `Retry-After`) and a lock
  that grows; which count held an attempt back, and whether the username exists, is never said.
- **A browser's session** is an HttpOnly, SameSite=Strict cookie (Secure with `ORBIT_WEB_COOKIE_SECURE=1`) kept only as
  its hash, new at every sign-in, lasting `ORBIT_WEB_SESSION_HOURS` (168) and ending after
  `ORBIT_WEB_SESSION_IDLE_HOURS` (24) unused, with a CSRF token every change carries. A new password ends the user's
  other sessions; Settings → Account lists them and has *Sign out everywhere*; a terminal has `owner revoke-sessions`
  and `revoke-sessions --account=<id> | --all`.
- **One global gate**, before any program runs. Public: `GET /api/health`, `GET /api/auth/status`,
  `POST /api/auth/login|setup`, `POST /api/access` (token mode) and a shared chat's `GET /api/shared/<token>`. The AGENT
  DOORS, declared once (`AGENT_DOORS`: the chats' gateway `/api/agent/…`, the employees' tool endpoint
  `/api/runtime/tools/…`), take a run's own token and nothing else; neither the Host allow-list nor the access token
  applies there, a run reaching them by Orbit Web's name on its own network. A run token anywhere else is refused and
  recorded. Every other route needs a live browser session, and a change its CSRF token, the `X-Orbit-Web` header, a
  matching `Origin` and a JSON body of at most 256 KB -- but for exactly two raw uploads, a research source and a chat
  image, each on its one route. Routes are matched on the routed path, case-sensitively; one added later is closed
  unless marked public. No request names its account: it is the session's, and another account's record is not found
  (404), never forbidden.
- **The accounts are the gate; an access token is a perimeter** ("entering just the account and the password should be
  enough"). Beyond the loopback names, the host names `ORBIT_WEB_ALLOWED_HOSTS` adds are answered with or without
  `ORBIT_WEB_ACCESS_TOKEN`. Set, the token (at least 16 characters) is asked before the sign-in page, traded once for an
  HttpOnly cookie kept 30 days, or taken from an access link (`#access=<token>`, read from the fragment and removed from
  the address bar before anything else reads the URL) that Settings → Account offers: a perimeter before the sign-in,
  never in its place. The trial answers loopback names alone.
- **No AI credential of the server's own.** `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`
  are given to no program, and Orbit Web says, by name and never by value, that they are ignored. The image names no
  `CLAUDE_CONFIG_DIR`: every AI CLI process is one connection's, with that connection's home (3).
- **Sharing** names other users of this Orbit Web -- by username, or by an email the user verified -- who read a chat
  or a research workspace and carry on with it as themselves. Only its owner deletes it, shares it on, makes a public
  link or governs it; sharing has no read-only level and gives no governance, and a run in a shared record is decided
  under the record's own account.

### 2. PostgreSQL, one initial schema, and the account as the boundary of every record

- **One PostgreSQL database, required.** `ORBIT_WEB_DATABASE_URL` (or `_FILE`) names it; one that cannot be reached or
  migrated stops the start, saying what is wrong, and nothing falls back to SQLite or memory. Its URL is never printed
  and reaches no program Orbit Web starts; Orbit Web's role is never a superuser; the compose files run the pinned
  `pgvector/pgvector` image on an internal network only Orbit Web joins, never an agent's container. Four schemas --
  `app`, `research`, `governance`, `workforce` -- are reached through the connection's search path.
- **One initial schema.** 0.8.0 is Orbit Web's first PostgreSQL release: ONE initial migration, remembered in
  `orbit.schema_migrations` with the SHA-256 of its text and applied at start under an advisory lock (`cli/db.js
  status|migrate|verify` from a terminal); one that changed after it was applied, or a database a newer build migrated,
  is refused at start. Nothing a development build made is upgraded: while 0.8.0 is unreleased a schema change edits
  the initial migration in place, and an installation of a development build starts afresh -- `db.js reset
  --confirm=<database> [--with-data]` (refused unless it names the database) or `docker compose down -v`, as Orbit Web
  says when it refuses such a database. Release candidates are no exception: 0.8.0-rc02 edited the initial migration
  in place, so an rc01 database is refused the same way and nothing of it is migrated (the owner's decision). Nothing of
  an earlier Orbit Web is read, imported or deleted: neither its SQLite files nor the Claude CLI's sign-in in
  `/data/claude`.
- **pgvector is enabled, and nothing stores a vector yet** ("just enable pgvector; no need to integrate it yet"): the
  image's init script runs `CREATE EXTENSION vector` as the database's superuser, and every start checks it. Embeddings
  and semantic retrieval are a later step.
- **One `Db`, asynchronous.** `pg` (an exact version) behind a bounded pool with connect and statement timeouts. A
  transaction holds ONE client for its whole life and travels with the async context (AsyncLocalStorage), never in a
  variable concurrent requests share; one begun inside another is a savepoint. What a change tells the rest of Orbit
  Web -- an event to a stream, an app-stream notice -- runs AFTER COMMIT, never for work rolled back, and a callback
  that fails then is logged and changes nothing.
- **Concurrency by design, not by a single writer.** Journal numbers come from an `UPDATE … RETURNING` of the session's
  own counter in the change's transaction; a source's revision numbers from a counter on the source; policy revisions
  from a locked head row; an audit record from its chain's head row locked `FOR UPDATE` -- one chain per account and one
  for the deployment, so accounts never wait for each other; an approval moves only by compare-and-set, and one action's
  approval is asked once under an advisory lock on its fingerprint. A stream replays a journal by SUBSCRIBING FIRST,
  reading up to the journal's head and then sending what it buffered beyond it: an event written meanwhile is neither
  lost nor sent twice, and one chat's events arrive in the order of their numbers.
- **The account is the boundary of every record.** Every table carries `account_id uuid NOT NULL` with a foreign key
  toward `app.accounts` (a test reads `information_schema` and holds it) -- except `app.accounts` itself and
  `orbit.schema_migrations` -- and every child is held to its parent's account by a composite foreign key, so a
  message, a passage or a citation cannot belong to another account's chat, revision or workspace whatever the code
  above does.
  The deployment's own records (its capacity, settings and audit chain) belong to a reserved SYSTEM account that never
  signs in. App-stream notifications name their audience when published (the account and the users a record is shared
  with), so a deletion notice still reaches the right pages. Background work uses the account its records name, never
  whoever asked last. A level between the account and its records (departments of accounts, members) would be additive.

### 3. AI connections, each account's own

- **Each connection, a home of its own.** An account connects Claude Code, OpenAI Codex and Google Antigravity
  (Settings → AI Connections) -- several of one CLI if it likes, labelled, one the default. Each connection's CLI keeps
  its login and state in `/data/connections/<OrbitId>/<connectionId>/` (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
  Antigravity's settings), written by that CLI alone, mounted only where that connection runs (its model planes, its
  runs' sandboxes, and the governed deployment's one agent container (7)), never into an employee's tool plane, never
  read for another account's work. A provider identity is connected to ONE account at a time
  (`identity_already_connected`). A change is a signed-in person's of the account, decided by the policy
  (`connection.manage`) and recorded.
- **Methods**, each showing the provider's words it rests on: a SUBSCRIPTION, signed in by its owner with the
  unmodified official CLI's own sign-in against that home; an API KEY (a Claude Console key; an OpenAI key, handed to
  `codex login --with-api-key` on stdin), typed once and kept in the control plane's credential store (one 0600 file
  each under `/data/control/credentials`, outside every mount, never in a home, an answer, a log or an event), given to
  that connection's process alone; a CLOUD PROVIDER for Claude Code (Bedrock, Vertex AI, Foundry), saved and shown
  *blocked* -- documented, not verified here, never used. Never accepted: a subscription token pasted by hand, a copied
  `.credentials.json` or `auth.json`, a setup token for anybody else's use. The hire step quotes Anthropic ("ordinary,
  individual usage of Claude Code and the Agent SDK" is what the Pro, Max and Ultra limits assume) and recommends an API
  key for employees.
- **A subscription is signed in from its card** ("clicking Add connection shows the link to sign in … as before"):
  *Add a connection* starts it at once, *Sign in* and *Reconnect* again. `POST /api/connections/:id/sign-in` runs the
  runtime's own sign-in (`claude auth login --claudeai`, `codex login --device-auth`) with that connection's home and
  environment -- what the terminal's `cli/connect.js` runs -- as one process (`LoginFlow`); the page follows it: the URL
  the CLI printed, Codex's one-time code (entered on OpenAI's page), and whether Claude Code waits for the code its page
  shows, which `POST …/sign-in/code` writes to that process's stdin and nowhere else; `…/cancel` stops it.
  - ONE BROWSER: only the browser session that started a sign-in sees its URL and code or sends a code (`no_sign_in`);
    another browser of the account sees that one is under way and by whom, may cancel it, and cannot start another
    (`sign_in_busy`). One per connection at a time; an ended one keeps its outcome alone, in memory, for ten minutes.
  - KEPT NOWHERE: no URL, code or token reaches the database, a log, the audit record or an event; the record says
    `ai_connection.<runtime>.subscription.sign_in_started` and `…signed_in_from_page`, with the connection and how it
    ended. The CLI keeps its login in the connection's home.
  - VERIFIED, NOT SAID: connected only when the CLI's own status names the identity, held to one identity, one
    account; exiting 0 proves nothing. A ChatGPT sign-in, which `codex login status` does not name, is named by `codex
    app-server` (`initialize`, then `account/read`, no token refreshed): the email and the workspace, whose id tells
    two workspaces of one email apart. Reconnect with the same identity stays connected; another makes it
    `identity_changed` -- who a connection is changes only by disconnecting it.
  - WHERE: Claude Code and OpenAI Codex subscriptions (`SIGN_IN_READERS`); never Antigravity, an API key or a cloud
    connection (`sign_in_not_offered`). Relaying the one-time code from the person's browser to the unmodified CLI's
    stdin is read as that person signing their own subscription in. The terminal command, which passes nothing through
    Orbit Web's pages, is always shown beside it; `ORBIT_WEB_SIGN_IN_ON_PAGE=0` leaves it the only way.
- **Status is the CLI's, never inferred**, read against that home: *Installed* or *Not installed*, *Connected*,
  *Disconnected*, *Authentication required* (signed out, expired, or another identity than the one linked),
  *Connection error*; *Re-check* asks now. *Disconnect* runs the CLI's own logout and removes the home's login: the
  attempts running on it stop and their work is blocked saying why, a retry while it is disconnected starts no CLI, and
  nothing switches to another provider by itself. A connection an employee runs on cannot be removed.
- **The models and efforts are the account's**, asked of the connection's own CLI at every sign-in and Re-check:
  Claude Code's over its control protocol (one `initialize` request, restricted, no tool, no model call), OpenAI
  Codex's from its app server's `model/list` (failing that, the catalog bundled in the binary), none for Antigravity.
  Every choice is held to them: an effort a model does not take moves to one it does, and a model that takes none is
  passed none. A fallback list is labelled, holds a choice to its shape alone, and never serves an employee. A card
  also shows the runtime's capabilities as observed and whether an employee can run on it, and why not (8).
- **The Orbit plugin** loads only for the use cases the account's owner approved (chats, employees) and only for the
  exact DIGEST the page showed -- the SHA-256 of every file of the parts Claude Code loads and runs, never through a
  link -- so an upgraded plugin waits for its owner again (`plugin_grants`).
- **Claude connectors, checked per account** ("add a place where the user sets which connectors are used, with
  checkboxes, that can grow later"). Settings → Claude connectors lists what the default Claude Code connection may use
  -- its claude.ai connectors (Claude Docs, Gmail, Drive …) and its installed plugins' MCP servers -- as its CLI
  reports them (`mcp_status`, no model called), each with a box for chats and one for research, kept per account and
  checked until unchecked. Unchecked, it is denied by name in every mode; checked, it is still a decision of
  `tool.connector` when a run starts (6).

### 4. The Claude Code workspace

- **Laid out like Claude Code** (web only), open once signed in: a sidebar (New session, Search, the account's chats
  and research sessions, the Office, Governance), ONE composer at the bottom, Settings as a dialog over any view.
- **A chat runs with or without a repository.** With none (the default), its workspace is an empty repository of its
  own (`git init -b main`, one empty commit, the account's email as the local identity, Orbit seated in it), so
  Changes, the Orbit panel and resuming work as for any chat. Either way it works on a branch of its own
  (`orbit-web/<id>`), so the branch picked is never written, and its repository is fixed for its life.
- **Two sources, behind one interface** (`modules/sources/`): GitHub and Azure DevOps, each listing repositories and
  branches and cloning one. A repository is named back by its source and the id that source listed it under, and opens
  only if that source lists it; its clone URL comes from the listing, never a request. GitHub clones with `gh repo
  clone`. Azure DevOps is read with `az rest --resource 499b84ac-1321-427f-aa17-267ca6975798` (the Azure CLI holds the
  token): the profile, up to 50 organisations four at a time, their enabled repositories and a repository's branches,
  kept five minutes. Its clone names the image's helper alone (`-c credential.helper= -c credential.helper=…`), and
  `docker/git-credential-azure-cli.mjs` answers git's `get` for `dev.azure.com` and `*.visualstudio.com` only, asking
  the Azure CLI (Orbit Web's profile) for an Azure DevOps token -- THE ONE PLACE A TOKEN IS ASKED FOR: from az to git
  for that clone, never through Orbit Web's process, never written, nothing in the remote URL or `.git/config`, no
  helper for Claude Code. Both CLIs' sign-ins are the installation's.
- **The AI first, then model · effort · mode, in the CLI's own words.** A chat runs for its whole life on the
  connection chosen -- else the default Claude Code connection, else the account's first chat connection (Settings'
  `defaultRuntime`; an AI not signed in is a 409 naming where to sign it in, and with none no model is offered) -- its
  model, effort and mode held to THAT connection's catalog (3), each checked against its closed list and passed as
  typed (`--model`, `--effort`, `--permission-mode`): no dated model id is written anywhere, and a model an account
  cannot use fails with the CLI's own error. Defaults (Settings → Code): Sonnet 5.5, Medium, Autonomous; a change
  applies from the chat's next message.
- **Two modes, and no third.** AUTONOMOUS is Claude Code's auto mode (`--permission-mode auto`): reads and edits in the
  workspace go ahead, and its classifier reviews every other action. PLAN is its plan mode (`--permission-mode plan`):
  read and plan, change nothing; the denied `ExitPlanMode` call's input becomes a durable `plan.proposed` event
  (bounded, redacted) and a Plan card whose *Run it in Autonomous* switches the mode and asks Claude to carry the plan
  out, in the same conversation. No chat runs in `dontAsk` or any bypass mode.
- **What Claude Code may do changes with the mode.** In Autonomous it creates, edits, renames and deletes files in its
  workspace and commits on the chat's branch (checked with the real CLI and these arguments); the classifier may refuse
  a destructive command on files that existed before the session unless the person asked. The allow-list
  (`Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite`, whose bare `Bash` auto mode drops itself) and the deny rules
  stay on the command line, and the deny rules bind in every mode: `git push` and `gh` (unless GitHub's switch is on),
  `git credential`, a global git config, `az` (unless Azure's is on), and for the file tools every connection's home,
  GitHub's sign-in, the control plane's rooms and, unless its switch is on, Azure's. The workspaces are the image's
  user's, the programs and the plugin root's. What the policy does not allow, a run does not get: without
  `workspace.execute` no shell, without `tool.web` no web tools.
- **Autonomous reaches the internet as part of the work.** Its run carries the CLI's own auto-mode environment
  (`claude auto-mode defaults`) with *Network posture* (the public sources a task needs are ordinary work; probing
  unrelated endpoints -- request-capture, paste and file-sharing sites, tunnels -- is still reconnaissance) and *Host
  containment* (a container that keeps the CLIs' sign-ins, never to be read or sent) replaced; no allow rule lets a
  network command past the classifier. `WebFetch` and `WebSearch` are on by default, never pre-approved.
- **Commit always; push and open pull requests when the owner allows it.** One of two fixed sentences appended to the
  system prompt, written by nothing a request or a repository said, tells Claude Code what the workspace allows: it
  commits locally and never chains a refused push into another command. *Let Claude Code push and open pull requests
  with this GitHub sign-in* (`githubForClaude`, off by default) gives a chat whose repository came from GitHub, and no
  other, GitHub CLI's configuration (`GH_CONFIG_DIR`, never a token variable) and a credential helper for
  `https://github.com` alone (`GIT_CONFIG_*`: `gh auth git-credential`; no git configuration file written): `git push`
  and `gh` leave the deny list, while `gh auth`, `gh api`, extensions, aliases, gh's configuration, workflows, runs,
  releases, gists, secrets, variables, keys, codespaces, the organisation, rulesets, caches, deleting, renaming,
  archiving or editing a repository and `git credential` stay on it (an allow rule never carves an exception out of a
  deny rule), and the sentence says to push the branch it works on and open a pull request, never force-push, never to
  the default branch -- rules on the command as written, not a wall. *Let Claude Code use this Azure sign-in*
  (`azureForClaude`) lets its `az` act as that account, told to read Azure DevOps with `az rest`. Both are privileged
  (6).
- **What a repository brings, read on its first fetch.** A last workspace step reads its files only -- regular files,
  never through a symbolic link (every path component checked), bounded (200 items a kind, 256 KB a file, 4 levels,
  2,000 entries a directory): `.claude/skills/*/SKILL.md`, `.claude/commands/**/*.md`, `.claude/agents/*.md`,
  `CLAUDE.md`, `.mcp.json` (its server names), from `.claude/settings.json` only `enabledPlugins` and
  `extraKnownMarketplaces`, and `.claude-plugin/plugin.json` / `marketplace.json`.
  - *Load project skills* (on by default: instructions run nothing by themselves) copies the skills, commands and
    agents into a plugin of the chat's own (`/data/sessions/<id>/project-plugin/`), loaded with `--plugin-dir` AS
    INSTRUCTIONS ONLY: frontmatter rebuilt from `name`, `description`, `model` and `argument-hint` (no `hooks`, no
    `allowed-tools`), every pre-run `` !`command` `` (and a fence opened with `!`) made plain text, a file whose
    frontmatter never closes left out.
  - *Run project plugins* (off by default, and privileged: a plugin is code -- hooks at session start, MCP servers --
    beside the run's sign-ins) loads a repository that is a plugin, or a marketplace of local plugins, with
    `--plugin-dir`, and installs a declared one once (`claude plugin marketplace add`, `claude plugin install --scope
    user`, then `claude plugin disable --scope user`, uninstalled again if disabling fails), enabled for that chat's
    runs only (`--settings '{"enabledPlugins":…}'`); off, each is *Not run*.
  - Every state is an event (`project.inventory`, `project.plugin`); a failure never fails the workspace. Claude Code
    reads `CLAUDE.md` itself; the repository's other settings, hooks, `env` and `.mcp.json` servers are never loaded
    (`--setting-sources user`: its `env` could send the credential elsewhere, its hooks run before any tool call).
- **A chat reaches the account's connectors** ("turn it on for every chat": Claude makes its documents through the
  claude.ai connector Claude Docs, and no MCP config can declare one alone): it runs without `--strict-mcp-config`,
  reaching its connection's connectors and the MCP servers of the user's settings and of the plugins loaded, as far as
  Claude connectors and the policy allow (3, 6). A repository's `.mcp.json` stays unstarted.
- **A chat on OpenAI Codex** runs `codex exec --json` in its workspace with that connection's `CODEX_HOME`, nobody's
  configuration (`--ignore-user-config`, `--ignore-rules`), no MCP server (`mcp_servers={}`) and none of Codex's apps,
  plugins, hooks, browser or desktop tools; each message resumes the thread the first started. Its commands run only
  where something holds them: in a run's own sandbox (below) the container does; elsewhere, where Codex's own sandbox
  starts (`codex sandbox -- true`, asked once), a permission profile lets them read the system and nothing of Orbit
  Web's data but the chat's own room (written in Autonomous, read in Plan), with no network and no explicit
  `--sandbox` (on codex-cli 0.169.0 one beside the profile let a command read the denied path); where it cannot, the
  chat gets no shell and says so. `ORBIT_WEB_MAX_BUDGET_USD`, a cap Codex cannot be held to, refuses its runs.
- **Each run in a sandbox of its own, where the allocator is** (the single deployment's default,
  `ORBIT_WEB_SANDBOX=container`): every chat's and research question's CLI starts in a container made for that run
  alone -- Orbit Web's image and runner, as Orbit Web's user, read-only, no capability, limits of its own
  (`ORBIT_WEB_SESSION_SANDBOX_CPU` / `_MEMORY` / `_PIDS`: 1 vCPU, 2g, 1024), on a network whose only other member is
  Orbit Web -- holding the chat's workspace (read-only for a Plan run on Codex) and project room, the connection's
  home, the account's Orbit store, the installation's GitHub or Azure sign-in only where the account turned that switch
  on, and nothing else; a research run holds its connection's home alone. The allocator works the mounts out from ids
  and removes the container when the run ends, however it ends. At most `ORBIT_WEB_SESSION_SANDBOX_MAX` (4) run at
  once, one beyond waiting and saying so; an allocator named and unusable refuses runs, never silently dropped.
- **Images go with a message** ("add copying images into the chat: take a screenshot, then paste it into the chat"),
  uploaded first as their own bytes (`POST /api/images`), read as what their first bytes say -- PNG, JPEG, GIF or
  WebP, never SVG -- and held to Claude's own limits (6 a message, 5 MB, 8000 pixels a side); each is kept as
  `/data/app/images/<id>` (the control plane's room), named by the server, the uploading account's. A message names
  only its sender's unsent uploads, which go with that one message and are read back only through its chat (`nosniff`,
  `default-src 'none'`). Claude Code's run takes `--input-format stream-json` and one user message on stdin (the words,
  then each image as base64), a Codex run files beside the workspace; events and logs keep an image's id and kind,
  never its bytes. A shared snapshot drops them, an unclaimed upload is swept after a day, a chat's images go with it;
  research takes none.
- **Event-driven streams.** `packages/contracts/src/events/catalog.ts` is the one list of the events there are: each
  type, its stream (`session`, `app`, `research`) and whether it is stored, in one envelope `{ id, type, stream,
  sessionId, seq, runId, at, data }`. One event bus refuses a type the catalog lacks or a stream it does not travel on,
  stores what is durable BEFORE delivering, and hands each event to its subscribers (a throwing one is logged, the
  others still served). One gateway serves a chat's stream (`GET /api/sessions/:id/events`, replayed after
  `Last-Event-ID`, a message being written sent whole) and the app stream (`GET /api/events`: notifications only -- the
  sidebar's chats, GitHub's and Azure's device sign-ins, the customizations -- never stored; a page that reconnects
  reads the read models again). Adding an event is a catalog row and its payload type.
- **Around the conversation.** A run stopped before its CLI started never starts it. The working branch moves only
  between runs, never to the default branch or over uncommitted work. A shared chat is a read-only snapshot
  (`#/share/<token>`, 32 random bytes in the fragment) of the conversation alone, every text masked again.

### 5. Research

- **A domain of its own, not a chat**: schema `research`, its journal (`research_events`), routes (`/api/research/...`)
  and stream kind (`research`), and no record of a chat -- no repository, branch or workspace on disk. A WORKSPACE owns
  what lasts (sources, notes, findings); a SESSION one conversation over the sources it selects (kept per session); a
  RUN answers one question, on the account's default Claude Code connection.
- **A conversation with references** ("research, like chat, only references the data"; "I want a prompt alone to make
  it write a Claude artifact and give back the link"): the passages retrieved for a question are reference material --
  a statement resting on one cites it, Claude says what comes from elsewhere, a question needs no source -- and stay
  untrusted data, never instructions.
- **Sources are stored by the server and read in a worker.** An upload is the file's own bytes on its one route, at
  most `ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB` (25), and is what its bytes say it is; pasted text is a source too. A URL is
  fetched by the server as a SNAPSHOT (`ORBIT_WEB_RESEARCH_URL_IMPORT=off` refuses URLs): http(s) on ports 80 and 443,
  every address its name resolves to checked against the one definition of the public internet (the egress proxy's
  `forbiddenAddress`, which also refuses IPv6 ranges carrying an IPv4 address), the connection made to the address
  checked, each redirect (five at most) checked again, an absolute deadline, at most `ORBIT_WEB_RESEARCH_MAX_URL_MB`
  (10), no cookie, credential or proxy. Files live under `/data/research/workspaces/<id>/objects/` by their SHA-256,
  written whole and renamed; nothing a client typed becomes a path. PDF (unpdf, page numbers kept; a scan is said to
  have no text -- no OCR), Word (a bounded in-memory ZIP reader), HTML (parse5), Markdown and text are read in a worker
  thread with a time and memory bound, chunked without crossing a page and anew at each heading -- two pure-JavaScript,
  pinned dependencies. A revision is immutable; a URL fetched again makes a new one only when its bytes changed, and a
  failed refresh leaves the source `stale` on its last snapshot.
- **Retrieval is the server's, from what the session selected alone.** A passage is indexed as a `tsvector` of its
  text with its diacritics folded by Orbit Web (so "ro ri" finds "rò rỉ"), English words stemmed, no stop word
  dropped. A question's evidence is frozen first: the revisions the selected sources are indexed at, and passages from
  them alone, ranked by `ts_rank_cd` (a full-text rank, not BM25), ties broken by place, the sources' openings added
  when few match, within `ORBIT_WEB_RESEARCH_CONTEXT_CHARS` (24,000). Every query names the account, the workspace and
  the pinned revisions in SQL; no source selected searches nothing; a selection changed during a run changes the next.
  A `Retriever` interface lets another engine replace it.
- **A research run has no built-in tool**: its own command line (`researchArgs`) -- `--tools ""`,
  `--disable-slash-commands`, `--no-session-persistence`, `--permission-mode dontAsk`, a fixed system prompt, the model
  and effort from the connection's catalog. With no connector checked for research it is also `--restricted` (no
  settings file: nobody's hook, plugin or permission rule) and `--strict-mcp-config`; with some, it reads the user's
  settings source (the only one the account's connectors come with), the checked connectors allowed by name and the
  rest denied by name, and its prompt says a connector is used only when the person's own message asks, never because
  a passage or a tool's answer says to. The question, the conversation so far (labels stripped) and the passages go in
  on stdin, the passages between tags carrying a random value made for the run, so no document can close them. A
  process that reports a built-in tool, or reaches for a tool or connector research may not use, is killed and the run
  fails as refused. Each run is answered fresh (no `--resume`): nothing of a document piles up in a transcript.
- **Citations are the server's.** The model may only write a passage's label (`[S3]`); a label found among the
  passages the run was given becomes a citation -- the source, the revision, its place in the extracted text and a
  masked copy of the passage, from the server's own record -- and any other is removed and named as rejected. A
  citation outlives its session (when a note or a finding refers to it) and its source (it keeps its copy).
- **Notes and findings are a person's.** A finding moves draft → needs review → reviewed | rejected, and back to
  draft; words changed after a review make it a draft again; its words are its writer's or the workspace owner's, its
  review anybody's the workspace is open to. `reviewed` is not an approved policy: nothing in research writes to
  governance (a test counts governance's rows before and after).
- **Deleting** a session removes its conversation and runs; a source, its text and, once no revision stores the same
  bytes, its file (citations keep their copy); a workspace, after its owner types its name back, everything -- refused
  while one of its sessions answers. A run a restart cut short is interrupted, never completed, never run again.

### 6. Governance: the account's policy, decisions, approvals and audit

- **The rules are a package of their own.** `packages/governance-core` -- no dependency, clock, HTTP or storage --
  holds the action vocabulary, the policy and its validation, the ONE deterministic decision function, the revision
  lifecycle, impact analysis, approvals bound to fingerprints, the audit envelope and hash chain, the auditor and the
  daily report; the API binds them to its stores, routes and clock, so another agent runtime would be held to the same.
- **Every action says where it is enforced**: `boundary` (the container, the broker or the egress proxy: the agent
  cannot change it), `control` (the API's authorization), `runtime` (the agent runtime's configuration: defence in
  depth, never called enforcement) or `none` (nothing here can carry it out, so it is denied); only a boundary action
  may be reported PREVENTED. A CEILING per kind of principal caps what any rule may grant: nobody reads a raw
  credential (`credential.read_raw`) or changes an audit record (`governance.audit.modify`); modifying the policy,
  deciding an approval, a privileged setting and the office's management (departments, roster, hiring, an employee's
  resources and desk, the budget, connections) are people-only; for an agent a production action
  (`deployment.production`, `database.production.migrate`, `data.production.destroy`, all `none`) is at most one
  approval of exactly it, and the policy at most a draft it hands in (`governance.policy.propose`). `repository.push`
  has no ceiling: git is the policy's to decide for an agent as for a person.
- **The policy is a document over a closed set of actions** (canonical JSON, `orbit.governance/v2`, kind
  `AccountPolicy`; an override is a `PolicyOverride`): `agent.run.start`, `repository.read`, `repository.write`,
  `workspace.execute`, `tool.web`, `tool.connector`, `network.egress` (by `host:port`), `filesystem.outside_workspace`,
  `credential.read_raw`, `settings.privileged.write`, `repository.push`, `connector.write`, the three production
  actions, the policy's and the approvals' own, and the office's (`office.department.manage`, `office.roster.manage`,
  `employee.hire`, `employee.hire_assistant`, `employee.resources.change`, `employee.desk.read`, `employee.desk.clean`,
  `work.assign`, `work.delegate`, `artifact.publish`, `notification.send`, `budget.change`, `connection.manage`). A rule
  is `allow`, `require_approval` or `deny`; the default decision is `deny`, never `allow` (an action nobody thought of
  is not permitted); the strictest wins. Its OBLIGATIONS (`auditDecisions`: every decision or those not simply allowed;
  a daily report; isolation required or optional) and its employee network access (8) are part of it. The owner edits
  it as a table -- a row per action with *Allowed* and *A person approves first* (neither: denied), the reachable hosts
  as a list, the obligations as boxes -- and a rule the table cannot show is kept as written.
- **Each account starts with a PUBLISHED default** (revision 1, `policy.provisioned`, by the system, in the transaction
  that makes the account) fitting the deployment. In both: a run starts, reads, writes and runs commands in its
  workspace and reaches the model's own service (`api.anthropic.com`, `platform.claude.com`, `claude.ai`, port 443);
  files outside its storage and raw credentials are denied; privileged settings are a person's; a push and an
  employee's connector write wait for the owner's approval; production is denied; an agent may propose a draft and
  never modify the policy; the office's actions are allowed; employee network access is AUTONOMOUS. Two differ: the
  SINGLE deployment allows the web tools and the connectors and makes isolation optional (it can never be attested
  there, and requiring it would refuse every run); the GOVERNED deployment denies both and requires isolation.
- **Inheritance**: the deployment's mandatory limits (the ceilings, the actions nothing can carry out, no credential in
  the governed deployment, research without tools) ▸ the account's published policy ▸ an OVERRIDE of one chat or one
  research workspace, which only narrows (an `allow` in it changes nothing, and is said beside it). Loosening for one
  resource is a rule of the account's policy, through its whole lifecycle.
- **One owner publishes.** DRAFT → VALIDATED → PUBLISHED → SUPERSEDED, or DISCARDED. What a change does is worked out
  by asking both policies every question of the vocabulary -- every action, for every kind of principal, in every
  environment, about every resource either names -- never from their words: what it loosens and narrows, and its risk
  (HIGH for loosening a sensitive action, an obligation moved to its weak word, or employee network access moved from
  Restricted to Autonomous). The owner CONFIRMS the content's digest, the revision in effect it was compared with and a
  high risk by name; a revision or a policy in effect that moved since is refused, never overwritten. There is no
  second approver, on purpose: a confirmation is the owner's own, recorded as such, never shown as another person's
  approval. A published revision never changes -- the database refuses it too -- and a rollback is a copy published
  anew. *Simulate* asks a revision what it would decide and records nothing.
- **A department may decide for its own employees, within what the company DELEGATES.** The company's policy names
  what its departments may decide (`delegation.departments`: per action the loosest effect a department may give, a cap
  on the employees' network mode and allow-list and limits, a cap on the employees' models) and marks each of its rules
  MANDATORY (the default: it binds every department, strictest wins) or a DEFAULT a department's own rule may replace
  within the cap. A department's policy (`kind: DepartmentPolicy`, its own revisions in `governance.department_policy_*`)
  has the company's lifecycle -- draft, validate (422 `exceeds_delegation`), simulate, publish against the company
  revision read (409 `stale_company_policy` when it moved), history, a rollback published anew -- and applies ONLY to its
  employees' assignment runs: a chat, a research question and a person decide exactly as before. Each kind of rule keeps
  its own meaning (an allow-list narrows or replaces within its cap, a numeric limit only lowers unless delegated, a deny
  binds, an approval binds, a model list intersects downward; unset inherits, `[]` is none), and simulation answers with
  the very `evaluate()` enforcement uses. A manager (its department) or the CEO (the company, any department) may
  PROPOSE a draft through its tools; only the owner publishes. Every employee decides as ITS OWN principal
  (`employee:<id>`, with its assignment, mission and department at dispatch on the run's binding), never as a service
  standing in for it.
- **A decision is an audit record written before it is acted on** (as `auditDecisions` says); an unknown action, no
  published policy, an unverified principal and another account are denied. Every run -- a chat's, a research
  session's and an employee's assignment, in both deployments -- is bound and decided under its account's policy in
  effect before it starts (scopes `ACCOUNT_WORKSPACE`, `ACCOUNT_RESEARCH`, `ACCOUNT_EMPLOYEE`): `agent.run.start`, the
  resource's override, isolation where the policy requires it, and `tool.connector` for each connector its owner
  checked. Governance is a profile on the run, never a third mode.
- **A run's token is never a person.** Minted at the run's start and ended with it, it opens one door: a chat run's the
  AGENT GATEWAY (`/api/agent`: who it is, a decision, a push, its workspace's approvals, a draft of the policy), an
  employee attempt's the tool endpoint (8), a research run's neither (in the governed deployment, the proxy alone).
  Principals stay distinct -- the owner, an agent, the system, anonymous -- and an agent can never edit the policy,
  approve anything, change the account or turn a privileged switch on: every attempt is refused and recorded.
- **Approvals.** A protected action the policy does not simply allow waits in Governance → Approvals with exactly what
  it is and its FINGERPRINT (its row's parameters: for a push the repository, remote, ref, commit, force and where the
  remote's branch stood). Only a person decides it -- the database refuses any other decider, so a run never approves
  what it asked for. It is spent once, BEFORE the action runs, against the fingerprint taken again; anything that moved
  is refused and asked again; a replay, or an approval presented for another action, is refused and recorded.
- **Privileged switches**: turning on `githubForClaude`, `azureForClaude` or `projectPlugins` takes the owner's
  session and CSRF token and the policy's decision (`settings.privileged.write`); turning one off needs nobody; a
  request from anything else -- the agent's shell included -- is refused and recorded. The governed deployment refuses
  the two sign-in switches to everybody (7).
- **The push broker** carries a chat's working branch to GitHub or Azure DevOps, asked by the chat's owner (*Prepare
  the push* shows exactly what, and its fingerprint) or by the agent through its gateway. The commit is carried into
  Orbit Web's own bare copy of the repository with every object checked (governed: as a bundle the agent's git
  writes), the remote is asked where the branch stands, and `repository.push` is decided on exactly that: where the
  policy simply allows it, the chat's own working branch is pushed at once under that decision (another branch still
  asks); otherwise the owner's approval of the fingerprint is spent first. The push uses the source's own sign-in
  (GitHub CLI's helper, the Azure CLI's one-shot helper), never by Claude Code, never forced, never to the default or
  a protected branch, and is refused when the default cannot be established (`push-target.ts` decides alone); a story
  branch a chat started from, neither default nor protected, is pushed like any other.
- **The audit record**: one hash chain per account and one for the deployment -- records idempotent by id, refused any
  change or removal by the database, allow-listed per type (a credential pasted into a username is masked), checked
  whole at every start with the head said in the log, and on demand (`governance.js verify-audit [--account=<id> |
  --deployment]`). Never cascaded: deleting a chat or a research workspace records the deletion and leaves its records
  and a resource row naming it. Retention is indefinite. It is tamper evidence within its threat model, not proof
  against whoever controls the host and every copy of its head; the event bus carries only ids-only notices of it.
- **The auditor** works findings out from the record by rules -- `POLICY_DENIED_ACTION`, `REPEATED_DENIED_ACCESS`,
  `UNAUTHORIZED_POLICY_CHANGE`, `AGENT_PRIVILEGE_ESCALATION`, `APPROVAL_REPLAY`, `CROSS_WORKSPACE_ACCESS`,
  `CREDENTIAL_ACCESS_ATTEMPT`, `AUDIT_INTEGRITY_FAILURE` -- each CONFIRMED, SUSPECTED or INCONCLUSIVE and citing its
  records, and the daily report is the same fold over one UTC day, by hand or, when the policy asks, after the day
  ends; no model is asked. Every count, page and export is the account's own, filtered in SQL: its Workspaces,
  Research and Office, each resource with the policy that applies, its runs, approvals and activity, a deleted one
  still listed. The terminal's door is `cli/governance.js` (`status`, `verify-audit`, `owner …`, `revoke-sessions`,
  `budget`).

### 7. Two deployments

- **The single deployment** (`docker/compose.yaml`: `postgres`, `orbit-web`, `orbit-allocator`). Each chat's and
  research question's run is in a sandbox of its own (4); Orbit Web's own work in a workspace (the clone, Changes,
  branches, the Orbit panel) runs in Orbit Web's container, on the same disk. Governance holds at the API, and inside
  the sandbox the deny rules, auto mode's classifier and `--setting-sources user` are defence in depth. Isolation is
  never attested there, so a policy that requires it refuses every run; nothing calls a run isolated because its
  records carry an account. Without an allocator (development), a run starts in Orbit Web's own container.
- **The governed deployment** (`docker/compose.governed.yaml`, `ORBIT_WEB_DEPLOYMENT=governed`) runs the same image as
  two containers, beside the database (on a network only the control plane joins) and the allocator. The CONTROL PLANE
  (`orbit-web`) holds the API and the page, the database's credentials, the GitHub and Azure sign-ins, the credential
  store, its own bare copies of the repositories and the egress proxy. The AGENT container (`orbit-agent`) runs Claude
  Code and every program that touches a workspace through a RUNNER (TCP on an internal network, newline-delimited JSON
  in frames bounded at 4 MB -- a long stdin in several, never cutting a character in two -- a file and an argument
  list, signals to the group, killed when the connection ends). It mounts only the AI connections' homes, the
  workspaces, the sessions, Orbit's store and a home, and the repositories' copies read-only, on a read-only root with
  no capability and no Docker socket: no database, no governance record, no API key but in a run's own environment, no
  GitHub or Azure sign-in. Its network is internal: requests from it reach the agent gateway alone, public names do
  not resolve, and its only way out is the proxy, which decides each connection as the run whose token it carries,
  under that run's account policy (`network.egress`), never to an address off the public internet unless the
  installation names an internal range (`ORBIT_WEB_EGRESS_PRIVATE_ALLOW`).
- **The control plane never creates, writes, deletes or reads in a directory the agent can write** (a link planted
  there would resolve in its own mounts): the runner makes and removes directories, a workspace's project is read
  there, run logs move to the control plane's room (`/data/app/run-logs/`), and a credentialed clone or fetch goes into
  the control plane's bare copy, of which the workspace is a local clone.
- **An isolation check before every strict run**, recorded: canaries ask the agent's container whether the control
  plane's rooms are absent (research's included: a research run gets its passages on stdin, never a path), the shared
  ones present, the copies read-only, a direct connection and a public name refused, and the database out of reach --
  it must fail to CONNECT (`no_database`); one it can reach, or one behind a local socket the check cannot try, fails
  the check. No database variable reaches a child process.
- **What the governed deployment withholds.** A run reaches no connector (`--strict-mcp-config`, and
  `ENABLE_CLAUDEAI_MCP_SERVERS=false` behind the proxy); the GitHub and Azure switches are refused, so a push is the
  broker's; a repository's declared marketplace plugins are not fetched (their install runs outside any run and has no
  way out), while its skills, commands and agents still load. A connection's sign-in runs in the control plane, from a
  terminal of the server (3).

### 8. The virtual office

- **Bounded contexts, one write path each** (`apps/api/src/contexts/{workforce,work,execution,shared}`, each with a
  pure TypeScript `domain/` -- a test reads its imports -- and `application/`, `infrastructure/`, `presentation/`;
  `integrations/orbit-web/docs/office.md` draws them, their events and states). WORKFORCE: the office, departments,
  employees with their profile and resource revisions and Personal Sandbox. WORK: missions, assignments, handoffs,
  *Needs me*, team rooms, schedules, deliveries. EXECUTION: runs, admission, the worker, the tool endpoint, artifacts.
- **Four things, never one word**: a MISSION is what a person wants done, an ASSIGNMENT one employee's responsibility
  for it, a RUN one attempt, a HANDOFF one result. An employee holds at most ONE assignment (the RESERVATION: a primary
  key per employee, a deferred constraint trigger holding "holding state ⇔ reservation" at commit). *Start now* on a
  busy employee answers 409 `employee_busy` and makes nothing; *Queue it* answers 202 and is claimed when the employee
  is free; of two claims of one idle employee at the same instant, exactly one wins.
- **Every change decided, recorded, and held to what was read.** A command is decided under the account's policy and
  recorded on its chain -- a refusal too, in a transaction of its own. A changed record names the version it was read
  at (`If-Match` → 412); a review names the handoff digest looked at (→ 409 `stale_handoff`); a new mission names its
  request once (`Idempotency-Key`: the same key and request, the same result). A transactional OUTBOX
  (`workforce.events`) is written in the command's transaction and each consumer records what it handled in the
  transaction of its effect (`consumer_inbox`): at least once, applied once; a mission's timeline is that journal.
  Pages read ONE snapshot (REPEATABLE READ, read-only) and refresh on `office.changed`, an invalidation with no content.
- **An empty company, activated on a usable connection.** A company is activated (`POST /api/office/setup`, its name
  the account's company name unless one is typed) only once the account holds at least one AI connection USABLE for an
  interactive function or for running employees. Three states are told apart, each from one function
  (`connections/uses.ts`): authenticated (the CLI's own status), usable for Chat, for Research, and eligible to run a
  governed employee (Antigravity never is) -- each with why not. Nothing comes with the company: no department, employee,
  mission or CEO; a request naming departments is refused (422 `departments_not_accepted`); activating twice, from two
  tabs at once, makes one company. Losing the connection later changes readiness only: the company stays administrable.
- **Hiring** needs a connection that is connected with a model catalog its CLI gave, and takes its model and effort,
  the runtime's own web search where it has one, the Orbit plugin where granted, a department and a profile (title,
  instructions, a "may delegate" switch -- none of which grants authority) and a Personal Sandbox's resources, beside
  the account's budget; an employee starts on probation unless a reason is given. A profile may leave its connection,
  model and effort to its DEFAULTS: what a mission overrides beats the employee's own, which beats its department's
  default, which beats the company's (`execution-precedence.ts`, each field's source kept with the attempt), and a default
  of another runtime never applies. A model the policy's employee allow-list leaves out is refused at hire, never
  switched. Changing an employee's provider is a new profile revision of the same employee -- its id, desk, history,
  artifacts and appointment kept; work in flight keeps its pin until a person re-pins it.
- **Authority is an appointment, never a title.** A company has at most one CEO and each department at most one
  manager, a member of it: APPOINTMENTS (`workforce.appointments`: appoint, replace -- atomic --, suspend, reinstate,
  revoke; each numbered in its slot, versioned, audited, kept as history, never deleted; one incumbent per slot and one
  appointment per employee held by the database). A person may also GRANT an employee the right to give work to
  another employee or a department (`delegation_grants`). Nothing else grants authority: a title, instructions or the
  profile's switch give none. An appointee is not moved out of its department, archived, nor its department archived
  from under it. Replacing a manager moves none of its open work: a person HANDS OVER open work explicitly (only before
  or between attempts; the fence moves, the old holder's late result is refused). The PERSONAL SANDBOX (`PROVISIONING → READY | FAILED`) is
  READY only once its desk, cache and toolbox areas exist with their labels, a write test passed in each and each
  area's enforcement is recorded; no container runs while the employee is idle.
- **An attempt is two containers**, made by a trusted ALLOCATOR -- the only holder of the Docker socket, on a private
  control network, publishing no port, answering only requests signed with the shared secret, taking no image, path,
  mount or privilege from a request -- and removed, verified gone, when it ends:
  - the MODEL PLANE: the unmodified CLI with its connection's home and Orbit Web's tool bridge, on a read-only root with
    no desk or scratch, its only way out the providers' own hosts on port 443 (`ORBIT_WEB_MODEL_EGRESS_HOSTS` may add
    a provider endpoint of the operator's);
  - the TOOL PLANE, the employee's workstation: its desk as `/work` (with its toolbox), `/output`, `/input` read-only,
    `/cache`, a small `/tmp` and a team's `/team` -- an unrestricted shell holding NO credential, with no capability or
    privilege, a read-only root, the employee's CPU, memory, process and time limits, and its only way out Orbit Web's
    egress proxy, every connection decided as the run.
- **The flags are not the boundary; the CLI's own first line is.** Claude Code runs with `--restricted --tools
  TodoWrite[,WebSearch] --strict-mcp-config --mcp-config <the bridge> --allowedTools mcp__orbit_tools__*
  --permission-mode dontAsk --settings {"disableAllHooks":true} --disable-slash-commands --no-session-persistence`, and
  its init line is checked, fail closed: a tool, an MCP server or a plugin from disk it was not given -- or no
  `mcp__orbit_tools__submit_handoff` -- stops it before it acts (`isolation_not_established`), never retried with
  more; plugins compiled into the binary (`<name>@builtin`) are the unmodified CLI's: recorded, allowed.
- **An employee runs on a CLI only where its installed binary was OBSERVED holding its model plane to Orbit Web's
  tools.** Claude Code is, by its `--help` and its init line on every run. OpenAI Codex is where its binary is seen
  doing it: Orbit Web stands in for the provider on the loopback for one turn and runs `codex exec` exactly as a model
  plane does -- every feature that runs, writes or reads locally off, `--ignore-user-config`, `--ignore-rules`,
  `--ephemeral`, a read-only sandbox, the bridge as the whole `mcp_servers` table (required, its tools approved), the
  model's catalog entry made Orbit's (no patch tool, code mode, sub-agents or tool search; text only) as
  `model_catalog_json` -- reading every tool the request offers the model. Only a model observed so is offered, the
  observation kept per binary version and entry digest (Re-check makes it for the recommended model, a hire and a
  dispatch for the chosen one), and the stream fails closed on any item but a message, reasoning, a plan, a warning,
  Orbit's tools or the search it was given. Google Antigravity runs no employee, said at hire. The development-only
  `process` provider has no container, limit, isolation or shell, and says so on every attempt.
- **Every tool runs in the tool plane** through Orbit Web's endpoint (`/api/runtime/tools/list|call`), reached by the
  bridge by Orbit Web's name on the attempt's network and authenticated by the attempt's own token -- refused at the
  chats' gateway and every owner route -- for the attempt's CURRENT fence only. A shell runs only where the attempt's
  isolation and the protection of the login were attested from outside the shell.
- **A run is a durable intent** written in the claim's transaction; a worker drives it only while it holds its LEASE
  and writes only under its FENCE (a claim, pause, cancel or new attempt moves it: a replaced attempt's result is
  history, acted on never). A worker that loses a lease stops its attempt; whoever recovers it stops and removes what
  is left -- verified -- and says it was interrupted: never a second start on a guess.
- **Review.** An employee hands in a summary, deliverables and claims; *Needs me* lists what waits for a person (a
  result, a question asked of them, blocked or unschedulable work, a delivery). *Request revision* gives the work back to
  the same employee; *Accept* names the revision read, publishes the work to its desk and frees it; pause, resume,
  cancel, retry and an answer name the version read too. The person reviews a mission's ROOT only: a part's hand-in is
  its lead's (409 `reviewed_by_lead`). Every revision is kept as handed in -- the database refuses a change of a hand-in's
  content or of a reviewed one's status, and of an artifact -- so v1 asked to revise stays beside v2 accepted, and v1
  can no longer be accepted once v2 is in. Hand-in files are staged into a content-addressed store per account (bytes,
  hash verified, then the row), served only verified and never as a page that could run script. A research mission's
  pinned revisions reach `/input` read-only under their labels (S1 …); a claim is SUPPORTED only when every label is a
  source the mission was given and its quote is found in that source's frozen text; one resting on a web page stays
  *web, not pinned*.
- **What an employee keeps.** A DESK, with a TOOLBOX of skills and scripts it wrote for itself, lasts across
  assignments; an assignment's workspace is seeded from it, and an ACCEPTED workspace is published back once -- the
  employee's next attempt is prepared only after every accepted workspace reached its desk. A work tree has no bound (a
  repository, its dependencies), while a publish's answer and the desk's version record cross bounded channels (the
  storage helper's 4 MiB, a storage worker's 16 MiB): each names at most the first 500 paths it changed, with how many
  there were, and a record read back cut short is refused, never taken as the whole.
- **Work given to a department or to the CEO.** A mission names its TARGET: an employee by name, a department (which
  goes to its manager in office) or the CEO, resolved inside the transaction that makes the mission with the slot's
  row held, and kept on the work with the appointment and slot revision that resolved it. What the person saw may be
  named (`expectedAssignee`, from `GET /api/missions/target`): a slot that moved since is refused (409 `target_changed`,
  with who is responsible now) and nothing is made; an empty slot is `no_ceo` / `no_manager`, a suspended holder
  `appointment_suspended`. A refusal and a success are the answer to their `Idempotency-Key`, replayed as they were.
- **A team, by the tree.** Whom a lead may give work to is ONE function over its appointment and grants
  (`work/domain/authority.ts`): the CEO gives work to the managers in office (a department goes to its manager), a
  manager to the working members of its department, anyone to whom a person granted it -- never to itself or a lead
  above it in the mission. The same function says what the attempt is told, whether its `delegate` tool exists, and
  what its plan is held to. A plan gives up to eight parts, each with a key unique among its lead's parts, a goal,
  deliverables, criteria, what it waits for and what it is SHARED (§9); a plan that names someone out of reach, waits in
  a circle or shares what the lead does not read is refused whole (`work.delegate`, decided as the lead). A part starts
  once those it waits for are accepted; its lead reviews each by the DIGEST of the revision it read (a newer one refuses
  the decision), and hands its own result in only once every part has ended (`parts_not_ended`). Limits: five revisions
  of one hand-in, three plans per assignment, three questions per assignment, delegation three levels deep. Temporary
  assistants (`employee.hire_assistant`) are a word of the vocabulary, not built.
- **Questions go up the tree.** An attempt that cannot go on asks ONE question and its work ends there: a part asks its
  LEAD, the root the person who gave the work. The lead is woken (ANSWERING; a review it is already in answers too) and
  answers -- the asker resumes ONCE with the answer in its brief: an answer is a compare-and-set on the open question,
  so two at once (a lead and a person, two tabs) resume it exactly once -- or moves it one level up saying why. A
  question reaches the person only from the root, or moved up for what is a person's: a human decision, something beyond
  the lead's authority, a deadline, one nobody below answered; the person's answer to a question asked of a lead is
  refused (409 `asked_of_lead`). A lead woken for a question it then leaves unanswered is woken again at most twice, then
  the question moves up by itself; an overdue one moves up too; one whose asker ends is withdrawn, and a lead that ends
  takes its open parts with it. Every hop is appended to the question's route.
- **An attempt that delegated, asked or answered ENDED BY DESIGN.** Its assignment moved on in the same transaction
  (WAITING_FOR_SUBORDINATES, BLOCKED on its question, waiting again), its tools close at once (an attempt acts only while
  its fence is current AND its work is in a state that runs one), and its run is asked to stop and recorded as a SUCCESS
  with why (`Ended by design: it gave its work to its team`) -- its compute goes back at once instead of when its CLI
  happens to exit, so a lead and its part never hold one execution slot together. The first reason a run was asked to
  stop is the one it keeps; each attempt says why it was started (`wake_reason`).
- **Resources and admission.** Capacity (detected by the allocator, or `ORBIT_WEB_CAPACITY_*`) less the control
  plane's limits (`ORBIT_WEB_CONTROL_PLANE_LIMITS`) and a reserve (10 %) → the account's BUDGET (authorized by the
  operator; the owner may lower it, never raise it) → each employee's RESOURCE PROFILE (immutable revisions; an attempt
  pins the one it was admitted under) → each attempt's containers, its model plane's included. An idle employee
  reserves no CPU or memory; a hire is refused only above a per-employee ceiling or the account's storage budget, never
  because CPU or memory are busy now. An attempt reserves at admission and releases only once its containers are
  verified gone; one that could fit but not now is `waiting_for_resources` and starts by itself; one that never can as
  configured is `unschedulable`, with the numbers, in *Needs me*. One serialized admission pass: dominant-resource
  fairness across accounts, aged priority within one (`ORBIT_WEB_AGING_MINUTES`, 30), and a starvation guard after
  which freed capacity is held for the longest waiter (`ORBIT_WEB_STARVATION_GUARD_MINUTES`, 60).
- **The host is read again** ("a Re-check that reads the new configuration") at every start and at *Re-check*
  (Settings → Compute & storage, `POST /api/office/resources/capacity/check`, two at once being one): the provider is
  asked, the capacity row rewritten, and every authorization that comes from the capacity follows it -- a budget value
  that stood at it moves, up or down; one the owner lowered stays, never above the new one. A provider that does not
  answer changes nothing (`capacity_unreadable`; at a start, ten tries three seconds apart, then the row is left as it
  was, never replaced by the control plane's view of its own host). The operator's authorization is `governance.js
  budget show | set`: `set --account=<id> | --all` with numbers (vCPU, GiB, attempts) makes it the operator's
  (`source: operator`), which a Re-check or a start leaves alone, and `--from-capacity` gives it back; each is on the
  account's chain (`workforce.budget.authorization`). The budget form sends only what was typed.
- **Storage is enforced by the kernel where the host can.** A probe tries XFS project quotas, a loop-backed XFS pool
  (`ORBIT_WEB_WORKFORCE_POOL_SIZE`, 20g), btrfs qgroups and a loop image per area, and records each area
  HARD_ENFORCED, SOFT_MONITORED or UNSUPPORTED with the over-quota write that proved it. A shell runs only where every
  writable area is HARD, or the operator accepted SOFT (`ORBIT_WEB_ACCEPT_SOFT_STORAGE=1`) while the host's disk is
  protected; otherwise the attempt is blocked (`storage_not_enforceable`).
- **Network.** Employee network access is part of the policy: AUTONOMOUS (the default: any public host on ports 80
  and 443, no per-domain approval) or RESTRICTED (an allow-list, exact or `*.domain`), changed through the policy's
  lifecycle and applied to a running attempt's next connection. Private, loopback, link-local and metadata addresses
  are refused in both, after resolution and at every redirect; an employee gets no installation-named range and no
  IPv4-mapped IPv6 address. A tool plane's every connection is logged with its bytes, at most
  `ORBIT_WEB_EGRESS_MAX_CONNECTIONS_PER_RUN` (256) open at once, and the run's summary (counts, hosts, bytes, the log's
  digest) goes on the account's chain (`office.run.network`). Internet and shell are independent. Said where the mode
  is chosen, at hire and when assigning: "In Autonomous mode an employee can send the data of its assignment to any
  public website. Use Restricted mode, or do not give it data that must not leave."
- **Recurring work and deliveries.** A schedule (daily to quarterly) runs in its own IANA zone (a skipped local hour
  at the first instant after it, a repeated one at its first) and names the period a run covers (the quarter before,
  on a quarter's first day); one occurrence per period, whoever asks (a unique key); a missed period is made or skipped
  as its policy says (the latest, each, or none), a skip recorded. An accepted scheduled result is delivered to each
  recipient: SENT only with a receipt; PENDING_CHANNEL until a person says how it was delivered (0.8.0 has no external
  channel); one that may or may not have arrived is settled by a person -- never "sent" on a guess.

### 9. What an employee may use of the account

- **Each attempt reads only what its grant gives it, enforced where it is staged and where it is read.** The ROOT of a
  mission reads the mission's sources and, when its employee may read them, its repositories; a PART reads only what its
  lead SHARED with it on purpose (`workforce.data_shares`, each with what, to whom, from where, audited
  `office.data.shared`): a source the lead reads itself, and the ACCEPTED hand-in of a part it waits for -- its summary,
  or in full; a LEAD reads, by supervision, the latest submitted or accepted hand-in of each DIRECT part. Nothing else: a
  sibling's work nobody shared, a part of a part, another department's room. ONE function decides it
  (`work/domain/data-authorization.ts`); the attempt's inputs are staged from it alone, written down with why each
  (`workforce.attempt_inputs`, audited `office.run.inputs`) BEFORE it starts, and the provider is given, for each file of
  `/input`, a path naming the ATTEMPT -- served only when that name is in the run's manifest, the run is live and the
  grant, worked out again, still gives it; a store's own path, a name not in the manifest or another account's attempt is
  refused and recorded (`boundary.violation`, `input_not_authorized`).
- **The working room is the department's.** A mission's team has one room per data domain: the members of one
  department working on it share theirs (`/team`), the employees of no department the company's -- never another
  department's. What crosses departments is a hand-in, shared on purpose.
- **What is no longer an attempt's is taken from it while it runs.** A share revoked by a person
  (`POST /api/data-shares/:id/revoke`), a lead's own grant narrowed, or the employee moved to another department (the
  room it holds is not its department's now): the ACCESS WATCH -- on the governance's access hooks, an employee's
  department change, and a heartbeat for what no hook says -- asks that attempt to stop (`office.access.revoked`, with
  why) and Work blocks its work saying so; nothing runs it again by itself.
- **Who reads what, said plainly.** The tool plane holds its own scratch and cache, its department's room and its
  authorized `/input`, its mounts attested. The model plane sees what passes the tool endpoint, but its `/connection`
  home is the AI connection's, shared by every employee on that connection: a connection is not a department boundary.
  The coordinator (Orbit Web itself) is trusted and reads everything by design.

- **The account's connectors, asked by Orbit Web.** An employee may use the GitHub and Azure DevOps sign-ins of
  Settings → Connectors -- the installation's, shared -- once a person lets it, on the employee's *Access* tab: each
  connector off until turned on, then for EVERY repository that sign-in reaches or ONLY the ones chosen (an Azure
  DevOps project's work items and wiki come with a chosen repository's project). Grants live in
  `workforce.connection_grants` -- one live row per employee and operation; a change revokes the last and writes the
  next, so the history stays -- changed by a signed-in person of the account under `connection.manage`, recorded.
  Through its one bridge the employee may then read, for Azure DevOps, a work item by its URL (fields, description,
  acceptance criteria, comments, attachments' names), work items found by WIQL and a wiki page; for GitHub, an issue
  and a pull request; for both, a file or a folder's listing. Orbit Web makes each ask itself, on the control plane,
  with the installation's sign-in (`az rest`, `gh api`): THE SIGN-IN NEVER ENTERS THE SANDBOX. Each ask is held to the
  grant (a query's items, a wiki and a work item to the granted projects, whatever the organisation holds), decided by
  the policy (`tool.connector`, the repository or project its resource) and recorded; its answer is data the employee
  must not take instructions from, fenced by lines carrying a nonce made for that answer (stripped from the body, so a
  body cannot close the fence) and cut to 256 KiB. Turned off, the next ask is refused.
- **A write waits for the owner.** An employee reads only, unless a person also checks *Also write* on that connector:
  it may then PROPOSE a comment on a work item, an issue or a pull request, or a work item's new state -- inside what it
  may read, a work item only under its own project. A write passes every gate a read does first (the grant, its scope,
  the `tool.connector` decision), then its own: `connector.write` (enforcement `boundary`; fingerprint: the connector,
  the target, the operation and a digest of the text), `require_approval` by default in both deployments. The employee
  is told nothing is written yet; the owner approves that exact write in Governance → Approvals, and Orbit Web writes it
  at once with the installation's sign-in -- once: the approval is spent before the write, against a fingerprint taken
  again from what it would write. A policy may allow such writes outright, or deny them.
- **Knowledge bases (MCP servers).** Settings → MCP servers keeps the account's remote MCP servers (Streamable HTTP) --
  a knowledge base, a wiki, a document store -- each with a name, its URL and how Orbit Web signs in: nothing, a bearer
  token, or a token in a header a person names. A token is typed once, kept in the credential store, never said back
  or logged, and a server with one is reached over https only. Orbit Web reads a server's tools at once (one that
  cannot be read yet is kept, saying why) and ALLOWS ONLY THOSE THE SERVER MARKS READ-ONLY; any other, and any tool it
  adds later, is offered to employees only once a person checks it. Each server is OFF for every employee until a
  person turns it on, on the employee's *Access* tab; the employee then sees its allowed tools as `kb_<server>_<tool>`,
  and Orbit Web asks each itself, with the server's credential, on the control plane -- the credential never enters the
  sandbox, and the employee's CLI keeps its one MCP server, the bridge. Each ask is held to the grant and the tools
  allowed now, decided by the policy (`tool.connector`, resource `mcp:<server>/<tool>`), recorded, fenced as data and
  cut. Orbit Web connects only to the public internet (or a range the installation named), never to its own host,
  loopback or a cloud metadata service, to the very address it checked, following no redirect. Removing a server takes
  its tools from every employee at their next ask.
- **Repositories, as git bundles.** Work may bring up to five repositories, only ones its employee may use on its
  *Access* tab (any other is refused when the work is given; the mission keeps them as grants of its own). Every
  attempt gets a snapshot of each at its default branch as a git bundle in `/input` (`repo-<name>.bundle`: one root
  commit holding the branch's files, its message naming the repository, the branch and the commit it was taken at) and
  is told to `git clone` it. Orbit Web clones it itself -- bare, one commit deep, through the source's sign-in, in a
  room of the control plane's own -- and removes its copy once the attempt has the bundle (and, at start, every room a
  restart left): the sign-in never leaves the control plane. A repository the employee may no longer use when an
  attempt starts (its grants then, not when the work was given), or whose snapshot is larger than an attempt takes
  (48 MiB for all of them), is not brought in, and the employee is told why.

### 10. Employee desks

Governance → Employee desks lists every employee's desk -- of those in the office, then of those who left -- with what
its desk and cache commit of the account's storage and what was last measured in them, measured again when accepted
work reaches it, when it is opened and after a clean-up ("this part should still be shown, so one can see what is on
the desk ... it can be refreshed when the data grows").

- **Looked into, read only.** The desk is the account's -- the directory it keeps for an employee's work -- so
  reviewing it is the owner's: one folder at a time, the biggest first; a file's first 512 KiB as text, shown and never
  run or rendered; a file that is not text only named and sized; links listed with their targets, never followed --
  read by the allocator's storage worker, as the employee's own user with no network, never by its privileged helper.
  `employee.desk.read` and `employee.desk.clean` are people-only actions of the policy, allowed by default and always
  recorded; every look is recorded with what was looked at, never what it holds (`office.desk.read`).
- **Cleaned up only while nothing could put it back**: named paths (never the toolbox's folders; what is in them may
  go), everything but the toolbox, or the dependency cache -- each said in full first, and final. Only for an employee
  in the office that holds no work (an assignment awaiting acceptance too: a work tree made from the desk would put
  back, when published, what the clean removed), with nothing of it still running and its accepted work on the desk --
  the allocator checks again, under the employee's lock, that no workspace or attempt container of it is left -- and
  only at the desk's version the owner chose at (`If-Match`; accepted work since makes it stale). A clean does not move
  that version, which counts accepted results: moving it could leave the database and the disk apart and refuse every
  later publish. It is recorded (`office.command`, `employee.desk.clean`).
- **Orbit Web's own names at a desk's top** (`.orbit`, `.orbit-publish`, `lost+found`, an isolation check's
  `.orbit-canary-<hex>`) are never shown, read or removed -- and never seeded or published, so no employee can hide a
  file there.
- **One who left** -- archived, or rejected at its trial -- keeps its desk, read only (looked into, never cleaned), and
  its desk storage stays committed (an archive releases only the cache). The owner reviews it there and may delete it
  (the `employment` command `delete`, only from `archived`, against the version read): its sandbox goes `DELETING`, and
  the provisioner asks the provider to remove every area of the employee (`deleteEmployee`, refused while a container
  of one of its attempts exists, read back), backing off and trying again until it is gone; only then is it `DELETED`
  and the storage released -- the account is never told it may use space still on the pool's disk. The employee stays,
  `deleted`, for what refers to it, and leaves the office's lists.

### 11. The image

- **Every AI CLI in the image** ("the image comes with the codex and agy CLIs installed"): Claude Code (an exact npm
  version), OpenAI Codex CLI (`@openai/codex`, an exact version, its native binary from the registry) and the Google
  Antigravity CLI (`agy`, the release archive its official installer fetches, pinned by the SHA-512 its manifest names,
  per architecture), in the control plane's image and the model plane's; `build-info.json`, `GET /api/setup/status`
  and Settings → System name every version, the Orbit commit included. What each may do is decided in 3 and 8.
- **Three employee images** from the same Dockerfile's targets, never pulled or built by Orbit Web: `workstation` (the
  pinned Debian base with git, a C toolchain, the pinned CPython with pip and venv, Node, npm and jq, one non-root user
  with no sudo), `model-plane` (the CLIs, Orbit Web's runner and tool bridge, no `/etc/claude-code`) and
  `storage-helper` (the filesystem tools of the employees' quotas).
- **The image's Python**: CPython 3.15.2 from python-build-standalone (release 20261110), SHA-256 per architecture,
  with pip and venv, root's and on the PATH for Claude Code (a project installs into its own virtual environment or
  with `pip --user`; `AGENT_PYTHON=0` leaves it out), reported by the System card, health and build info.
- **A pin moves without a new Orbit Web**: Settings → System → Updates compares each program with its publisher's
  newest release, sending nothing of the installation, and `scripts/update-pins.mjs` (a dry run unless `--apply`)
  moves the pins it can verify and names the ones a person moves by hand.

## Consequences

- A person needs Docker: `docker compose up -d --build` brings PostgreSQL with pgvector, Orbit Web and the allocator
  (its secret in `allocator.secret`, the three employee images built first), then *Set up Orbit Web* with the code its
  terminal prints. A hosted installation asks for a username and a password alone unless its operator sets a token,
  and its accounts sign their connections in with nobody at a terminal of the server.
- Nothing of an earlier Orbit Web is carried over: a 0.7.0 installation starts with empty records (its SQLite files,
  `/data/claude`, the workspaces on disk and the GitHub and Azure sign-ins stay where they were) and each account
  connects its own AI CLIs; a development build or release candidate of 0.8.0 starts afresh with `db.js reset
  --confirm=<database name> --with-data`. 0.8.0-rc02 changed the initial schema in place (appointments, department
  policies, data shares, questions, targets) and migrates nothing from rc01, by the owner's decision: an rc01 database is
  refused at start with that command. The upgrade acceptance cases are not applicable.
- What was verified is reported per acceptance case (`integrations/orbit-web/docs/0.8.0-acceptance.md`, A01-A19):
  every native AI CLI row is BLOCKED -- no account was used for the tests, by the owner's decision -- and the logic is
  tested with scripted CLIs against the real endpoints on the same pinned PostgreSQL image (`scripts/test-db.mjs`, the
  PR workflow's service) and, for the sandbox, in real containers. The security lab (`tests/security-lab/`), which
  attacks the governed deployment from the agent's own container and reads each verdict outside it, still drives a
  sign-in this version no longer has and was not run for 0.8.0.
- **Said plainly.** A run's sandbox in the single deployment holds what it holds for real -- its chat's workspace, its
  connection's login, its account's Orbit store and, with a switch on, the installation's GitHub or Azure sign-in (with
  GitHub's, Claude Code pushes as the person by design, and a prompt injection could drive it to the sign-in) -- and it
  reaches the internet; without an allocator, runs sit in Orbit Web's own container beside every sign-in. The governed
  deployment's one agent container mounts every account's workspaces and connection homes, so an agent can read
  another workspace's files on disk (the gateway refuses another's approvals, the disk does not): trust domains that
  must not see each other run as separate deployments. A run's Claude configuration is readable by it and the model
  API reachable by design; the isolation check is the agent container's own answer -- a check of the wiring, not proof
  against a runner the agent took over. Accounts are separated at the API, in the rows and per sandbox, not as tenants
  of an isolated system: the GitHub and Azure sign-ins are the installation's, and Orbit Web's container holds every
  account's data. An attempt's isolation is Docker's, so whoever controls the allocator controls the host; the model
  plane's login is readable by the provider's own CLI that uses it, and its connections are held to the providers'
  hosts but not logged per run; a storage area only measured can be filled past its quota until noticed. What a
  question retrieves, a chat's words and its images go to the model's provider; a checked connector acts as the
  account in its service, and in research the guard is the person's checkbox and the model's rule, with no classifier
  reviewing the call. The model catalog and the connector list come from the control protocol the Agent SDK speaks,
  not a documented CLI command. The audit chain is tamper evidence on this host, not proof against whoever controls it.
- Not built in 0.8.0: semantic retrieval, OCR, web search or "deep research" in research, serving a source's original
  file, a local model, temporary assistants, an external delivery channel, email verification, OIDC or a single sign-on
  of Orbit Web's own, billing, audit pruning, and any run of an employee on Antigravity.
