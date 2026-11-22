# ADR 0068 — Orbit Web: a subscription connection signed in from its card

## Status

Accepted (Orbit Web 0.8.0), 2026-11-22, the owner's decision ("bấm add connection thì show link để đăng nhập … như
cũ"). Replaces ADR 0067's "a subscription is signed in only in a terminal of the server: the URL and the code never
pass through Orbit" -- the terminal stays, beside the card. For Orbit Web only: nothing of the plugin changes.

## Context

1. ADR 0067 made every account connect its own AI CLIs, each connection with a config home of its own, and signed a
   subscription in ONLY from a terminal of the server (`cli/connect.js <connectionId>`). On a hosted installation a
   person has no terminal of the server: the Azure deployment needed an operator (or `az vm run-command` with a pty
   and a pipe) to sign a connection in, and the owner asked for the earlier flow back: Add a connection, get a link,
   sign in, paste the code back -- per account, per connection.
2. The flow existed before (ADR 0061: the browser relay of `claude auth login`) and was removed with it. Its parts are
   still in the code: `common/login-flow.ts` drives one CLI sign-in as a process (its URL, a device code, a code a
   person pastes, verified by the CLI's own status) for GitHub CLI and the Azure CLI.
3. What each CLI offers, read from the CLIs themselves (2026-11-22): `claude auth login --claudeai` prints a URL and
   asks "Paste code here if prompted >"; `codex login --device-auth` prints a link and a one-time code a person enters
   on OpenAI's page, then finishes by itself; `agy` (1.5.14) has no sign-in command at all, and Antigravity's terms do
   not permit its Google sign-in from another product (ADR 0067's `not_permitted`).
4. Anthropic's terms say a product may not "collect, store, or intermediate Claude.ai credentials or session tokens",
   and also that an end user may sign the unmodified Claude Code binary in with their own subscription, including where
   a platform hosts it. Relaying a one-time authorization code from the person's browser to the unmodified CLI's stdin
   is the reading ADR 0061 took and the owner takes again; the strict reading stays available (decision 6).

## Decision

1. **The card runs the CLI's own sign-in.** `POST /api/connections/:id/sign-in` starts the runtime's own sign-in
   (`RUNTIME_SPECS[runtime].login`) through the agent's process port, with that connection's home and environment
   (`ConnectionProbe.envOf`) -- exactly what `cli/connect.js` runs -- driven by `LoginFlow`. The page follows it
   (`GET …/sign-in`, polled while it runs): the URL the CLI printed, Codex's one-time code, and whether Claude Code
   waits for a code. `POST …/sign-in/code {code}` writes Claude Code's code to that process's stdin; `…/cancel` stops it.
2. **One browser.** A sign-in belongs to the browser session that started it: only that session sees its URL and codes
   and sends a code (`no_sign_in` otherwise); another browser of the account sees that one is under way and by whom,
   may cancel it, and cannot start another (`sign_in_busy`). One sign-in per connection at a time; an ended one keeps
   only its outcome, for ten minutes, in memory.
3. **Kept nowhere.** No URL, code or token is written to the database, a log, the audit record or an event. The audit
   record says `ai_connection.<runtime>.subscription.sign_in_started` and `…signed_in_from_page` with the connection's
   id and how it ended. The CLI keeps its login in the connection's home, as from the terminal.
4. **Verified, not said.** A sign-in ends connected only when the CLI's own status names the identity, held to ADR
   0067's ONE IDENTITY, ONE ACCOUNT (`ConnectionProbe.check`); the CLI exiting 0 proves nothing by itself.
5. **Add, then the link.** Adding a subscription connection starts its sign-in on its card at once. **Reconnect** on a
   subscription runs the same sign-in again from the card; on a connected one, the same identity stays connected and
   another makes it `identity_changed` -- who a connection is still changes only by disconnecting it.
6. **Where it is offered.** Claude Code and OpenAI Codex subscriptions (`SIGN_IN_READERS`). Never Antigravity, never an
   API key or a cloud connection (`sign_in_not_offered`). The operator may switch it off (`ORBIT_WEB_SIGN_IN_ON_PAGE=0`):
   then the card shows the terminal command alone, as under ADR 0067, and the route refuses. The terminal command is
   always shown beside the card's sign-in.

## Consequences

- A hosted Orbit Web is usable by its accounts without anybody at a terminal of the server.
- The code a person pastes passes through Orbit Web's API on its way to the CLI: an installation that must not relay it
  sets `ORBIT_WEB_SIGN_IN_ON_PAGE=0`.
- Held by `apps/api/src/modules/connections/sign-in.spec.ts` (each CLI's output as printed),
  `apps/api/tests/integration/connection-sign-in.spec.ts` (the home, the one browser, stdin alone, nothing kept, the
  identity verified, Codex's device flow, Reconnect, cancel, the operator's switch) and the web's
  `AiConnections.spec.tsx`.
