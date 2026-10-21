# ADR 0038 — Generated tests run only in a proven isolation provider's worker

## Status

Proposed (0.1.0). Extends ADR 0014 (sandbox) and the AGENTS.md rule that generated executable code is a trust boundary.

## Context

1. **The sandbox proves ownership, not isolation.** Its provider delegates to native or dev container placement
   (`src/runtime/providers/sandbox.mjs:1-10`). Ownership of a workspace, a process and a port is proven; isolation of a
   filesystem, a network or a credential is not.
   - `HARD.listen` is asserted only by a test (`src/runtime/sandbox/policy.mjs:136`).
   - `network.denyProductionWrites` is defaulted and validated, and read by nothing (`policy.mjs:43,76`).
2. **`expect` can reach the whole host.** It runs through `new Function` in the Node process (`src/run/verdict.mjs:25`),
   where it can reach `process.getBuiltinModule` and a dynamic `import()`. That is acceptable for a case a person wrote
   and reviewed. It is not acceptable for text a model generated.
3. **A worker's word is not proof.** A worker's own claim of PASS is worth nothing if the worker can be steered.

## Decision

- **An isolation provider is a contract.**
  - `orbit.isolation-provider/v1` (`src/runtime/isolation/contract-v1.mjs`) declares what a provider proves
    (filesystem, network, credential, limits) and how it creates, inspects, stops and removes networks and containers.
  - Docker is the first provider (`src/runtime/isolation/docker.mjs`, argv through the Process port).
  - On a host with no provider, active generated tests are BLOCKED with a capability gap; discovery and validation
    continue. A native process or a dev container proves nothing.
- **The profile is attested at prepare and again at every dispatch** (`PROFILE`, `src/runtime/sandbox/isolation.mjs`),
  from what the provider reports:
  - the root filesystem is read-only;
  - no host home, vault, control socket or store is mounted, and the plugin is mounted read-only;
  - the container is attached only to the task's internal network and publishes no ports;
  - it is unprivileged, with capabilities dropped and no-new-privileges;
  - CPU, memory and pids limits are set;
  - environment names stay inside the allow-list;
  - an egress probe from inside fails.
- **The worker runs the pinned runner** (`cli/sandbox-worker.mjs`, `run-case --worker`) on a trusted image pinned by
  digest. The frozen case, the sidecar and the compiled design are mounted read-only; output and store are scratch.
  Credentials arrive only on stdin, and the browser runs inside the worker.
- **Only the host writes authoritative records.** `src/run/envelope.mjs` first checks:
  - ids against the dispatch receipt, and digests against the frozen version;
  - the image digest and attestation against the provider's own inspect;
  - every file's sha and size.

  It then re-derives the status and `proved` from the frozen case; a claim that disagrees is an EXECUTION_ERROR. Only
  after that does the host write the ledger line, the evidence and the investigation's run line.
- **Generated predicates are compiled.**
  - `src/run/evaluator.mjs` has two modes. Inline is today's `new Function`, kept for accepted, person-authored cases.
    Compiled is a pure op-table interpreter over the predicate tree kept in the sidecar.
  - The digest of the canonical rendering is checked immediately before the run.
  - A generated predicate outside the templates is INVALID_TEST.
  - A non-template predicate, when a later gate allows one, runs in a separate process: it receives observations,
    returns an evaluation, has its own timeout and has no mounts.

## Consequences

- AGENTS.md gains the rule. `cli/evaluate.mjs` is reserved for that later gate.
- Isolation is attested per platform. A host without a provider, Windows CI for instance, reports the gap.
