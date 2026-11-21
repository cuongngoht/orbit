# ADR 0066 — Orbit Web on PostgreSQL (pgvector enabled), each verified Claude identity an account with a browser session, governance scoped to the account

## Status

Accepted (Orbit Web 0.8.0), 2026-11-21, the owner's decision (the implementation task "Orbit Web 0.8.0: PostgreSQL,
pgvector, governance theo account Claude", and, while it was planned, "chỉ bật pgvector thôi, chưa cần integrate giờ").
Builds on ADR 0060-0065 and replaces parts of three of them, said below. For Orbit Web only: nothing under `src/`,
`cli/`, `skills/`, `hooks/` or `agents/` changes, the plugin stays 0.6.0, and the plugin archive is unchanged
(`integrations/` is export-ignored).

Replaces:

- ADR 0061's "one Claude account for the whole instance, not a session per browser": a browser is signed in only when
  IT finished a sign-in; the CLI being signed in no longer opens anything by itself.
- ADR 0063's operators (password, session, roles, bootstrap code, terminal recovery), its organization, its agent
  registry and "govern a workspace", and its two-person approval of a high-risk change.
- ADR 0064's claim of chats from before owners, and its ownership key (email plus organization name when the CLI names
  no organization id).

## Context

1. Orbit Web kept two SQLite files through Node's synchronous driver: every store, guard and service read and wrote in
   the same tick. Transactions could not nest (the app database) or nested through a process-wide depth counter (the
   governance database); sequence numbers, audit chain heads and revision numbers relied on SQLite allowing one writer.
   Research searched an FTS5 index kept by triggers.
2. The CLI's sign-in WAS the sign-in: any caller that passed the host check and the access token, in any browser, acted
   as the signed-in account, saw its sign-in flow and could post its code. Records were keyed by an email and an
   organization taken from the CLI, falling back to the organization's display name.
3. Governance was the installation's: one organization, operators with passwords and six roles, a bootstrap code
   printed to a log, a registry of agents and workspaces a person had to "govern" before policy applied -- and Research
   was never governed at all (LEGACY_ORBIT).
4. The owner wants a person to open Orbit, sign in with Claude, and be in their own workspaces, research and governance
   -- nothing to register, no second password, no organization to create -- with the account as the boundary of every
   record, and PostgreSQL with pgvector as the one store, ready for semantic retrieval later.

## Decision

### One PostgreSQL database, asynchronous, no fallback

- `pg` (exact version) behind one `Db` class: a bounded pool with connect and statement timeouts, `query`/`one`/`run`,
  and `tx`. A transaction holds ONE client for its whole life and travels with the async context (AsyncLocalStorage),
  never in a variable shared by concurrent requests; a transaction begun inside another is a savepoint of it. What a
  change says to the rest of Orbit Web (an event delivered to a stream, an app-stream notice) runs AFTER COMMIT, and
  never for work rolled back; a callback that fails afterwards is logged and changes nothing.
- Three schemas -- `app` (accounts, sessions, settings, chats), `research`, `governance` -- reached by their unqualified
  names through the connection's search path. Numbered migrations, remembered with the SHA-256 of their text: one that
  changed after it was applied, or a database migrated by a newer build, is refused at start. Orbit Web migrates at
  start under an advisory lock; `cli/db.js status|migrate|verify` does the same from a terminal.
- `ORBIT_WEB_DATABASE_URL` (or `_FILE`) is required. A database that cannot be reached, or cannot be migrated, stops the
  start with what is wrong. Nothing falls back to SQLite or memory. The SQLite files of an earlier Orbit Web are not
  read, not imported and not deleted.
