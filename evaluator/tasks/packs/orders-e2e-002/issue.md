# Cancel an order

Support asks for a way to cancel an order before it ships. Add it to the order service's API.

What the project must do:

- `POST /orders/<id>/cancel` cancels an OPEN order: it answers 200 with the order, now in state `cancelled`, and the
  order reads back (`GET /orders/<id>`) as `cancelled` from then on.
- Only an open order can be cancelled. Cancelling an order that is already shipped or already cancelled answers 409
  and changes nothing. Cancelling an order nobody has answers 404.
- A cancelled order is never shipped: `POST /orders/<id>/ship` on it answers 409, and it stays cancelled.
- Every other route keeps its contract exactly: creating an order (201, `open`; 400 when it has no valid lines),
  reading one (200, or 404), shipping an open one once (200 `shipped`; 409 after that), and 404 for a route nobody
  serves.

Make the change in the project, with a regression test under `test/` that fails before it and passes after it. Do not
change or delete an existing test.
