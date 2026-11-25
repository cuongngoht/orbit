# Orbit

**A Governed Agentic Workplace**

Orbit is a workplace where AI agents do real work for an organization -- as **employees**, with a role, a desk, a
manager and a queue of work -- and where **every action they take is the organization's to decide**. You hire AI
employees, give them missions and review what they hand in. Your account's policy decides each action before it runs; a
person approves what the policy keeps for people; each piece of work runs in containers of its own; and everything --
every decision, approval, refusal and look -- is on a hash-chained record.

- **Agentic** -- employees work on their own: they plan, build, test, research, ask when they are blocked, hand parts of
  their work to teammates, and hand in deliverables with the claims they make about them.
- **Governed** -- the account's policy decides every action: allowed, denied, or waiting for one person's approval of
  exactly that action. What is a person's to do -- hiring, approving, changing the policy, looking into a desk -- is
  never an agent's, whatever a rule says.
- **Isolated by construction** -- each attempt runs in two containers made for it alone: a workstation with a shell and
  no credential, and a model plane with the AI CLI's sign-in and no shell. Its isolation is checked before it acts.
- **On the record** -- decisions, approvals, refusals, commands and looks go into an audit record whose every entry is
  chained to the one before; an auditor reads it for findings, and a daily report sums it up.
- **Self-hosted and yours** -- one Docker deployment beside PostgreSQL. Each account is a tenant with its own AI
  connections (Claude Code, OpenAI Codex, Google Antigravity); no credential of the server's is ever given to a program.

