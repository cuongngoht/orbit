// ONE SANDBOX LOG, LIVE: what a task's application prints, as it prints it -- read from a byte offset by the
// runtime's own command (src/runtime/sandbox/view.mjs logsOf), so every line is placed and scrubbed there and
// Control never holds a log's path. The checks a plain read makes are made once, when the stream opens and
// before any header: the session's id, the stream's name, and that the sandbox is this task's own.
//
//   log        { source: "log", session, stream, from, next, lines, truncated }, id o=<next>
//   log-reset  the log was pruned or begun again; the page starts over at 0
//   end        the log could not be read any more
//
// Pages watching one log share one timer (followers.mjs); each reads at its own offset, and nothing is buffered.
// The stream runs until the page leaves: whether a process still runs is the runtime's judgement on a live
// look, not something a log file says.
import { logReader } from "../tasks/sandbox.mjs";
import { formatOffset, parseOffset } from "./cursor.mjs";
import { liveOf } from "./index.mjs";
import { tickSubject } from "../core.mjs";

export async function openLogStream({ ctx, ids, query, lastEventId }) {
  const reader = await logReader(ctx, ids, query);
  const s = { ctx, reader, from: parseOffset(lastEventId ?? query?.from), busy: false, lease: null, sink: null };
  return { start: (sink) => started(s, sink), tick: () => {}, close: () => s.lease?.release() };
}

function started(s, sink) {
  s.sink = sink;
  s.lease = liveOf(s.ctx).followers.acquire(`log:${s.reader.key}`, tickSubject);
  s.lease.listen(() => read(s));
  return read(s);
}

// One read in flight at a time: a slow disk never piles reads up behind a fast timer.
async function read(s) {
  if (s.busy || s.sink.closed) return;
  s.busy = true;
  try { answered(s, await s.reader.read(s.from)); }
  catch { ended(s); }
  finally { s.busy = false; }
}

function answered(s, a) {
  if (a.reset) return reset(s);
  if (a.next <= s.from) return;
  s.from = a.next;
  s.sink.send({ event: "log", id: formatOffset(a.next), data: { source: "log", session: a.session, stream: a.stream, from: a.from, next: a.next, lines: a.lines, truncated: a.truncated } });
}

function reset(s) {
  s.from = 0;
  s.sink.send({ event: "log-reset", id: formatOffset(0), data: { source: "log", from: 0 } });
}

function ended(s) {
  s.sink.send({ event: "end", data: { source: "log", reason: "error" } });
  s.sink.end();
}
