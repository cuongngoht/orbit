# The autonomous QA benchmark's fixtures

`test/autonomous-qa-benchmark.test.mjs` drives every app here through the loop
(context → decision → step → checkpoint → finish), using a scripted policy in
place of the host's model, on fake ports. It holds the results to five gates and
prints the baseline that future efficiency thresholds will be set from.

| file | what it is |
|---|---|
| `apps.json` | one scripted fake APPLICATION per row: what the product does (its requests, its data, its tenancy, its rule), what a person approved (the mode, settings) and how the session goes (two sessions, a crash). It says nothing about what the engine should conclude. |
| `truth.json` | the GROUND TRUTH per app: the defects a correct QA must find (and whether their oracle can confirm them), the behaviours it must recognise as correct, and the writes an authorised session makes. It is written from the app's description, never from a run, and never edited to make a gate pass. |
| `refunds.plan.json` | a screenless plan for a PBI: one accepted criterion, one scenario proved on the api layer only. |
| `refund-limit.json` | its case: one `call` to a capability that declared `page: false`, so it runs with no browser at all. |

## Adding an app

1. Describe the product in `apps.json`. Name its behaviour in the words the test's
   `PRODUCTS` table already knows, or add a row there.
2. Write what is TRUE about it in `truth.json`, before you run anything.
3. Run `node --test test/autonomous-qa-benchmark.test.mjs`. A gate that fails is
   a finding about the engine or about the policy, and the fix goes there.
