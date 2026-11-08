# Fines for late returns

Nothing happens today when a member brings something back late, and we want to start charging fines.

- A loan is late for every day after its due date. Something brought back on its due date, or before, owes nothing.
- A late book is fined 25 cents a day, and a late DVD $1 a day.
- A fine is never more than what it would cost us to replace that copy (its `replacementCents`).
- The fine is charged when the item comes back, whether it is checked in at the desk or dropped in the drop box, and
  it is added to what the member owes.

Show it in the API, in cents: a returned loan says its fine in `fineCents` (on `POST /loans/:id/return` and on
`GET /loans/:id`), and `GET /members/:id` says what the member owes, all of their fines added up, in `balanceCents`.
