# A payment delivered twice is charged twice

The broker that feeds the payments consumer (`consume(store, message)` in `src/worker.mjs`) delivers a message again
whenever it is unsure the first delivery was handled -- after a timeout, or after the consumer's process restarted.
Every redelivery of an `order.paid` message writes another invoice for the same payment.

What the project must do:

- An `order.paid` message, by its `id`, writes ONE invoice however many times it is delivered, and every delivery of it
  is acknowledged (`ack: true`) -- the first and every one after.
- That holds across a restart: a message delivered again after the store is opened again on the same directory still
  writes no second invoice.
- Two different payment messages are two payments, each with an invoice of its own, even when they name the same
  order.
- A payment for an order nobody has is still not acknowledged and writes nothing; a message that is not a payment is
  still acknowledged and skipped. An invoice names its order (`orderId`) and the order's total (`amountMinor`).

Make the change in the project, with a regression test under `test/` that fails before it and passes after it. Do not
change or delete an existing test.
