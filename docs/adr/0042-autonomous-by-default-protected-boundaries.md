# ADR 0042 — Autonomous by default: a person decides only at Protected Boundaries

## Status

Accepted (0.2.0). Amends ADR 0012 (a task's approve-once), 0023 (autonomy enforced per action), 0037 (a fixture
grant's standing policy), 0038 and 0039 (trust in a sandbox's worker, topology, restore and definition).

## Context

1. Orbit's governance was spread over six tables (task, orchestration, runtime, automation, Satellite, Live), each
   re-declaring "never push / deploy / production" in its own words, and ordinary work stopped for a person: a
   capability that declared `mutates` asked a Control approval; a task's own sandbox waited for a person's standing
   trust before restoring its dependencies, building its dev container or starting its isolated topology;
   `validate`, `prepare --apply` and `forget` needed `--human`; autonomous QA was off by default and a task's sandbox
   allowed only `observe`; a fixture grant needed a person's `qa.writes`.
2. The places that DO need a person were not enforced: `runtime adopt` wrote the developer's checkout on a
   self-asserted `--human`, a task workspace's `origin` was the checkout's own path, an MCP server that writes a
   repository could push or merge through a direct call, and nothing recorded what production is.

## Decision

- **Autonomous by default.** Everything Orbit does is AUTO unless it crosses one of five **Protected Boundaries**,
  declared ONCE as rows in `src/protected/boundaries.mjs` (a leaf every executor and viewer reads):

  | Boundary | Action | Decision |
  |---|---|---|
  | `PRIMARY_CHECKOUT_WRITE` | `repository.primary_checkout.write` | DENY — only a person's own act crosses it, once, through Orbit Control's door (a terminal cannot prove a person: an agent can make a pseudo-terminal and knows every id it was shown) |
  | `GIT_PUSH` | `repository.push` | APPROVE_ONCE (a force push is its own action, with its own risk) |
  | `PRODUCTION_DEPLOY` | `deployment.production` | APPROVE_ONCE |
  | `PRODUCTION_DB_MIGRATION` | `database.production.migrate` | APPROVE_ONCE |
  | `PRODUCTION_DESTRUCTIVE_DATA` | `database.production.{delete,truncate,drop,purge,reset,mutate}` | APPROVE_ONCE_DESTRUCTIVE |

  Anything else -- reading, planning, a task's own workspace, a local branch and commit, building, testing, QA, a
  task's own sandbox with its restores, containers and local databases, a staging deploy, an ordinary integration
  write, an action kind nobody has seen -- is AUTO. There is no allow-list.
- **Semantic actions, never command strings.** An executor describes what it is about to do as a structured action
  (`{ kind, environment, …fields }`) and asks `authorize(action)` (`src/protected/authorize.mjs`). A capability call is
  described from its DECLARATION (`effects` gain `deploy`, `migrate`, `delete`, `truncate`, `drop`, `purge`, `reset`;
  an optional `environment`), an MCP tool call from what its catalog row declares the tool is (`protected`: the github
  row names its ref-writing tools) or what the server says of it, a push from the commit, ref, remote and URL digest.
- **Production is declared.** `src/protected/environments.mjs` reads the words Orbit already lets a person or a project
  declare onto one tier; only an explicit production declaration is production, and unknown never is. A write whose
  meaning nobody declared, on a target declared production, is read as the strictest data boundary.
- **One approval mechanism.** An approve-once boundary is asked through the existing task lifecycle
  (`src/task/approvals.mjs`): `request-approval` carries the protected kind as its type, the tier as its environment,
  the boundary's risk text and three new fields (`boundary`, `destructive`, `shows`); one open request per
  fingerprint; granted only through Orbit Control's door on the revision the person read; consumed in the same locked
  append, BEFORE the action starts; expiry; reject is never asked again. `fingerprintOf` moved to the leaf, unchanged,
  so a task and every executor hash an action one way. Immediately before an approved action runs, its fingerprint is
  derived again and must be the one the approval was spent on.
- **Enforcement where the call passes.** The engineering orchestrator asks the leaf for every step
  (`src/orchestration/policy.mjs`); two new actions deliver a verified change -- `commit` (AUTO, the task's own branch)
  and `push` (GIT_PUSH, to the URL the checkout names, never through an `origin`, which a workspace no longer has).
  Neither goes through the workspace's own `.git`, which the task writes: the commit is made in a bare git directory
  beside the workspace that only Orbit writes (it borrows the checkout's objects and stages the workspace's files from
  the base revision), and the push goes from a git directory made for that one push -- so a hook, a URL rewrite
  (`pushInsteadOf`) or a `.git` that names the checkout's own cannot move a commit or an approved push. The capability pipeline (`src/capability/invoke.mjs` `boundary` gate)
  refuses a protected call unless the run carries the fingerprint of exactly the approved action, which only the
  orchestrator sets -- so a UI case, a work's need, a playbook step, a mission and a worker cannot cross. The MCP broker
  refuses a protected tool call outright (it has no task to ask through). `runtime adopt` is the primary-checkout
  boundary; Control's adopt route is a person's door.
- **Friction removed, safety kept.** A task's own sandbox restores, builds and starts autonomously; a person's trust
  list is now a REVIEW MARK a receipt names, never a gate -- except for the one thing a task must not write on its
  own: a dev container command that runs on the HOST (`initializeCommand`) which the task's workspace added or changed
  against the developer's checkout waits for a review mark on exactly that definition. `validate`, `prepare --apply` and `forget` ask nobody.
  Autonomous QA is on by default; a task sandbox opens every mode the engine's gates allow; `qa.modes` and `qa.writes`
  only narrow. Ownership, isolation, containment, fingerprints, minted fixture grants and the destructive-control rule
  are unchanged.
- **Live sees it.** Every journal line is already a task-event; Live words protected approvals from the journal's own
  fields and names the transitions (`protected.detected`, `approval.*`, `protected.executing|completed|failed`,
  `src/live/protected.mjs`). Orbit Control is not changed beyond the adopt route's door: its approval card shows the
  protected kind, the tier, the reason and a risk sentence that carries the details (and DESTRUCTIVE first).

## Consequences

- A fresh task goes from a requirement to a verified, committed change with no approval; a person is asked only to
  push it, to deploy or migrate production, or to destroy production data -- and nothing else waits for them.
- `NOT_ORCHESTRATION` no longer lists push, deploy or production: each is a boundary crossed only on an approval.
  The automation matrix derives its protected rows from the leaf.
- Runtime settings keep their schema: trust lists and `restore.mode` remain readable, so no file is refused on upgrade.
- What remains outside Orbit's engine is said in the README: a host's own shell, opaque capability code, declarations
  that misstate themselves, and Control's token reaching the session that started it.
