# A note on an order

Customers want to leave a note with their order ("leave at the back door"). Add it to the order service.

What the project must do:

- An order may be created with a `note` (a string). The API returns it as `note` when the order is created and every
  time the order is read back (`GET /orders/<id>`), also after the store is opened again on the same directory.
- An order created without a note, or with an empty one, has the empty note `""`.
- The HTML view (`renderOrder(order)`) draws a non-empty note as its own paragraph, `<p class="note">…</p>`, after the
  state paragraph, ESCAPED the way the view escapes every value a customer typed: `&` as `&amp;`, `<` as `&lt;`, `>` as
  `&gt;`, `"` as `&quot;` and `'` as `&#39;`. An order with an empty note draws no note paragraph at all.
- Nothing else changes: the customer, the total and the state are drawn as they are, and every route keeps its
  contract.

Make the change in the project, with a regression test under `test/` that fails before it and passes after it. Do not
change or delete an existing test.
