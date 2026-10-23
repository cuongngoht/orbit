# ADR 0041 — Orbit Satellite is a mission journal above Orbit's owners

## Status

Proposed (0.1.1). Builds on ADR 0017 (a coordinator dispatches to owners and proves nothing itself), ADR 0022 (a plan
is revised only on evidence) and ADR 0030 (a generated skill runs only through the doors that exist). Satellite's own
decisions are in `satellite/docs/adr/` (0001-0004).

## Context

1. **Goals that need several specialists have no fixed shape.** A coordinated workflow (`/orbit-help`) runs a known
   sequence of owners. A goal like "payment succeeded but no email was sent" first needs an investigation whose result
   decides who does what, and then roles nobody declared in advance.
2. **Every owner already exists.** Engineering tasks, QA investigations, the skill factory, the resolver, the MCP broker
   and Orbit Live are the doors. A second store, journal door, resolver or launcher would be a second story.
3. **Hosts differ in what they can prove.** Only Claude Code dispatches native subagents; the others run serially.

## Decision

- **Orbit Satellite** (`satellite/`, entry `/orbit:satellite`, command `satellite/cli/satellite.mjs`) keeps ONE journal
  per mission under `<storeRoot>/satellite/missions/<msn>/`. A goal becomes a structured intent; a work graph is planned
  and revised only on triggers; roles, agent templates, skills and workflows are reused or generated as immutable,
  digest-pinned definitions; each work unit goes to a fresh agent run under a least-privilege profile; every action
  passes one gateway (proposal, contract, policy, durable intent, provider, observation, evidence, journal).
- **Owners are reached only through their own doors**, bound in `satellite/cli/bind.mjs`: a source change is an Orbit
  autonomous-engineering task in its own workspace (`autonomous-engineering start`); a capability is `invokeBound`, read
  only; a playbook is Orbit's skill factory, without a person's moves. Satellite creates no Orbit task for a mission and
  writes no other owner's journal. Its engine imports only Orbit's leaves.
- **A criterion is VERIFIED only by an independent owner's own record**: an engineering task's verification rows, a
  check its runner ran, a QA investigation's outcome -- read back when a run reports. An agent's word is evidence of
  itself.
- **A mode is an action's and a run's, never a mission's.** Satellite Live is a pure fold of the journal into
  `orbit.satellite.event/v1` events, through Orbit Live's own follower and primitives.
- **A host cell is verified only on a native acceptance receipt for the same source**
  (`satellite/acceptance/host-acceptance.json`); otherwise it is reported. A host with no native agents dispatches
  serially and says so.
- **Recovery reads back and never resends.** A worker holds a lease while its provider runs; reconcile closes what a
  dead worker left as INTERRUPTED (a read) or AMBIGUOUS (a write) and adopts the one engineering task a dead start left.

## Consequences

- `skills/satellite/`, `agents/satellite-*.md`, five plugin switches and four catalog rows are new; the rest of the
  engine is unchanged (`satellite/test/repository-safety.test.mjs` holds the files a release may touch).
- Adding `skills/satellite/` and catalog rows changes the backend acceptance digest, so the native backend acceptance is
  owed again for this source.
- An AMBIGUOUS action and Satellite's policy have no door in Orbit Control yet: a person resolves the first outside
  Satellite, and the second keeps its defaults.
