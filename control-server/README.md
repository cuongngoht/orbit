# Orbit Control

A local control plane for this plugin, from a browser, on this machine only: **skills** (list,
read, edit, delete `skills/*/SKILL.md`), the **prompt router**'s view and an inspector, **MCP**
servers (the host's, Orbit's catalog, your own) and **CLI tools** (detected, and installed
privately on request). Router, MCP and Tools read the same Effective Resource Registry the
prompt router does (README §4.8).

It sits **beside** the Orbit engine, not inside it:

```
existing Orbit (src/ cli/ hooks/ skills/ agents/ …)   unchanged; knows nothing of Control
        ▲
        │  skills/<id>/        the only thing Control changes, and only when a person asks
        │
control-server/   Node >= 24.15, built-ins only      REST API + the built page
control-panel/    React + TypeScript + Vite + Fluent UI v9 + TanStack Query   → builds into
                  control-server/public/
```

The engine keeps Node >= 20 and zero dependencies. The page's dependencies live only in
`control-panel/package.json`, and its **built** files are committed to `control-server/public/`,
so running Control needs no install and no Vite.

## Run it

```bash
node control-server/src/main.mjs            # Node >= 24.15; port 0 = the OS picks a free one
node control-server/src/main.mjs --port=7317 # a fixed port (the dev workflow below needs one)
node control-server/src/main.mjs --port 7317 # the same, as two words: how a task's sandbox tells it a port
node skills/orbit-control/start.mjs           # the same, on a Node >= 24.15 found on this machine
node skills/orbit-control/start.mjs --which   # which Node that would be, starting nothing
node skills/orbit-control/start.mjs --install-runtime  # none new enough? install a private one first
```

It prints:

```
Orbit Control is running
  open     http://127.0.0.1:54883/#token=…
  skills   <plugin>/skills
  backups  ~/.orbit/projects/control-backups/skills
  stop     Ctrl+C
```

Open **that** URL. A tab opened without the `#token=…` part can read skills but not change them.

From a Claude Code session, the `orbit-control` skill does this for you: ask it to open the control
panel. `skills/orbit-control/start.mjs` tries `ORBIT_CONTROL_NODE`, then the Node running it, then
the plugin's private runtime, then every nvm version (nvm-sh and nvm-windows), newest first, and
starts the server on the first one that is new enough.

With `--install-runtime`, a machine that has none gets one. The official Node LTS is downloaded
from nodejs.org, checked against its published SHA-256, and unpacked into
`<store>/control-runtime/`. The system Node, nvm and PATH are left exactly as they were.

Exit codes: `1` this Node is older than `engines.node` in `control-server/package.json` (which
is where the requirement is read from); `2` bad usage (anything but `--port=<n>` or `--port <n>`,
`n` from 0 to 65535), or the backup room resolves somewhere unsafe (for example `ORBIT_STORE_DIR`
inside a repository).

A task's **sandbox** (README: Sandboxes) starts Control on a port it leased only when a person told it
how, in Control's Runtime → Settings → **Port in a sandbox** for `node:control-server`: an argument,
flag `--port`, with `--` before it, format `{port}` -- saved as
`{ "kind": "argv", "flag": "--port", "format": "{port}", "after": "--" }`, so the sandbox runs
`npm run start -- --port <leased>`.

## API

The routes are the table in `src/router.mjs`, and nothing else. Anything else under `/api/` is
404; a known path with the wrong method is 405. There is no route that runs an arbitrary
command, and no route that writes a host's configuration. Every `POST`/`PUT`/`DELETE` except
`router/resolve` needs the token — including a connection test (a stdio test starts the
configured command) and an install; `test/security.test.mjs` walks every mutating row.

