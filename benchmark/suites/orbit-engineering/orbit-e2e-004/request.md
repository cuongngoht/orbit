# A payment's invoice can be lost after it is acknowledged

The payments team found paid orders with no invoice. The payments consumer (`consume(store, message)` in
`src/worker.mjs`) acknowledges an `order.paid` message before the order's invoice is safely on disk; when the process
stops right after the acknowledgement, the invoice is gone, and the broker never delivers that message again because it
was acknowledged.

What the project must do:

- When `consume` acknowledges an `order.paid` message (`ack: true`) for an order the store holds, that order's invoice
  is already written to the store: a store opened again on the same directory right after the call returns finds it.
  The invoice names its order (`orderId`) and the order's total in minor units (`amountMinor`).
- A payment message delivered again (the same message `id`) is acknowledged again and writes no second invoice. Two
  different payment messages are two payments, each with an invoice of its own, even when they name the same order.
- A payment for an order nobody has is not acknowledged (`ack: false`), so the broker delivers it again; it writes
  nothing.
- A message that is not a payment is acknowledged and skipped, and writes nothing.

Make the change in the project, with a regression test under `test/` that fails before it and passes after it. Do not
change or delete an existing test.
