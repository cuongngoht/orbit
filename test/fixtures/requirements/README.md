# Requirement fixtures

`workitem-4312.json` is the synthetic work item `test/requirements-e2e.test.mjs` reads through a
scripted reader. It has two revisions. Revision 7 is what a session reads on its first day.
Revision 8 is what another session reads on the next: one stated fact moved, and one thing a person
decided is now contradicted.

Nothing in it names a real tenant, person, product or system, and every sentence that must never
reach a store, a journal or a trail starts with `SENTINEL-E2E`, so the test can look for it.
