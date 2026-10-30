---
name: orbit-improve
description: >
  Improve this project's reusable playbooks and Satellite roles from what they actually did: the engine finds a
  problem that recurs in independent sessions, drafts the smallest successor through the skill factory, and -- once
  the host writes what changes -- compares it with the version it would replace on the same frozen inputs in two
  independent sessions, lets it run for new work only when every promotion gate holds, watches later runs, and puts
  the replaced version back when it regresses. Use when asked to improve a generated playbook or a Satellite role,
  when improve status or Orbit Live shows a campaign waiting for the host, or to evaluate a candidate from a new
  session. It never promotes, reverts or rejects a candidate (a person does, in Orbit Control), never weakens an
  acceptance rule, never writes a script, and never edits the developer's checkout.
argument-hint: <imp-… | cand-… | "what can improve here" | evaluate imp-…>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

**Storage paths:** read `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`
and run `query storage --json` before writing anything. `$SCRATCH` below is the resolved scratch path from that
command: the only place this playbook writes a file.

# Improve a reusable definition, on independent evidence

The ENGINE decides everything here; the host does three things only: it writes a successor's text when a campaign
asks for it, it evaluates from a new session when a campaign asks for that, and it runs a Satellite mission when a
campaign about a role asks for one. Every step answers what it did and what it NEEDS next — follow that answer, and
nothing else.

## 1. Where things stand

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/improve.mjs status
node ${CLAUDE_PLUGIN_ROOT}/cli/improve.mjs opportunities
```

Detection also runs by itself after a coordinated workflow ends and from the hooks (debounced, never an
evaluation). To look now: `node ${CLAUDE_PLUGIN_ROOT}/cli/improve.mjs analyse` — `--dry` writes nothing. One failure,
or retries inside one session, is never an opportunity; an environment, a provider or a person's approval is recorded
and never improved around.

## 2. Carry a campaign

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/improve.mjs resume imp-…
```

It steps the campaign until it NEEDS somebody. What each NEEDS means:

- **host — write the successor (a playbook).** Read the version it succeeds, exactly as it is kept:

  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/cli/skill-factory.mjs show <pin>
  node ${CLAUDE_PLUGIN_ROOT}/cli/skill-factory.mjs workflow <pin>
  ```

  Change ONLY what the campaign's cause names (`improve show imp-…`: the failing steps and why). Keep every step id,
  every output NAME and every success rule — a candidate may change where a step reads an answer, never what counts
  as a pass; a loosened or removed rule, a dropped required step or an output whose type changed is refused before
  anything runs. Write the file under `$SCRATCH`, put it into the successor's draft, and step again:

  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/cli/skill-factory.mjs put <playbook-id> <file> --as=workflow.json
  node ${CLAUDE_PLUGIN_ROOT}/cli/improve.mjs step imp-…
  ```

  The skill factory holds it to the same contract every playbook is held to; a refusal names its rule — fix exactly
  that and put again. When the host has native agents, the design may be delegated to a Satellite mission
  (`/orbit:satellite`, a design unit under the read-only designer); the host still writes and puts the file.

- **host — propose the successor (a Satellite role).** Write the role's whole content as JSON (same profile, every
  completion criterion and restriction kept) and propose it:

  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/cli/improve.mjs candidate imp-… --file=<content.json>
  ```

- **host — link missions (a Satellite role's evaluation).** Pursue ONE goal as a Satellite mission under each
  version, then link each: `node ${CLAUDE_PLUGIN_ROOT}/cli/improve.mjs link imp-… --mission=<msn-…> --side=baseline` (and
  `--side=candidate`). Each run is read back off its mission — never off a report.

- **session — evaluate again, from another session.** One session's BETTER is an observation. From a later session
  (another day, or another host session): `node ${CLAUDE_PLUGIN_ROOT}/cli/improve.mjs evaluate imp-…`.

- **person — Orbit Control.** A qualified candidate waits there when a person turned automatic promotion off; a
  campaign blocked by a person's switch waits there too. Say so, with the campaign id, and stop.

## 3. What never happens here

- Promoting, reverting or rejecting a candidate, or changing a bound: Orbit Control's, a person's.
- Writing into the improvement room, the skill factory's room or Satellite's definitions by hand: every one of them
  is written only through its own door, and a playbook or role changed by hand fails its digest and is never chosen.
- Reporting a candidate better, worse or verified: only the engine's evaluation says that, from the evaluation's own
  receipts, and only across independent sessions.
- `--human`, a script, an install, a push, a deploy, or the developer's checkout.

When a campaign ends, its result is a lesson only when learn's own ladder says so (two independent sessions, nothing
against it): `node ${CLAUDE_PLUGIN_ROOT}/cli/learn.mjs lessons` shows it.
