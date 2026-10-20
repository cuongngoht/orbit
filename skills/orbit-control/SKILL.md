---
name: orbit-control
description: >
  Start Orbit Control, the local control panel for this plugin (MCP servers, skills, tools, report
  connections, PO reports, the router, activity), and hand back its one URL. Use when asked to
  open the control panel, add, test, approve or police an MCP server, install a CLI tool or an MCP
  runtime, set up a report connection or its credential, or see what the router would pick. It
  starts the server on loopback only and never adds, enables or approves anything itself; the
  person does.
argument-hint: open the control panel | restart it on a fixed port
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/orbit-control/*)
user-invocable: true
---

# Start Orbit Control and hand over its URL

Orbit Control is a server that sits **beside** the engine (`control-server/`, README §8.1). It
needs Node **>= 24.15**, while the engine and the shell running this session may be on 20 or 22.
`start.mjs` settles that for you. It tries, in order:

1. `ORBIT_CONTROL_NODE`
2. the Node running it
3. the plugin's **private runtime**, if one was installed
4. every nvm-installed version, newest first

It uses the first one that is new enough, and asks each candidate its version rather than trusting
a folder name.

## 1. Start it, in the background

It is a server: it keeps running until it is stopped. Start it as a **background** command, never
in the foreground, where it would hold the session:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/orbit-control/start.mjs
```

Add `--port=<n>` only when the person asks for a fixed port. The default lets the OS pick a free
one, so two panels never fight over a port.

## 2. Hand over the URL, exactly as printed

Read the command's output until this block appears:

```
Orbit Control is running
  open     http://127.0.0.1:<port>/#token=<token>
```

Give the person the `open` URL **verbatim**, and tell them to open it in their browser:

- The `#token=…` part is what lets that tab edit and delete. Without it the page is read-only.
- The token is new every start and lives only in that output. Do not write it into a file, a
  note or a commit.
- The sidebar has **Analytics** and **PO Reports**, then **Skills**, **MCP**, **Tools** and
  **Connections**, then **Router**, **Activity** and **Trace**. Nothing is tracked; Analytics reads
  the files on disk, Activity reads the MCP broker's own lines (never what was asked or answered).
- **Skills** lists, edits and deletes skills, with what each one's needs resolve to. **Tools** is
  a verified private install per tool, Python for project reports included.
- **Connections** are the sources project reports read, each naming where its credential comes
  from; the credential itself goes straight to the OS secret store. **PO Reports** holds this
  project's report settings, sections and extensions.
- **MCP** has four tabs. **Managed** is what Orbit owns, kept in the machine store and independent
  of any host: **Add to Orbit** from the **Catalog** (Microsoft Learn needs nothing installed), or
  **Add custom**. A secret is never typed there: a header or variable is NAMED with the environment
  variable its value is read from when Orbit connects. **External** is what a host (Claude Code) has
  configured — observed and testable, never selected by Orbit's router and never written by Control.
  **Policies** sets allow · approval · deny per capability and for write tools, plus workflow
  exceptions. A server in **Approval** mode is used only after the person approves it there.
- A Orbit-managed server is reached from a session through
  `node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs call <server> <tool> --for=<capability> --input='<json>'`,
  never through the host's own tool list.
- A task's page in **Mission Control** has a **Sandbox** card: the environment the task owns, built from its changed source tree, with what runs there, its endpoints as text, its output inline, and Stop and Release for a person. **Projects → Runtime** lists every sandbox of a checkout and holds the **Sandbox policy**, including the restore plans and container definitions a person trusts by fingerprint. Control never starts, restarts or builds a sandbox: the agent's next `start-sandbox` rebuilds a stale one.
- A running task's page in **Mission Control** is **live** (Orbit Live, 1.8.0): it shows each journal line and each browser step of the QA begun against its sandbox as they are written, the current activity, a person's approval inline, and the sandbox's console -- no refresh needed. `● LIVE` pulses only while the page holds a healthy stream; `DEGRADED LIVE` means it reads every 5 seconds instead. Nothing on it runs anything, and the console has no input.
- **Tools → Install** and **MCP → Install runtime** download only a pinned, checksum-verified build
  into Orbit's store; neither uses a system package manager.
- Control shows the project it was started in, so start it from the project the person is
  working on when their question is about that project's MCP servers or tools.

If the person already has a panel running from this session, give them that URL again rather
than starting a second server.

## 3. When it does not start

### No Node here is new enough (exit 1)

It says `needs Node >=24.15, and none was found here`. **Install the private runtime and start
it**, in one background command:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/orbit-control/start.mjs --install-runtime
```

Tell the person in one sentence first, because it downloads software. It fetches the official Node
LTS from nodejs.org, checks it against the SHA-256 that nodejs.org publishes, and puts it in the
plugin's own store (`<store>/control-runtime/`). The system Node, nvm, PATH and shell profiles are
**not touched**, and deleting that folder removes it. It happens once: the next start reuses it.

### Anything else

| It says | What it means | Tell the person |
|---|---|---|
| `could not be installed` (exit 3) | offline, a proxy nodejs.org cannot be reached through, or a checksum that did not match (then nothing was installed) | install Node 24 themselves (`nvm install 24`), or set `ORBIT_CONTROL_NODE` to a node binary that is new enough, then ask again |
| `no official build for …` (exit 3) | an OS or CPU nodejs.org publishes no build for | the same: a Node they install, pointed at by `ORBIT_CONTROL_NODE` |
| `ORBIT_MEMORY_DIR: retired`, or a path `is inside the repository` (exit 2) | the backup room resolved somewhere unsafe | fix `ORBIT_STORE_DIR` (README §4.2); backups never go inside a repository |
| `the Control Panel has not been built` (in the page) | a checkout whose `control-server/public/` is empty | only a development checkout: `cd control-panel && npm ci && npm run build` |

To see which Node it would use without starting anything:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/orbit-control/start.mjs --which
```

## 4. Stopping it

Stop the background command. The server closes its connections and exits, and a new start
prints a new URL with a new token.

This skill starts the panel and nothing more. It does not add, enable, approve or remove MCP
servers, install tools or runtimes, or read, edit or delete skills itself, and it does not drive
the browser unless the person asks it to. From a terminal, `node ${CLAUDE_PLUGIN_ROOT}/cli/resources.mjs list`
shows the same registry the Router page does, and `node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs list` the
MCP servers by owner, read-only.
