# ORBIT-MEM-002 — A, B, A is two sessions, and a contradiction keeps a record possible

`src/memory/support.mjs` is the one place that says how many INDEPENDENT sessions back a record and what that makes its
confidence; engineering memory and project knowledge both reconcile by it. A record's support is
`{ examples, sessions, against, seen, contested }`: `seen` and `contested` are lists of session marks
(`sessionMarks` of `src/memory/session.mjs`), and `sessions` and `against` are how many distinct sessions supported and
contradicted it.

The behaviour this source must have:

- `counted(support, seenBy, list)` folds one observation into the list `"seen"` (supporting) or `"contested"`
  (contradicting). When `seenBy` is a session that list has already counted -- by `knownIn` of `src/memory/session.mjs`
  -- nothing changes. Otherwise its marks join that list and that list's counter (`sessions` for `seen`, `against` for
  `contested`) rises by one.
- Sessions are a set, never a counter beside the last one seen: a rerun in the same session is never a second session,
  and A, B, A is two sessions and never three, however often the two alternate. A named and an unnamed observation on
  the same machine and UTC day are one session; two different names are two.
- A supporting session and a contradicting session are each counted in their own list, each once.
- `derive(support)` is `"certain"` exactly when two or more independent sessions support the record and none
  contradicts it. Anything else is `"possible"`: one session, no session, or any contradiction, however many sessions
  support it.

Make the smallest change in `src/memory/` that gives this behaviour, and add a regression test under `test/` that fails
before your change and passes after it. Do not change or delete an existing test.
