# ADR 0006 — A case that asks nothing of a screen runs with no browser

**Status:** accepted, 1.7.0

## Context
A case made only of `sql` and `call` steps still needed a browser:
- the session gate always ran;
- the validator demanded a final `report`, which evaluates JS in the page;
- a FAIL asked the browser for a screenshot, the console and the request log.

Nothing in the vocabulary said whether a verb needs a page, and nothing in the capability
contract said whether a capability does. So a requirement behind an API could not be verified on
a machine with no browser. A browser that happened to be missing turned a backend check into a
REFUSED or BLOCKED run about a browser nobody needed.

## Decision
1. **A verb column, `pageless: true`,** on `sql` and `call` only. A verb nobody described may read
   or drive the page, which is the safe reading.
2. **A capability field, `page: false`,** additive to `orbit.capability/v1`. It means the
   capability never touches `ext.browser`. A capability that declared nothing is taken to need a
   page, so the frozen v1 fixture behaves exactly as before.
3. **`src/dsl/page.mjs` gives two answers, each as the first reason that holds.**
   - `pageNeedOf` / `pagelessByVerbs` read what the case itself shows: a non-pageless verb, a
     `wait`, an identity (proved from the page's token) or a start screen. The validator uses it.
     `src/dsl/` never imports `src/run/`, so validation asks no capability registry.
   - `runNeedOf` / `needsPage` add each called capability's declaration. `prepare` uses it.
4. **What a pageless run does differently:**
   - The session, identity and start-screen gates skip (a gate row marked `page`).
   - FAIL evidence is the run's log, with no browser call.
   - `runDir` is not looked up.
   - A pageless case need not end with `report`. It still needs a verdict.
   - A pageless run that claims to prove `ui` is refused before anything runs.
   - A capability that declared `page: false` and reaches for the browser anyway is refused in so
     many words (`src/extensions/context-v1.mjs`).
5. **Data checks through a capability.** An investigation can read a store it has no SQL for,
   through a registered read-only capability: `check-data --via=<cap> --input='{…}'`.
   - It is asked with no page and no case, so the existing mutation gate refuses a writer.
   - It keeps a count and nothing else.
   - The map does not say that store is the one the control writes, so a record missing there is
     SUSPECTED (high), never CONFIRMED.
   - Every data check, SQL too, now passes the investigation's gate table first, with the browser
     and action-budget rows silent.

## Consequences
- `browser.automation` is now optional for `orbit-qa-agent` in the component catalog.
- A capability author who wants headless runs declares `page: false`. Nothing else changes for
  anybody.
