# ADR 0026 — Orbit product identity

## Status

Accepted (2026)

## Context

The engine shipped under mixed names (package, plugin, skills, store path). Orbit 2.0 unifies user-facing identity without replacing the goal/work/task/evidence model from 1.9.x.

## Decision

- **Product:** Orbit — tagline *From Goal to Verified Outcome*
- **Plugin id:** `orbit` (`orbit:orbit`, `orbit:orbit-help`, …)
- **Package:** `orbit` @ 2.0.0, private, CLI `orbit`
- **Store default:** `~/.orbit/projects/<project-key>/`; override with `ORBIT_STORE_DIR`
- **Entry skills:** `orbit` (goals), `orbit-help` (navigation and bounded coordination)
- **Shipped skills/agents:** `orbit-*` only in the plugin tree
- **Persisted journal/schema ids** (e.g. goal/source API versions) stay unchanged so existing stores remain readable

## Consequences

- Host manifests, catalog, Control, and Live use Orbit branding.
- Environment configuration uses the `ORBIT_*` prefix only.
- Release gate: `node skills/orbit-release/ship.mjs`.
