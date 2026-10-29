---
name: orbit-qc-builder
description: >
  Build the smallest project-local QC tool needed to EXECUTE or VERIFY a test that has
  already been agreed, when the engine and the project cannot perform it cleanly. Use when
  a concrete verification is blocked on tooling — a second database the `sql` verb cannot
  reach, a vendor SDK the browser never sees, a queue nothing can inspect. It recalls
  architecture and lessons first, reuses anything that already exists, generates only into
  scratch, verifies against the real contract, and registers into this project's own store
  so a plugin upgrade cannot remove it. It never decides WHAT to test, never writes product
  code, and never edits the engine.
argument-hint: QC needs to check the order row in Postgres and nothing here can read it
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/qc-tool.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/query.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/architecture.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/learn.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/run-case.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs opportunities*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs verify*)
  - Read
  - Write
  - Edit
  - Glob
  - Grep
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

# Build the smallest missing QC tool, and nothing more

**QA decides what should be tested. QC decides how to execute it.** This skill is QC, and
its scope is one sentence:

> Build the smallest project-local tool required to perform a verification that has
> already been agreed, when nothing that exists can perform it.

It is not a code generator, not a feature writer, and not a way to change the engine.

## When this is the right skill

Both of these must be true, and the first one is the one people skip:

1. A **concrete verification goal** exists — from a plan (`orbit-test-plan`), a case, a tester's
   question, or an **accepted capability opportunity** (`knowledge opportunities` lists it
   `accepted`: a person already decided this capability should be prepared, and it names what it
   would prove). "Confirm the order the UI just created is really in Postgres."
2. **Nothing that exists can perform it.** Not the engine, not the project, not a helper
   somebody already wrote.

A new technology appearing in a repository is NOT a trigger. Build only when a real
verification is blocked.

If there is no agreed verification yet, stop and use `orbit-test-plan`. Inventing the test and
then building a tool for it is how a QC tool ends up proving something nobody asked about.

## The workflow, in order

Do not skip to step 5. Steps 1–4 are what keep this from becoming a code generator, and
three of the four usually end the task without writing anything.

### 1 — Recall before reading

```bash
node <engine>/cli/architecture.mjs ensure --for="<the capability the goal names>"
node <engine>/cli/architecture.mjs facts
node <engine>/cli/learn.mjs lessons
```

`ensure` decides whether the repository has to be read at all, and PRINTS the decision. The
normal answer is CURRENT. Do not grep the project before asking it.

Architecture facts change the answer, not just the confidence. A fact saying *"persistence
access goes through repository abstractions"* means the right QC tool is probably a thin
adapter over an existing helper or test host — **not** raw database access, even though raw
database access would be easier to generate.

Then ask **project intelligence** which technology this project already uses for the operation
the goal needs — and whether a capability exists for it:

```bash
node <engine>/cli/intelligence.mjs ensure --for="<the goal>"
node <engine>/cli/intelligence.mjs resolve "<the goal, as system + operation>"
```

`resolve` is the decision, with its evidence; this skill is the builder that acts on it, and only
on `build`. `reuse` names the capability to call instead. `unknown` means a person or the
architecture scanner settles the technology first — build on a guessed client and the tool
verifies something the product does not do. The technology `build` names is the one to build on:
if the project reads its lists through one client and its files through another, the tool for
lists uses the first, whatever is easier to generate.

If the goal is an accepted opportunity, read it first — its needs say which subjects it would
prove, in which contexts, and which claims imply it:

```bash
node <engine>/cli/knowledge.mjs opportunities
```

Once the tool is registered (step 7), the next
`knowledge verify --for="<the goal>" --workflow=orbit-qc-builder` finds its provider and
resolves the opportunity by itself. Never move an opportunity by hand: accepting, deferring and
ignoring are a person's, and resolving is the engine's.

### 2 — Ask what already exists

```bash
node <engine>/cli/query.mjs capabilities        # what a {"do":"call"} step can already ask
node <engine>/cli/query.mjs extensions          # and what failed to load, with the reason
node <engine>/cli/query.mjs doctor              # which declared tools are usable here
node <engine>/cli/query.mjs dsl                 # the verbs and fields that already exist
```

Read `extensions` properly. A capability that exists but **failed to load** looks exactly
like a capability that was never built, and rebuilding it is the most common waste here.
The refusal line says what to fix.

### 3 — Look for a reuse before a build

In this order, and stop at the first that works:

| Prefer | Over |
|---|---|
| an existing Orbit capability | anything new |
| an existing project abstraction (repository, test host, integration-test utility) | reaching past it |
| an existing project helper or script | a second implementation of it |
| an existing SDK or client the project already depends on | a new dependency |
| an existing CLI (`psql`, a vendor tool) | code that reimplements it |
| a thin adapter over one of the above | a tool that owns the logic itself |

