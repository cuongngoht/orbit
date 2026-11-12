# Orders in more than one currency

The order service only knows dollars. It must take orders in US dollars, euros and Japanese yen.

What the project must do:

- An order is created in one of `USD`, `EUR` or `JPY` (the codes exactly as written here), given as `currency` when it
  is created, and `USD` when none is given. The order keeps its currency: the API returns it as `currency`.
- An order's total is shown formatted in its own currency, by the API (`total`) and by the HTML view (the total
  paragraph): `$12.34` for dollars and `€12.34` for euros (two decimals), and `¥1234` for yen, which have no minor
  unit -- amounts are always kept in the currency's minor units, so 1234 yen is `¥1234`.
- The invoice the payments consumer writes for a paid order carries the order's currency as `currency`.
- A currency nobody keeps (any other code) is refused with 400, and no order is stored.
- Nothing else changes: an order with no currency is exactly what it was, totals and discounts are computed as they
  are, and shipping, reading and the other routes keep their contracts.

Make the change in the project, with a regression test under `test/` that fails before it and passes after it. Do not
change or delete an existing test.
