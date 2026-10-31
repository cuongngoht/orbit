# orders

A small order service. Money is kept in minor units (cents); an order's total is its lines' total after a whole
percentage discount. Records live on disk, one JSON file each, so a process that stops and starts again finds them.

- `src/money.mjs` — line and order totals, currencies, formatting.
- `src/store.mjs` — the durable store.
- `src/orders.mjs` — creating, shipping and cancelling orders.
- `src/api.mjs` — the HTTP-shaped API: `handle(store, { method, path, body }) -> { status, body }`.
- `src/worker.mjs` — the payments consumer: `consume(store, message) -> { ack, ... }`.
- `src/ui.mjs` — an order as HTML.

`npm test` runs the tests.