Generation is the fallback, and the smallest adapter over something that already works beats
the cleanest thing written from nothing.

### 4 — Classify the gap, and say it out loud

Before writing anything, state: **the QC goal · what already exists · what is missing · which
kind of thing is missing · why generating is necessary · what could go wrong.**

| What is missing | What to build |
|---|---|
| only knowledge ("tenant id comes from a token claim first") | a note, or a line in the project's own playbook — **no code** |
| a small repeatable operation | a script or helper in the project |
| an external thing to ask | a **capability** |
| a provider that has to be adapted | an **adapter** behind a capability |
| new validation semantics over a case | a **validator** in the extension |
| a genuinely new kind of test STEP | a custom verb — **last resort** |

A provider is never a reason for a new verb. `postgres.query`, `redis.get`,
`msgraph.driveItem.get` are all `{"do":"call"}`. A custom verb is only justified by new
*run-control* semantics that `call` cannot express — and if you are reaching for one, say why
`call` cannot do it before writing a line.

### 5 — Generate into SCRATCH, never into the store

```bash
node <engine>/cli/qc-tool.mjs new <tool-id> $SCRATCH/qc-tools/<tool-id> --tool=psql
```

Scaffolds a `draft`: manifest, one capability, and a contract test. A draft is inert — the
loader refuses to run one — so nothing can go live by being left somewhere.

Then write the real capability. The rules it has to keep:

- **It imports nothing from the engine.** It is handed `ext` (the public
  `ExtensionContextV1`) and reaches the world only through that. This is what lets it
  survive an engine upgrade.
- **Namespaced id**: `postgres.query`, `msgraph.driveItem.get`, or
  `project.<domain>.<operation>` when it cannot generalise. Never `get`, `query`, `check`.
- **Declare `inputSchema`, with `esc` on every key whose value reaches an interpreter.**
  That declaration is what escapes a `${PARAM}`; without it a value is spliced raw.
- **Declare `tools`** for every command it shells out to, so `query doctor` reports a
  missing one before a run does.
- **Read-only unless you must.** If it can change external state, declare `mutates: true` —
  and then every case using it must declare `"destructive": true`, which is the guard that
  already exists rather than a new one.
- **No secrets in the manifest, ever.** Credentials stay with the tool being invoked
  (`PGPASSWORD`, a profile, a keychain), exactly as `sql.command` already does.
- **No dependency installs** without asking. The engine has none and neither should this.

**A work-item reader** is the same thing with two more declarations. When the gap is that nothing
here can read a work item (`workitem.read`, and its relations, comments or history), scaffold the
smallest adapter over the command line the person already has:

```bash
node <engine>/cli/qc-tool.mjs new <tool-id> $SCRATCH/qc-tools/<tool-id> --tool=<the cli> \
  --provides=workitem.read,workitem.relations.read --connection=<the connection provider id>
```

`--provides` names the semantic capabilities it answers, so the resolver can find it for a need
without knowing its name; `--connection` names the kind of connection it needs, and the ENGINE puts
that one credential into the command's environment for the moment of the call — the adapter never
reads a secret, never receives one as input and never writes one anywhere. A connection that signs in
with Microsoft (Azure DevOps by default) has no credential to hand over: its command gets the few
variables a child needs to start and nothing else, so an adapter for such a provider cannot count on a
token in its environment and says so when it is blocked; reading through the engine's own readers is what
signs in. It is asked with an
`{ref, organization, project, id}` and must answer a work item in the shape in
`src/sources/contract-v1.mjs` (`WORKITEM_FIELDS`): an answer of another shape is Blocked, never
turned into a requirement. It must not declare `mutates: true`: a reader of requirements changes
nothing. Everything after this step — verify, register, use — is unchanged.

### 6 — Verify before trusting

```bash
node --test $SCRATCH/qc-tools/<tool-id>/test.mjs        # the pure half, ports faked
node <engine>/cli/qc-tool.mjs verify $SCRATCH/qc-tools/<tool-id>
```

`verify` loads the candidate through the **real loader, into a throwaway context** — same
manifest checks, same contract, same refusals a registered tool gets. There is no separate
validation mode that could drift from the real thing. Exit 2 means it would not have loaded.

If it can mutate anything, do not run the mutating path to prove generation worked. Prove
the shape with a faked port, and prove the real thing once, deliberately, against data you
are allowed to change.

### 7 — Register

```bash
node <engine>/cli/qc-tool.mjs register $SCRATCH/qc-tools/<tool-id>
```

Verifies again, copies into this project's room in the machine store, stamps the manifest
`verified`, and records the registry line (id, kind, apiVersion, engine, when). Outside every
repository, keyed to this project — so **upgrading the engine does not remove it**, and
project A's tools never reach project B.

