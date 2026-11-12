# login-app (fixture)

A small two-sided project for the file-level relations walk (test/context-relations.test.mjs,
test/develop-relations.test.mjs): a frontend whose login page calls an API client that posts to the
session route, a backend in another language whose route handler serves that route through a session
module, tests on both sides, and a decoy named login that none of them touches.
