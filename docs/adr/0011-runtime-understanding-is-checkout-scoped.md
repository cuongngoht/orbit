# ADR 0011 — Runtime understanding is checkout-scoped, native comes first, and one writer touches the repository

**Status:** accepted, 1.7.6

## Context
"Can this checkout run here, and how?" is a question every team asks and no part of the engine
could answer. Architecture, intelligence and knowledge all describe a PROJECT: one store, one set
of facts, true of the repository wherever it is checked out. What it takes to run a checkout is
not like that. A branch's `package.json` differs from another's, a machine has a runtime or does
not, a port is held or is not, and two checkouts of one product on one laptop are two different
answers. Forcing those facts into a project-scoped store would put the wrong scope on every one of
them; inventing a second identity, a second ecosystem registry or a second way to start a child
process to hold them would split what the engine already agrees on.

The answer also has to hold for many unrelated projects on one machine, for a stack the engine
has never heard of, and without a container: a Dev Container is one way to run a checkout, never
the only one.

## Decision
1. **Five scopes, named once, and nothing new.**
   - Machine: the tools observed, the registry of checkouts. Project: the existing `storeKey`.
     Checkout: `sha(physical root)`, which is already the binding file's name
     (`checkoutId(root)` is now exported, and the session directory derives from it).
     Environment instance: `env-…`, kind `human`. Runtime session: `rs-…`.
   - Durable per-checkout state lives under `<storeRoot>/checkouts/<checkoutId>/`; what is live
     lives in the per-host runtime room, `<storeRoot>/runtime/<host>/checkouts/<checkoutId>/`.
2. **Understanding is its own subject, `src/runtime/`, over the shared infrastructure.**
   - It reuses freshness, confidence, hashing, constraints, schema-stamped documents and the
     memory-first decision table. What was shared by two subjects is lifted once: `createFactRoom`
     (architecture's store is now a thin wrapper over it), `revisioned.mjs` (the compare-and-refuse
     line three settings documents had copied) and `canonicalJson`.
   - It is not a fourth generic fact framework: its kinds (component, requirement, command, port,
     service, readiness signal, environment definition, os constraint) have no row anywhere else.
3. **Memory first, and a gap is not a doubt.** An ordered table decides whether anything has to be
   read. The normal answer is CURRENT: a listing and a fingerprint. Freshness is scoped to the
   evidence files themselves, so an unrelated edit moves nothing. PARTIAL is for what could not be
   read; an informational unknown is a note.
4. **Discovery reads evidence and executes nothing.** Manifests come through the EXISTING ecosystem
   registry, extended additively (nested manifests, target frameworks, launch profiles, `ports`);
   what is not a manifest is a static readers table. A stack no adapter knows is understood from
   what generic readers see, and is `PARTIAL` or `UNKNOWN`, which is an answer. What an agent
   concludes from prose goes through `record` as a hypothesis: `possible`, never counted against a
   machine, never launched, key-prefixed so it can never overwrite what a file said.
5. **A command is launched only as a file declared it.** A shell-free tokenizer refuses shell
   syntax; a start is argv through the Process port; there is no command in a setting, a body or
   a prompt.
6. **The resolver chooses among ways that WORK.** A preference narrows and never widens: it cannot
   make an incompatible way compatible, and it never falls back silently. The classic framework
   that only runs on Windows is catalog data, not a branch.
7. **Starting is a receipt first, ownership is proven, and ready is a separate question.** A session
   document is written before the launch. Orbit may stop only what a receipt, a pid and the pid's
   start time all agree is its own; a port someone holds is reported, with its owner when Orbit knows
   it, and never taken. A process that is alive answers nothing about whether it ANSWERS.
8. **One module writes the repository, and only for a person.** `adopt` writes the files of a
   proposal, only with `--human`, only while the understanding and the environment files are what
   the proposal was made against, and reads every file back to check it. A JSONC edit changes the
   keys it names and leaves every byte and comment around them alone.
9. **Runtime is never a verdict.** What could be checked right now is a projection (browser, http,
   database, test runner: available, blocked or unknown). An investigation gate may say that nothing
   answers where an approved environment is expected; it never says whether the product is right.
10. **The registry is membership by binding, never a scan.** A checkout is known because Orbit was
    used from it. Control lists those and reads no repository; every runtime route names project
    and checkout in its path, and no body can name a directory.
11. **Settings are a person's, per machine, and carry no command.** One revision-protected
    document per checkout in the machine store, a block per host, never committed. Readiness is a
    port or a URL on this machine: there is no `command` probe, because status runs the probe on every
    read and a setting must never be a way to run a program.
12. **A checkout is untrusted data.** Discovery runs nothing; a tool's version is asked from a neutral
    directory so a per-project configuration cannot make it run something; what a file said is made
    printable before a terminal sees it; every reader is linear and a scan is bounded; and bringing an
    environment up -- which can run the definition's `initializeCommand` on the host -- is a person's
    (`--human`), as adopting is. The playbook pre-approves only what reads or keeps something in
    Orbit's own store.
13. **Looking and launching are one step.** A start takes the look for what is running and the launch
    in turn per checkout (a queue inside a process, a lock between processes), and never holds the lock
    across the wait for a server to answer.

## Consequences
- Adding a language is an ecosystem adapter and a catalog row; the resolver, the store and Control
  do not change.
- A package-manager command on Windows is a `.cmd` shim, which cannot be started without a shell
  that Orbit never uses. It is reported ("could not be started: it is not on PATH, or it is a command
  shim that needs a shell"), not worked around.
- The Node adapter now reads nested `package.json` files, so an architecture snapshot of a
  repository with nested packages gains units and is read again once.
- The Process port gains a detached `launch` beside `start` (whose piped, same-lifetime child its
  caller must kill), and `alive`, `signal` and `startedAtOf`; the fake gains the same.
- `detectTool` can answer `unknown` for a tool that was found and did not answer in time, which is
  not `missing`; every reader treats anything but `ready` as not ready.

## Alternatives rejected
- **Runtime facts in the architecture store.** That would give a branch's evidence the scope of the
  whole project.
- **A Dev Container as the runtime.** It is one provider among several, and optional.
- **A "current project" in Control.** Identity in the address means a bookmark, a second tab and a
  reload all say the same thing.
- **A registry of recognisers for non-manifest formats.** Nothing registers from outside; a
  project's own adapter already reaches discovery through the ecosystem registry.