| Method | Path | Answers |
|---|---|---|
| GET | `/api/v1/health` | `{ status, node, engine, skills }` — no path, no token |
| GET | `/api/v1/account` | `{ host, signedIn, displayName?, email?, organization?, role? }` — who is signed in to Claude Code on THIS machine, from its own configuration, through an allow-list; never a token. An unreadable configuration answers `signedIn: false` |
| GET | `/api/v1/skills` | `{ skills: [{ id, name, description, userInvocable, allowedTools, valid, problems, skillBytes, files, bytes, modified }] }` — weights read off the disk (lstat, symlinks never followed), never tracked |
| GET | `/api/v1/skills/:id` | the summary + `content` (the whole SKILL.md), `revision`, `problems` |
| PUT | `/api/v1/skills/:id` | body `{ content, revision? }` → the skill as it now is on disk |
| DELETE | `/api/v1/skills/:id` | `{ id, deleted: true, backup: "<timestamp>/<id>" }` |
| GET | `/api/v1/skills/:id/resources` | `{ id, provides, needs: [{ requirement, level, status, provider, candidates }] }` — what the skill needs and who would provide it now, derived by the resolver, never stored |
| GET | `/api/v1/router/resources` | `{ version, summary: [{ family, total, enabled, available, eligible }], resources, problems }` — the router's own view: Orbit's records and the saved host snapshot, never a live read |
| GET | `/api/v1/automation` | `{ fields, fixed, machine, effective: { values, fields (each `{ value, by }`), matrix }, live, readiness }` — what this machine allows, who set each value, the policy matrix those values give, and what each host can do. A read creates nothing |
| PUT | `/api/v1/automation/settings` | body `{ settings, revision }` — the ONE door the automation settings are written through (the engine refuses any other); 409 `STALE_REVISION` on a revision that moved; a fixed field is 400 |
| GET · PUT | `/api/v1/projects/:key/automation[/settings]` | one project's narrowing: it can only make a field stricter than the machine set it |
| GET · PUT | `/api/v1/live/settings` | how Live looks (the status line's lines, idle and finished windows, terminal rows), revisioned |
| GET | `/api/v1/projects/:key/generated-skills[/:id]` | a project's generated playbooks: pin, status, provides and needs, the task that drafted it, quarantined when its files changed; one with its printable text |
| POST | `/api/v1/projects/:key/generated-skills/:id/{revalidate,activate,disable,retire,rollback,archive}` | a person's move, one route each; activating a quarantined playbook is 409 `SF_QUARANTINED`; there is no delete |
| POST | `/api/v1/router/resolve` | body `{ prompt }` → `{ decision (v2: graph with every candidate, selected, approval, blocked, missing, plan), context, executed: false }`. The prompt is routed in memory and not kept |
| GET | `/api/v1/mcp` | `{ host, managed, external }` — what Orbit manages, what the host has (read LIVE, files only, observe only) with separate ownership. Secrets as names, never a value |
| GET | `/api/v1/mcp-catalog` | `{ entries }` — the plugin's catalog, each with `addable`, `added` (Orbit manages it) and `observedInHost` |
| GET | `/api/v1/mcp/policies` · `/api/v1/mcp/activity` | every managed server's policy and the workflow exceptions · the broker's newest activity lines |
| PUT | `/api/v1/mcp/policies/workflows` | body `{ workflows: { skill: { capability: verdict } } }` → the policies, validated first |
| POST | `/api/v1/mcp/test` | body `{ definition }` (a managed definition) → `{ check }` for a server not saved yet; nothing is kept |
| GET · POST | `/api/v1/mcp/managed` | the managed servers · add `{ catalog: "<id>" }` or `{ definition }` to Orbit (`409` when Orbit already manages that id). No host configuration is written |
| GET · PUT · DELETE | `/api/v1/mcp/managed/:id` | one managed server with its potential consumers · a new definition (it cannot be renamed) · remove from Orbit (its runtime stays: `runtimeKept`) |
| POST | `/api/v1/mcp/managed/:id/enable` · `disable` · `test` · `install` · `approve` | the person's switch · a kept check under `managed:<id>` · the catalog row's installer (remote-http installs nothing; `409` when there is nothing to install) · body `{ minutes }`, a time-boxed approval |
| PUT | `/api/v1/mcp/managed/:id/selection` · `policy` | body `{ selection }` (automatic · approval · disabled) · body `{ policy: { default?, capabilities?, operations? } }` |
| DELETE | `/api/v1/mcp/managed/:id/approval` · `runtime` | revoke the approval · delete the runtime files Orbit installed, only inside `runtimes/mcp/` |
| GET | `/api/v1/mcp/managed/:id/tools` | the tools the last test found, dated, or `null` |
| GET | `/api/v1/mcp/external` · `/api/v1/mcp/external/:id` · `…/tools` | the host's servers, observe only (never eligible) |
| POST | `/api/v1/mcp/external/refresh` · `/api/v1/mcp/external/:id/test` | re-read the host into the external snapshot · one handshake as the host configured it, kept under `external:<id>` |
| GET | `/api/v1/tools` · `/api/v1/tools/:id` | the effective tools: desired and observed apart, every source that was looked in, what an install would do |
| POST | `/api/v1/tools/:id/refresh` · `install` · `update` | detect again · install privately (`409` if already usable anywhere) · a managed install older than the catalog's pin |
| GET | `/api/v1/trace/turns?days=1` | `{ version, days, recording, turns: [{ id, at, ms, prompt: { chars, hash? }, intent, confidence, routing, suggested, followed: { verdict, say }, outcome, steps, path }] }` — one row per prompt off the session trail, newest first, at most 100; `days` 1–90. Never a prompt's text |
| GET | `/api/v1/trace/turns/:id` | `{ version, turn }` — one prompt in full: the router's decision (requirement graph, selected, approval, blocked, missing) and every step in order. `400` `INVALID_TURN_ID`, `404` `TURN_NOT_FOUND` |
| GET | `/api/v1/analytics/usage?days=30` | `{ version, days, recording, window, totals, commands, shell, skills, transitions, paths, failures, privilege }` — the usage projection: every ratio with its denominator; least privilege holds each skill's `allowed-tools` against what it ran |
| GET | `/api/v1/projects` · `/api/v1/projects/:key` | every project and checkout Orbit knows on this machine, from the registry — a checkout is known because Orbit was USED from it, and nothing is scanned: `{ projects: [{ key, name, checkouts: [{ id, root, exists, host, lastSeen, summary: { understanding, runtime, branch } }] }] }`, each summary as of the time it was written · one project. `404` `PROJECT_UNKNOWN` |
| GET | `/api/v1/projects/:key/checkouts/:checkout/runtime` | the runtime of ONE checkout, named by project AND checkout (never the directory Control was started in, never a body): what is understood, how each component would run here, what is running and whether it answers, what can be verified. Starts, probes no tool and writes nothing. `404` `PROJECT_UNKNOWN`, `409` `CHECKOUT_MISSING` |
| POST | `…/runtime/discover` · `design` · `doctor` · `prepare` · `validate` · `start` · `stop` | the CLI's own commands, over the same binding. The body is a choice among named fields (`dry`, `rescan` · `human` · `component`, `wait` · `component`, `session`, `environment`; `prepare` takes none: it is a plan) and anything else is `400` `RUNTIME_BODY_INVALID`: no command, path or flag ever comes from a body. `validate` brings an environment up on this machine, where its definition may run commands of its own, so it needs `{ human: true }` (`400` `HUMAN_REQUIRED`). A long one is awaited and answered as a receipt |
| GET · POST | `…/runtime/proposals/:proposal` · `…/runtime/proposals/:proposal/adopt` | one environment proposal · body `{ human: true }` — the ONE operation that writes the repository: the PRIMARY_CHECKOUT_WRITE protected boundary (0.2.0), which only a person's own act crosses -- this route builds the runtime context with Control's door, after its token -- for a proposal that is still true. `400` `HUMAN_REQUIRED`, `409` `STALE_PROPOSAL`, `409` `ADOPT_UNVERIFIED` (files left as written) |
| POST | `/api/v1/projects/:key/checkouts/:checkout/forget` | a person forgets a checkout whose directory is gone · body `{ human: true }` → `{ project, checkout }`: its line and its binding go, what Orbit kept stays in the store; `409` `CHECKOUT_PRESENT` when the directory is there again |
| GET · PUT | `…/runtime/settings` | this machine's settings with their `revision` · body `{ settings, revision }` → `{ saved }`; `409` `STALE_REVISION`. Never a command, a secret or a way to force a way of running |
| GET | `/api/v1/mission-control` · `/api/v1/mission-control/approvals` | every task execution on this machine, across every project the registry knows -- a projection over the task journals, read again on each look and stored nowhere: `{ counts, tasks[], approvals[], problems[] }` · the open approvals alone, each with its project, checkout, task and the task's `revision`. No git, no probe, no write; one unreadable task is one row that says so |
| GET | `/api/v1/projects/:key/checkouts/:checkout/tasks` · `…/tasks/:task` · `…/tasks/:task/events?since=<n>` | one checkout's tasks · one task as the page shows it (`{ task }`) · its journal from a position on. A task of another checkout -- even of the same project -- is `404` `TASK_UNKNOWN`; a checkout whose directory is gone is still read, because a task lives in the store |
| GET | `…/tasks/:task/activity?since=<cursor>` | Orbit Live, once: `{ version, task, cursor, terminal, view, events }` -- the task's journal lines and the QA activity of the investigations begun against its sandbox, merged by time, from a cursor `t=<n>(;<inv-id>=<n>)*`. What a page paints first, replays a finished task from, and reads every 5 s when it cannot keep a stream open |
| GET (SSE) | `…/tasks/:task/events/stream` | Orbit Live, streamed: `task-event` · `qa-event` · `task-view` (only when what a person watches moved) · `ping` (every 15 s, an event so a page's watchdog sees it) · `end` (`terminal`, after the last line). Every event's `id` is the cursor after it; a reconnect resumes from `Last-Event-ID`, the first connection from `?since=`. Read-only: no token, never `mutates`, and every refusal is JSON before any header (`400`, `404` `TASK_UNKNOWN` · `PROJECT_UNKNOWN`). One poll per followed file, shared by every page on it; `closeAll()` ends every stream before a shutdown |
| POST | `…/tasks/:task/pause` · `resume` · `cancel` · `…/tasks/:task/approvals/:approval/approve` · `reject` | a PERSON's decision, through the same command table `cli/task.mjs` runs. Body `{ human: true, expectedRevision, because? }` (`reason?` for reject) and nothing else (`400` `TASK_BODY_INVALID`, `400` `HUMAN_REQUIRED`) → `{ task }` as it now stands. `409` `STALE_REVISION` when the task materially moved since that revision (never retried), `409` `APPROVAL_DECIDED` for a second decision, `409` `APPROVAL_EXPIRED`, `409` `TASK_ENDED`, `409` `TASK_PAUSED` · `TASK_NOT_PAUSED`, `404` `APPROVAL_UNKNOWN`, `503` while another session writes the task. Approve once grants that one action, once; nothing stops a process. An approval exists only where work reached a protected boundary (0.2.0: a push, a production deploy or migration, destroying production data); its `action` is the protected kind, its `risk` says exactly what is approved (DESTRUCTIVE first), and the payload carries `boundary`, `title`, `destructive` and `shows`. Approve once and Resume are written ONLY here: the task context Control builds is the one door that may write a decision that allows something, because the token was checked before it -- `cli/task.mjs` refuses both |
| GET | `/api/v1/knowledge` | project knowledge for the project Control was started in: claims by tier, layer, source and concern, the relations in use (declared, undeclared, interpreters, refused), the context dimensions, conflicts and the capability opportunities by state. Read only |
| GET · POST | `/api/v1/connections` | `{ connections, providers, backend }` — machine-wide; a credential only ever DESCRIBED (`{ set, from, name? }`); `backend` is the OS secret store here, or `null` · create `{ id, provider, organization, host?, label? }` |
| GET · PUT · DELETE | `/api/v1/connections/:id` | one connection · change `{ label?, host?, organization?, note? }` (a new host or organization forgets the last test) · delete it and the credential Orbit stored |
| PUT · DELETE | `/api/v1/connections/:id/credential` | body exactly one of `{ value }` (into the OS secret store; `503` where there is none — no plaintext fallback) or `{ env }` (a variable's NAME) → `{ connection, backend }`; the value is in no answer, no log and no file · clear it |
| POST | `/api/v1/connections/:id/test` | authentication, then each read the current project's scope asks for → `{ at, ok, identity, checks: [{ id, status, permission, message }] }`, masked, kept as the last test |
| GET | `/api/v1/reports/overview` · `settings` · `parts` | the project Control was started from (`{ available: false, why }` outside a Git checkout): source, connection, runtime, runs and the latest coverage · the settings with their `revision`, providers and sections · every part with provenance, fingerprint, the last run, and what the next run would leave out and why |
| PUT | `/api/v1/reports/settings` | body `{ settings, revision }` → `{ saved }`; `409` `STALE_REVISION` when somebody changed them since |
| POST | `/api/v1/reports/parts/enable` · `disable` · `approve` · `unapprove` | body `{ part, revision }` — a part's switch; `approve` is a PERSON approving a replacement of a standard part |
| POST | `/api/v1/reports/parts/verify` · `rollback` | body `{ extension }` — verified again (the real loader, the static check, the part run) · body `{ extension, to? }` — back to a kept version, verified again. No route runs a report |

Every failure has one shape: `{ "error": { "code", "message", "details"? } }`. `400` invalid
input or an invalid SKILL.md (`details` lists every problem) · `403` host, origin or token ·
`404` no such skill, project or route · `405` wrong method · `409` `STALE_SKILL`, `STALE_REVISION`, `STALE_PROPOSAL`, `CHECKOUT_MISSING` · `413` body over 1 MB ·
`415` not JSON · `500` a write, backup or delete failed, or a bug (logged on the server, never
sent to the page) · `503` the page has not been built.

The catalog **is** the directory: every direct child of `skills/` that is a plain directory,
whose name is a skill ID, and that holds a readable `SKILL.md`. There is no registry to keep in
step.

## Security model

- **Loopback only.** It binds `127.0.0.1`, never `0.0.0.0`.
- **Host check, every request.** `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, which
  stops a DNS-rebinding page reaching it under its own name.
- **Changes need the token.** `PUT` and `DELETE` must carry `x-orbit-control-token`, minted per
  process with `crypto.randomBytes(32)` and compared in constant time. It travels in the URL's
  `#fragment`, which browsers never send to a server or put in a `Referer`. The page moves it
  into `sessionStorage` (this tab only) and wipes it from the address bar.
- **Origin check on changes.** A browser always sends `Origin` on a `PUT`/`DELETE`, and it must
  be this server's own. There is **no CORS**: nothing is ever answered with
  `Access-Control-Allow-*`. A change must also be `application/json`, which a cross-origin form
  cannot send without a preflight this server refuses.
- **An ID, never a path.** A skill ID is `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`: no dot, no separator
  of either platform. It is decoded once and then validated, so `%2e%2e`, `%2F` and `%5C` come
  out as the characters they are and get refused. The resolved directory is checked against
  `skills/` both lexically **and after following symlinks** (core's `contained`), and a skill
  directory or `SKILL.md` that is itself a symlink is refused outright, even one pointing inside
  `skills/`.
- **The page is not a file server.** A path is served only when it resolves, after decoding and
  after every symlink, to a plain file inside `public/` with a known extension. A path with no
  extension gets `index.html` (the single-page fallback). Everything else is 404. HTML goes out
  with a CSP (`script-src 'self'`, `frame-ancestors 'none'`, …), `nosniff`, `X-Frame-Options:
  DENY` and `no-referrer`.

## Edit flow

```
PUT /api/v1/skills/:id  { content, revision }
  → resolve the known skill (ID rule, contained, not a symlink, has SKILL.md)
  → hold the body to the contract (validate.mjs)
  → refuse a stale base: `revision` must still be the hash of what is on disk (409)
  → write a temporary file, rename it over SKILL.md (core's writeAtomic)
  → answer the fresh skill
```

Nothing is written until every check has passed, so a refused save leaves the file
byte-for-byte as it was, and the page keeps what you typed. Only `SKILL.md` is touched, and a
skill cannot be renamed here.

What the validator enforces is only what is already in force elsewhere, and
`test/skills.test.mjs` holds it against every skill this repository ships:

1. a `---` frontmatter block exists
2. `name` exists and equals the directory name
3. `description` exists
4. `description` contains no `<angle brackets>` (`skills/orbit-release/gates.mjs` refuses the
   archive for it)
5. `user-invocable`, when present, is `true` or `false`

Frontmatter is read by a small reader (`src/skills/frontmatter.mjs`) that handles the shapes the
shipped skills use (`key: value`, quoted values, `>`/`|` blocks, `- item` lists). No YAML package.

## Delete and backup flow

```
DELETE /api/v1/skills/:id
  → resolve the known skill (as above)
  → copy the WHOLE directory to <backups>/<timestamp>/<id>/, then check the copy's SKILL.md
    matches the original's
  → only then remove skills/<id>/ recursively
```

**No backup, no deletion.** If the copy cannot be made or checked, or a backup already exists
at that path, the delete stops with `BACKUP_FAILED` and nothing is removed. Symlinks inside the
directory are copied as links and never followed, and `rm` removes a link, never its target.

Backups go to the machine store through core's `storeBase`: `ORBIT_STORE_DIR` when set,
otherwise `~/.orbit/projects`, then `control-backups/skills/`. That keeps them outside
every repository and outside the plugin. The server prints the full path at start-up and on
every delete; the page shows only the `<timestamp>/<id>`. To restore one, copy it back into
`skills/`.

## Boundary with Orbit core

`src/core.mjs` is the **only** file that imports from `../../src` or `../../skills`, and it only
re-exports: `contained`/`physical`, `storeBase`, `writeAtomic`/`realIo`, `engineVersion`, the
resource manager (the registry, the router, MCP and tool reconciliation and their state rooms —
the same modules the prompt router's hook composes), the session trail's log and projections
(`traceLog`, `turnsOf`, `turnOf`, `usageOf` — the ones `cli/trace.mjs` prints, so the page and the
terminal cannot disagree), `projectKnowledge` and `realWorld`
(`skills/orbit-control/world.mjs`: the real Claude Code host, detectors and installers).
`test/server.test.mjs` asserts that no other file reaches past it and that nothing imports a
package or a database. Nothing under `src/` knows Control exists.

What Control keeps lives in the machine store, never in the plugin: `control-backups/`,
`control-runtime/`, `control/resources/{mcp,tools}/` and `runtimes/tools/` under `storeBase`. It
READS the session trail the hooks append to (`control/activity/trace/`) and never writes it. So
replacing the plugin directory on an upgrade loses none of it
(`test/resources.test.mjs`, "UPGRADE SURVIVAL").

## Develop the page

```bash
cd control-panel
npm ci
npm test            # Vitest + Testing Library, against an in-memory stand-in for the server
npm run typecheck
npm run build       # → ../control-server/public/ (commit the result)
```

Live-reload development, with two terminals:

```bash
node control-server/src/main.mjs --port=7317   # terminal 1: copy the #token=… it prints
cd control-panel && npm run dev                 # terminal 2: http://127.0.0.1:5173/#token=<that token>
```

Vite proxies `/api` to `ORBIT_CONTROL_API` (default `http://127.0.0.1:7317`) and presents the
server's own origin, so the origin check passes. The token still has to come from the server.

Frontend tests are `*.test.tsx` **on purpose**: a bare `node --test` at the repository root
collects `*.test.ts` on Node >= 23 and would try to run them outside Vitest.

### Pages and the sidebar

Every page is at a real URL, so a view can be linked to, survives a refresh, and Back works:

| URL | Page |
|---|---|
| `/analytics` (and `/`) | what the skills cost a session, what they may do without asking, what needs a look — and Usage, off the session trail |
| `/mission-control` | every task execution on the machine: counters, the approval queue, tasks by project with filters (an active one marked `●` with its stage) — polled every 5 s while a task is still going |
| `/mission-control/approvals` | what waits for a person, machine-wide — polled every 5 s while open |
| `/mission-control/:key/checkouts/:checkout/tasks/:task` | one task, **live** (Orbit Live): a connection badge (`● LIVE` pulses only while the stream is healthy; RECONNECTING · DEGRADED LIVE · OFFLINE · FINISHED · REPLAY), the current activity, a person's approval inline, the feed of journal and QA lines with filters and auto-follow, the sandbox's console; then readiness, state, current decision, attempts, changes, verification, references, budget; Pause · Resume · Cancel · Reject · Approve once, each confirmed. The task is not polled while the stream holds it |
| `/automation` · `?tab=general\|factory\|execution\|governance\|live\|skills` | how autonomous Orbit may be when a task is handed to `/orbit-help`, for this machine or one project, each value saying who set it; the policy matrix; host readiness; Live's look; generated playbooks with a person's moves. Nothing here starts a workflow |
| `/skills` · `?show=…&q=…` | the catalog: search, filter tabs with counts, edit, delete |
| `/skills/:id` | one SKILL.md in the editor |
| `/trace` | each prompt: the router's intent, what it suggested, whether the session followed, the path, how it ended — polled every 5 s |
| `/trace/:id` | one prompt in full: the requirement graph, every step counted from the prompt, the verdict in words |

**Analytics has two halves, and they never mix.** The first reads the disk and derives everything
from `GET /api/v1/skills`:

- description length, loaded into every session, held against the 1,024-character Agent
  Skills limit
- SKILL.md size, loaded when the skill runs
- the pre-approved tools each skill's `allowed-tools` grants
- what needs attention
- what changed recently

The second, **Usage**, reads the session trail (`GET /api/v1/analytics/usage`, README §4.8): how
many prompts, Orbit commands and other commands ran, which ones, how prompts flowed through them,
what failed out of how many runs, and least privilege. A window with nothing recorded says so and
says what the trail would never keep; nothing is invented to fill it.

"Needs attention" has **one** definition (`features/skills/attention.ts`). The sidebar badge,
the Skills tab and the Analytics tile all read it, so the number on a tile is the number of rows
its link opens. The charts follow the dataviz method:

- one validated series color per mode, plus status colors that always come with an icon and words
- a table view for every chart
- every bar is a link with a hover **and** focus tooltip

The sidebar has three shapes, one decision (`app/layout/useSidebar.ts`):

- **Expanded:** a wide window with labels shown. This is the default.
- **Rail:** a wide window collapsed to icons with tooltips. The choice is remembered.
- **Overlay:** a narrow window. The menu button opens it over the page, and it closes when a
  page is chosen.

Leaving a page with unsaved changes asks first, whether the person uses a sidebar link, the
breadcrumb, Back, Cancel or closes the tab (`shared/navigation/UnsavedChanges.tsx`).

**Adding a page** is one row in `DESTINATIONS` (`src/app/navigation.tsx`) plus a folder under
`src/features/`. The sidebar in all three shapes and the router are both derived from that table,
so nothing else in `app/` changes.

The page is feature-first: `src/features/<name>/` owns its API, hooks and components, and
`src/shared/` holds the one HTTP client (`shared/api/client.ts`: JSON, error normalisation, the
token header), the page header, cards, loading/error/confirm components and the navigation
helpers. A feature links to another only through the other's exported paths
(`features/skills/paths.ts`), never by spelling a URL.

Two traps this layout already fell into once, both found only in a real browser:

- Fluent copies the FluentProvider's `className` onto every portal it mounts. So `.app-root`
  may carry CSS variables only: a `min-height` on it turned the tooltip portal into a white
  sheet over the whole page.
- A Fluent modal whose owner unmounts as it closes leaves the page `aria-hidden`. That is why
  the dialogs stay mounted, close through `open={false}`, and the leave-without-saving guard
  lives in the shell, above the pages.

## Tests and gates

```bash
node --test "control-server/test/*.test.mjs"          # the server, Node >= 24.15 (also passes on 20+)
node cli/check-five-lines.mjs control-server/src --strict
```

The server's tests also run inside the engine's own suite, because a bare `node --test` at the
root finds any `test/` directory. That is why the server code stays Node-20-compatible even
though it only starts on 24.15. CI has a `control-server` job (Linux + Windows, Node 24) and a
`control-panel` job that type-checks, tests, builds, and fails when the committed
`control-server/public/` is not what the source produces.
