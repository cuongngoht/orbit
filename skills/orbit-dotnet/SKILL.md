---
name: orbit-dotnet
description: >
  Know which technologies a .NET solution declares, what its code actually uses each one FOR,
  and how the composition root wires it — Microsoft Graph, SharePoint CSOM, EF Core, Dapper,
  SQL Server, PostgreSQL, Redis, Service Bus, Kafka, RabbitMQ, MassTransit and the standard DI
  container — and decide whether a capability a task needs should be reused or built. Use when
  asked which client a project uses for some system, whether a package is actually used, how a
  service is registered, what a new integration should be built on, or before building a
  project-local QC tool. Memory first: it re-reads only manifests or directories that moved.
  It reads tracked source through the engine and writes nothing into the repository, it never
  stores a literal from the code, and a declared package is never reported as a used one.
argument-hint: which client does this project use for X | is package Y used | what should Z be built on
allowed-tools:
  - Read
  - Grep
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

**Storage paths:** read `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`
and run `query storage --json` before working with project files. `$DATA`, `$SCRATCH`,
`$REPORTS`, `$RUNTIME` and `$EVIDENCE` below are the resolved paths from that command.


# Know a .NET project's technologies — and what each is used for

This is the **.NET pack** behind `cli/intelligence.mjs`. The engine's project-intelligence core
knows no ecosystem and no product: it runs whatever adapters, descriptors and analysers are
registered. This pack registers the ones that know .NET — `catalog.json` (technology
descriptors, as data) and `analyzers/` (pure functions over one C# file each). The MSBuild
manifest adapter itself is a format reader and lives with the engine (`src/ecosystems/`).

| | answers | from |
|---|---|---|
| `architecture` | what structurally exists: modules, imports, boundaries | the tree's shape |
| **this** | which technologies are here, and what the code does with each | manifests + bounded source reads |
| `engineering` | how this project builds things, and how binding that is | reconciled observations |

## 1. Ask the engine first — always

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs ensure [--for="<the task>"]
```

`ensure` prints its DECISION first. `CURRENT` means nothing moved and nothing was read.
`MANIFESTS` re-read project files only; `INCREMENTAL` re-read only the directories that moved.
With `--for`, a moved directory the task has nothing to do with is **skipped and listed** —
still owed, never called current. Then:

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs technologies [<id>]   # the ladder, per technology
node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs integrations          # one row per system AND operation
node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs wiring                # registrations, traced to what they use
node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs why <fact-id | technology>
node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs dependencies --unmatched   # packages no descriptor knows
```

## 2. Read the ladder, and never skip a rung

| rung | shown by | not shown by |
|---|---|---|
| declared | a `PackageReference` (or one a `Directory.Build.props` injects) | a `PackageVersion` in `Directory.Packages.props` — that makes a version *available* |
| used | the namespace or the client type **in code** | a file or class name |
| configured | a DI registration whose implementation is a class using it | the package being present |
| used-for | the request builder / member the code calls (`Drives`, `Lists`, `GetByTitle`…) | the client alone |
| architectural-pattern | two or more registrations wrapping technologies behind the project's abstractions | — and even then it is a **candidate** |

"SharePoint files are done with Graph, SharePoint lists with CSOM" is two integration facts, and
the tool will never collapse them into "SharePoint uses X". When one system+operation is done
two ways, the fact says so and which one new code follows is **the project's decision**.

## 3. Reuse or build — decided, never done

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs resolve read sharepoint list
```

Precedence: an existing implementation of that operation → an adopted/enforced convention →
a registered capability (`reuse`) → a declared technology → catalog knowledge only (`unknown`,
with options). `build` means *a capability is missing and here is the technology to build it
on*; nothing is generated or registered. Hand a `build` to `orbit-qc-builder`.

## 4. Teach it your own packages — as data

An internal SDK nobody else has heard of is a JSON descriptor in the store room that
`intelligence where` prints (`descriptors/`), one object or a list per file:

```json
{ "id": "acme-ledger-sdk", "category": "sdk", "doc": "our ledger client", "matchers": [{ "ecosystem": "dotnet", "dependency": "Acme.Ledger.*" }], "domains": ["acme-ledger"] }
```

`intelligence descriptors` says what loaded and what was refused, and why. A descriptor may say
what a technology **can** serve; it may never say what this project **should** use.

## 5. Feed engineering memory — only as candidates

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs propose [--dry]
```

Repeated "technology behind the project's own abstraction" registrations become an `observed`
engineering candidate, judged and reconciled by `engineering`'s own door. It can never become
`adopted` or `enforced` from here — only a person (`engineering record --human`) can.

## 6. What you may never do

- **Never report a declared package as used**, or a used client as used *for* something the
  code does not show. The unknowns on each fact say what is not settled — repeat them.
- **Never copy a literal out of the code into anything you report**: connection strings,
  URLs, secrets and tenant names live in literals, and the analysers never read them.
- **Never widen a scan.** If the deterministic answer is `unknown`, the architecture scanner
  agent investigates ONE bounded question; it does not re-read the solution.
