# ORBIT-MEM-005 — stale is not false, and an uncommitted edit is unknown

`src/freshness.mjs` answers one question for architecture and engineering memory: has the tree moved under this fact?
Freshness is keyed to a fact's own SCOPE, never to HEAD, so a commit that touches a README leaves a fact about other
code alone. A scope is measured now as `{ hash, files, dirty }` (`dirty`: how many uncommitted changes it has) and
compared with the hash recorded when the fact was learned.

The behaviour this source must have:

- `scopeState(now, was)` is, with the hash measured now riding along (`hash`, or `null` when there is nothing measured):
  - `unknown` when the scope is gone or there is no checkout to ask (`now` is absent);
  - `unknown` when it has uncommitted edits the index cannot see -- whatever its hash, and never `stale` or `fresh`;
  - `unknown` when nothing recorded what it used to be;
  - otherwise `fresh` when it hashes to what was recorded, and `stale` when it moved. Stale means NEEDS REVALIDATION; it
    never means false.
- `factState(fact, scopes)`: a fact is as fresh as its least fresh scope. Any stale scope makes it `stale`; all scopes
  fresh makes it `fresh`; anything else is `unknown` -- an unknown scope, a scope the fact names that nobody measured,
  or a fact that names no scope at all.
- `measure(facts, model, source)` measures every scope the facts name -- and only those -- once, asking the source port
  (`source.fingerprints(scopes)`) in ONE call however many there are, and not at all when the facts name none. It answers
  each scope's state against the hash the model recorded for it (`model.scopes[scope].hash`); a scope the port does not
  answer for is gone.
- `movedScopes(scopes)` names the scopes a rescan must cover: every one that is not fresh.

Make the smallest change in `src/freshness.mjs` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
