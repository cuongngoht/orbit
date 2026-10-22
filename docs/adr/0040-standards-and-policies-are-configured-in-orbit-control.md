# ADR 0040 — Standards and policies are sources a person configures in Orbit Control

## Status

Proposed (0.1.0). Extends ADR 0007 (authority) and the Control door rules (ADR 0012, ADR 0016).

## Context

1. **Catalogs and budgets need to change without a release.** The 0.1.0 plan pins OWASP Top 10 2025 and ASVS 5.0.0 as
   the starting security catalogs and proposes budgets (§6.4). A project may need another catalog version, a different
   standard, its own policy, or tighter limits.
2. **Neither hard-coding nor agent editing is acceptable.** A catalog Orbit hard-codes is a product learned. A catalog
   an agent fetches or edits is authority a model gave itself.

## Decision

- **A security catalog is a source.** `orbit.control-catalog/v1` has:
  - a header: catalog, version, source (URL, tag, digest, when retrieved), licence and a note;
  - controls, each with a versioned id, a group, a summary in Orbit's words, a link, verification methods, minimum
    evidence (positive, negative, state), an `applies` predicate over structural roles, shape ids and an unsupported
    reason;
  - many-to-many mappings.
- **A person manages catalogs in Orbit Control.** There is no limit, and several can be active at once. A person can:
  - add a source by URL or by file, fetch it, preview it (the count of controls and a diff against the current one),
    then adopt it, which pins the digest;
  - change a link or a version;
  - write a catalog of their own, or single controls, in an editor that validates against the contract and keeps
    revisions;
  - enable catalogs per project, filtered by level or group;
  - mark a control not-applicable, with a reason.

  Readers for public catalog formats live in `skills/orbit-security-audit/formats/`. Agents and CLIs never fetch or
  edit a catalog.
- **The default.** When a project configured nothing, ASVS 5.0.0 Level 1 is the source of obligations, labelled with
  OWASP Top 10 2025 and API Security Top 10 2023. It ships as ids, links and Orbit's own summaries, never the standard's
  text.
- **At run time the Security Auditor reads the enabled catalogs.** It computes applicability over the graph:
  - applicable, with the refs that made it hold;
  - not-applicable, only when a scan covered the scope, and with a reason;
  - applicability-unknown, naming what would settle it.

  It hands the obligations to QA. What needs design or process evidence is `not-tested`, never "compliant". Each
  assessment pins the catalog's id, version and digest. A catalog change makes the obligations derived from the old one
  STALE; an old report keeps its pin.
- **Budgets and limits are data a person sets.** The plan's §6.4 values are defaults:
  - 20 obligations, 4 cases each, 2 repairs, 1 worker;
  - 2 requests a second, 10 s per HTTP call, 120 s per case, 15 minutes per session, 1 MiB per response;
  - 10 logical messages, 3 delivery attempts each, 2 workers;
  - plus wall time, occurrences, in-flight work, observation bytes and events, polling rate, retry horizon, replay range
    and a teardown deadline.

  They narrow in order: machine → project → grant → the adapter's declared limits → the run budget left. Advancing a
  clock never extends a grant.
- **Vocabularies are layered.** The organisation's and the project's topology and semantics layers are edited the same
  way.

## Consequences

- Control gains pages for catalogs, adapters, limits and isolation. Every write names the revision it read.
