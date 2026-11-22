# ADR 0069 — Orbit Web: accounts are the gate, the host's capacity is read again, and the image carries every AI CLI

## Status

Accepted (Orbit Web 0.8.0), 2026-11-22, the owner's decisions while deploying 0.8.0 to the hosted installation
("chỉ cần nhập account và mật khẩu là xong", "có phần re-check để lấy cấu hình mới", "image có cài sẵn codex và agy
cli"). Amends ADR 0060's access token rule and ADR 0067's capacity and image. For Orbit Web only.

## Context

1. Since ADR 0060 an Orbit Web answering any host name but loopback refused to start without
   `ORBIT_WEB_ACCESS_TOKEN`: before 0.8.0 the token was the only thing between the internet and the app. 0.8.0 (ADR
   0067) gives Orbit Web its own accounts -- a username and a scrypt-hashed password, throttled sign-in, a first
   administrator made only with a one-time code printed in the server's terminal -- and every route but the sign-in,
   the setup, the health check and a shared chat's link needs a browser session. A person reaching a hosted
   installation was asked for the token and then for the password: two doors where the owner wants one.
2. The host's capacity was read once (the first look at the Office) and kept; an account's authorization was made
   from it once and kept. After the hosted VM was resized from 2 to 4 vCPU nothing read it again, and the page told
   the operator to run `governance.js budget set`, a command that did not exist. A per-employee limit of 0.05 vCPU
   (2 vCPU less the control plane's 1.75 and a 10 % reserve) could not even be typed back into the budget form: the
   browser refused any value off its 0.25 step.
3. Settings → AI Connections said OpenAI Codex and Google Antigravity were "Not installed on this server": the image
   carried Claude Code alone.

## Decision

1. **The access token is optional.** Another host name may be answered with or without `ORBIT_WEB_ACCESS_TOKEN`:
   Orbit Web's accounts are the gate, and a token, when set, is a perimeter in front of them (still at least 16
   characters, still asked before the sign-in page). The localhost-only trial, whose login is public, still answers
   loopback names alone. Nothing else of the sign-in changes.
2. **The host is read again** at every start and at a person's **Re-check** (Settings → Compute & storage,
   `POST /api/office/resources/capacity/check`, two at once being one): the sandbox provider is asked, the capacity
   row is written again, and every account whose authorization comes from the capacity follows it. A budget value that
   stood at the old authorization moves with it (up or down); one the owner lowered stays, never above the new one. A
   provider that does not answer changes nothing (`capacity_unreadable`; at a start: ten tries, three seconds apart,
   then the row is left as it was -- never replaced by the control plane's own view of its host).
3. **The operator's authorization** is `governance.js budget show | set` (the command the pages already named):
   `set --account=<id> | --all` with numbers (vCPU, GiB, attempts) makes an authorization the operator's own
   (`source: operator`), which a Re-check or a start leaves alone; `--from-capacity` gives the account back to the
   capacity. Each is in the account's audit record (`workforce.budget.authorization`).
4. **Every AI CLI in the image**: OpenAI Codex CLI (`@openai/codex`, exact version, its native binary from the
   registry) and the Google Antigravity CLI (`agy`, the release archive its official installer fetches, pinned by the
   SHA-512 its manifest names, per architecture), in the control plane's image and the model plane's, beside Claude
   Code. `build-info.json` and Settings → System name their versions. What each may do is unchanged: ADR 0067's
   methods decide (Antigravity has no sign-in Orbit Web offers).

5. **Employee desks** (Governance → Employee desks). An employee who leaves -- archived, or rejected at its trial --
   keeps its desk, read only, and its desk storage stays committed (an archive releases only the cache). The owner
   reviews each one there -- what it holds, why it left -- and deletes the desk (`employment` command `delete`, only from
   `archived`, against the version read). Its sandbox goes `DELETING`; the provisioner asks the provider to remove every
   area of the employee (`deleteEmployee`: refused while a container of one of its attempts exists, read back),
   backing off and trying again until it is gone; only then is it `DELETED` and the desk's storage released -- the
   account is never told it may use space still on the pool's disk. The employee stays, `deleted`, for what refers to
   it, and leaves the office's lists. 0.8.0 keeps ONE initial schema: the new states are in it, and an installation
   of a development build starts afresh (`db.js reset`).

## Consequences

- A hosted installation asks for a username and a password, nothing else, unless its operator sets a token.
- Resizing a host, or changing `ORBIT_WEB_CAPACITY_*`, takes effect at a Re-check or a restart, with no database edit.
- An office whose storage is full of desks of people who left frees it from Governance, never from a database edit.
- Held by `apps/api/tests/integration/office-desks.spec.ts`, the web's `EmployeeDesks.spec.tsx`, and
  `apps/api/src/config/config.spec.ts`, `apps/api/src/contexts/execution/application/resources.service.spec.ts`,
  `apps/api/tests/integration/capacity.spec.ts` (Re-check, the owner's lowered value, the operator's authorization, a
  provider that does not answer, a restart), the web's `ComputeStorage.spec.tsx`, and the Docker smoke test (both CLIs
  answer in the image).
