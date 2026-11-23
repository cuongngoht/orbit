# ADR 0067 — Orbit Web's virtual office: AI employees, each working in a sandbox of its own, on the account's own AI connections, signed in to Orbit itself

## Status

Accepted (Orbit Web 0.8.0), 2026-11-21, the owner's decisions (the specification "Orbit 0.8.0 — the virtual office", its
review notes, and the answers given while it was planned). Builds on ADR 0060-0066 and replaces parts of two of them,
said below. For Orbit Web only: nothing under `src/`, `cli/`, `skills/`, `hooks/` or `agents/` of the plugin changes,
and the plugin archive is unchanged (`integrations/` is export-ignored).

Replaces:

- ADR 0061 entirely, and ADR 0066's "each verified Claude identity an account": Orbit Web signs a person in with ITS
  OWN login (a username and a password), never with an AI CLI's. The browser relay of `claude auth login` is removed,
  as a sign-in and as a way to connect a CLI.
- ADR 0066's "one CLI identity for the deployment": every account connects its own AI CLIs, each connection with a
  config home of its own.
- ADR 0066's migration history: 0.8.0 is Orbit Web's FIRST PostgreSQL release. Its schema is ONE initial migration;
  nothing made by a development build is upgraded (`db.js reset`).

## Context

1. The owner wants an office: hire AI employees (a CLI, a model, an effort), give them work, let each work in a place
   of its own, review what they hand in, ask for a revision or accept it -- and the employee takes its next work.
   Then research with sources, several runtimes, teams, recurring work and governance over all of it.
