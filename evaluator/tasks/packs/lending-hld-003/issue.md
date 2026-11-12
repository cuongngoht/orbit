# Let members renew a loan

Members keep asking to keep something a little longer. Please add renewals: `POST /loans/:id/renew`.

- A renewal moves the loan's due date forward by its title's loan period — 21 days for a book, 7 for a DVD — counted
  from the due date it had, not from the day they renew. It answers 200 with the loan, its new `due`, and how many
  times it has now been renewed (`renewals`; a loan starts at 0).
- A loan can be renewed twice. After that the answer is 409 with `renewal-limit`.
- An overdue loan can't be renewed (409 with `overdue`); on its due date itself it still can.
- It can't be renewed while somebody is waiting for its title (409 with `hold-waiting`). A hold on another title
  doesn't stop it.
- A loan that has already come back can't be renewed (409 with `returned`).
- A renewal that is refused leaves the loan exactly as it was.
