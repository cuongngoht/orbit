# ADR 0064 — Orbit Web research: workspaces of sources, sessions answered only from retrieved passages, citations the server verifies; each Claude account its own chats and models

## Status

Accepted (Orbit Web 0.8.0), 2026-11-20, the owner's decision (the implementation task "Orbit Web Research Workspace &
Research Session", and, while it was planned, "on every sign-in, take the models and efforts from the Claude account
that signed in" and "each account has its own sessions: Claude account A, signed in, does not see Claude account B's
unless they share them with each other").
Builds on ADR 0060-0063, for Orbit Web only. No engine contract changes: nothing under `src/`, `cli/`, `skills/`,
`hooks/` or `agents/` changes, the plugin stays 0.6.0, and the plugin archive is unchanged (`integrations/` is
export-ignored).

## Context

1. Orbit Web had one kind of session: a chat, which is a git workspace and Claude Code with tools. A person who wants to
   study documents -- policies, standards, articles -- and ask questions answered from them had nowhere to put them,
   and a chat would hand the model the documents' text with a shell beside it.
2. The Claude account is Orbit Web's sign-in (ADR 0061), but nothing was anybody's: every chat was every account's, and
   the models offered were a fixed list, so an account a program gives a model to (a research preview) could not pick
   it, and an account without one was offered models it cannot use.
3. Research documents may be confidential. "Local" storage does not mean nothing leaves the server: the passages a
   question uses go to the model's provider.

## Decision

**Research is a domain of its own, not a chat.** Tables of its own (`research_*`, one additive migration), a journal of
its own (`research_events`), routes of its own (`/api/research/...`), a stream kind of its own in the one event catalog
(`research`), and no record of a chat -- no repository, no branch, no workspace on disk. A WORKSPACE owns what lasts
(sources, notes, findings); a SESSION owns one conversation over the sources it selects (kept per session); a RUN
answers one question.

