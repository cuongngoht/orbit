# Keep each library system's records to itself

Several library systems share this service, and each one must only ever see and change its own records. That isn't
true everywhere today. Please make every request — and the drop box — work on the caller's own library system only:

- Another system's title, copy, member, a member's notices, loan or hold reads exactly like one that doesn't exist:
  404, as for an id nobody has.
- `GET /titles` lists the caller's own titles, all of them, and nobody else's.
- A change that names another system's record is refused as not found (404) and changes nothing of theirs: lending
  their copy, lending to their member, placing a hold on their title or for their member, adding a copy of their
  title, checking in their loan or renewing it.
- A drop box only checks in its own system's copies: a scan of another system's copy is acknowledged with
  `unknown-copy` and changes nothing.
- Everything a library system does with its own records keeps working exactly as it does now.