Orbit's workplace is **[Orbit Web](integrations/orbit-web/README.md) 0.8.0**, its first release. Orbit also comes as a
**plugin** for AI coding hosts -- one smaller direction, [below](#orbit-in-your-coding-host-the-plugin).

## Contents

[The model](#the-model) · [How control works](#how-control-works) · [A day in the workplace](#a-day-in-the-workplace) ·
[Architecture](#architecture) · [Run it](#run-it) · [Orbit in your coding host: the plugin](#orbit-in-your-coding-host-the-plugin) ·
[Repository](#repository) · [Developing](#developing) · [Further reading](#further-reading)

## The model

```
            ┌─────────────────────────── an ACCOUNT (a tenant; its owner governs it) ───────────────────────────┐
            │                                                                                                   │
            │   AI connections          Office                              Governance                        │
            │   Claude Code · Codex ──▶ departments ─ employees ─ missions  policy ─ approvals ─ audit ─ desks  │
            │   · Antigravity           (each with a desk and a toolbox)    (decides every action before it runs)│
            │                                   │                                                               │
            │                                   ▼                                                               │
            │                       an ATTEMPT: two containers of its own                                       │
            │                       workstation (shell, no credential) ◀─tools── model plane (CLI + sign-in)    │
            └───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| | What it is |
| --- | --- |
| **Account** | The tenant. You sign in to Orbit itself, with a username and a password, independent of every AI CLI; every record belongs to exactly one account, and nothing of another account's is ever shown, listed or found. |
| **AI connection** | A CLI the account works with -- Claude Code, OpenAI Codex or Google Antigravity -- signed in with the CLI's own sign-in (from its card in Settings) or an API key. Its models and efforts are read from that sign-in. |
| **Employee** | An AI worker hired into a department: a role, duties, instructions, skills and a handoff standard; a connection, a model and an effort; resource limits; and a **personal sandbox** -- a **desk** that keeps its accepted work, a **toolbox** of the scripts and skills it writes for itself, and a dependency cache. It starts on probation; it may be a team lead. |
| **Mission** | Work given to an employee: a goal, the deliverables, what makes the result acceptable, a deadline -- and optionally research sources pinned at a revision, repositories it may use, a recurring schedule. An employee holds one piece of work at a time; the rest waits in its queue. A team lead splits work into parts for colleagues, who share the mission's room. |
| **Attempt** | One try at an assignment, in two containers made for it and removed -- verified gone -- when it ends. The AI CLI has no built-in tool: its only tools are Orbit's (read, write, run, ask, hand in), each carried out in the workstation under the attempt's own token. |
| **Hand-in** | What the employee delivers: its files and the claims it makes about them. A person requests a revision or accepts; accepted work is published to the employee's desk, where its next work starts from, and delivered to the inbox or wherever the mission says. |
| **Policy** | The account's constitution: a rule per action -- allow, deny, or require one approval -- with a default that is never "allow", people-only ceilings, and obligations (what is always recorded). It is drafted, validated, risk-assessed and published by the owner. |
| **Approval** | One person's decision on exactly one action, bound to a fingerprint of it, decided once and spent before the action runs: never a standing permission. |
| **Audit record** | Every decision, approval, refusal, command and look, chained by hash per account. An auditor derives findings from it; a daily report counts and cites the day's records. |

## How control works

1. **The account is the boundary.** Every record -- chats, research, the office, the policy, the audit -- belongs to one
   account. A request about another account's employee or mission is answered "not found", never "forbidden".
2. **The policy decides before anything runs.** Each action an employee or a person attempts is a word of one closed
   vocabulary (`work.assign`, `tool.connector`, `connector.write`, `repository.push`, `employee.desk.read`, …), decided
   against the account's published policy: deny overrides allow, an approval overrides allow, and what no rule names
   gets the default -- which is never allow. The decision is recorded before the action, whatever it was.
3. **People decide what is theirs.** Some actions have a people-only ceiling -- hiring, the budget, approving, changing
   the policy, looking into or cleaning an employee's desk: no rule can give them to an agent. Some are no one's:
   reading a raw credential or changing the audit record.
4. **An approval is exact and single-use.** A write through a connector (a comment on a work item, a state), a git
   push, a production action: each waits for the owner's approval of exactly that action -- the target, the operation,
   a digest of what it would write -- is re-fingerprinted just before it runs, and is spent once.
5. **Credentials stay on Orbit's side.** An employee may use the account's GitHub and Azure DevOps sign-ins only where
   a person let it, per employee and per repository; Orbit Web makes each call with that sign-in on its own side and
   hands the employee only the answer. A repository reaches an attempt as a git bundle, never with the sign-in that
   cloned it. A connection's login lives only in the model plane, beside no shell.
6. **Isolation is attested, not assumed.** Before an attempt acts, its containers are checked from outside: limits
   applied and observed in the kernel's own files, mounts, the network (no way out but Orbit's egress proxy), and
   markers planted where the attempt must not see. A CLI that reports a tool it was not given is stopped before it acts.
7. **Resources are admitted, not hoped for.** Each attempt reserves its CPU and memory within the account's budget and
   the host's capacity (read again on request); storage is committed per area, with quotas the file system enforces
   where it can (and says so where it cannot); an attempt that cannot fit waits, and says why with the numbers.
8. **Work is judged on evidence.** Deliverables are required by name; a research answer's claims are checked against
   the quoted passages of the sources it was given; a person reviews and accepts. Nothing is "done" on an agent's word.

## A day in the workplace

- **Set up.** Sign in, connect the account's AI connections in **Settings → AI Connections**, and the GitHub and Azure
  DevOps sign-ins in **Settings → Connectors**. Add MCP servers as knowledge bases in **Settings → MCP servers**.
- **Hire.** **Office → Hire**: a name, a department and role, a connection with its model and effort, the personal
  sandbox's resources. Grant each employee, on its **Access** tab, the connectors, repositories and knowledge bases it
  may use -- each off until a person turns it on.
- **Give work.** **Assign work**: a goal, deliverables, acceptance criteria, a deadline, research sources, repositories;
  start it now or queue it; or make it recur on a schedule with deliveries.
- **Watch and answer.** **Needs me** gathers what waits for you: work that is blocked, questions an employee asked,
  hand-ins to review; approvals wait in **Governance → Approvals**. A mission's timeline shows each attempt, its
  resources, its network and its isolation checks.
- **Review.** Request a revision or accept; accepted work reaches the employee's desk and its deliveries.
- **Govern.** **Governance** shows the policy (edit, validate, publish), approvals, every decision, the audit record
  (verified end to end), findings, daily reports, each workspace's and research workspace's runs -- and **Employee
  desks**: every desk, looked into read only (each look recorded), cleaned up when it fills, deleted when an employee
  has left.
- **Chat and research.** Beside the office: **Chat / Coding** -- Claude Code (with the Orbit plugin) on a repository of
  your own, with the model, effort and mode you pick -- and **Research**, your documents and pages asked in
  conversation, every answer cited to a frozen passage.

## Architecture

```
browser ── React + Fluent UI v9 ── HTTPS + SSE ──▶ Orbit Web (NestJS API, one origin)
                                                   ├─ PostgreSQL 17 + pgvector   every record, per account
                                                   ├─ governance-core            the policy's decisions, pure
                                                   ├─ egress proxy · tool endpoint (for the employees' containers)
                                                   └─ signed requests ──▶ allocator (the only holder of the Docker socket)
                                                                           ├─ workstation (tool plane) per attempt
                                                                           ├─ model plane (AI CLI + sign-in) per attempt
                                                                           └─ storage helper + workers: desks, caches, scratch
```

- **Orbit Web** -- the API (the office in bounded contexts -- workforce, work, execution -- beside modules for
  governance, research, chat, connections and the rest) and the web app: one image that also carries every AI CLI it
  drives (Claude Code, Codex, Antigravity, the GitHub and Azure CLIs) and the Orbit plugin.
- **The allocator** -- the only process that talks to Docker. It takes ids and values, never an image, a path, a mount
  or a privilege from a request; it makes each attempt's containers and networks, keeps the employees' storage with
  quotas, and removes what it made, reading back that it is gone.
- **PostgreSQL with pgvector** -- one database on an internal network; every store awaits it; the audit chain's head is
  locked per account.
- **governance-core** -- the vocabulary of actions, the constitution, the evaluation of a request against it, the
  audit chain's rules and the auditor: plain functions, shared by the API and the web app.

The design, decision by decision: [ADR 0061 -- Orbit Web 0.8.0](docs/adr/0061-orbit-web-0-8-0.md), on top of
[ADR 0060](docs/adr/0060-orbit-web-a-browser-host-around-the-official-clis.md) (Orbit Web as a browser host around the
official CLIs).

## Run it

Docker is the only thing to install.

```bash
cd integrations/orbit-web/docker
printf 'ORBIT_WEB_DB_PASSWORD=%s\nORBIT_WEB_POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 16)" > .env
(umask 027 && openssl rand -hex 32 > allocator.secret) && sudo chown 0:10001 allocator.secret
(cd ../../.. && for t in workstation model-plane storage-helper; do
  docker build -f integrations/orbit-web/docker/Dockerfile --target "$t" -t "ghcr.io/cuongngoht/orbit-web-$t:0.8.0" . ; done)
docker compose up -d --build
docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner setup-code
open http://localhost:3000          # "Set up Orbit Web", with the code printed above
```

A trial on this machine only skips the code: `docker compose -f compose.yaml -f compose.trial.yaml up -d --build`, then
sign in as `admin` / `123456`. The **governed deployment** (`compose.governed.yaml`) runs every agent in a container of
its own and starts from a stricter default policy. Everything else -- settings, storage and backups, sign-in, AI
connections, the office, governance, security and troubleshooting -- is in
[Orbit Web's README](integrations/orbit-web/README.md).

## Orbit in your coding host: the plugin

The same discipline also ships as a plugin for AI coding hosts -- **Claude Code**, **Codex**, **Antigravity CLI** and
**Grok Build**: you describe a goal in your own checkout, and Orbit takes it through requirements, planning,
implementation, testing and review, calling it done only on evidence -- with UI tests written as plain JSON, QA
investigations of a running application, and a person asked only at a few protected boundaries. Orbit Web's chats run
it, and an employee may use it where the account's owner grants it.

```bash
/plugin marketplace add cuongngoht/orbit      # in Claude Code
/plugin install orbit@orbit
```

Everything about it -- install for every host, skills, the command line, where its data lives, Orbit Live and Orbit
Control, and its feature guides -- is in **[docs/plugin.md](docs/plugin.md)**.

## Repository

| Path | What it holds |
| --- | --- |
| [integrations/orbit-web/](integrations/orbit-web/README.md) | **The workplace**: `apps/api` (NestJS), `apps/web` (React + Fluent UI v9), `packages/contracts`, `packages/governance-core`, `docker/` (the image, compose files, the database's init) |
| `src/`, `cli/`, `skills/`, `agents/`, `hooks/` | The plugin's engine, commands, skills, agents and host hooks ([docs/plugin.md](docs/plugin.md)) |
| [control-server/](control-server/README.md), [satellite/](satellite/docs/README.md) | The plugin's local control panel, and its multi-agent missions |
| [evaluator/](evaluator/README.md) | The independent evaluator that measures a plugin release from outside |
| [docs/](docs/) | Architecture, decision records ([docs/adr/](docs/adr/)), the plugin's documentation |

## Developing

```bash
cd integrations/orbit-web
node scripts/ci.mjs                               # typecheck, lint, unit, integration on PostgreSQL, web tests, builds
npm run test:sandbox -w @orbit-web/api            # an attempt in real containers (needs Docker and the employee images)
node tests/docker/smoke.mjs --image=<image>       # an image's checks
```

The plugin is developed and released apart, with its own gates: [docs/plugin.md › Developing Orbit](docs/plugin.md#developing-orbit)
and [AGENTS.md](AGENTS.md), the rules every change to it is held to.

## Further reading

| Document | About |
| --- | --- |
| [integrations/orbit-web/README.md](integrations/orbit-web/README.md) | The workplace in full: run it, use it, its security model |
| [docs/adr/0061-orbit-web-0-8-0.md](docs/adr/0061-orbit-web-0-8-0.md) | The decisions behind Orbit Web 0.8.0 |
| [docs/plugin.md](docs/plugin.md) | The plugin for AI coding hosts |
| [docs/architecture.md](docs/architecture.md) | The plugin's architecture: layers, dependency direction, data |
| [docs/adr/](docs/adr/) | Every architecture decision record |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |

## License

MIT -- see [LICENSE](LICENSE).
