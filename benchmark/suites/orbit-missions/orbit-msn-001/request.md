# An order with an impossible line is accepted

Customers of the order service can create an order whose line has no quantity, a negative or a fractional quantity, or
a price that is negative or not a whole number of cents -- and the service keeps it. A line `{ "qty": 0, "unitMinor":
500 }` sent to `POST /orders` answers 201 and the order is stored; it should be refused.

What the project must do:

- An order line's quantity (`qty`) is a whole number of at least 1, and its unit price (`unitMinor`) a whole number of
  minor units of at least 0 -- a free item is a valid line.
- `POST /orders` with any line that breaks either rule answers 400 (`{ "error": "invalid lines" }`, as an order with no
  lines does today) and stores nothing, whatever the order's other lines are.
- Every valid order is created as before: 201, open, with its total.
- Nothing else about orders, payments or the view changes.

How it is verified: a regression test under `test/` sends such a line to `POST /orders`, sees 400 and finds no order
stored. It fails before the change and passes after it. Do not change or delete an existing test.
