# ADR 0034 — Orbit ships capability packs a project opts into

## Status

Proposed (0.1.0). Amends the AGENTS.md rules "A PROVIDER IS NOT A VERB" and "A concrete tool lives in `skills/`".

## Context

1. **There was no way to ship a capability.** Capabilities were "registered by a project from OUTSIDE this repo". The
   loader reads only the project's store room (`src/extensions/store.mjs:28`, `qc-tools/`). `qc-tool register` copies a
   FLAT directory into that room (`src/extensions/lifecycle.mjs:128,140`), so a shipped tool with subdirectories cannot
   travel that way, and a copy would not follow a plugin upgrade.
2. **0.1.0 needs to ship some.** It has generic capabilities (HTTP, the adapter families of ADR 0035) and reference
   adapters that every project should be able to use without writing them.

## Decision

- **A pack is opted into by id.**
  - `project.json` gains `packs`, a list of ids, default `[]`.
  - `catalog/packs.json` lists the packs that may be shipped.
  - An id it does not list becomes a recorded refusal.
- **Loaded in place, by the same loader and contract.** `src/extensions/packs.mjs` hands the loader the same room shape
  the store room has, pointing into the plugin directory. Packs are gathered first, then `qc-tools/`, through the same
  validation and the same refusals. Nothing is copied.
- **`orbit.*` is reserved** to the engine's own registrations and to packs. A store extension claiming an `orbit.*` id
  is refused.
- **Pinned by the engine.**
  - A pack's manifest is `active`, and its version equals the engine's; a test holds both.
  - A provider's identity in every log line and receipt is `pack:<id>@<version>#<fingerprint>`.
  - `qc-tool` refuses to act on a pack.
- **A pack never states a support level.** Support is computed (ADR 0035).

## Consequences

- AGENTS.md: a provider is a capability behind `call`. Either a project registers it from outside this repo, or Orbit
  ships it as a pack that stays inert until a project opts in. A pack's product words stay in its `skills/` directory.
- The extension manifest stays `orbit.extension/v2`. Its new optional fields are additive, as `runs` was in 0.0.4.
