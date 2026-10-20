---
name: orbit-sql
description: >
  Read a Microsoft SQL Server database from a UI test run, through sqlcmd. Use when a case needs
  a `sql` step, when `run-case` reports BLOCKED because the database could not be read, when
  wiring `sql.command` in ui-tests/project.json, or when asked to check a row/table in SQL
  Server for a test. Read-only (SELECT/WITH), one statement per call; the connection comes from
  ORBIT_SQL_* in the environment (or the resolved runtime adapter file) and no credential ever enters the
  repository. `preflight` says whether this machine can read the database at all; `setup-hint`
  prints the commands that configure it.
argument-hint: <a SELECT to run | "wire up sql for this repo" | "why is the database BLOCKED">
allowed-tools:
  - Read
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/orbit-sql/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

**Storage paths:** read `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`
and run `query storage --json` before working with project files. `$DATA`, `$SCRATCH`,
`$REPORTS`, `$RUNTIME` and `$EVIDENCE` below are the resolved paths from that command.


# Read SQL Server for a test run

This is the **optional adapter** behind `project.json` → `sql.command`. The engine knows only
"a command that takes the query as its last argument and prints rows"; this skill is one such
command, for teams whose database is SQL Server. A team on another database writes its own and
the engine does not change.

## 1. Wire it once

```jsonc
// $DATA/project.json
"sql": { "command": ["node", "${CLAUDE_PLUGIN_ROOT}/skills/orbit-sql/sqlcmd.mjs"] }
```

`${CLAUDE_PLUGIN_ROOT}` expands inside a Claude Code session. For runs from a plain shell (CI, a
cron job), use the path to the installed plugin instead, or set the variable in that shell.

Then the environment, **outside the repository** — a machine-level variable, your shell profile,
or the CI secret store:

| variable | meaning |
|---|---|
| `ORBIT_SQL_SERVER` | **required.** `host`, `host,1433`, or `host\INSTANCE` |
| `ORBIT_SQL_DATABASE` | **required.** the database to read |
| `ORBIT_SQL_USER` | a SQL login. **Omit it** for Windows integrated auth (`-E`) |
| `ORBIT_SQL_PASSWORD` | only with `ORBIT_SQL_USER`. Passed to sqlcmd as `SQLCMDPASSWORD` in its environment, never as an argument, never printed |
| `ORBIT_SQL_TIMEOUT` | login and query timeout in seconds (default 30) |
| `ORBIT_SQL_TRUST_CERT` | set to `1` only for a server with a self-signed certificate (adds `-C`) |
| `ORBIT_SQL_BIN` | path to sqlcmd when it is not on `PATH` |

Check it in one line, then stop:

```bash
node <plugin>/skills/orbit-sql/sqlcmd.mjs preflight
```

```
sqlcmd              : /opt/homebrew/bin/sqlcmd
ORBIT_SQL_SERVER     : db.internal [environment]
ORBIT_SQL_DATABASE   : App [<runtimeDir>/adapters/sql.env]
ORBIT_SQL_PASSWORD   : set (18 chars) [<runtimeDir>/adapters/sql.env]
connection : OK
database   : App
login      : svc_read   db_datareader=1  db_owner=0
```

Exit 0 means a case can reach the database; 2 means it is not configured or sqlcmd is missing;
anything else is sqlcmd's own code. **Where each value came from is printed on purpose** — the
commonest failure here is not a wrong password.

## 1b. When the variables "are set" and the tool says they are not

An `export` reaches a process only if that process starts **afterwards**. An agent that is
already running inherited its environment at launch, and nothing a shell does later can reach
into it. So there are two fixes, and they fix different sessions:

| | fixes | how |
|---|---|---|
| `$RUNTIME/adapters/sql.env` | **this** session, no restart | canonical `ORBIT_SQL_*` `KEY=VALUE` lines only (unknown keys are refused), mode 600, in Orbit runtime — never in a repository |
| the shell profile | every session started later | `export ORBIT_SQL_…` in `~/.zshrc`, then a new terminal |

```bash
node <plugin>/skills/orbit-sql/sqlcmd.mjs setup-hint [--os=mac|win|linux] [--from-env] \
     [--server=…] [--database=…] [--user=…]
```

