# Orbit current-contract implementation

| Component | Current responsibility and consumers | Decision | Verification |
| --- | --- | --- | --- |
| project / store | Repository identity, explicit data home; all CLI and Control contexts | Layout 3 only, no discovery or mirror | Storage, containment, fresh-install tests |
| extensions / capabilities | Validate modules before registry mutation; runner and report parts | Direct extension v2 and capability v1 contracts | Loader, real execution, negative contract tests |
| MCP | Managed resources and observed external resources; broker, CLI, Control | State schema 3; delete historical conversion and actions | State, invocation, HTTP 404, Control UI tests |
| automation / goals | Evidence-governed orchestration; CLI, Live, Control | Settings schema 3, plan schema 2, playbook manifest and registry schema 2 (0.0.4: optional `runs`), declared workflow `orbit.skill-workflow/v1`, goal v1 with a required structured `intent`; strict reads | Workflow, approval, goal, skill-run and fresh-install tests |
| knowledge / engineering | Contextual claims and independent evidence | Journal v3, evidence v2; no seeded support or projection wrappers | Reconciliation, replay, observer and knowledge tests |
| report | Snapshot-based project reports and extensions | Create current settings directly; remove standalone import | Report command, Python and extension tests |
| runtime | Checkout facts, environment compatibility, owned sessions and sandboxes (autonomous: a trust list is a review mark, never a gate; `adopt` is the primary-checkout boundary) | Keep current platform/service adapters and all safety gates | Runtime, sandbox, scope, review-mark tests |
| hosts / integrations | Native host hooks and VS Code companion | Keep platform protocols; remove historical transport and configuration names | Native fixture conformance, pane tests |
| packaging / UI | Plugin manifests, schemas, committed Control assets | Rebuild from current producers | Release, frontend build and archive scans |
| protected boundaries (0.2.0) | Where a person decides: `src/protected/` read by the task's approvals, the orchestrator, the capability pipeline, the MCP broker, the runtime writer, automation's matrix and Live | Five boundary rows over structured actions; everything else AUTO; the task approval (`boundary`, `destructive`, `shows`) is the only approval; engineering actions `commit` and `push` | `test/protected-boundaries.test.mjs`, `test/protected-bypass.test.mjs`, `test/orchestration-push.test.mjs`, `test/orchestration-approval.test.mjs` |
| satellite (0.1.1) | Mission journals above the owners; `/orbit:satellite`, `satellite/cli/satellite.mjs`, Satellite Live | Mission schema 1, definition, workflow, envelope, report, event and acceptance contracts at v1; additive under `satellite/`, `skills/satellite/`, `agents/satellite-*` | `node --test satellite/test/*.test.mjs`; repository safety, boundary, recovery and opt-in end-to-end tests |

The engine and server retain Node built-ins only. External host and service adapters remain supported
where they implement a current protocol. Runtime OS compatibility and analysis of a consuming project's
migration files are current functions, independent of product-state conversion.

There is no state upgrade, legacy-name lookup, alias namespace, automatic dual read/write, or reset of
unsupported data. An absent document takes its declared defaults; an existing unsupported or corrupt
state document is refused unchanged. Test-data import/export remains a person's explicit publication
of current data, with containment, digests and confirmation; it does not convert persistent contracts.

Product names are Orbit, `orbit`, `ORBIT_*`, `ORBIT_STORE_DIR`, `~/.orbit/` and `orbit.*` for owned
namespaces. External platform identifiers retain their native spelling.

## Fresh installation

Install the plugin for the supported host as described in README. For a source checkout, use Node 20+
for the engine and Node 24.15+ for Control. From a consuming Git checkout:

```sh
node /absolute/orbit/cli/orbit.mjs --help
node /absolute/orbit/cli/orbit.mjs --version
node /absolute/orbit/cli/orbit.mjs doctor
node /absolute/orbit/cli/init.mjs .
printf '%s\n' 'Implement the requested change and verify its acceptance criteria.' | node /absolute/orbit/cli/orbit.mjs goal start --stdin --json
node /absolute/orbit/cli/orbit.mjs goal status <goal-id> --json
```

`query storage --json` reports resolved paths. Read commands create no store; initialization creates
only current project metadata and schemas. Configuration and state from other installations are not
searched. See the implementation handoff for exact gate outcomes and environmental limits.