**Sources are stored by the server, read in a worker, indexed in SQLite.** An upload is the file's own bytes
(`application/octet-stream`, the name in a header): the one non-JSON body the API takes, on one route, still under the
CSRF header and origin rules and bounded. A URL is fetched by the server as a snapshot -- http(s), ports 80 and 443,
every address the name resolves to checked against the one definition of the public internet (`forbiddenAddress`, the
egress proxy's, which now also refuses the IPv6 ranges that carry an IPv4 address) and the connection made to the address
checked, every redirect checked again, bounded in time (an absolute deadline) and size, no cookie, no credential, no
proxy. Files are kept under `/data/research/workspaces/<id>/objects/` by their SHA-256, written whole and renamed;
nothing a client typed becomes a path. PDF (unpdf: page numbers kept; a scan has no text and is said to have none -- no
OCR), Word (a bounded in-memory ZIP reader: `word/document.xml` only), HTML (parse5: the readable content), Markdown and
text are read in a worker thread with a time and memory bound, chunked without crossing a page and starting anew at each
heading, and indexed in FTS5 (`porter unicode61 remove_diacritics 2`). Two runtime dependencies, pure JavaScript and
pinned. A revision is immutable; a URL fetched again makes a new one only when its bytes changed, and a failed refresh
leaves the source `stale` on its last snapshot.

**Retrieval is the server's, and only from what the session selected.** A question's evidence is frozen first: the
revisions the selected sources are indexed at, and the passages retrieved from them alone (BM25, ties broken by place,
the openings of the sources added when few passages match), within a character budget. Changing the selection during a
run changes the next run. A `Retriever` interface lets another engine replace it.

**A research run has no tool.** Its own command line (`researchArgs`): `--tools ""`, `--restricted` (no settings file,
so no hook, plugin or permission rule of anybody's), `--strict-mcp-config`, `--disable-slash-commands`,
`--no-session-persistence`, `--permission-mode dontAsk`, a fixed system prompt; the model and effort from the account's
catalog. The question, the conversation so far (labels stripped) and the passages go in on stdin, the passages between
tags carrying a random value made for the run, so no document can close them. A process that reports a tool or an MCP
server, or calls a tool, is killed and the run fails as refused. Each run is answered fresh (no `--resume`): the
evidence of a run is exactly its passages, and nothing of a document accumulates in a transcript under `/data/claude`.
In the governed deployment a research run is bound like any run there -- the egress proxy alone, decided by the
Constitution -- and its token never opens the agent gateway.

**Citations are the server's.** The model may only write a passage's label (`[S3]`); each label is looked up in the
passages the run was given, and only a found one becomes a citation, with the source, the revision, its place in the
extracted text and a masked copy of its passage, from the server's own record. Any other label is removed from the
answer and named as rejected. A citation outlives its session (when a note or a finding refers to it) and its source
(it keeps its copy).

**Notes and findings are a person's.** A finding moves draft → needs review → reviewed | rejected, back to draft, and
its words changed after a review make it a draft again; its words are its writer's or the workspace owner's to change,
its review anybody's the workspace is open to. `reviewed` is not an approved policy: nothing in research writes to
governance (a test counts governance's rows before and after).

**Each Claude account its own.** Chats and research workspaces belong to the account that made them -- its email in its
organization (`claude auth status`'s `orgId`) -- and only it, and the accounts it shares them with by email, see them.
One global guard holds every route under `/api/sessions/<id>`; research checks every record through its workspace;
lists, customizations and app-stream notifications are filtered the same way. Only the owner deletes, shares on, or
makes a public link. A chat from before owners is claimed once by the first account that signs in.

**A chat reaches the account's claude.ai connectors** (the owner's decision while 0.8.0 was verified, 2026-11-20:
"turn it on for every chat", asked why Claude in Orbit Web made no document). Claude makes its documents through the account's
claude.ai connector *Claude Docs*, and a chat ran with `--strict-mcp-config` (ADR 0060), which drops every claude.ai
connector with every other MCP server; the CLI lets no claude.ai connector be declared on its own (`claudeai-proxy` is
refused in an MCP config), so Docs cannot be let in alone. A chat now runs without that flag: it reaches every connector
the account connected, and the MCP servers of the user's settings and of the plugins loaded. A repository's own
`.mcp.json` stays unstarted (Claude Code starts a project's server only once settings approve it, and only the user's are
read -- checked with Claude Code 2.1.328). A run governance holds keeps the flag (and, in the governed deployment,
`ENABLE_CLAUDEAI_MCP_SERVERS=false` behind the egress proxy): its Constitution has no action for a connector. Research
and the model catalog's probe keep it too.

**The models are the account's.** The API asks the signed-in account's own Claude CLI through its control protocol (one
`initialize` request, restricted, no tool, no model call) and keeps the catalog per account, read again at every
sign-in. Chats, research sessions and Settings' defaults are held to it; an effort a new model does not take moves to
one it does; a model that takes no effort is passed none. When the CLI cannot be asked, the fallback list is shown and
a choice is held to its shape alone.

## Consequences

- A research question needs no repository, no GitHub and no tool, and its answer can be checked passage by passage;
  restarts keep everything, and a run a restart cut short is interrupted, never completed, never run again.
- **Said plainly.** The passages a question retrieves are sent to Claude (Anthropic): storing documents on the server
  does not keep them from the model's provider. CLI flags are the CLI's boundary, not the operating system's: in the
  single deployment the research process runs as the same user as everything else. The control protocol the model
  catalog reads is the one the Agent SDK speaks, not a documented CLI command. Accounts are separated at the API and the
  pages, not on disk: GitHub's and Azure's sign-ins and Settings remain the installation's, operators see every
  session's audit, and sharing has no read-only level. What the signed-in account connected at claude.ai (mail, files,
  chat ...) Claude in any chat reaches too; the way to keep a service out is to disconnect it there. Not built: web search or "deep research", OCR, serving the
  original file, a local model, resizable panels.

## Amendment, 2026-11-21: research is a conversation with references; connectors are checked per account

The owner's decisions while 0.8.0 was verified: "I want a prompt alone to make it write a Claude artifact and give
back the link" (a research prompt makes a Claude Doc and says its link), "add a place where the user sets which
connectors are used, with checkboxes, that can grow later" (a place where a person checks which connectors are used,
able to grow), and "research, like chat, only references the data" (research like a chat, its sources only
references).

- **A research session is a conversation like a chat whose selected sources are references.** The passages retrieved
  for a question (as above: only from the selected sources, frozen first) are given as reference material: a statement
  resting on one cites it (verified by the server, as above), Claude says what comes from elsewhere, and a question
  needs no source at all. The passages stay untrusted data, never instructions.
- **Connectors are the account's, checked per account.** Settings → Claude connectors lists the signed-in account's
  connectors -- its claude.ai connectors and the MCP servers of the plugins installed for it, as its Claude CLI reports
  them over the control protocol (`mcp_status`, no model called) -- each with a box for chats and one for research,
  kept per account and checked for both until unchecked. A chat is denied, by name, what is unchecked for chats.
- **Research has no built-in tool, and only the connectors checked for research.** A research run keeps `--tools ""`,
  `dontAsk`, no persistence; with no connector checked it stays restricted with no MCP server, as before. With some, it
  reads the user's settings source (the only one the CLI brings the account's connectors with -- `--restricted` or any
  other source lists none, checked with Claude Code 2.1.328), the connectors checked are allowed by name and the rest
  denied by name, and its prompt says a connector is used only when the person's own message asks, never because a
  passage or a tool's answer says to. A run that reaches for anything else is stopped. Checked with a real model: a
  research-shaped run allowed Claude Docs alone made a doc and answered its link.
- **Said plainly.** In research a checked connector acts as the account with no classifier reviewing the call: the
  guard is the person's checkbox and the model's rule. A run governance holds still reaches no connector.


## Amendment, 2026-11-21: PostgreSQL, accounts, and research governed (ADR 0066)

Research's records moved to PostgreSQL (schema `research`): its full-text search is PostgreSQL's (diacritics folded by
Orbit Web, English stemming, no stop word, `ts_rank_cd`, every query filtered by account, workspace and the run's pinned
revisions); pgvector is enabled but nothing stores a vector yet. A chat and a research workspace belong to an internal
ACCOUNT (one per verified Claude identity, keyed by the CLI's organization id, never its name); sharing by email stays.
The claim of chats from before owners is removed. A research run is bound and decided under its account's policy like a
chat's (no longer LEGACY_ORBIT), each checked connector a decision of `tool.connector`.
