# ADR 0014 — A sandbox is an environment scope a task owns, not a runtime engine; execution is delegated; evidence is bound to a source tree

**Status:** accepted, 1.7.9

## Context
1.7.8 gave a task its own workspace (ADR 0013) and left one hole open: everything that VERIFIES the
change live — the runtime's start, Autonomous QA's origin check — was bound to the developer's
checkout. A developer's server on the expected port reads as "the application is up", so QA could
test code the task never touched, and a green result would be evidence of something else.

Fixing it needs four things the runtime did not have. A session lookup that is per environment (it was
per checkout, matched by component: `env` was written and read by nothing). A root other than the
checkout to start from (every provider's `cwd` and a container's workspace folder came from it). A
source port that reads what a workspace HOLDS (it read HEAD, and a task's edits are uncommitted). And a
way to give two tasks and a person the same default port without any of them taking another's.

## Decision
1. **A sandbox is an environment instance of kind `sandbox` with an owner.** It belongs to a task, to
   that task's workspace and to the source tree it was built from. It is runtime's document, never the
   task's or the orchestrator's state, and it inherits the checkout's project, store and identity: it is
   not a second project.
2. **Execution is delegated.** The sandbox provider places each component on the native or the dev
   container provider and adds no way to run a process. The Process port stays the one door, and a
   container is found by labels (checkout, environment, task, workspace), never by name.
3. **A port is leased, never taken.** Leases are machine-global and per host; one is a receipt written
   before anything listens; a port something else holds blocks the start and names its holder; nothing
   Orbit does frees, moves or signals it. A component learns its port through an override the project's
   own data declares (an environment name or an argument), and with no such evidence its port is fixed
   and a collision is BLOCKED, never guessed.
4. **Live evidence names a source tree.** A session, a task's receipt and an investigation bound to a
   sandbox carry the tree they ran on. A workspace that moved past it makes the sandbox STALE (derived,
   never written by whoever edited), and the QA gate `RUNTIME_STALE` holds. A stale sandbox is evidence
   of something else, never of the change.
5. **Restoring dependencies and building a definition are a person's trust, by fingerprint, through
   Orbit Control.** A restore plan's fingerprint covers its argument list and the manifests and lock files
   it reads; a definition's covers its files. A change voids the trust. An untrusted one is BLOCKED with
   `needs=person` and runs nothing. A terminal cannot prove a person, so the CLI cannot grant it
   (ADR 0012's rule for grants).
6. **A sandbox never reuses a developer's application, and a developer never reuses a sandbox's.**
   `reuseExternal` does not reach inside one; a held port is somebody's, and the sandbox leases another
   or is blocked. Cleanup ends only what an ownership proof names: the task's own sessions, its leases
   and its labelled containers.
7. **Control reads a task's sandbox through the task's own receipt and acts only through runtime's
   ownership rules.** No body names an environment, a session or a path; Stop and Release are a
   person's; nothing there starts a sandbox, because starting is the agent's decided step.

## Consequences
- The orchestrator gains two closed actions (`prepare-sandbox`, `start-sandbox`) and a receipt domain;
  it keeps no lifecycle of its own and decides no readiness.
- Autonomous QA can investigate the change itself, inside the modes and browser strategy a person set.
- What is still not done is explicit: live evidence as a completion condition (1.8.0), a signed-in
  browser profile for a sandbox, a restart button in Control, a leased port for a container-placed
  component (a generated per-sandbox definition), and any cloning or seeding of data.
