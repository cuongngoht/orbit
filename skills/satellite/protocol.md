# Orbit Satellite -- the shapes a host sends and receives

The machine-readable source of every shape here is `node ${CLAUDE_PLUGIN_ROOT}/satellite/cli/satellite.mjs protocol`
(no checkout needed). This page is its summary; when they differ, the command is right.

## A decision (`mission step <msn>`, on stdin)

```json
{ "schemaVersion": 1, "decisionId": "yours-1", "expectedRevision": 14,
  "action": { "kind": "dispatch", "unit": "wu-2" },
  "observed": "one sentence of what the context showed", "hypothesis": "optional, one sentence" }
```

`action.kind` is one of `analyze`, `recall`, `plan`, `replan`, `resolve-role`, `resolve-template`, `resolve-skill`,
`write-skill`, `validate-skill`, `register-skill`, `resolve-workflow`, `dispatch`, `invoke`, `skip`, `cancel-unit`
and `checkpoint`; `protocol` lists each one's fields. A decision never carries `outcome`,
`verdict`, `status`, `mode`, `operationKind`, `level`, `lifecycle`, `grants`, `confidence` or `revision`: each is
refused by name. The same `decisionId` twice is a replay; a moved `expectedRevision` is STALE.

## A capability asked for a run (`invoke`)

```json
{ "kind": "invoke", "capability": "runbook.search", "agentRun": "arn-1", "tool": "search",
  "input": { "q": "nightly timeout" }, "expects": ["cause", "file"] }
```

The resolver picks the provider at that moment, and the call goes through Orbit's own door for it -- the MCP broker,
narrowed to reading, or a project's capability pipeline with no case -- once, outside the mission's lock. While it is
open the run shows `DISPATCHING` on top of its own mode; once recorded, its own mode again. The answer is in
`result.answer` once and kept nowhere: the journal keeps the receipt's digests. An answer holding every `expects` field
is CONTRACT_MET, any other TOOL_COMPLETED -- the provider's word, never VERIFIED. Refused with nothing asked:
`RUN_NOT_OPEN`, `NOT_GRANTED` (a run whose mode reads through no provider), `CAPABILITY_UNPROVIDED`,
`CAPABILITY_APPROVAL`, `CAPABILITY_HOST_ONLY`, `CAPABILITY_CONNECTION`, `INVOKE_SECRET`. A call its door says wrote
counts for nothing.

## An envelope (`dispatch` answers it; `agent envelope <msn> <arn>` shows it again)

`agent.subagentType` (the plugin agent whose host-enforced tool allowlist carries the profile), `profile`, `mode`,
`operationKind`, `role` (pin, display name, purpose, responsibilities, restrictions, completion criteria),
`instruction.text`, `contextSlice` (the unit, its acceptance criteria, the handoffs it rests on, the playbooks its
skills pin -- never the conversation, never a secret), `grants`, `drive` (for an engineering run: the task and the
commands that drive it), `report` (the command, the shape, an example), and `dispatch.mode` -- `native` (several runs
may be in flight) or `serial` (no native agents here: one run at a time, never shown as parallel).

## Which agent carries a run (0.2.2)

The envelope also names `parentAgentRunId` and `attempt`. On Claude Code the hooks read `missionId` and `agentRunId`
off an Agent call whose prompt holds the envelope's mark (`orbit.satellite.envelope/v1`), and the `agentId` the call
answers with: the run is then HOST_OBSERVED to be carried by that agent, and its calls are the agent's. `agent ack <msn>
<arn> --host-agent=<agentId>` adds the dispatcher's word (REPORTED, an `agentrun.bound` line, the id hashed as the hooks
hash it). Two different agents named for one run, or one agent for two runs, is CONFLICTING. A serial run, and any run
nothing observed, is UNATTRIBUTED. A word grants nothing: no gate, approval or boundary reads it.

## A report (`agent report <msn> <arn>`, on stdin)

```json
{ "schemaVersion": 1, "agentRunId": "arn-2", "executionState": "reported",
  "findings": [{ "say": "one sentence of what was found", "refs": ["file:src/payment/notify.mjs"] }],
  "evidenceRefs": ["file:src/payment/notify.mjs", "task:tsk-0123456789ab", "check:tsk-0123456789ab:chk-2"],
  "remainingUnknowns": ["one sentence each"], "supports": ["hyp-1"], "refutes": [],
  "proposes": { "units": [{ "key": "trace-consumer", "kind": "diagnose", "objective": "…" }], "because": "…" },
  "artifacts": [{ "name": "design.md", "text": "…" }],
  "summary": "one sentence" }
```

`executionState` is `reported` or `blocked` -- what the run itself can say. Evidence references are read back from
their owners: `file:<repository-relative path>`, `task:<tsk-id>`, `check:<tsk-id>:<chk-n>`,
`investigation:<inv-id>`, `handoff:<hof-n>`, `definition:<pin>`. Only an engineering task's verification rows, a
declared check and a QA investigation are independent: nothing else can make a criterion VERIFIED. A report never
says `verdict`, `outcome`, `passed`, `failed`, `level`, `mode`, `lifecycle`, `confidence` or `verified`. `artifacts`
are published only by a DESIGN, IMPLEMENT or VERIFY run.

## What a run comes to (the engine's word)

`succeeded` (evidence reached the unit's verification contract) · `insufficient` (it did not: retried while attempts
are left) · `blocked` · `violated` (the primary checkout changed while the run was open) · `interrupted` (reconcile
closed it). Three failures in a row with one signature stop the mission as NO_PROGRESS.
