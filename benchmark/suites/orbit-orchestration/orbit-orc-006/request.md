# ORBIT-ORC-006 — an id never moves a failure signature

An engineering task stops with `NO_PROGRESS` when three completed attempts in a row ended on one failure signature.
`signatureOf(run, root)` in `src/orchestration/failure.mjs` is that signature: a 12-hex hash of what failed, normalised
so that what changes between two runs of the SAME failure -- a timestamp, an absolute path, an id, a duration, the
order lines arrive in -- does not move it, and a different failing test does. The ids a failing line prints are often
UUIDs: a request, an order, a tenant, a correlation, a session.

The behaviour this source must have:

- Two runs of one failure whose failing lines differ only in the UUIDs they print sign the same: wherever a UUID stands
  in a line (at its start, after a word, in braces, after `=`), in lower or upper case, one or several to a line.
- A different failing test, or the same test failing differently, still signs differently, whatever ids its lines
  print.
- What already moves no signature -- a timestamp, a duration, an absolute path, a long hexadecimal hash, the order the
  lines arrive in -- still moves none.

Make the smallest change in `src/orchestration/` that gives this behaviour, and add a regression test under `test/`
that fails before your change and passes after it. Do not change or delete an existing test.