2. Before 0.8.0 the CLI's sign-in WAS Orbit Web's, one identity per deployment, and every run of an agent shared one
   container with Orbit Web or with every other run (the security lab's cross-read finding).
3. Anthropic's terms ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)): a product may not
   offer Claude.ai login or intermediate Claude.ai credentials; products use API keys or a cloud provider; an end user
   may sign the unmodified Claude Code binary in with their own subscription, including where a platform hosts it.

## Decision

### Orbit's own sign-in; an account is the boundary of every record

- An ACCOUNT (its id is the OrbitId) is made by a one-time setup code an operator prints in a terminal of the server
  (`cli/governance.js owner setup-code`), or -- only in the localhost trial (`ORBIT_WEB_TRIAL=1`, the trial compose
  file, refused at start anywhere else) -- seeded as `admin` / `123456`, a red bar on every page saying so. A user signs
  in with a username and a password (scrypt, N=2^17; no Argon2id: no built-in, no native dependency), throttled per
  username and per address, sessions rotated at login, "sign out everywhere".
- Signing in to Orbit never starts a provider's login. The Office, departments, research sources and governance work
  with no AI connection; what needs one says where to connect it.
- Every table carries `account_id uuid NOT NULL` tied by a foreign key toward `app.accounts` (a test reads
  `information_schema` and holds it), with two named exceptions: `app.accounts` itself and `orbit.schema_migrations`.
  What is the deployment's own (its capacity, its settings, its audit chain) belongs to a reserved SYSTEM account that
  never signs in. A record of another account is not found (404), never forbidden.

### AI connections, per account, each with its own config home

- An account connects Claude Code, OpenAI Codex and Google Antigravity -- several of one CLI if it likes -- each
  connection with a config home `/data/connections/<OrbitId>/<connectionId>/`, mounted only into that connection's
  model planes, never into a tool plane, never readable by another account's runs. A provider identity is connected to
  ONE account at a time.
- A SUBSCRIPTION is signed in only by the provider's official CLI in a terminal of the server
  (`docker compose run --rm orbit-connect claude <connectionId>`): the URL and the code never pass through Orbit. The
  browser accepts only API keys (kept in the control plane's credential store, 0600, outside every mount, handed to the
  model plane alone) and cloud-provider settings. A subscription token, a copied `auth.json` or `.credentials.json` is
  refused.
- Status words are verified by the CLI against that home, never inferred: Installed / Not installed, Connected,
  Disconnected, Authentication required, Connection error. Hiring needs one connection that is connected with a model
  catalog its CLI gave.

### The office as bounded contexts, one write path each

- `apps/api/src/contexts/{workforce,work,execution,shared}` with `domain/` (pure TypeScript, held by a test that reads
  its imports), `application/`, `infrastructure/`, `presentation/`. Workforce: the office, departments, employees,
  their profile and resource revisions, their Personal Sandbox records. Work: missions, assignments, handoffs, Needs
  me, schedules, occurrences, deliveries. Execution: runs, admission, the worker, the tool plane's endpoint, artifacts.
- Four things, never one word: a MISSION is what a person wants done; an ASSIGNMENT is one employee's responsibility
  for it; a RUN is one attempt; a HANDOFF is one result. An employee holds at most ONE assignment (the RESERVATION: a
  primary key per employee, a deferred constraint trigger holding "holding state ⇔ reservation" at commit). "Start now"
  on a busy employee answers 409 `employee_busy` and makes nothing; "queue" answers 202. Of two claims of one idle
  employee at the same instant, exactly one wins.
- Every change is decided under the account's policy before it happens and recorded on its audit chain -- a refusal
  too, in a transaction of its own. Every changed record names the version it was read at (`If-Match` → 412); a review
  names the handoff digest the person looked at (→ 409 `stale_handoff`); a new mission names its request once
  (`Idempotency-Key`: the same key and request answer the same result).
- A transactional OUTBOX (`workforce.events`) is written in the command's transaction; consumers record what they did
  in the same transaction as their effect (`consumer_inbox`): at least once, applied once. A mission's timeline is that
  journal. Pages read from ONE snapshot (REPEATABLE READ, read-only) and refresh on `office.changed`, an invalidation
  that carries no content.

### An attempt: two containers, the login never beside a shell

- Each attempt is TWO containers made by a trusted ALLOCATOR -- the only holder of the Docker socket, on a private
  control network, answering signed requests, taking no path, image, mount or privilege from a request:
  - the MODEL PLANE: the unmodified CLI with its connection's home and Orbit's tool bridge; read-only root, no desk or
    scratch, its only way out the providers' own hosts (the model-plane egress, port 443);
  - the TOOL PLANE: the employee's sandbox -- its workspace seeded from its desk, `/output`, read-only `/input`, its
    cache and toolbox -- holding NO credential, its only way out Orbit's egress proxy, every connection decided as the
    run.
- Claude Code runs with `--restricted --tools TodoWrite[,WebSearch] --strict-mcp-config --mcp-config <the bridge>
  --allowedTools mcp__orbit_tools__* --permission-mode dontAsk --settings {"disableAllHooks":true}
  --disable-slash-commands --no-session-persistence`. The flags are not the boundary: the CLI's own init line is (fail
  closed): a tool, an MCP server or a plugin from disk it was not given kills it before it acts, and the work is
  blocked with why. The plugins compiled into the binary (`<name>@builtin`) are part of the unmodified CLI: recorded,
  allowed. A runtime whose installed binary was not OBSERVED to hold its model plane to Orbit's tools runs no employee:
  OpenAI Codex (its documented switches turn its shell tool off, not its patch and exec tools) and Google Antigravity
  (no non-interactive mode with a closed tool set) are refused, said at hire.
- Every tool runs in the tool plane through Orbit's endpoint (`/api/runtime/tools`), authenticated by the run's own
  token -- refused at the chats' agent gateway and at every owner route -- for the attempt's CURRENT fence only. A shell
  only where the attempt's isolation and the protection of the login were attested from outside the shell.
