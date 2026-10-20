Seed ledgers for the suite: run lines and notes a test needs to already exist,
kept as plain input rather than as a store.

They are NOT a store, and the layout here is not the store's layout. A store is
keyed by a hash of the project's origin (`projectKey`, `src/store/resolve.mjs`),
so a committed `store/<hash>/` would be unreadable to anyone and would rot the
day a fixture's `origin` changed. `test/fakes/store.mjs` computes the key and
copies these files into a throwaway directory, which the test then exports as
`ORBIT_STORE_DIR`.

* `main/` — the fixture project's own history: two machines, two verdicts. That
  disagreement is the point, and several tests assert on it.
* `qa/` — a separate history for the QA-plan fixtures: one fresh PASS, one SKIP,
  one BLOCKED, sized to demonstrate one plan's coverage. It is apart from `main/`
  because folding those runs into the shared history would change what
  `learn analyse` concludes about a completely different subject.

Nothing a test runs appends here any more. The ledger left the repository in
1.4.2, so `run-case` against `test/fixtures/ui-tests` writes into a temporary
store and this directory stays exactly as committed — the reason the old
`test/fixtures/ui-tests/memory/` needed a warning in AGENTS.md, and no longer
does.
