# Report extensions: the part contract, the SDK, and how parts compose

A report extension is a `orbit.extension/v2` extension whose manifest names a `reporting`
module — a **JSON** file, parsed and never imported — declaring one or more parts. The only
code a part brings is a script the report runner starts as its own process:

```
python -I -S -B -X utf8 <kit>/orbit_part.py  < envelope.json  > result.json
```

`-I -S`: no user site, no `.pth`, no `PYTHON*` variables; the environment is the minimum a
process needs to start, and **never a credential**. A guard refuses sockets, processes, native
code, and writes outside the part's output directory. That guard is a second lock, not a
sandbox: a part runs as the user who runs the report.

## `extension.json` and `reporting.json`

```json
{ "id": "pr-aging", "version": "0.1.0", "apiVersion": "orbit.extension/v2",
  "engine": ">=0.0.1 <1", "status": "draft", "createdFor": "<the need>",
  "reporting": "./reporting.json" }
```

| Part field | Meaning |
|---|---|
| `id` | `<extension-id>.<name>`. `orbit.report.*` belongs to the standard kit. |
| `version`, `contract` | the part's own version; `orbit.report.part/v1` |
| `kind` | `collector` · `transform` · `metric` · `section` · `exporter` · `workflow` |
| `runtime`, `requires` | `python`, `>=3.11` (the catalog's tool, resolved per machine) |
| `entry` | `./<file>.py` — a `.md` playbook for a workflow, which is listed and never run |
| `doc`, `basedOn` | what it is for, and where it came from (the need, the collections) |
| `provides`, `needs` | tokens: `report.collection.<name>`, `report.model`, `report.metric.<id>`, `report.forecast`, … |
| `metrics` | a metric part's metrics: `id` (namespaced), `version`, `label`, `unit`, `definition`. Nothing undeclared is kept. |
| `section` | `{ id, title, placement: "after:<section id>" }` |
| `replaces` | the part it REPLACES — explicit, and only a person approves it |
| `formats` | an exporter's: `csv`, `json`, `md`, `txt` |
| `timeoutSec`, `fixture` | how long it may take; a snapshot it is verified on |

Refused outright: `packages` beyond the standard library, a store part that is `.mjs`, a
collector that needs the source's API (`source.read`), an id outside its extension's namespace.

## The SDK a part is handed

```python
def run(envelope, sdk):
    prs = sdk.collection("pullRequests")        # DataMissing when the source could not give it
    sdk.metric("pr-aging.open-at-cutoff", value=n, basis={"samples": n})
    sdk.section([sdk.tiles([...]), sdk.table(cols, rows), sdk.chart("bar", labels, series)])
    return {}
```

`collection(name)` · `has(name)` · `completeness(name)` · `snapshot()` · `model()` (the standard
model, for a part that `needs` `report.model`) · `metrics()` · `derived(name)` · `cutoff`,
`window`, `calendar`, `local_date(t)`, `before_cutoff(t)`, `in_window(t)` · `metric(…)` (only
declared ids) · `section(blocks, title)` with `tiles` `table` `chart` `text` `notes` · `write(name,
obj)` (a transform's output) · `export(name, text)` (an exporter's file) · `log(…)` ·
`DataMissing([...])` to say what is missing. A link is a table cell `{"url": …, "text": …}`, shown
only when it points at the report's own source.

Exit 0 = done · 2 = a data gap (shown as "not available", never a zero) · 3 = the part failed
(its section says so; every other section is untouched).

## How parts compose (`src/project-report/compose.mjs`)

In order, each exclusion printed with its reason:

1. **admit** — the contract, an active extension whose files are the ones registered, switched
   on in the settings, a runtime that satisfies `requires`, not contested;
2. **replacement** — declared, the same kind, providing everything the replaced part provided,
   and approved by a person; two replacements of one part cancel each other;
3. **dependencies** — a need nothing provides leaves its part out, and a cycle leaves out every
   part on it, with the cycle printed;
4. **order** — collector → transform → metric → section → exporter; in a phase, what is needed
   first, ties by id.

An extension part runs BESIDE the standard ones; one titled like a standard section is shown
beside it, never instead of it. Every run COPIES the extensions it uses into the run, hashes
them, and runs the copy; the record says which files at which hashes produced the page.

## The lifecycle

`qc-tool new <id> --report=<kind> --for="<need>"` → `put <id> <file>` (stdin) → `register <id>`
(the real loader, a static check, and the part RUN on its fixture, the latest snapshot, or the
pack's synthetic sample) → `status <id> active` → `project-report render latest`.
`register` keeps the previous version aside; `rollback <id> [--to=<version>]` restores one,
verified again. A file edited by hand in the store stops the part from running until it is
registered again (`--human` for a person's own edit).
