# ORBIT-MEM-007 — a second look at an unchanged checkout is CURRENT, and reads no file

`node cli/architecture.mjs ensure` is how every playbook asks for a project's architecture: it decides whether the
repository has to be read at all (`src/architecture/ensure.mjs`), says why, and does only that much
(`src/architecture/views/ensure.mjs`). Memory comes first, and a scan is the exception: the normal answer is CURRENT,
at the cost of a few git calls -- no listing and no file read.

The behaviour this source must have, for a git checkout that nothing moved in between two looks:

- A first look, with nothing learned, is BOOTSTRAP: it lists the tree once, reads what the tree declares (its manifests
  and documents) and records a snapshot, so that nothing after it has to.
- Every look after that is CURRENT. It reads no file, lists nothing and searches nothing; it asks the index for its
  entries ONCE, however many scopes the snapshot holds (one fingerprint call); it makes a few git calls in all -- at
  most four -- and it writes nothing: the store holds the same bytes after it as before it.
- `--dry` writes nothing, whatever the look decides. A `--dry` first look leaves the store as it was, so the next look
  still learns; a `--dry` look over a snapshot is CURRENT.
- A CURRENT look is cheap: at its best of three, it takes under half the time of the look that learned the snapshot.

Make the smallest change under `src/architecture/`, `src/freshness.mjs` or `src/frontend/` that gives this behaviour,
and add a regression test under `test/` that fails before your change and passes after it. Do not change or delete an
existing test.
