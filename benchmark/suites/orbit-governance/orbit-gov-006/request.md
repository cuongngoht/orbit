# ORBIT-GOV-006 — a call is attributed only by evidence

`src/attribution.mjs` is the one vocabulary the session trail, Orbit Live, Satellite and Orbit Control use to say which
run an invocation belongs to, and how anybody knows it. Each word is earned by its own kind of evidence, in the order a
reader trusts them: `RUNTIME_BOUND`, `HOST_OBSERVED` (the host's own payload links the call), `REPORTED` (an agent or
the session said so, and nothing independent observed it), `UNATTRIBUTED` (nothing says which run), `CONFLICTING` (two
sources name different runs, or one run different agents, and neither is chosen for the reader).

The behaviour this source must have:

- `settle({ observed, reported })` -- the agent ids the hooks observed for a run, and the ones somebody reported --
  comes to its word by an ordered table, the first row that holds deciding:
  - `CONFLICTING` whenever two different agents are named for the one run, by any mix of sources: two observed, two
    reported, or one observed and a different one reported. One run launched twice is never quietly one of them;
  - else `HOST_OBSERVED` when the hooks observed an agent -- also when what was reported agrees with it;
  - else `REPORTED` when only somebody's word names an agent;
  - else `UNATTRIBUTED`.
- It answers `{ word, agents, observed, reported }`, where `agents` is every different agent it was told of, from both
  sources, each once: it chooses none of them for the reader. The same id given twice is one agent, and an empty or
  missing id is no id at all.
- Nothing else moves a word: a call is never moved onto the latest skill, the nearest run or the closest timestamp, so
  whatever else rides along with the evidence changes nothing.
- `envelopeRefOf(text)` reads the qualified run reference `msn-<12 lowercase hex>/arn-<n>` (n from 1, at most five
  digits, no leading zero) off a dispatch envelope: only from a text that carries the envelope's mark
  (`"orbit.satellite.envelope/v1"`, quoted as JSON writes it), pretty-printed or not, with prose around it or not, and
  only when its `missionId` fields name exactly one well-formed mission and its `agentRunId` fields exactly one
  well-formed run (the same id written twice is one id); nothing past the first 262144 characters is read. Otherwise --
  no mark, two missions, two runs, no well-formed mission or run, or no text at all -- it is `null`.

Make the smallest change in `src/attribution.mjs` that gives this behaviour, and add a regression test under `test/`
that fails before your change and passes after it. Do not change or delete an existing test.
