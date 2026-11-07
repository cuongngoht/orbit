# A shipped order can be marked delivered

The order service follows an order from open to shipped, and nothing after that. Support asks to record that a shipped
order reached its customer.

What the project must do:

- `POST /orders/<id>/deliver` moves a SHIPPED order to `delivered` and answers 200 with the order, its `state`
  `delivered`; reading it back (`GET /orders/<id>`) shows it delivered.
- An order that is open, cancelled or already delivered is refused with 409 (`{ "error": "the order is <state>" }`, as
  shipping a shipped order is today) and stays as it was; an unknown order answers 404.
- A delivered order can no longer be shipped or cancelled: 409.
- Every other route keeps its contract.

How it is verified: a regression test under `test/` ships an order, delivers it and reads it back delivered. It fails
before the change and passes after it. Do not change or delete an existing test.
