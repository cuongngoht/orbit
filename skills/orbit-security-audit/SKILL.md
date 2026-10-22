---
name: orbit-security-audit
description: >
  Assess a project against the security catalogs it is held to, from evidence and standalone: no
  goal is needed. It opens a task, reads which catalogs are in effect (the ones a person enabled
  in Orbit Control, or Orbit's default), works out where each control applies over the System
  Graph, hands the security obligations to QA to test inside a sandbox, and keeps an assessment
  snapshot that pins the catalogs it used, linked to the task as a receipt. Use when asked for a
  security assessment, whether an application meets a security standard's controls, or to check
  access control, tenant isolation or token handling against a catalog. It never fetches, adopts,
  enables or edits a catalog and never marks a control not applicable (those are a person's, in
  Orbit Control), never grants itself anything, never calls a proposal a vulnerability, never
  gives a severity number and never says a system is compliant.
argument-hint: "assess this project | assess the orders API against the enabled catalogs | resume tsk-…"
allowed-tools:
  - Read
  - Glob
  - Grep
  - AskUserQuestion
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/security-audit.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/task.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/query.mjs storage*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host. On Codex and Antigravity there is no native subagent: follow the orbit-security-auditor agent's steps in the main session.

**Storage paths:** read `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`
and run `query storage --json` before working with project files. `$DATA`, `$SCRATCH`,
`$REPORTS`, `$RUNTIME` and `$EVIDENCE` below are the resolved paths from that command.

# Assess from evidence. A person chooses the standard.

**Two shared references, the same for every `orbit-*` playbook.** Read the one you need; do not
re-derive what is in them:

- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` — which Claude Code tool does
  which QA job, what to do when an optional one is not in this session, and the lines that do not
  move.
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/dsl.md` — how to read the JSON DSL off the
  tables that define it, instead of from memory.

| | who | decides |
|---|---|---|
| which catalogs exist, which a project follows, which controls do not apply | a **person**, in Orbit Control (Security → Catalogs) | adopt · enable · mark not-applicable |
| where each control applies, what it owes, what its evidence came to | **this skill** and the orbit-security-auditor agent | applicability · obligations · the assessment |
| the tests, the sandbox, the grant, the verdict | **orbit-qa** and the engine | nothing here re-judges them |

`<engine>` below is the plugin root.

## 1. Open a task — the audit is its own execution

A standalone audit needs no goal. It is a task in this checkout, so Orbit Live and Mission Control
show it, and every receipt it keeps is linked there:

```bash
node <engine>/cli/task.mjs create "Security assessment of <the project or the part asked>"
node <engine>/cli/task.mjs stage <task> CONTEXT --because="read the catalogs in effect and the graph"
```

## 2. The catalogs in effect

```bash
node <engine>/cli/security-audit.mjs catalogs
```

It prints the catalogs this project is held to — the ones a person enabled, each pinned by digest
and maybe filtered by level or group, or Orbit's default (ASVS 5.0.0 Level 1, with OWASP Top 10 2025
and API Security Top 10 2023 as labels) — and any catalog refused, with why. If the person wants a
different standard, another level, their own policy, or a control marked not applicable, tell them
where: **Orbit Control → Security → Catalogs**. Never fetch a catalog, never write one, never mark a
control yourself; `security-audit.mjs adopt`, `enable` and `mark` refuse from a terminal on purpose.

## 3. Where each control applies, and what it owes

Use the System Graph the reverse engineering produced, as a file (its nodes and relations by
structural role, and whether it is complete for its scope). Without one, every control is
applicability-unknown — say so; do not guess one from file names.

```bash
node <engine>/cli/security-audit.mjs applicability --graph=<graph.json>
node <engine>/cli/task.mjs stage <task> PLANNING --because="the obligations the applicable controls owe"
node <engine>/cli/security-audit.mjs plan --graph=<graph.json> --json
```

Hand the obligations to QA (the orbit-qa playbook): each names its control, its shape, the boundary
it may claim, the controls its verdict needs — a **positive** (the allowed actor can), a
**negative** (the refused actor cannot), a **state** (nothing else changed) — and its assertion
templates. QA designs the tests, runs them in a sandbox under a grant, and verifies them; you run
nothing. A control only design or process evidence can settle stays not-tested until a person
provides that evidence.

## 4. The assessment, kept and linked

```bash
node <engine>/cli/task.mjs stage <task> REVIEWING --because="assess the controls from QA's evidence"
node <engine>/cli/security-audit.mjs assess --investigation=<inv-id>           # from QA's own record: evidence that can verify
node <engine>/cli/security-audit.mjs assess --results=<results.json> --graph=<graph.json>   # a file: shown, never proof
node <engine>/cli/task.mjs link receipt <task> --domain=assessment --ref=<asm-id> --summary="<the counts by conclusion>"
node <engine>/cli/security-audit.mjs report <asm-id>
node <engine>/cli/task.mjs complete <task> --summary="<what the assessment came to, and its gaps>"
```

What the conclusions mean is the engine's, in an ordered table — report them as they are:

- **verified** — every piece of minimum evidence satisfied, on fresh, accepted oracles read back
  from their owners, within this scope only;
- **finding** — a negative or state control saw an access or a field it must not reach; **confirmed**
  only when every condition holds, otherwise **suspected**, with what it still needs;
- **inconclusive** — a positive control that did not pass makes every refusal beside it prove
  nothing; or the evidence could not decide;
- **pending** — what it still owes; **not-tested** — design or process evidence a person provides;
- **not-applicable** / **applicability-unknown** — from the graph or a person's mark, never guessed.

With `--investigation`, each control in effect is answered by every generated test whose obligation's
shape it names, one result per control role the test's design ran, read back from the investigation's
journal and the run log its host kept; a role earns a word only from the steps of the frozen case that
show it. Evidence in a results file is REPORTED: it is shown and never proof. A finding has an impact,
preconditions, a confidence, a reproducibility and a scope — never a severity number. An assessment
is evidence about the controls in its scope, never a certification: do not call a system compliant.
When a catalog in effect changes, `report` says the snapshot is stale and why.

When the host has subagents, delegate steps 2–4 to the **orbit-security-auditor** agent: hand it the
task id and the graph file, and relay what it returns.
