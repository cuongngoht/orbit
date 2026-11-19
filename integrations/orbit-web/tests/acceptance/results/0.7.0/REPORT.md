# Orbit Web 0.7.0 -- real acceptance run

Image orbit-web:0.7.0; Claude Code 2.1.328; Orbit 0.6.0 (26925c2f2c5db7118c147085eea50174196b9266); budget $2 per turn.

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Start Orbit Web Docker | PASS | orbit-web:0.7.0 healthy on 127.0.0.1:34863 |
| 2 | Open the application | PASS | GET / -> 200 |
| 3 | Sign in to Claude Code | BLOCKED | the browser sign-in needs a person; this run used Claude Code's own environment credential (Orbit Web reads it as: connected, source environment, method oauth_token) |
| 4 | Click Connect GitHub | BLOCKED | the device flow needs a person at github.com/login/device (the real gh in the image was seen to print a real one-time code) |
| 5 | Authenticate using GitHub CLI's browser flow | BLOCKED | needs a person; GitHub is stood in for by the acceptance fake (connected as orbit-acceptance) |
| 6 | Select the fixture GitHub repository | STAND-IN | listed through Orbit Web's own code from the stand-in: ["acceptance/sum-fixture"] |
| 7 | Select the branch | PASS | branches: ["main"] |
| 8 | Choose Sonnet | PASS | model: sonnet |
| 9 | Create a new chat | PASS | HTTP 201 {"id":"c92ae583-a538-423e-9f02-e64dfee78b69","title":"Fix the incorrect addition in sum.mjs so the existing test …","repository":"acceptance/sum-fixture","branch":"main","workBranch":null,"model":"son |
| 10 | Send the prompt | PASS | Fix the incorrect addition in sum.mjs so the existing test passes. Do not modify the test. |
| 11 | The real Claude CLI runs | PASS | Claude Code 2.1.328 (claude-sonnet-5-5); ended session.completed; cost $0.058139800000000005; turns 5 |
| 12 | The Orbit plugin is active | PASS | init plugins: [{"name":"orbit","version":"0.6.0"},{"name":"cc-plugin-agents-md","version":null},{"name":"cc-plugin-telemetry","version":null},{"name":"cc-plugin-privacy","version":null},{"name":"cc-plugin-plugin-authoring","version":null}] |
| 13 | The source really changed | PASS | changed: ["modified:sum.mjs"]; sum.test.mjs untouched: true |
| 14 | The test passes | PASS | node --test exit 0: ℹ pass 1 ℹ fail 0 |
| 15 | Streaming shows the real execution | PASS | 9 text deltas (none with an SSE id), 22 durable events each with its seq as SSE id, tools: ["Read sum.mjs","Edit sum.mjs","Find *test*","$ node --test sum.test.mjs 2>&1 \| tail -15"] |
| 16 | The changed files appear | PASS | 1 file(s) +1 -1 on orbit-web/c92ae583 from main |
| 17 | The Git diff is accurate | PASS | the API's diff is byte-identical to git diff in the workspace |
| 18 | Orbit's status is read correctly | PASS | panel: available, association none/no task, verdict unknown (No Orbit task is linked to this session, so Orbit has given no verdict.); Orbit's own live status: none/no task |
| 19 | Restart the container | PASS | after restart: status completed, 2 messages, turns 1, workspace kept: true |
| 20 | Reopen and continue the session | PASS | resumed true with the same Claude session (true); ended session.completed; cost $0.061699000000000004; answer: I changed `sum` in `sum.mjs` from returning `a - b` to `a + b`, because the function is meant to add two numbers and the subtraction made the existing test fail. |

Totals: PASS 16, BLOCKED 3, STAND-IN 1.