### 8 — Use it through the normal runtime

```json
{ "do": "call",
  "capability": "postgres.query",
  "input": { "query": "SELECT id FROM orders WHERE id = '${ORDER_ID}'" },
  "proves": "sql",
  "expect": "it.rows.length === 1",
  "select": "rows.0.id",
  "into": "FOUND_ID" }
```

`proves` says which layer this verdict rules on — the case knows, the capability cannot.
Then run it the way any case runs:

```bash
node <engine>/cli/run-case.mjs <case> --dry        # resolve the plan, touch nothing
node <engine>/cli/run-case.mjs <case> --report
```

**Never** `node /tmp/some-generated-script.mjs` as the permanent way to verify something. A
temporary probe while you are working it out is fine; the finished tool goes through the
runtime, so it gets the input check, the mutation guard, the tool check, the typed outcome,
the evidence and the verdict.

### 9 — Record what was learned

Write a note (`cli/note.mjs`) saying **what the tool solved, what it wraps, what proves it
works, and any trap**. Next time step 2 finds it instead of you rebuilding it.

When a tool stops matching the project, mark it rather than leaving it to be believed:

```bash
node <engine>/cli/qc-tool.mjs status <tool-id> stale
```

`draft → verified → active → stale → retired`, plus `broken`. Do not silently assume an old
tool is still correct.

## The builder is not QC's — this playbook is one consumer of it

What turns a candidate into something the runtime trusts — `qc-tool new | verify | register |
status`, over `src/extensions/lifecycle.mjs` — knows nothing about QC: it holds a manifest and its
capabilities to the published contract, by the real loader, before anything can run them. QC is
the first consumer because a blocked verification is the first real demand. A development or QA
workflow that needs an executable capability later reaches the same lifecycle, after
`intelligence resolve` has said `build`; what differs is the intent that justifies building, and
that lives in the consumer's playbook, never in the builder.

## What the engine does with your tool

Knowing this stops you from re-implementing it:

```
{"do":"call"} → resolve capability → check input against your inputSchema
              → mutation guard (mutates + the case's destructive flag)
              → tool check (BLOCKED if a declared command is missing)
              → invoke, with your declared timeout
              → record in the run log → expect → verdict → evidence
```

Your capability does **not** implement permissions, timeouts, redaction, logging or evidence.
It answers a question.

And it does not decide a verdict either. It reports; `expect` in the case rules.

## Failure semantics — get these right

| What happened | What it is |
|---|---|
| manifest malformed, apiVersion unsupported, unknown capability, input the capability cannot accept | **REFUSED** (2) |
| a declared command is not on this machine | **BLOCKED** (3) |
| the external system is unreachable | **BLOCKED** (3) |
| the capability answered, and it contradicts what the product should have done | **FAIL** (1) |
| the generated tool itself crashed | **BLOCKED** (3) — tooling, not a product defect |

The last row is the one that matters most. A generated tool's own bug must never be filed as
a defect in somebody's feature. The engine enforces it, and you should not write around it.

## Never

- decide what should be tested (that is `orbit-test-plan`)
- write product/application code
- edit `src/dsl/core/verbs.mjs`, `src/dsl/core/fields.mjs`, `src/run/verbs/`, or anything
  else in the engine, for a project-specific need — if a normal capability seems to require
  it, the design is wrong
- put a generated tool in a repository, in `src/`, or in `skills/`
- create a `postgres` / `redis` / `graphql` verb because the provider is new
- register something that has not verified
- store a credential anywhere in the tool
- run destructive code to prove generation worked

## Worked example

> QC needs to confirm an order created through the UI really reached PostgreSQL.

1. `architecture ensure --for="orders persistence"` → CURRENT; a fact says persistence goes
   through repository abstractions, and nothing exposes them outside the app.
2. `query capabilities` → none. `query extensions` → none, none refused.
3. Reuse ladder: no test host, no helper, no HTTP route that reads it back. `psql` is
   available and the project's connection is already configured for its own tooling.
4. Gap: **an external thing to ask** → a capability, `postgres.query`, over `psql`. Not a
   verb, not a subsystem.
5. `qc-tool.mjs new postgres-qc $SCRATCH/qc-tools/postgres-qc --tool=psql`, then write
   `postgres.query` with `inputSchema.query` declaring `esc: "sql"`, `tools: ["psql"]`,
   `mutates` absent (read-only).
6. `node --test`, then `qc-tool.mjs verify` → ok.
7. `qc-tool.mjs register` → verified, in the store.
8. The case gains one `{"do":"call","capability":"postgres.query",…,"proves":"sql"}` step.
9. A note: what it wraps, that the connection comes from `PGPASSWORD` in the environment and
   never from the manifest.

Total new engine code: none.
