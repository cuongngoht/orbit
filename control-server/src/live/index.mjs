// Orbit LIVE in Control: delivery, never state. What a page is streamed is read off the journals the
// engine already keeps; nothing here writes anything, and nothing is kept that a reload could not
// rebuild. One `live` per server: the followers (one poll per followed file) and the streams that are
// open (so a shutdown can end them before the server closes).
import { createFollowers, POLL_MS } from "../core.mjs";
import { HEARTBEAT_MS } from "./sse.mjs";

export function createLive(opts = {}) {
  const open = new Set();
  const streams = { add: (s) => open.add(s), remove: (s) => open.delete(s), size: () => open.size, closeAll: () => [...open].forEach((s) => s.end()) };
  return { followers: createFollowers({ pollMs: opts.pollMs ?? POLL_MS }), streams, heartbeatMs: opts.heartbeatMs ?? HEARTBEAT_MS };
}

// Bound on first use, so a context built by hand (a test's) gets one too.
export const liveOf = (ctx) => (ctx.live ??= createLive());