- A RUN is a durable intent written in the claim's transaction; a worker drives it only while it holds its LEASE, and
  writes only under the run's FENCE (a pause, a cancel, a revision move it: a replaced attempt's result is kept as
  history and acted on never). A worker that loses a lease stops its attempt; whoever recovers it stops and removes
  what is left -- verified -- and says the attempt was interrupted: never a second start on a guess. Resources go back
  only once the containers are verified gone.

### Resources, admission and storage

- Capacity (detected, or set by the operator) minus the control plane's own limits and a reserve → the account's
  budget (its authorization is the operator's; the owner may lower it, never raise it) → each employee's resource
  profile (immutable revisions; an attempt pins the one it was admitted under) → each attempt's containers.
- An idle employee reserves no CPU or memory. Hiring is refused only above a per-employee ceiling or the account's
  storage budget -- never because CPU or memory are busy now. An attempt that could fit but does not now is
  `waiting_for_resources`; one that can never fit as configured is `unschedulable`, said with the numbers in Needs me.
  One serialized admission pass, dominant-resource fairness across accounts, aged priority within one, a starvation
  guard after which freed capacity is held for the attempt that waited longest.
- Storage is enforced by the kernel where the host can: a probe tries XFS project quotas, a loop-backed XFS pool, btrfs
  qgroups, a loop image per area, and records each area HARD_ENFORCED / SOFT_MONITORED / UNSUPPORTED with the
  over-quota write that proved it. A shell runs only where every writable area is HARD (or the operator accepted SOFT
  while the host's disk is protected).

### Network

- Employee network access is part of the account's policy: AUTONOMOUS (the default: any public host, ports 80 and 443,
  no per-domain approval) or RESTRICTED (an allow-list). Private, loopback, link-local and metadata addresses are
  refused in both, after resolution. Every connection of an employee's run is logged with its bytes; the run's summary
  (counts, hosts, bytes, the log's digest) goes on the account's chain. Internet and shell are independent.
- Disclosure, said where the mode is chosen, at hire and when assigning: "In Autonomous mode an employee can send the
  data of its assignment to any public website. Use Restricted mode, or do not give it data that must not leave."

### What an employee keeps, what it hands in, what it was given

- A desk (with a TOOLBOX of skills and scripts the employee wrote for itself) lasts across assignments; an assignment's
  workspace is seeded from it; an ACCEPTED workspace is published back once (the next attempt of that employee is
  prepared only after every accepted workspace reached its desk), so its next work starts from what was accepted.
- A hand-in's files are staged into a content-addressed store per account (bytes, hash verified, then the row), served
  only verified and never as a page that could run script.
- A research mission's pinned source revisions reach `/input` read-only under their labels (S1 …); a claim is
  SUPPORTED only when every label is a source the mission was given and its quote is found in that source's frozen
  text. A claim resting on a web page stays "not verified".

### Recurring work and deliveries

- A schedule's rule is in its own IANA zone (a skipped local hour runs at the first instant after it, a repeated one at
  its first) and names the period a run covers (the quarter before, on a quarter's first day). One occurrence per
  period, whoever asks (a unique key); a missed period is made or skipped as its policy says, and the skip is recorded.
- An accepted scheduled result is delivered to each recipient: SENT only with a receipt; otherwise PENDING_CHANNEL until
  a person says how it was delivered -- never "sent" on a guess.

## Consequences

- The deployment needs Docker for employees: the allocator, three images (workstation, model plane, storage helper),
  and a secret shared with Orbit Web. The process provider exists for a development run without Docker; it is never
  isolated and never grants a shell.
- No database of an earlier build is read: `node dist/cli/db.js reset --confirm=<database> [--with-data]` (or
  `docker compose down -v`) starts again. The upgrade acceptance case (A02) is not applicable by the owner's decision.
- What was verified and what was not is reported per acceptance case (A01-A19): every native AI CLI row is BLOCKED --
  no account was used for the tests (the owner's decision) -- and the logic is tested with a scripted CLI against
  Orbit's real endpoints and, for the sandbox, real containers.
