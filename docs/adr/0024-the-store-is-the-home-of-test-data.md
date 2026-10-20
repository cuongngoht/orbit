# ADR 0024 — One explicit data home per project

**Status:** accepted; current storage layout 3.

Every Git checkout resolves a project by repository identity. Its store is outside all repositories,
under `ORBIT_STORE_DIR` or `~/.orbit/projects/`. Reads create nothing. Explicit use seats the checkout,
its project descriptor and generated schemas without inventing screens or cases.

The default test-data home is `<storeRoot>/ui-tests/`. A person's `dataHome` stamp may select
`checkout`; `init --in-checkout` and a confirmed export set that stamp. A committed directory alone
never changes resolution. `ORBIT_UI_TESTS` explicitly selects a directory and uses current store rooms.
There is one active copy, read and written directly. No mirror, directory search or automatic upgrade runs.

Publication remains a separate, explicit operation. Import copies checkout test data to the store;
export previews changes and requires Control's mutation door or a person's interactive confirmation.
Both record relative paths and file digests, refuse conflicts, contain symlinks and verify written bytes.
They transfer current test data and do not convert schemas. They never delete the source.

Reports, evidence, goals, tasks, requirements, lessons and runtime state remain store-only. Unsupported
or corrupt state is refused without replacement. UI runs still require an origin before browser access.
