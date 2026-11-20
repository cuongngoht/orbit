# ADR 0063 — Orbit Web governance: operators verified apart from the Claude sign-in, a Company Constitution that decides, a governed deployment that holds, and an audit record that shows

## Status

Accepted (Orbit Web 0.8.0), 2026-11-20, the owner's decision (the implementation handoff "Orbit Web 0.8.0 Governance
Core", and, mid-way, "Thiếu chức năng push branch cho github và devops nữa trong orbit-web và cài sẵn môi trường python
mới nhất"). Builds on ADR 0060, ADR 0061 and ADR 0062, for Orbit Web only, and amends ADR 0062's stated limit ("a misled
agent could turn either switch on itself"; "separating them is left to a later version"). Keeps ADR 0061 whole: the
Claude account remains Orbit Web's mandatory sign-in. No engine contract changes: nothing under `src/`, `cli/`,
`skills/`, `hooks/` or `agents/` changes, the plugin stays 0.6.0, and the plugin archive is unchanged (`integrations/`
is export-ignored).

## Context

1. Orbit Web 0.8.0 has one Claude account signed in for the whole instance. Whoever reaches the API -- a person's
   browser, or the coding agent's own shell in the same container -- works as that account. There was no verified
   human principal at all: `PATCH /api/settings` needed only a constant header, so a prompt-injected agent could turn on
   the switches that hand it GitHub's or Azure's sign-in (ADR 0062 said so).
2. The agent ran as the same Unix user as the API, in the same container, beside Orbit Web's database and both CLIs'
   sign-ins. A role check in the API alone would prove nothing: the agent could open the database file and write itself
   any role.
3. The owner asked for an enterprise governance layer around Claude Code -- operators, a declarative Company
   Constitution with a lifecycle and separation of duties, deterministic decisions, approvals of protected actions,
   tamper-evident audit, a deterministic auditor, a security lab and a console -- that would still hold if Claude Code
   were replaced; and, mid-way, a push of a chat's branch to GitHub and to Azure DevOps from Orbit Web, and the latest
   Python in the image.
4. ADR 0060 keeps Orbit Web apart from the dependency-free plugin: governance is Orbit Web's, and its vocabulary may
   follow the plugin's protected-boundary words without importing them.

## Decision

**The rules are a package of their own, pure and runtime-neutral.** `packages/governance-core` (no dependency, no clock,
no HTTP, no storage) holds the action vocabulary, the Constitution and its validation, the one deterministic decision
function, the lifecycle and separation of duties, impact analysis, approvals bound to fingerprints, the audit envelope
and its hash chain, the auditor and the daily report. The API binds them to its stores, routes and clock; another agent
runtime would be governed by exactly the same rules.

