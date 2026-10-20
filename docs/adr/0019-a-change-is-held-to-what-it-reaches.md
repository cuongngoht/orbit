# ADR 0019 — A change is held to what it reaches; declared is not required

**Status:** accepted, 1.8.4

## Context

Through 1.8.3 an engineering task completed only when every build and test the checkout declared had
passed since the last change. In a repository of several components, that made one broken, unrelated
component block every task. A frontend change could not finish while a backend build was broken. And a
"fix" for that would be wrong if it were written for one kind of task, one language or one name: the
next repository is shaped differently.

What the code already had, and what it lacked:

- Runtime understanding knew the checkout's COMPONENTS (one per unit an ecosystem adapter read) and
  which declared command belongs to which. It did not know what depends on what.
- Ecosystem adapters read dependency NAMES, a project file's references were not read, and a shared
  build file's reach was known (`src/ecosystems/reach.mjs`).
- The orchestrator kept a baseline (a check run in PLANNING) only to classify a failure, and PLANNING
  ended with `plan`, so a host could not know which checks to baseline before it planned.

## Decision

1. **The component graph is evidence a file states.** An adapter returns the unit's own `name` and the
   units it `references` by path. Runtime's ecosystems reader turns those, plus a dependency on another
   unit of the same checkout by its own name and every shared file that reaches a unit, into `dependency`
   facts. A reference that resolves to no unit read is kept with no target and said as an unknown. No
   import is parsed and nothing is guessed from a directory.
2. **Impact is derived, never chosen.** `src/orchestration/impact.mjs` reads the change's paths (the
   plan's scope before a change, the change's own files after it, a rename's old path included) against
   the graph the composition root hands in. A component is reached when it is MODIFIED, inherits a
   changed SHARED file, is a DEPENDENT of one reached, or is UNRESOLVED (it names something nothing
   resolves, and something changed). Its words are about relations, never about stacks or task kinds.
3. **Declared is not required.** `src/orchestration/obligations.mjs` holds a change to the declared checks
   of what it reaches, and only those. Every other check is NOT AFFECTED, NOT RUN: refused in the checking
   stages, published as `not-applicable`, never as a pass. With no graph to read, every component with a
   check is held to it (WIDENED), which is the 1.8.3 rule.
4. **Unknown is never success.** A changed path no component holds, or a changed component with no test
   or verify command of its own nor of anything that depends on it, is MISSING. It is published as a
   `blocked` verification row, fails the review (class CAPABILITY), and blocks completion
   (`COVERED`). Only a person, or a declaration in the checkout, settles it.
5. **A baseline decides what a failure means.** A check's baseline is its last run before the code first
   changed, on the pinned base revision. A failure with the same signature is `failed-as-before`. It is
   kept visible (the action still failed, its receipt says so), it settles the check, and it is never a
   pass. A failure that passed at its baseline, failed differently there, or has no baseline is a
   regression and fails the attempt. At least one required test or verify command must pass (`VERIFIED`).
   Hardened after the commit's security review, so that none of it can be gamed by the host that drives
   the loop. A baseline counts only if it ran on the base revision's own tree, so a failure made on purpose
   before the change is not "old". "As before" compares the whole output, nearly verbatim, never the
   NO_PROGRESS signature, which merges failures that differ only in a value. A check counts only if it ran
   on the tree `record-changes` recorded. A review fails while the workspace holds unrecorded edits. A
   component the graph does not know, or a reference an adapter cannot evaluate, is unknown, and unknown is
   held to its checks. A second review added three rules. A check's tree is named before AND after it runs,
   so an edit made in between leaves the run with no tree. A run with anything ignored beside it is never a
   baseline, because a git tree leaves ignored files out, including the clone's own `.git/info/exclude`, so
   the base revision was not all it ran on. An output the runner kept only in part has no exact identity.
   Each of these fails closed: what cannot be named is a regression, never a pass. A third and a fourth
   review moved the naming out of the host's reach. The tree, the ignored count and a stamp come from a
   FRESH bare git directory, made in a new temporary directory for each look and removed after it. It has
   its own index and no system or global configuration, so neither a `--skip-worktree` flag, a clean
   filter or an exclude file in the clone, nor a git directory planted beforehand, nor a filter in a global
   config can make edited files read as the base revision. The base tree is read in the developer's
   checkout with replace refs off. The stamp is the newest CHANGE time (ctime) among the tree's files,
   taken before and after each check. A file edited and put back during a run moves it, and an
   unprivileged process cannot set a change time back. A file whose change time cannot be read makes
   the stamp null, never a stamp that cannot move. The anchor's git also gets an empty HOME and
   XDG_CONFIG_HOME, so a per-user default ignore or attributes file decides nothing.

   **Where the gate stops.** It verifies the RECORDED change: what git, unconfigured, says the
   workspace's files hold. What the project's own ignore rules leave out is environment, the way a CI
   runner's cache is: installed dependencies, build output, and files an ignore file hides. No run beside
   any of it is ever a baseline, because no tree names it. A check after the change runs on whatever the
   workspace holds, those files included, exactly as it would on a developer's machine, and the gate
   cannot fingerprint all of it at a cost a check can bear. A host that plants code in ignored files, or
   rewrites Orbit's own store, the user's git configuration or the journal, is outside what any check
   could detect. The journal shows what ran, and a person's review is where that is caught.

   The same line covers a tracked symbolic link. The tree records the link, meaning where it points, and
   the stamp reads the link's own change time. A target inside the tree is a tracked file with its own
   change time in the stamp. A target outside the tree is environment, like an ignored file: an edit to
   it during a run is not seen, by the same design and for the same reason. A sixth review raised this,
   and it was accepted on that reasoning, not changed. What remains outside the gate is a host that
   rewrites Orbit's own store, which a journal already cannot defend against and a person's review catches.
   `plan` therefore stays in PLANNING, and `implement` begins the first attempt, so the checks a plan
   reaches can be baselined first.
6. **Runtime evidence is conditional.** A reached component's kind says how it would be looked at
   running (`live` on runtime's COMPONENT_KINDS: browser, http, messages …). That is a recommendation.
   Once the task links an investigation, its evidence must be about the tree the workspace holds now
   (`LIVE`).
7. **The plan is published, never stored beside the journal.** It is derived on every read. For a viewer
   it lands on the journal as verification rows and one `impact` receipt per plan and per change, so Orbit
   Live and Mission Control draw it with no graph of their own.

## Consequences

- An unrelated failing component no longer stops a task. An affected failing one still does.
- A task whose objective is to fix a failure that was already there can complete without fixing it, when
  that check fails exactly as before and another required check passes. The requirement's own
  verification is where "did it do what was asked" belongs, and the review and the requirement remain
  the person's. This is the price of not letting pre-existing failures block, and it is said here on
  purpose.
- A documentation-only change in a checkout with no component for its documentation is MISSING. It does
  not complete autonomously until something declared verifies it or a person ends it.
- Lint, typecheck, validate and verify scripts are now discovered as `verify` commands.
- What depends on what is only as good as what manifests state. An undeclared runtime dependency (one
  service calling another over the network) is not an edge. It is no worse than 1.8.3 for a change
  inside a component, and the reason the plan says WHY each component was reached.
