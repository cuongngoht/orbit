# ADR 0061 — Orbit Web signs in with a Claude account, and only with one

## Status

Accepted (Orbit Web 0.8.0), 2026-11-20, the owner's decision ("signing in with a Claude account is always required; it
is the sign-in itself": the Claude account is always required, and it is the sign-in). Amends ADR 0060 for Orbit Web
only. No engine contract changes: nothing under `src/`, `cli/`, `skills/`, `hooks/` or `agents/` changes, the plugin
stays 0.6.0, and the plugin archive is unchanged (`integrations/` is export-ignored).

## Context

1. Orbit Web 0.7.0 treated the Claude account as one connection among three. The first-run page showed Claude, GitHub
   and Azure side by side; Settings, the GitHub and Azure sign-ins and most of the API answered before any Claude
   sign-in; an Anthropic Console sign-in was offered beside the Claude one.
2. A container started with `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` skipped the sign-in entirely: Orbit Web
   passed the variable to Claude Code by name, and Claude Code uses such a variable before any account signed in. So
   what the page said about the account and which credential Claude Code used could be two different things.
3. The terminal fallback the page and the README gave (`docker exec -it orbit-web claude auth login`) signed the CLI in
   under `$HOME/.claude`, while Orbit Web reads the sign-in from `CLAUDE_CONFIG_DIR=/data/claude`: the image did not
   set it for itself, so a terminal sign-in never reached Orbit Web.

## Decision

**The Claude account is Orbit Web's sign-in.** Orbit Web is signed in when, and only when, `claude auth status` reports
a Claude account (`loggedIn` and `authMethod: "claude.ai"`); `api_key`, `oauth_token` or a Console sign-in is not one,
and the page says why.

- **Enforced by the API.** A global Nest guard (`modules/claude-auth/claude-sign-in.guard.ts`, APP_GUARD) answers 401
  `claude_sign_in_required` to every route before any program runs, except the routes marked
  `@BeforeClaudeSignIn()` where they are declared: `GET /api/health`, `POST /api/access` and the Claude sign-in
  (`GET /api/claude/status`, `POST /api/claude/login`, `.../login/code`, `.../login/cancel`, `GET .../login/events`).
  A route added later is closed unless it says otherwise. It runs after the host guard and the access token gate, so
  token mode still asks for the token first. The CLI is asked at most every ten seconds; a sign-in or a sign-out
  clears that answer, so the gate opens and closes at once.
- **Only a Claude account, and no credential variable.** `POST /api/claude/login` takes no field and always runs
  `claude auth login --claudeai`. `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are given to
  no program; a container started with one is told, by name and never by value, that it is ignored.
- **Who is signed in is shown.** `ClaudeStatus.account` carries the address, organisation and plan the CLI reports
  (`source` is gone). The web app opens on *Sign in to Orbit Web* and nothing else, mounts the workspace only once
  signed in, shows the account in the header, and returns to the sign-in page the moment the API says the sign-in is
  gone (a terminal sign-out, an expiry).
- **Sign-out signs Orbit Web out, never while the account works.** `POST /api/claude/logout` runs `claude auth logout`,
  and is refused (409 `run_active` / `workspace_preparing`) while Claude Code runs in a chat or a workspace is being
  prepared -- the idiom deleting a chat already uses -- so nothing runs for an account that signed out.
- **The image names `CLAUDE_CONFIG_DIR=/data/claude`** for every `claude` in it, so the terminal fallback
  (`docker exec -it orbit-web claude auth login --claudeai`) lands where Orbit Web reads it. The Docker smoke test
  checks that, and that the image opens on the sign-in with every other route closed.

**Kept as it was.** One Claude account per Orbit Web, held until a person signs out: the CLI's own credential, for
the whole instance, not a session per browser. It is the sign-in of the instance, not an authentication of a browser:
whoever reaches the API (loopback, or the access token beyond it) works as that account, so the gate adds to the
loopback rule and the access token and replaces neither. Chats are the instance's and survive a sign-out.

## Consequences

- A person signs in with their Claude account before anything else; the setup page then asks only for GitHub (and
  Azure, optional).
- An unattended run can no longer use an environment token. The real acceptance run mounts a volume a person signed
  in once (`--claude-volume=<name>`, at `/data/claude`) and stops BLOCKED, printing the sign-in command, without one;
  its evidence names the sign-in's method and plan, never the account's address. The smoke test stands in for a
  signed-in account (`tests/docker/claude-signed-in.mjs`) only for the checks that need the API open, and says so.
- The API's contract changed (`ClaudeStatus`, the login request, the 401 gate), so Orbit Web is 0.8.0.
- Per-browser sessions, an owner bound to the first account that signs in, and chats kept per account are not done;
  each would be a decision of its own.


## Amendment, 2026-11-21: the sign-in is a browser's (ADR 0066)

The CLI being signed in no longer opens Orbit Web. A browser is signed in only when IT finished a sign-in: the flow is
bound to the browser that started it (an HttpOnly nonce cookie), and the verified sign-in is exchanged once for that
browser's session (`POST /api/claude/session`), kept as its hash, rotated at every sign-in, with a CSRF token for every
change. Each verified Claude identity is an internal account; signing in as another account ends every session of the
one before. "One Claude account for the whole instance, not a session per browser" above is replaced by ADR 0066.
