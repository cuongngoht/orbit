# ADR 0039 — A sandbox topology is composed from discovery

## Status

Proposed (0.1.0). Amends the AGENTS.md rule "Orbit never touches … a container's networking" with one scoped
exception. Extends ADR 0011 and ADR 0014.

## Context

1. **The whole closure has to run.** A backend obligation needs its dependency closure running in the sandbox: the API
   if there is one, a scheduler, a broker, producers, consumers, a database, a cache, a sink. A consumer-only backend
   has no HTTP health endpoint at all.
2. **A compose file is the wrong place to hold isolation.** Running a project's compose file would hand Orbit's
   isolation to a language that can declare host mounts, privileges, host networking and published ports.
3. **The dev container route leaves siblings running.** It deliberately leaves the unlabelled siblings of a compose
   project running (`src/runtime/providers/devcontainer.mjs:284-295`). That is right for a person's environment and
   wrong for a task's.

## Decision

- **The topology is derived by three ordered tables** in `src/runtime/sandbox/topology.mjs`. Their inputs are the
  runtime understanding, the System Graph closure handed in as data, and catalog rows.

  | Table | Rows, in order |
  |---|---|
  | `IMAGE_SOURCES` | a compose image or build; a Dockerfile; a dev container build; a catalog requirement's images; else a gap. Each is resolved to a digest |
  | `NETWORK_MODES` | compose service names as aliases; a shared namespace when the project runs against localhost. Colliding ports are BLOCKED, naming both |
  | `READINESS` | a person's setting; a declared signal; catalog handshake data; the adapter's readiness operation; HTTP only where declared; TCP accept, reported as "accepts a connection, not ready"; running |

  Volumes, published ports, privileges, network mode and devices are never carried over. An environment interpolated
  from the host is BLOCKED and needs a person.
- **A compose file is read, never run.** The isolation provider creates each container from argv, labelled with the
  checkout, the environment and the task, and receipted before it exists.
- **Trust is by fingerprint, through Control.**
  - A topology's fingerprint is the sha over its digests, argv and mounts.
  - `topology`, `worker-image` and `adapter-image` join the trust kinds. Only Control's door grants them.
- **`PREPARE_STEPS` gain TOPOLOGY → NETWORK → SERVICES → READINESS → ATTEST**, each receipt-first.
- **The scoped exception.** For a task's sandbox, the isolation provider creates, attaches and removes an INTERNAL
  network of the task's own. The network is:
  - labelled, and receipted before it exists;
  - joined only by containers Runtime created;
  - removed only when its labels and receipt prove it Orbit's and nothing else is attached.

  Orbit still never touches a VPN, a route, DNS, a firewall, or any network it did not create.
- **Teardown has an order** (`TEARDOWN`):
  1. stop triggers;
  2. keep observers until their windows close;
  3. freeze evidence;
  4. let in-flight work settle;
  5. clean fixtures in reverse dependency order, with receipts;
  6. stop containers by receipt;
  7. remove the network;
  8. release leases.

  A step that cannot be proven leaves the sandbox QUARANTINED, which only Control releases.

## Consequences

- A topology nobody can derive is a gap that names what is missing.
- The dev container route is unchanged for a person's own environment.
