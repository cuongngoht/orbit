# lending

A lending service for library systems. Several library systems share one service, and each sees and changes only its
own records. Records live on disk, one JSON file each, so a service that stops and starts again finds them.

- `src/dates.mjs` — calendar days (`YYYY-MM-DD`, UTC).
- `src/store.mjs` — the durable store: `openStore(dir)`.
- `src/tenancy.mjs` — a library system's own records.
- `src/catalog.mjs` — titles and their copies. A book may be out for 21 days, a DVD for 7.
- `src/members.mjs` — members, and what they owe. A member may have five items out at once.
- `src/loans.mjs` — lending, renewals and returns.
- `src/fines.mjs` — fines for late returns.
- `src/holds.mjs` — holds: members waiting for a title, first come, first served.
- `src/api.mjs` — the HTTP-shaped API: `handle(store, { method, path, tenant, today, body }) -> { status, body }`.
- `src/dropbox.mjs` — the drop box consumer: `consume(store, { id, tenant, copy, at }) -> { ack, outcome }`.

`tenant` is the library system the caller signed in as, and `today` the day the service's clock says it is. A refusal
answers `{ error: <word> }`.

| Route | Does |
|---|---|
| `POST /titles` `{ name, format }` · `GET /titles` · `GET /titles/:id` | adds a title (`book` or `dvd`), the system's titles, a title |
| `POST /copies` `{ title, replacementCents }` | adds a copy of a title |
| `GET /copies/:id` | a copy and its status: `shelf`, `loan` or `held` |
| `POST /members` `{ name }` · `GET /members/:id` | adds a member, a member |
| `GET /members/:id/notices` | the notices a member was sent |
| `POST /loans` `{ copy, member }` · `GET /loans/:id` | lends a copy to a member, a loan |
| `POST /loans/:id/return` | checks a loan in at the desk |
| `POST /loans/:id/renew` | renews a loan |
| `POST /holds` `{ title, member }` · `GET /holds/:id` | places a hold on a title, a hold |

`npm test` runs the tests.
