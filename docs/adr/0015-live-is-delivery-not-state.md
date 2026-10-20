# ADR 0015 — Live is delivery, not state: a page follows the journals the engine already keeps

**Status:** accepted, 1.8.0

## Context
Mission Control (1.7.7) read a task's whole journal every five seconds while the task ran, and an
autonomous QA investigation reached the page only as one receipt, after it ended. A person watching an
autonomous task had to refresh to know what it was doing, and could not see the browser at all.

The obvious design is an event bus: writers "raise" an event to an orchestrator in Control, which pushes it
to pages. It does not fit this engine. The writers are separate processes -- `cli/task.mjs`,
`cli/autonomous-engineering.mjs`, the run-case and investigation children, and Control itself -- and every
one of them must work from a terminal with nothing else running. An in-memory bus would see only Control's
own writes, and a broker would make a terminal command depend on a daemon. It would also be a second record
of what happened beside the journal, and two records drift.

Two more facts constrain it. An orchestrator's decision is STALE when ANY line lands in the task's journal
after the revision it read (`src/orchestration/decision.mjs` FRESH `STALE`), so nothing may write QA
activity into a task's journal while an agent decides. And a run's `run-log.jsonl` has exactly one reader,
the report.

## Decision
1. **The journals are the event log.** "Raising an event" is appending a line through a journal's one write
   door, as it always was. Live writes nothing, anywhere.
2. **A page FOLLOWS files.** `src/store/follow.mjs` reads only the bytes appended since it last looked, and
   numbers each ended line with the store's OWN keep-rule (`journalLine`), so a live page and a reload agree
   on every line's index. An unended line is held; a file that shrank is a reset.
3. **Sources are a table.** A live task is drawn from its journal (`src/task/live.mjs`), the investigations
   begun against its sandbox, found by reading their first line (`src/investigation/discover.mjs`) and
   shown through an allow-list per kind (`src/investigation/activity.mjs`), and its sandbox's session logs,
   read from a byte offset by the runtime's own command. Another source is one subject in
   `control-server/src/live/subjects.mjs` and one row in its owner's table.
4. **Server-Sent Events, read-only.** A stream is a GET row with `stream: true`; everything that can refuse
   does so before a header, as JSON. Every event's id is a composite cursor (`t=<n>;<inv-id>=<n>`), so a
   browser that reconnects resumes exactly where it was. A heartbeat is an event, not a comment, because a
   page's watchdog must see it. A person's decisions stay POSTs with a token and a revision.
5. **One poll per followed file.** Followers are refcounted; the first page starts one timer (a stat, and a
   read only when the size moved), the last page to leave stops it. `fs.watch` is not used: across
   platforms it misses or coalesces another process's appends and never says how many bytes arrived.
6. **A run-case case is one unit.** Its start is the investigation's decision and its end the investigation's
   `run` line; per-step browser activity comes from the investigation's own actions, which are journaled
   live. `run-log.jsonl` keeps its one reader.

## Consequences
- A page shows a line at most one poll interval after it is written (500 ms), and the same line in the same
  place after a reload.
- A browser that cannot hold a stream reads `/activity?since=<cursor>` every five seconds and says
  `DEGRADED LIVE`; nothing pretends polling is a stream.
- What a page can see of QA is decided by a table a test holds whole: every investigation kind is a row or
  is named SILENT, and a header, a body, a query or a structured field never reaches the wire.
- Per-step detail of a run-case run is not live in 1.8.0. Doing it would mean a second reader of
  `run-log.jsonl` or a progressive writer, and it is a decision of its own.
