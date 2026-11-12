# Keep the next copy for whoever has waited longest

Members can place a hold on a title, but nothing happens to those holds today: when a copy comes back it goes straight
back on the shelf, where anyone can take it. We want holds served, first come, first served.

- When a copy is checked in at the desk or dropped in the drop box and members are waiting for its title, set it aside
  for the member whose hold was placed first. A hold on another title doesn't count, and neither does a hold that has
  already been given a copy.
- That hold becomes `ready`: `GET /holds/:id` says which copy is waiting (`copy`) and the last day to collect it
  (`pickupBy`), seven days after the day the copy came back. Everybody else keeps waiting, in the same order.
- The member is sent a notice, which they see at `GET /members/:id/notices`: one notice whose `kind` is `hold-ready`,
  with the hold's id (`hold`), the copy's id (`copy`) and the same `pickupBy`. Nobody else is sent one.
- The copy's status is `held`, and only that member may borrow it: anybody else who asks is refused with 409 and
  `held-for-another`. When that member borrows it, their hold becomes `collected`.
- With nobody waiting for the title, the copy goes back on the shelf, as it does today.
