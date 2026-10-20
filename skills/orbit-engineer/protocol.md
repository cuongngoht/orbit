# The autonomous engineering protocol

What the host sends each step, and what comes back. The tables themselves are printed by
`node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-engineering.mjs protocol --json`; this page explains
them and keeps no second copy of a field list that could drift.

## The decision

```json
{
  "schemaVersion": 1,
  "expectedRevision": 37,
  "action": { "kind": "check", "command": "rt-command-0000a7e5" },
  "observed": "the build passed after the change to the refund validator",
  "hypothesis": "the over-paid case is rejected now",
  "reason": "the targeted test covers exactly this rule",
  "evidence": ["check:chk-12"]
}
```

- `expectedRevision` is the task's `revision` as `context` printed it. Anything written since — by
  you, another host or a person — refuses the decision as `STALE`, so one decision runs once.
- `observed`, `hypothesis` and `reason` are one sentence each, at most 240 characters.
- `evidence` cites ids this task recorded: an action (`act-n`), an attempt (`att-n`), a decision, an
  approval or a receipt (`check:chk-n`, `runtime:rs-…`, `sandbox:env-…`, `investigation:inv-…`).
- `approval` (`apr-n`) only when re-sending an action a person approved in Orbit Control.
- Refused by NAME, never ignored: `outcome`, `verdict`, `status`, `passed`, `succeeded`, `success`,
  `done`, `completed`, `stage`, `signature`, `failureSignature`, `class`, `confidence`, `approved`,
  `granted`, `human`, `door`.

## The actions

| kind | fields | what it does |
|---|---|---|
| `check-requirement` | — | reads the requirement back: the snapshot, newer snapshots, blocking questions, moved sources, the work |
| `gather-context` | `for`? | project context, memory first; sections come back in `data` |
| `check-environment` | — | runtime understanding and readiness of the declared checks |
| `start-runtime` | `component`? | runtime starts what the checkout declares; the task owns what it started |
| `prepare-workspace` | — | the task's own local clone at its base revision |
| `prepare-sandbox` | — | the task's sandbox, an environment of its own, prepared at the workspace's tree; blocked `needs person` until a person trusts it in Control |
| `start-sandbox` | `component`? | starts the declared application from the workspace's changed code in the sandbox (preparing it, replacing a stale one); an application that stops by itself fails the attempt |
| `plan` | `intent`, `scope` | the smallest change, and every repository-relative path it may touch; the engine answers with the verification plan the scope reaches, and the task stays in PLANNING |
| `implement` | — | opens the change (from PLANNING, after a plan, it begins the first attempt); the host edits the workspace, then `record-changes` |
| `record-changes` | — | reads the change back from the workspace as changed files, and recalculates the verification plan from them |
| `check` | `command` | one declared build, verify or test command, by id; in BUILDING, TESTING and REGRESSION only one the change is held to |
| `diagnose` | `then`: `fix` · `retest` | records the diagnosis and opens the next attempt |
| `link-investigation` | `investigation` | an Autonomous QA investigation's outcome, in its own words |
| `invoke` | `capability`, `input`? | a project capability; one that changes state needs a person's approval |
| `review` | — | the whole change against the plan's scope; it also fails when something the change reaches has nothing declared that verifies it |

A sandbox's receipts (`sandbox:env-…`, and the `runtime:rs-…` of what it runs) name the environment and the
source tree they were taken from — never a path, a port or a URL. `context.sandbox` and `context.evidence`
say whether the sandbox still matches the workspace, and whether live evidence is `current`, `stale`,
`pending` or `none`.

## The verification plan

`context.verificationPlan` is the engine's, derived on every read, and you never choose it. Its scope
is the plan's `scope` before a change exists, then the change's own files. It says which components
that scope reaches and why: `MODIFIED`, `SHARED`, `DEPENDENT`, `UNRESOLVED`, or `NO_GRAPH` when no
component graph could be read. Runtime understanding read the graph from the checkout's own files.

- `required` lists the declared checks of what the change reaches, each with a `state` and a
  `baseline`. The states are `owed`, `running`, `passed`, `failed-as-before`, `regressed` and
  `unstarted`. A baseline is `passed`, `failed` or `none`. Completion is held to these checks only.
- `excluded` lists every other declared check as `NOT_AFFECTED`. It is not run, and it is never a pass.
- `missing` lists what the change reaches that nothing declared verifies: a path no component
  holds, or a changed component with no test or verify command of its own or of a dependent. It
  blocks completion.
- `baselineFailures`, `regressions` and `live` follow. `live` names the components worth seeing
  running and how (`browser`, `http`, `messages` …).

A **baseline** is a check's last run before the code first changed. Run each required check after
`plan` and before `implement`. A failure after the change with the same signature as its baseline is
`failed-as-before`. It stays visible, it is never a pass, and it does not block. A failure with no
baseline is an unknown comparison, so it is a regression. The task's journal carries the same
picture as verification rows plus one `impact:imp-n` receipt per plan and per change, so Orbit Live
and Mission Control show it too.

Which actions a stage allows is in `context.allowed`. Anything else is refused as `STAGE`, and
nothing is written.

## What comes back

A step answers with `action`, `kind`, `outcome` (`succeeded` · `failed` · `error` · `open`),
`summary`, `reason`, `receipts`, `failure` (`class`, `confidence`, `because`, `signature`), `data`
(context sections, a failure excerpt, the workspace path), and then `revision`, `lifecycle`, `stage`,
`attempt`, `completion` (in REVIEWING), `stop`, `allowed` and `next`.

A step that ran nothing answers with a `state`:

- `waiting-approval` — a person must allow the action, once.
- `stopped` — the evidence ended or blocked the task: a requirement that moved, no progress, a
  spent budget.
- `caught-up` — what a pause held back was applied; decide again.
- `cancelled` — a person cancelled the task. What it started was asked to stop, and the answer is
  in `cleanup`.

## Refusals (exit 2, nothing written)

`SHAPE` · `FORBIDDEN` · `FIELDS` · `ACTION` · `TEXT` · `EVIDENCE` · `STALE` · `ENDED` · `PAUSED`
· `WAITING` · `UNSETTLED` · `STAGE` · `FIELDS_OF_ACTION` · `ACTION_CHECK` · `REJECTED` ·
`UNNEEDED` · `APPROVAL_UNKNOWN` · `NOT_GRANTED` · `OTHER_ACTION` · `ASKED`. The task's own write
door may refuse too (`REFS`: evidence that names nothing the task recorded).

A machine that could not answer — a lock another session holds, a tool that is not there — is
BLOCKED (exit 3).
