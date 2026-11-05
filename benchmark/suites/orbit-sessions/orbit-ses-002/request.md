# Find the defects of the invoice application

The invoice application's accepted requirement is PBI-INV-1, in `/work/target/contracts/pbi.md`, with its HTTP, message
and schedule contracts beside it (`openapi.json`, `asyncapi.json`, `schedule.json`) and its accepted test plan,
`invoice`, in `/work/target/ui-tests/`. The application runs in an isolated sandbox of its own, and only Orbit's engine
can reach it: every test you design runs there, through the engine.

An investigation over it is already open (its id is in your brief). Work it with Orbit's autonomous QA, the `orbit-qa`
skill: read `context`, then settle what the engine says is owed, one decision at a time -- for a test obligation,
`generate` a design and `run-version` the version it freezes -- until the engine gives a reason to stop. Then `finish`
the investigation, and say what was found and what was not inspected, with the evidence the engine kept.

Design each test from the accepted requirement and its contracts. A person's approvals -- a setting, an answer, a
release, a cancel -- are not yours to give, and nothing here asks for one.
