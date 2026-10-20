# Which tool for which QA job

Shared by every `orbit-*` playbook. Read it once per session, not per step.

Three layers, and they are not interchangeable:

| | what it is | what it may decide |
|---|---|---|
| **the host** | Claude Code or Antigravity: the file, search, shell, subagent and MCP tools this session happens to have | nothing about the product |
| **a playbook** | these skills and `agents/*.md`: which tool to reach for, what to pass it, what to do with the answer | what to do next |
| **the engine** | `node <engine>/cli/*.mjs` | **the verdict** — and nothing else may |

A tool call never produces a verdict. PASS/FAIL/REFUSED/BLOCKED/SKIP/PARTIAL/INCONCLUSIVE come out
of `run-case.mjs` and are read, not re-judged. A playbook that concludes "it works" from a
screenshot has skipped the only thing that counts.

`<engine>` is `${CLAUDE_PLUGIN_ROOT}` in a Claude Code session, or `${CLAUDE_PLUGIN_ROOT:-$ORBIT_ENGINE_DIR}` (or the clone path) in an Antigravity session or shell.

## The job table

Always available:

| the job | reach for | not |
|---|---|---|
| find the component that renders a screen | **Grep** / **grep_search** for the route or the label, then **Glob** / **find_by_name** for the file | reading a directory tree by hand |
| read a map record, a case, a plan, a generated schema | **Read** / **view_file** on the one file | loading the whole map into context — `query screen` is the slice |
| read one run's evidence | **Read** / **view_file** on `run-log.jsonl`, or `query triage` for the shape of it | opening every `.png` first |
| correct a case or a map record | **Edit** / **replace_file_content** on the one file, then the engine's own check (`query check`, `record-edge --replace --dry`) | **Write** over a file you have not read |
| write a new case, a scratch patch, a JSONL candidate file | **Write** / **write_to_file** — one file, yours alone | touching a file another agent owns |
| run anything | **Bash** / **run_command**: `node <engine>/cli/…`, `query doctor`, `--dry`, `node --test` | a shell loop that re-implements a CLI the engine already has |

Available only if the session has it — **check, do not assume**, and never let an absent one stop
the whole job:

| the job | reach for | when it is missing |
|---|---|---|
| trace a symbol to its definition or its callers | **LSP** | fall back to **Grep**; say in the report that you searched rather than resolved |
| find a tool for data that lives outside this repo | **ToolSearch** (see below) | use what the host already gave you, or the adapter the project declared |
| one independent, well-scoped piece of work | **Agent** — one job, one owner, a structured report | do it inline; a missing subagent tool is not a blocker |
| keep a multi-step QA workflow visible | the session's task-tracking tool | keep the steps in your replies instead |
| read official technical documentation | **WebSearch** / **WebFetch** | say which fact you could not confirm |

`allowed-tools` in a skill's frontmatter is a **permission grant for the invoking turn**. It is not
discovery, it does not filter anything, and it is **no evidence that a tool exists** — a grant for
an absent tool silently does nothing. The only way to know a tool is there is that the host offered
it this session.

## Reaching outside the repo: the order

1. Name the capability **this step** needs — "the acceptance criteria for this change", not "an
   issue tracker".
2. If the project's own data or a `<engine>/cli` command already answers it, **stop here**. The
   map, the ledger, the notes and the lessons are cheaper and are already evidence.
3. Only for data that genuinely lives outside: **ToolSearch**, if the session has it.
4. **Read the schema and the description** of what came back. A name that looks familiar is not a
   contract.
5. Check you are pointed at the right project, account, environment and scope of action. A
   read-shaped tool that can also write is a tool that can write.
6. Call it with input that matches the **real** schema.
7. Keep only what the next step needs, **and where it came from**. An unsourced fact cannot be
   re-checked, so it is not evidence.

Typical needs: an issue, acceptance criteria, a PR diff, a document, an observation of a live
screen.

**Never** hardcode a server name or an MCP tool name into a playbook, a case or a script. What one
machine has, another does not.

## The lines that do not move

- **A denied permission is reported, not routed around.** Say which step is blocked and why, and
  carry on with everything that does not depend on it. Never re-run the same call through Bash to
  get past a refusal.
- **Never install an MCP server, and never edit Claude's own configuration.** A missing capability
  is the user's decision, not yours.
- **One driver per browser session and per identity at a time.** Two agents in one signed-in
  browser produce a run neither of them can explain.
- **One writer per map file.** Candidates go to `$SCRATCH/`; the parent session applies them.
- **A missing optional tool degrades the step, never the workflow.** Finish every independent part,
  then say plainly what was left and what it was waiting on.
- **What the engine cannot check, a person checks.** `query doctor` speaks only for the tools the
  project declared on this machine; it says nothing about this session's tools or MCP servers, and
  nothing about whether the product is reachable.

Storage locations come from `query storage --json`; see `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`.
