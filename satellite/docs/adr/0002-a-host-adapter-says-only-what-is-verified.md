# ADR 0002 — A host adapter says only what is verified

## Status

Proposed (Orbit 0.1.1).

## Context

1. **Hosts differ, and documentation is not a run.** Claude Code documents native subagents and parallel dispatch;
   Codex, Antigravity CLI and Grok Build expose no native agents to a plugin today.
2. **A matrix that overstates is worse than none.** A host shown as parallel that runs serially makes every timing,
   concurrency and Live view wrong.

## Decision

- `satellite/src/hosts/matrix.mjs` is ONE table: for each host and capability, a value (`verified`, `reported`,
  `unavailable`, `unknown`) and its grounds (a document, or an acceptance result id).
- A cell is `verified` only while `satellite/acceptance/host-acceptance.json` holds a receipt recorded from a real
  session of that host whose result passed on THIS source: its digest covers `satellite/src`, `satellite/cli`,
  `skills/satellite` and `agents/satellite-*`. Otherwise a claimed cell falls back to `reported`. A stale receipt counts
  for nothing.
- Receipts are written only by `satellite/acceptance/record-host-acceptance.mjs`, from a person's account of a live run,
  held to shape.
- An envelope on a host with no proven native dispatch says `dispatch.mode: serial` and `parallel: false`, and the
  mission's concurrency is 1.

## Consequences

- Any edit to the digested source makes the host's claims `reported` again until a person records a new receipt.
- Codex, Antigravity CLI and Grok Build run every agent run in the main session, one at a time, and say so.
