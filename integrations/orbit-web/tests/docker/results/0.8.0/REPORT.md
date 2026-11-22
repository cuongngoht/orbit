# Orbit Web 0.8.0 -- Docker smoke test

`node tests/docker/smoke.mjs --image=orbit-web:0.8.0 --browser --out=<dir>`, 2026-11-22T00:36Z, on the image built from this branch (`node scripts/build-image.mjs --tag=orbit-web:0.8.0` at d7fec10 -- the commits after it change tests and documents only), with Playwright's Chromium on the same machine. No AI provider's credential was used.

```
PASS  1. the image exists -- orbit-web:0.8.0
PASS     PostgreSQL with pgvector starts beside it (the pinned image, Orbit Web's role made by the init script) -- pgvector/pgvector:0.8.1-pg17-trixie
PASS     with no database it does not start -- and keeps nothing anywhere else -- exited 1; [Nest] 6  - 11/22/2026, 12:35:05 AM   ERROR [ExceptionHandler] DatabaseUnavailable [Error]: the database could not be reached (ENOTFOUND)
PASS  2. the container starts
PASS     ...and reports healthy
PASS  3. the web UI responds -- HTTP 200
PASS     ...with a strict content security policy
PASS  4. the API responds (GET /api/health) -- {"status":"ok","api":{"ok":true,"detail":null},"claude":{"ok":true,"detail":"2.1.328"},"gh":{"ok":true,"detail":"2.89.0"},"git":{"ok":true,"detail":"2.39.5"},"az":{"ok":true,"detail":"2.91.0"},"python":{"ok":true,"detail":"3.15.2"},"orbitPlugin":{"ok":true,"detail":"0.6.0"},"storage":{"ok":true,"det
PASS     ...its database migrated, pgvector enabled -- {"ok":true,"detail":null,"server":"17.8 (Debian 17.8-1.pgdg13+1)","schema":1,"latestSchema":1,"pgvector":"0.8.1"}
PASS     ...and the health check names no connection string
PASS     Orbit Web's database role is not a superuser -- f
PASS  5. claude is installed -- 2.1.328 (Claude Code)
PASS  6. gh is installed -- gh version 2.89.0 (2026-03-26)
PASS  7. git is installed -- git version 2.39.5
PASS     node is installed -- v24.22.3
PASS     the Azure CLI is installed (optional component) -- 2.91.0
PASS     Python is installed for Claude Code (optional component: the pinned CPython, with pip and venv) -- 3.15.2 pip 26.3 from /tmp/smoke-venv/lib/python3.15/site-packages/pip (python 3.15)
PASS  8. the Orbit plugin is present and loadable (claude plugin validate) -- ✔ Validation passed with warnings
PASS     ...as git archive made it (no evaluator/, no integrations/)
PASS     ...and the API reads it -- {"ok":true,"detail":"0.6.0"}
PASS     the container runs as a non-root user -- uid 10001
PASS     that user can read everything Orbit Web and the plugin ship
PASS     the persistent directories are private to that user -- 700 orbit, 700 orbit, 700 orbit, 700 orbit, 700 orbit, 700 orbit, 700 orbit
PASS     that user creates, edits, renames and deletes in /data/workspaces, and cannot write the programs or the plugin
PASS     the Azure Repos credential helper is there, and answers nothing for another host -- exit=0
PASS     no Claude login is the image's: CLAUDE_CONFIG_DIR is not set (each Claude process is one AI connection's) -- unset
PASS     the terminal sign-in of a connection is there (connect.js), and needs a connection's id -- exit 2
PASS  11. nobody set up: the page opens on Orbit Web's own setup -- state setup_required
PASS     ...and every other route waits for it -- /api/setup/status 401, /api/settings 401, /api/github/status 401, /api/sessions 401
PASS     a foreign Host header is refused
PASS     a change without the Orbit Web header is refused
PASS     a made-up setup code is refused -- HTTP 400
PASS     the server's terminal prints a one-time setup code (governance.js owner setup-code) -- printed once
PASS     with it the first administrator is set up, and this browser signed in -- HTTP 200 signed_in
PASS     ...and the code is used: a second setup with it is refused -- HTTP 400
PASS     one customer account was made, beside the reserved system account -- customer:1,system:1
PASS     the password is kept as a scrypt hash, never as itself -- t
PASS     the session opens the API -- HTTP 200
PASS     ...which reads the build info -- {"web":"0.8.0","orbit":"0.6.0","orbitCommit":"d7fec105898078ca94a89c60901ee31d0e837831","claude":"2.1.328","gh":"2.89.0","git":"2.39.5","az":"2.91.0","python":"3.15.2","node":"24.22.3"}
PASS  9. state is written to the volume
PASS     a research workspace and a pasted source are kept (read and indexed, no model asked) -- source ready
PASS  10. a restart keeps the state -- and this browser's session -- {"defaultModel":"opus","defaultEffort":"medium","defaultMode":"autonomous","projectSkills":true,"projectPlugins":false,"webTools":true,"githubForClaude":false,"azureForClaude":false,"theme":"dark","maxBudgetUsd":null}
PASS     ...and the research workspace with its source, still ready -- workspace listed, source ready, content HTTP 200
PASS     a new container on the same volume keeps it too -- {"defaultModel":"opus","defaultEffort":"medium","defaultMode":"autonomous","projectSkills":true,"projectPlugins":false,"webTools":true,"githubForClaude":false,"azureForClaude":false,"theme":"dark","maxBudgetUsd":null}
PASS     ...research included -- workspace listed, source ready, content HTTP 200
PASS     the source's bytes are in /data/research, kept by their hash -- 1 file(s)
PASS     signing out ends this browser's session -- logout HTTP 200, then HTTP 401
PASS     a wrong password is refused, the right one signs the browser in again -- HTTP 401, then HTTP 200
PASS  12. a trial another machine could reach refuses to start, saying why -- exited 1; [Nest] 7  - 11/22/2026, 12:35:38 AM   ERROR [OrbitWeb] configuration refused: ORBIT_WEB_TRIAL=1 refused: ORBIT_WEB_ALLOWED_HOSTS names orbit.example.com: a trial answers loopback host names only (loca
PASS     on this machine alone the trial starts on an empty database, and says its login -- healthy true, trial {"enabled":true,"username":"admin","password":"123456"}
PASS     ...and admin / 123456 signs in -- HTTP 200
PASS  13. a real browser: the sign-in page is Orbit Web's own, the trial's login said in a red bar
PASS     the office is set up with no AI connection; Hire waits for one and says why -- hire disabled
PASS     a Claude Code subscription connection is added, Disconnected, with the terminal command that signs it in -- docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/connect.js <id>
PASS     Compute & storage says the capacity, how it was obtained, the budget and each storage level
PASS     Governance offers Employee network access: Autonomous or Restricted, private addresses never
PASS     at 320 px no page of the Office, Settings or Governance scrolls sideways -- 7 pages
PASS     ...and the page reported no error
58/58 Docker checks passed
```

Screenshots: `office.png` (1280 px, the office set up, Hire waiting for a connection) and `320-office.png` (the same at 320 px).