- pgvector is ENABLED and checked at every start (`CREATE EXTENSION vector` by the database's superuser in the image's
  init script; Orbit Web's role is never a superuser). Nothing stores a vector yet: embeddings and semantic retrieval are
  a later step, said in the README.
- Concurrency the single SQLite writer used to give, by design now: a chat's and a research session's journal numbers
  come from an `UPDATE … RETURNING` of the session's own counter, in the transaction of the change; a source's revision
  numbers from a counter column on the source; an account's policy revisions from a locked head row; an audit record
  from its chain's head row, locked (`FOR UPDATE`) -- one chain per account and one for the deployment, so accounts
  never wait for each other; an approval moves only by compare-and-set; an approval of one action is asked once under
  an advisory lock on its fingerprint.
- A stream replays a journal by SUBSCRIBING FIRST, buffering, reading the journal up to its head, sending what the
  buffer holds beyond that, and only then going live: an event written while the journal is read is neither lost nor
  sent twice. One chat's events are delivered in the order of their numbers.
- Research's full-text search is PostgreSQL's: a `tsvector` over the passage's text with its diacritics folded by Orbit
  Web (so "ro ri" finds "rò rỉ"), English words stemmed and no word dropped as a stop word, ranked by `ts_rank_cd` -- a
  full-text rank, not BM25 -- and every query filtered in SQL by account, workspace and the run's pinned revisions.

### An account per verified Claude identity, a session per browser that signed in

- An ACCOUNT is an immutable id, a display name a person may set later, and the identity it maps to: the CLI's account
  email (lower case) in the organization the CLI names BY ID (empty when it names none) -- never a display name, and two
  organizations of one email are two accounts; no identities are merged because an email matches. It is found or made
  the first time that identity finishes a sign-in, idempotently under a lock on the identity's key with a unique
  constraint behind it, and never without its audit chain and its default policy (same transaction).
- A sign-in belongs to the BROWSER that started it: starting one sets an unguessable nonce in an HttpOnly cookie, and
  only that browser sees the flow, sends its code, cancels it, or -- once `claude auth status` verified it -- exchanges
  it ONCE for a session (`POST /api/claude/session`). The session is a random token in an HttpOnly, SameSite=Strict
  cookie (Secure behind HTTPS), kept as its SHA-256, rotated at every sign-in, with a lifetime and an idle limit, and a
  CSRF token derived from it that every change carries. A browser with no session is signed in by running the official
  flow again, even when the CLI is signed in already. There is no "first visitor becomes owner".
- The runtime's CLI holds one identity at a time (the model stays one active identity per runtime). When a sign-in
  brings another account, every session of the account before is revoked in the same transaction, its streams close and
  its caches (models, connectors) are dropped. When the CLI's identity changes outside Orbit Web (a terminal), the gate
  ends the sessions of the account before at its next request. A sign-in that would change the CLI's identity is refused
  while Claude works for the account, so no run changes identity mid-way.
- ONE global gate replaces the three guards: a run token that is not a live chat run's is refused; the agent gateway
  takes a chat run's token and nothing else; an agent anywhere else is refused and recorded; public routes pass; every
  other route needs the OWNER of a live browser session whose identity the CLI still holds, and a change its CSRF token.
  No request names its account: it is the session's, and a record of another account is a 404.

### The account is the boundary of every record

Every root record (a chat, a research workspace, an image) carries its account; every child carries it too, held to
its parent's by a composite foreign key, so a message, a passage or a citation cannot belong to another account's
chat, revision or workspace whatever the code above does. App-stream notifications name their audience (the account,
and the emails a record is shared with) when they are published, so nothing is looked up while they are delivered and
a deletion notice still reaches the right pages. Sharing by email stays a way to open a chat or a research workspace;
it gives no governance of it, and a run in a shared record is governed by the record's own account. Background work
uses the account its records name, never whoever asked last.

### Governance is the account's, with one owner

- The signed-in person is the OWNER of their account. Operators, passwords, roles, the bootstrap code, the organization
  and the agent registry are gone; `cli/governance.js` keeps `status` and `verify-audit` and adds `revoke-sessions`.
  Principals stay distinct: owner, agent (a run's token), system, anonymous. A run token is never an owner.
- `governance-core` stays the one policy engine; `organizationId` becomes `accountId`. Each account starts with a
  PUBLISHED default policy (revision 1, `policy.provisioned`, by the system) fitting the deployment: in the single
  deployment what Orbit Web always allowed there (isolation optional, the web tools and connectors allowed); in the
  governed deployment the strict default.
- Inheritance: the deployment's mandatory limits (ceilings per kind of principal, actions nothing can carry out, no
  credential in the governed deployment, research without tools) ▸ the account's published policy ▸ an OVERRIDE for one
  chat or one research workspace, which only narrows (the overlay mechanism, levels `workspace` and
  `research_workspace`). Loosening for one resource is a rule of the account's policy, through the whole lifecycle.
- A single owner publishes: draft → validate → read the difference and its impact → CONFIRM (the digest read, the base
  it was compared with, the risk acknowledged) → publish. Digest and stale-content checks, version history and the
  immutability of a published revision (enforced by the database too) are kept. The two-person rule is removed on
  purpose and said so: a confirmation is one person's and is never shown as an approval by another, and no approver is
  invented. A protected action's approval is decided by a person only (the database refuses any other decider), so a run
  never approves what it asked for.
- EVERY run -- a chat's and a research session's, in both deployments -- is bound and decided under its account's
  policy before it starts (scopes `ACCOUNT_WORKSPACE` and `ACCOUNT_RESEARCH`); each connector the owner checked is a
  decision of `tool.connector`. In the single deployment that is governance at the API: the agent shares the container's
  user and is NOT isolated, and nothing says otherwise because an account id exists.
- Reads (overview counters, decisions, approvals, audit, findings, reports and their exports) are filtered by the
  account in SQL. The audit record is never cascaded: deleting a chat or a research workspace leaves its records and a
  resource row that names it.

## Consequences

- Orbit Web needs PostgreSQL with pgvector; the compose files run the pinned `pgvector/pgvector` image on an internal
  network only Orbit Web joins (never the agent's container in the governed deployment), and its role is made by an
  init script. The API's integration tests run against that same image (`scripts/test-db.mjs`, the CI service).
- The database is no longer a file the isolation check plants a canary in: the governed deployment's check asks the
  agent's runner to CONNECT to it (`no_database`), and a database it can reach -- or one behind a local socket the
  check cannot try -- fails the check. No database variable reaches a child process (`infra/process/env.ts`).
- A person upgrading from an earlier Orbit Web starts with empty records: chats, research and governance of the SQLite
  files are not carried over (their files stay where they were). The workspaces on disk and the CLIs' sign-ins are kept.
- A second browser of the same account cannot sign in while Claude works for the account (the flow would sign the CLI
  in again); it signs in once the run ends.
- Accounts on one runtime are not tenants of an isolated system: the CLI holds one identity at a time, and the files on
  the data volume (workspaces, the CLI's transcripts, the GitHub and Azure CLIs' sign-ins) are the runtime's. Separation
  is at the API and in the rows.
- Departments, members, invitations, an SSO of Orbit Web's own and billing are not part of this; the schema keeps the
  account as the root of every record and an override keyed by resource, so a level between them is an additive
  migration.