**Every action says where it is enforced.** A row of the vocabulary names its enforcement point: `boundary` (the
container, the broker or the egress proxy -- the agent cannot change it), `control` (the API's authorization), `runtime`
(the agent runtime's own configuration: defence in depth) or `none` (nothing can carry it out, so it is denied). Only a
boundary action may ever be reported as PREVENTED. A ceiling per kind of principal caps what any rule may grant: an agent
never administers its own governance and gets at most one approval of a protected action; nobody reads a raw credential
or changes an audit record.

### Operators: a person, verified by Orbit Web, never derived from the Claude sign-in

- A local credential (scrypt), a server-side session kept as its SHA-256 in an HttpOnly, SameSite=Strict cookie with
  idle and absolute expiry, revocation, a per-session CSRF token, sign-in attempts reserved before the password is
  checked (five lock a name). Six roles over one permission table; roles are read from the store on every request,
  never from a request; an operator never changes their own; the organization keeps one active owner. An
  `IdentityProvider` seam is left for Entra ID / OIDC, not built.
- **The first owner** is enrolled with a one-time code said once on the control plane's own standard output (`docker
  compose logs orbit-web`): only its hash is kept, in memory; it is spent before anything is written; it never reaches a
  response, a file or a child's environment. The offline door is the installation's terminal
  (`cli/governance.js`: `status`, `init-owner`, `reset-password`, `verify-audit`), every use recorded.
- One global guard after the Claude sign-in gate holds every route to what it declares (`@RequirePermission`,
  `@OperatorOnly`, `@AgentGateway`). The access token and a share token open what they opened before, and nothing of
  governance.

### The Company Constitution

- Canonical JSON (`orbit.governance/v1`, `CompanyConstitution`), validated by hand like the contracts (YAML import is
  not supported). Default decision `deny`; deny > require_approval > allow; overlays for a project, a workspace or an
  agent only narrow. Obligations (audit every decision, daily reports, isolation required) are part of it.
- **Lifecycle**: DRAFT → VALIDATED → PENDING_APPROVAL → APPROVED → PUBLISHED → SUPERSEDED (+ REJECTED, withdrawn). Every
  move is one permission's, names the digest it read, and is recorded in the same transaction. A change's risk is
  worked out by asking both policies every question of the vocabulary; loosening a sensitive action or weakening an
  obligation is high risk and is approved by somebody who wrote none of it. A published revision never changes -- the
  database's triggers refuse it too -- and a rollback is a copy published anew. An agent may only hand in a draft.

### The decision, the audit record, the auditor

- One decision function; every decision is an audit record written before it is acted on. Unknown actions, an
  unpublished policy, an unverified principal and another organization are denied.
- **The audit record** is governance's own database (`/data/governance/governance.db`), apart from the chats': deleting
  a chat records the deletion and removes nothing of governance's. Records are hash-chained, idempotent by id, refused
  any change or removal by triggers, checked whole at every start with the head said in the log, and allow-listed per
  type (a credential pasted into a username is masked). It is tamper evidence within its threat model, not proof
  against somebody who controls the host and every copy of its head. The event bus only carries ids-only notifications
  after a commit.
- **The auditor** works findings out from the record by rules -- POLICY_DENIED_ACTION, REPEATED_DENIED_ACCESS,
  UNAUTHORIZED_POLICY_CHANGE, AGENT_PRIVILEGE_ESCALATION, APPROVAL_REPLAY, CROSS_WORKSPACE_ACCESS,
  CREDENTIAL_ACCESS_ATTEMPT, AUDIT_INTEGRITY_FAILURE -- each CONFIRMED, SUSPECTED or INCONCLUSIVE and naming its evidence;
  the daily report is the same fold over one UTC day, generated by a person or by the scheduler. No model is asked.

### Two scopes, two deployments

- **LEGACY_ORBIT** (a chat nobody governs) runs exactly as before. **GOVERNED_WORKSPACE** (a chat an operator placed
  under one registered agent) runs only after a decision: the agent is registered and active, a Constitution is
  published, isolation was checked just now and held (or the Constitution says it is optional), and `agent.run.start`
  is allowed. Every run, decision and record says its scope. Claude Code keeps its two modes; governance is a profile on
  the workspace, not a third mode.
- **The single deployment** (`docker/compose.yaml`) is unchanged and is not isolated: the agent shares the container and
  the user with Orbit Web's records. Governance holds at the API there (no operator session, no switch, no gateway beyond
  its run), not at the files -- so a governed workspace refuses to run there while isolation is required.
- **The governed deployment** (`docker/compose.governed.yaml`) runs the same image as two containers. The control plane
  holds the API, both databases, the sign-ins, its own copies of the repositories and the egress proxy. The agent
  container runs Claude Code and everything that touches a workspace through a runner (TCP on an internal network,
  newline-delimited JSON, a file and an argument list, signals to the group, killed when the connection ends); it mounts
  only the Claude configuration, the workspaces, the sessions, Orbit's store and a home, the repositories' copies
  read-only, on a read-only root, with no capability and no Docker socket; its network is internal, its only way out the
  proxy, and public names do not resolve. The control plane never creates, writes, deletes or reads in a directory the
  agent can write (a link planted there would resolve in the control plane's mounts): directories are made and removed
  by the runner, a workspace's project is read there, run logs move to the control plane's room, and a credentialed
  clone or fetch goes into the control plane's own bare copy, of which the workspace is a local clone. Before every
  strict run the control plane checks the agent's container with canaries (its own rooms absent, the shared ones present,
  the copies read-only, no direct connection, no public name) and records the check. Requests from the agent's network
  reach the agent gateway alone; the proxy decides every connection as the run whose token it carries, and never reaches
  an address that is not on the public internet unless the installation names an internal range. The Claude sign-in
  (`claude auth login`, agent-placed and not a run) holds a channel of its own while it runs: a token handed to that
  process alone, which the proxy grants the Claude account's hosts (`CLAUDE_ACCOUNT_HOSTS`, the same three the default
  Constitution allows an agent) and nothing else, each connection recorded as `egress.sign_in` -- decided by that fixed
  rule and never by a Constitution, because the sign-in opens Orbit Web before one can exist. A repository's declared
  marketplace plugins are installed outside any run, so in this deployment they have no way out and are not fetched.

### Privileged switches, the gateway, the push broker

- Turning on `githubForClaude`, `azureForClaude` or `projectPlugins` needs an operator with `settings.privileged.write`,
  the CSRF token and -- once a Constitution is published -- its decision; turning one off needs nobody. In the governed
  deployment the two sign-in switches are refused to everybody: no sign-in exists in the agent's container.
- **The agent gateway** (`/api/agent`) answers a run's own token only (minted at its start, ended with it): who it is,
  a decision, a push, its workspace's approvals, a draft of the Constitution.
- **The push broker** carries a chat's branch to GitHub or Azure DevOps, asked by the agent or by an operator: the
  commit as a bundle the agent's git writes, fetched with every object checked into the control plane's copy; where the
  remote's branch stands; a decision of `repository.push` on exactly that; an approval of its fingerprint by a person;
  the approval spent before the push against the fingerprint taken again; the push made with the source's own sign-in
  (GitHub CLI's helper, or the Azure CLI's one-shot helper), never forced, never to the default or a protected branch,
  and refused when the default cannot be established (`push-target.ts` decides it alone). The branch a chat started
  from is pushed like any other when it is a working branch -- a story branch, neither default nor protected --
  because the approval of the exact commit and git's refusal of what is not a fast-forward already guard it. A replay, or an approval presented for another action, is
  refused and recorded.

### The image's Python

CPython 3.15.2 from python-build-standalone (release 20261110), pinned by SHA-256 per architecture, with pip and venv,
on the PATH for Claude Code (`AGENT_PYTHON=0` leaves it out); the System card, health and build info report it.

## Consequences

- An agent -- with or without its token, from either deployment -- cannot turn a credential switch on, administer
  governance, approve or replay a protected action, or change the audit record through the API. In the governed
  deployment it also cannot read the databases or the sign-ins, write the repositories' copies, or reach anything but
  the proxy; the security lab (`tests/security-lab/`, results in `results/0.8.0`) records attacks 1-3 and 5-10 as
  PREVENTED, decided from what the lab reads outside the agent.
- **Said plainly**: every governed workspace shares the one agent container, so an agent can read another workspace's
  files on disk (attack 4: the gateway refuses, the disk does not) -- run trust domains that must not see each other as
  separate governed deployments. The Claude account's configuration is necessarily readable by the agent, and the model
  API is reachable by design. The isolation check is the agent container's own answer: it proves the deployment is not
  mis-wired, not that a compromised runner tells the truth. `runtime` rules are defence in depth. The single deployment
  holds at the API only.
- A person who wants GitHub push in a chat now signs in as an operator and approves the exact push; nothing pushes by a
  switch alone. Operators are local accounts; per-browser identity for chat users, OIDC and audit pruning are not built
  (retention is indefinite).
- The real-model run of the governed deployment needs a person's Claude sign-in volume and is recorded as BLOCKED until
  one is given; every deterministic check runs without one.
