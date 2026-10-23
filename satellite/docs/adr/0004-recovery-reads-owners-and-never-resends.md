# ADR 0004 — Recovery reads owners back and never resends

## Status

Proposed (Orbit 0.1.1). Follows Orbit's own reconcile rules (AGENTS.md, ADR 0017).

## Context

1. **A worker can die at any point.** Between a durable intent and a provider's answer there is nothing to tell a crash
   from a slow call.
2. **Resending a write is the expensive mistake.** A second engineering task for one unit, a second registration, a
   second call to a provider that changed something.

## Decision

- An action whose provider runs outside the mission's lock is preceded by `action.intended` and a lease file (host, pid,
  the pid's start time, a random token). A worker writes its result only while it still holds its lease; one that wakes
  after reconcile closed its action is FENCED and writes nothing.
- `mission reconcile` reads each open action back from where it would have left a trace -- the lease, the tasks Orbit
  started since the intent, the task's own record, the host's word -- and never calls a provider. A read whose worker is
  gone is INTERRUPTED and can be decided again by a new decision; a write whose worker is gone is AMBIGUOUS, its lease is
  taken, and it is never resent; an engineering start finds its one task and adopts it.
- The same decision id twice is a replay that answers what was; the same report twice is a replay; a different report
  for an ended run is refused.

## Consequences

- An AMBIGUOUS action is a person's to resolve; Satellite has no door for that yet and refuses to guess.
- Every recovery move is its own journal line, so a viewer shows what reconcile decided and why.
