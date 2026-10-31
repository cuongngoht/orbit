# Discounted totals are a cent short

Customers on the order service report that a discounted order sometimes costs one minor unit (one cent) less than it
should. An item of 9.95 with a 10% discount comes to 8.955, which should be charged as 8.96; the service charges 8.95.

What the project must do:

- A whole-percentage discount leaves an amount in minor units, ROUNDED HALF UP to the nearest minor unit: a fraction
  of exactly one half, or more, goes up to the next minor unit; less than one half goes down. A discount that leaves
  whole minor units is exact.
- No discount leaves the subtotal as it is, and a 100% discount leaves nothing.
- An order's total is its lines' subtotal (quantity times unit price, in minor units) after its discount, rounded the
  same way -- in `src/money.mjs` and in what the API stores and shows for a new order (`total`, formatted in dollars).
- Nothing else about orders, payments or the view changes.

Make the change in the project, with a regression test under `test/` that fails before it and passes after it. Do not
change or delete an existing test.
