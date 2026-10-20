// The node:http adapter: a request in, one answer out, every exception turned
// into a response in exactly one place.
//
//   host check  ->  route  ->  page, or  ->  mutation check  ->  operation  ->  JSON
//
// It binds 127.0.0.1 and nothing else, on port 0 unless told otherwise, so the
// OS picks a free one and two servers on one machine never fight over it.
import { createServer } from "node:http";
import { readJson } from "./request.mjs";
import { failure, json } from "./response.mjs";
import { match } from "./router.mjs";
import { admit, LOOPBACK } from "./security.mjs";
import { serveStatic } from "./static.mjs";
import { invalid } from "./errors.mjs";
import { liveOf } from "./live/index.mjs";
import { openSse } from "./live/sse.mjs";

export function createControlServer(ctx) {
  return createServer((req, res) => handle(ctx, req, res));
}

export function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK, () => resolve(server.address().port));
  });
}

async function handle(ctx, req, res) {
  try { await answer(ctx, req, res); }
  catch (e) { failure(res, e, ctx.log); }
}

// The port a request arrived on is the port this server answers to, so the
// Host and Origin checks need no state set after listen().
async function answer(ctx, req, res) {
  const pathname = pathOf(req.url);
  admit(req, req.socket.localPort, ctx.token, false);
  const found = match(req.method, pathname);
  if (!found) return serveStatic(ctx, req, res, pathname);
  return api(ctx, req, res, found);
}

async function api(ctx, req, res, found) {
  admit(req, req.socket.localPort, ctx.token, Boolean(found.route.mutates));
  if (found.route.stream) return streamed(ctx, req, res, found);
  const body = found.route.body ? await readJson(req) : undefined;
  json(res, 200, await found.route.run({ ctx, id: found.id, ids: found.ids, body, query: queryOf(req.url) }));
}

// A STREAM (Orbit Live): everything that can refuse is decided by the row's `open` BEFORE a header is
// written, so a refusal is the same JSON failure every route has. After the headers the only exits are
// the stream's own: it ends, the page leaves, or the server closes it. A stream is a read: it is a GET,
// never `mutates`, and nothing it does writes.
async function streamed(ctx, req, res, { route, id, ids }) {
  const stream = await route.open({ ctx, id, ids, query: queryOf(req.url), lastEventId: req.headers["last-event-id"] });
  const sink = sinkFor(liveOf(ctx), req, res, stream);
  stream.start(sink);
}

// The open set holds the sink itself: ending it is what closes the stream, from the page or the server.
function sinkFor(live, req, res, stream) {
  const sink = openSse(req, res, { heartbeatMs: live.heartbeatMs, onTick: () => stream.tick(), onClose: () => closedStream(live, stream, sink) });
  live.streams.add(sink);
  return sink;
}

function closedStream(live, stream, sink) {
  stream.close();
  live.streams.remove(sink);
}

function pathOf(url) {
  try { return new URL(url, "http://control.invalid").pathname; }
  catch { throw invalid("INVALID_URL", "the request URL could not be parsed"); }
}

// A read's options (`?days=30`), as plain strings. Each operation validates the
// ones it reads, in its own words; the rest are ignored.
const queryOf = (url) => Object.fromEntries(new URL(url, "http://control.invalid").searchParams);