It **prints** the commands for both; the user runs them in their own terminal. Never run them for
them, never ask for the password in the chat, and never read the file back: `--from-env` copies
what their shell already exported into the file, so the secret is never retyped and never shown.
The environment always wins over the file, so a machine or a CI job that exports its own
credentials is unaffected by whatever is in `$HOME`.

## 2. The rules this tool enforces

- **SELECT or WITH only**, **one statement per call**, and **no writing word anywhere** outside a
  quoted value or a comment. That last part is the engine's shared check
  (`src/dsl/sql-text.mjs`), imported rather than written again here: a prefix test used to accept
  `SELECT 1; DROP TABLE x`, `WITH x AS (…) DELETE FROM y` and `SELECT * INTO z`. A `;` or the word
  `DELETE` inside a quoted value is still data, and a `-- DROP TABLE` comment is still a comment.
- **Plus what only this tool should know about SQL Server**: `GO`, `sp_`/`xp_` procedures,
  `OPENROWSET`/`OPENQUERY`, `BULK`, `WAITFOR`, `BACKUP`/`RESTORE`, `DBCC`, `RECONFIGURE`,
  `SHUTDOWN`. These stay here on purpose — the engine serves teams on other databases and must
  not learn one vendor's vocabulary.
- **A `${PARAM}` is escaped, not bound.** The engine requires it to sit inside a quoted value
  (`'${NAME}'`) and doubles the quotes in it, then re-checks the finished text before running it —
  so `O'Brien` asks the question the case meant. That is escaping. There is no binding channel in
  a port whose contract is "the SQL is the last argument".
- **Least privilege is the real defence, and the only guarantee.** Give the login `db_datareader`
  on that database and nothing else. A read-only check protects against a mistake; a read-only
  login protects against everything. `preflight` asks the server which roles the login holds and
  says so; a `db_owner` login is reported, not refused (`preflight.mjs` is where to change that
  if your environment can promise a reader).
- **A query that never answers is killed** after `ORBIT_SQL_TIMEOUT` + 15s and reported as BLOCKED.
  sqlcmd's own `-l`/`-t` come first; this is the backstop for a process that ignores them.
- **No credential in the repository.** Not in `project.json`, not in a case, not in a `.env` that
  a commit can catch. The engine never sees one.
- Exit codes: `0` ran · `2` refused or not configured · anything else is sqlcmd's, which the
  engine turns into **BLOCKED** (exit 3) — "we never got to ask", not "the product is broken".

## 3. Using it from a case

```json
{ "do": "sql", "query": "SELECT COUNT(*) AS n FROM Things WHERE Name='${NAME}'", "expect": "Number(it[0].n) === 1" }
```

- `it` is the rows; **every value is a string** — `Number(it[0].n)`, never `it[0].n === 1`.
- Assert the row **after a reload**, not right after the click: a repaint is not a commit.
- `${PARAM}` must be filled — an unresolved placeholder fails the step loudly rather than
  quietly asking a different question.
- Name the object with a `TC-` prefix so a later cleanup can tell test rows from customer data.

## 4. When a run says BLOCKED

Read the message the port printed — it is sqlcmd's own first line.

| message | what it means |
|---|---|
| `is not on PATH` | sqlcmd is not installed here, or `ORBIT_SQL_BIN` is wrong |
| `not configured: set ORBIT_SQL_…` | the variables are missing in *this* process — see §1b, and run `preflight` to see which ones and from where |
| `Login failed for user` | wrong login, or the login has no access to that database |
| `certificate chain was issued by an authority that is not trusted` | a self-signed server certificate: set `ORBIT_SQL_TRUST_CERT=1` |
| a timeout | usually the VPN, not the query |

BLOCKED is never a product finding. Fix the connection, or say the case could not be verified —
do not downgrade the case to a UI-only check and call it a pass.

When the fix turns out to be a fact about **this machine** rather than about the product, remember
it. The notes are committed and stamped with the host that wrote them, so the next person sees
whose laptop it applied to — and never put a credential in one:

```bash
node <plugin>/cli/note.mjs "machine" "sqlcmd needs the VPN profile" "<what you had to do>" --type=trap
```

and read it back with `<plugin>/cli/query.mjs notes machine` before spending the same hour twice.
