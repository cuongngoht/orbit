# Contract map: what Satellite uses of Orbit, and through which door

Satellite adds no second identity, store, journal door, resolver, factory or process launcher. Its engine
(`satellite/src/`) imports only Orbit's LEAVES -- `satellite/test/boundary.test.mjs` holds the list -- and everything
that touches an owner, a disk, an environment or a process is bound once, in `satellite/cli/bind.mjs`, and handed in.

## Leaves the engine imports

| Orbit module | What Satellite takes from it |
|---|---|
| `src/hash.mjs` | `sha`, `short`, `canonicalJson`: every digest, fingerprint and pin |
| `src/errors.mjs` | the typed stops: `Refused` (exit 2), `Blocked` (exit 3) |
| `src/scrub.mjs` | masking by shape at every write door, and `scrubFields` over the free-text fields |
| `src/store/lock.mjs`, `src/store/atomic.mjs`, `src/store/id.mjs`, `src/store/revisioned.mjs` | `withLock`, `writeAtomic`, `checkedId`, `revisionFor`/`checkRevision` |
| `src/store/control.mjs` | the machine's state rooms, for the policy file's place |
| `src/project/boundary.mjs` | `contained`: every path checked through symlinks |
| `src/goal/spec.mjs`, `src/goal/fields.mjs` | `normalizeSpec`, `digestOf`, `titleOf`: the goal as submitted, digested once |
| `src/printable.mjs` | text made printable before a terminal sees it |
| `src/learn/args.mjs` | `flag`, `has`, `words` |
| `src/live/presentation.mjs`, `src/live/words.mjs` | the viewer's own state (CONNECTING · ORBITING · IDLE · FINISHED …), kept apart from a lifecycle |
| `src/live/orbit.mjs`, `src/live/render/width.mjs`, `src/live/render/ansi.mjs`, `src/live/render/lines.mjs`, `src/live/tui/glyphs.mjs`, `src/live/tui/sections/parts.mjs` | the header's orbit, `drawn()`, the one escape emitter, ASCII glyphs, segments |

## What the composition root binds

| Port | Orbit's door | Satellite uses it to |
|---|---|---|
| project, store, io | `runtimeProject` → `machineContext` (`src/runtime/context.mjs`, `src/store/context.mjs`) | find this checkout's store root and its guarded io; nothing is computed by hand |
| a person's limits | `readAutomation`, `effectiveOf` (`src/automation/settings.mjs`) | narrow every mission by Orbit's own automation settings, machine then project |
| engineering tasks | `createTasks`, `modelOf`, `taskView` (`src/task/`) | read a task back: lifecycle, verification rows, check receipts |
| QA investigations | `createInvestigations`, `modelOf`, `OUTCOMES` (`src/investigation/`) | read an investigation back: lifecycle, findings, defects |
| starting a task | `node cli/autonomous-engineering.mjs start "<objective>" --json`, argv only, `ORBIT_LIVE=off` | start the one task an implement unit runs in; never a shell |
| recalling | `node cli/context.mjs --for-stdin --json`, `node cli/knowledge.mjs claims --json` | memory first, read-only |
| resolving a capability | `effectiveResourcesOf` + `realWorld` + `resolved` (`src/resources/compose.mjs`, `skills/orbit-control/world.mjs`, `src/knowledge/verify.mjs`), with the project's capabilities loaded by `withExtensions` | ask the same registry the router and Orbit's coordinator ask |
| invoking a capability | `invokeBound` (`src/work/invoke.mjs`) with `mcpInvokeContext`, bound by `resourceOf` + `fingerprintOf` | one read-only call through the broker or the capability pipeline |
| Orbit's skill factory | `factoryPort` (`skills/orbit-help/factory.mjs`), narrowed by `narrowedFactory` | scaffold, put, verify, register and read a playbook -- never a person's status, archive or rollback |
| the checkout | `git rev-parse` and `git status`, argv only, through `createProcess` (`src/process/index.mjs`) | witness the primary checkout before and after a run |
| liveness | `createProcess().alive` and `startedAtOf` | tell a dead worker's lease from a live one; a reused pid is never taken for its owner |
| this session's tool calls | `sessionActivityOf` over the working set's tail (`src/live/session.mjs`, `src/project/runtime.mjs`) | show them beside a mission, attributed to no agent run |
| the session mark | `taskSessionMark` (`src/memory/session.mjs`) | one viewer and one sessions file per session |

## Viewer primitives the Live roots use

`createFollower` (`src/store/follow.mjs`), `decodeKeys` (`src/live/tui/keys.mjs`), `changedRows`
(`src/live/tui/diff.mjs`), the alternate-screen and cursor sequences (`src/live/render/ansi.mjs`), and Orbit Live's
openers (`cli/live-open.mjs`: `openerOf`, `openPlan`, `typed`, `passedEnv`).

## What Satellite never touches

Another owner's journal (a task's, an investigation's, a workflow's), Orbit Control's door (`door: "control"`) or the
coordinator's, an approval, a resume, `--human`, a setting, a playbook's status, the MCP host configuration, a secret
store, a package manager, a shell line, the primary checkout's files, `git commit`, `push`, `merge` or a deploy.
`satellite/src/governance.mjs` lists these as `NOT_SATELLITE`, and the tests grep for them.
