# ORBIT-MEM-006 — a journal survives a process killed mid-append

A task (`src/task/store.mjs`), a goal (`src/goal/store.mjs`) and a mission (`satellite/src/store/journal.mjs`) each keep
an APPEND-ONLY journal -- `journal.jsonl`, one JSON record per line, every line in order -- and that journal is the only
state they have: every view is a fold over it. Records go in only through the store's own door (`append`, `begin`),
which writes through the file io it is given (`realIo` of `src/store/io.mjs` in production), and come out through its
reader (`read`), which drops a torn or garbled line rather than failing.

A process killed mid-append leaves a line with no end. Appending straight after it would glue the next record onto the
fragment, and the reader would then drop both.

The behaviour this source must have, for each of the three journals:

- Before a record is appended, a torn last line is ended first, so the fragment stays a line of its own -- unreadable,
  and dropped by the reader -- and the record after it is a whole line.
- Whatever a killed process left -- one fragment or several in a row, before any record, after the last one, or after
  every few records -- every record appended through the door reads back, in the order it was written, and the
  fragment is never read as a record.
- A process killed before it wrote anything leaves nothing to end, and nothing changes.

Make the smallest change in `src/task/`, `src/goal/` or `satellite/src/store/` that gives this behaviour, and add a
regression test under `test/` that fails before your change and passes after it. Do not change or delete an existing
test.
