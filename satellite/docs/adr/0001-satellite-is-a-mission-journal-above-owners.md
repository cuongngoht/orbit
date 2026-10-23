# ADR 0001 — Satellite is a mission journal above Orbit's owners

## Status

Proposed (Orbit 0.1.1). Root decision: [ADR 0041](../../../docs/adr/0041-orbit-satellite-is-a-mission-journal-above-owners.md).

## Context

1. **A goal needs several specialists, and no fixed pipeline fits every goal.** "Payment succeeded but no email" starts
   by exploring where an event goes; a refactor starts by reading boundaries; a small fix needs one change and one check.
2. **Orbit already owns the hard parts.** Engineering tasks change code in their own workspaces and judge their checks;
   QA investigations judge behaviour; the skill factory keeps playbooks; the resolver and the MCP broker gate providers.
   A second implementation of any of them would be a second story about the same work.
3. **An agent's word is not evidence.** A run can say a test passed that never ran.

## Decision

- A mission is ONE append-only journal under `<storeRoot>/satellite/missions/<msn>/`, with an allow-list of line kinds,
  scrubbed at the door. Its state (lifecycle, plan, units, runs, actions, evidence, verdict) is a fold of that journal,
  derived on every read.
- The host decides one step at a time; the engine judges each decision before anything runs, records it before its side
  effect, and runs it through one execution gateway: proposal, contract, policy, durable intent, provider, observation,
  evidence, journal.
- Every owner is reached through its own door, bound in `satellite/cli/bind.mjs`: an implement unit's change is an
  engineering task Satellite starts through `autonomous-engineering start`; a capability call is `invokeBound`; a
  playbook goes through the skill factory, narrowed. Satellite creates no Orbit task for a mission and writes no other
  owner's journal.
- Roles, agent templates, skills and workflows are immutable, versioned definitions pinned by content digest, reused
  across missions and rebuilt into a registry from their records on every read. A role requests a profile and grants
  nothing.
- A criterion is VERIFIED only by an independent owner's own record, read back when the report comes in.

## Consequences

- A mission is as general as its plan: nothing in the engine names a domain, a product or a stack.
- What Satellite can claim is bounded by what owners keep: without an engineering task, a check or an investigation, a
  mission ends REPORTED, never COMPLETED.
- A person's moves (approvals, settings, a playbook's status, resolving an AMBIGUOUS action) stay a person's, outside
  Satellite.
