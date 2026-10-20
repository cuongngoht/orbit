// Server-Sent Events, framed once. A stream is a GET that stays open: the headers say so, a `retry`
// line tells the browser how soon to come back, and a heartbeat EVENT (not a comment -- an SSE comment
// never reaches a page's script, and the page's watchdog has to see it) proves the connection is alive.
//
//   openSse(req, res, { heartbeatMs, onTick, onClose }) -> sink { send(evt), end(), closed }
//
// Memory is bounded per client: a page that stops reading is cut off, never queued for, and it comes
// back with its cursor. Nothing here knows what a task is.
import { API_HEADERS } from "../response.mjs";

export const HEARTBEAT_MS = 15000;
export const RETRY_MS = 3000;
export const MAX_BUFFERED = 1024 * 1024;

export const SSE_HEADERS = { ...API_HEADERS, "cache-control": "no-cache, no-store", "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive", "x-accel-buffering": "no" };

// `data` is one JSON line, so no newline in it can end a frame early; `id` is a cursor, whose grammar
// has none (cursor.mjs). A frame with no id leaves the browser's Last-Event-ID as it was.
export const frame = ({ event, id, data }) => `event: ${event}\n${id === undefined ? "" : `id: ${id}\n`}data: ${JSON.stringify(data ?? {})}\n\n`;

export function openSse(req, res, opts = {}) {
  res.writeHead(200, SSE_HEADERS);
  res.write(`retry: ${RETRY_MS}\n\n`);
  const sink = sinkOf(res, opts);
  req.on("close", () => sink.end());
  return sink;
}

function sinkOf(res, opts) {
  const state = { closed: false, timer: null };
  const sink = { send: (evt) => sent(res, state, evt), end: () => ended(res, state, opts), get closed() { return state.closed; } };
  state.timer = setInterval(() => beat(sink, opts), opts.heartbeatMs ?? HEARTBEAT_MS);
  state.timer.unref?.();
  return sink;
}

function beat(sink, opts) {
  sink.send({ event: "ping", data: {} });
  opts.onTick?.();
}

function sent(res, state, evt) {
  if (state.closed) return false;
  if (res.writableLength > MAX_BUFFERED) return cut(res);
  res.write(frame(evt));
  return true;
}

function cut(res) {
  res.destroy();
  return false;
}

function ended(res, state, opts) {
  if (state.closed) return;
  state.closed = true;
  clearInterval(state.timer);
  res.end();
  opts.onClose?.();
}
