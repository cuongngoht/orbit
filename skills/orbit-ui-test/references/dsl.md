# Reading the DSL before you write a case

**Never write a step from memory.** The vocabulary is a closed set defined in two tables, and
everything else — the editor schema, the validator, the runner, the report — is generated from
them. So there is always a command that answers the question, and it is always right.

```bash
node <engine>/cli/query.mjs dsl            # every verb, every field, the case root
node <engine>/cli/query.mjs dsl <verb>     # one verb: what it needs, what it may carry
```

That digest is generated from the same rows as `schema/case.schema.json`, so it cannot disagree with
what the validator will accept. Read it instead of this file's prose, and instead of the schema.

## Where each answer lives

| the question | the answer, and it is authoritative |
|---|---|
| which verbs exist, what each needs | `query dsl` · rows in `src/dsl/core/verbs.mjs` |
| which fields a verb may carry, and each field's type | `query dsl <verb>` · rows in `src/dsl/core/fields.mjs` |
| which capabilities `{"do":"call"}` may ask HERE | `query capabilities` · `query capability <id>` — a project's own, never the engine's |
| what an editor will validate as you type | the generated `$DATA/schema/case.schema.json` (a case's `$schema: "../../../schema/case.schema.json"`) |
| what a real case looks like | `query.mjs case <closest-existing-id>` — copy the closest one, never invent a shape |
| which control to name, and what it does below the UI | `query.mjs screen <id>` · `query.mjs effect "<screen>/<via>"` |
| what the validator will refuse, and why | `src/dsl/rules/*.mjs`, one family per file |
| which gate refuses a run before the browser | `src/run/gates/` — and note `--dry` runs **none** of them |

**A field the schema does not have is not a field.** If a scenario needs something the DSL cannot
express, that is a capability gap to report — never a key to invent, and never a reason to reach
past the DSL into a shell command.

## The five things the tables will not tell you

Generated output covers the grammar. These are the semantics that decide whether a case is honest,
and each one is a rule the checker enforces:

1. **A case must be able to fail.** No `assert`, no `api`, no `sql`, no `report`+`expect` means the
   case reports PASS whatever the screen did. The validator refuses it.
2. **A value is escaped for the language it lands in.** `query dsl` prints each field's `esc`
   column. A `${PARAM}` in SQL goes inside the quotes — `WHERE Name='${NAME}'` — because an
   unfilled or unquoted placeholder once passed a "the row is gone" check for exactly the wrong
   reason.
3. **`api` proves a NEW request.** The engine re-bases the request log before every action, and an
   `api` step asks what the UI did *since* that mark. So it goes immediately after the commit click
   and **before any reload** — a `goto` in between loses the call it was asking about.
4. **A write is witnessed below the screen.** A case declaring `creates` and ruling only on the
   screen is a `check` finding, not a style note: an optimistic render shows a write that never
   happened. And `graph/effects.json` is held against the case — assert the method and the call the
   map records for the control you drove, and query a table it records. The map says which table;
   your predicate still says which row.
5. **`into` binds once, forward only.** One name, bound by the step that produced it, readable only
   by later steps. It goes into the shared ledger, so **never bind a secret**.

## Proving it without running it

```bash
node <engine>/cli/query.mjs check                        # zero findings, and it EXITS 1 if any
node <engine>/cli/run-case.mjs <id> NAME=TC-demo --dry   # every step resolves
```

Both must be clean before a case is handed over. Know what they bought you:

- `--dry` runs the **whole validator**, resolves every `on` against the map, fills the params, and
  prints the plan. It opens no browser, reads no database, writes no evidence and no ledger line,
  and runs **no gate**. It is a check on the *file and the map* — not on the machine, and **not**
  evidence that a locator works on the screen.
- A dry run is never recorded as a verification. Only a run may write `seen: "live"` and
  `fe_commit`, and only in the turn it finished.

Storage locations come from `query storage --json`; see `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`.
