// The trail's LOG -- the one thing every producer and every consumer share, and
// the only thing between processes that never share memory.
//
//   <storeBase>/control/activity/trace/<YYYY-MM-DD>-<host>.jsonl
//
// Append-only, one shard per UTC day per host: two machines sharing a store
// (ORBIT_STORE_DIR on a shared directory) never write the same file, and a team
// reads one trail. Bounded twice: a shard stops at MAX_SHARD_BYTES and says so
// ONCE (`trace.dropped`), and shards older than KEEP_DAYS are pruned when a
// day's first event arrives. FAIL OPEN everywhere: a store that cannot be
// written costs the line, never the moment it describes.
//
// Reading merges every host's shards in a window, keeps only lines it can read
// (src/trace/events.mjs `readable`), and counts an id once.
//
// `recent` (0.5.0, B22 M3) is the one BOUNDED read: what a hook that runs on every turn's end may afford -- the last
// RECENT_BYTES of this machine's two newest shards, and only the lines of the one session it names, read the same
// tolerant way. A session's events are written by this machine's own hooks, so another host's shard holds none of them;
// a turn longer than the window is a turn this read cannot see the start of, and the caller says it cannot count.
import { join } from "node:path";
import { eventOf, readable } from "./events.mjs";
import { withLock } from "../store/lock.mjs";

export const MAX_SHARD_BYTES = 4 * 1024 * 1024;
export const KEEP_DAYS = 90;
export const MAX_READ = 20000;
export const RECENT_BYTES = 512 * 1024;
export const RECENT_SHARDS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const SHARD = /^(\d{4}-\d{2}-\d{2})-.+\.jsonl$/;

export function traceLog(rooms, io) {
  const c = { dir: rooms.trace, io };
  return { dir: c.dir, append: (event) => appended(c, event), read: (window) => readWindow(c, window ?? {}), recent: (ask) => readRecent(c, ask ?? {}) };
}

const hostOf = (io) => String(io.host ?? "host").replace(/[^A-Za-z0-9._-]/g, "_");

const shardOf = (c, at) => join(c.dir, `${String(at).slice(0, 10)}-${hostOf(c.io)}.jsonl`);

function appended(c, event) {
  try { locked(c, event); }
  catch { /* fail open: what this line describes has already happened */ }
}

function locked(c, event) {
  c.io.ensureDir(c.dir);
  return withLock(c.dir, () => written(c, event), { ...c.io, backoff: [5, 10, 20, 40, 80, 160, 320] });
}

function written(c, event) {
  const file = shardOf(c, event.at);
  if (event.id.startsWith("h-") && String(c.io.read(file) ?? "").includes(`"id":"${event.id}"`)) return;
  if (!c.io.exists(file)) pruned(c, event.at);
  if ((c.io.size?.(file) ?? 0) >= MAX_SHARD_BYTES) return droppedOnce(c, file, event);
  c.io.append(file, `${JSON.stringify(event)}\n`);
}

// Said once per shard: a trail that silently stopped would read as a quiet day.
function droppedOnce(c, file, event) {
  if (c.io.exists(`${file}.full`)) return;
  c.io.write(`${file}.full`, event.at);
  c.io.append(file, `${JSON.stringify(eventOf("trace.dropped", { reason: `this shard reached ${MAX_SHARD_BYTES} bytes — nothing more is kept for it today` }, { id: `${event.id}-dropped`, at: event.at }))}\n`);
}

function pruned(c, at) {
  const oldest = new Date(Date.parse(at) - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (const name of c.io.list(c.dir).filter((n) => SHARD.test(n) && SHARD.exec(n)[1] < oldest)) c.io.removeFile(join(c.dir, name));
}

// window: { sinceMs?, untilMs?, limit? } -- newest `limit` events, oldest first.
function readWindow(c, window) {
  const since = window.sinceMs ? new Date(window.sinceMs).toISOString().slice(0, 10) : "";
  const shards = c.io.list(c.dir).filter((n) => SHARD.test(n) && SHARD.exec(n)[1] >= since).sort();
  const lines = shards.flatMap((n) => String(c.io.read(join(c.dir, n)) ?? "").split("\n")).map(parsed).filter(Boolean);
  return ordered(distinct(lines.filter((e) => inWindow(e, window)))).slice(-(window.limit ?? MAX_READ));
}

const inWindow = (e, w) => (!w.sinceMs || Date.parse(e.at) >= w.sinceMs) && (!w.untilMs || Date.parse(e.at) <= w.untilMs);

// ask: { session, bytes? } -- one session's lines from the tail of this host's newest shards, oldest first. A line is
// parsed only once it names the session, so a busy machine's other sessions cost a substring test each.
function readRecent(c, ask) {
  const mine = c.io.list(c.dir).filter((n) => SHARD.test(n) && n.slice(11) === `${hostOf(c.io)}.jsonl`).sort().slice(-RECENT_SHARDS);
  const named = `"session":${JSON.stringify(String(ask.session ?? ""))}`;
  const lines = mine.flatMap((n) => tailOf(c, join(c.dir, n), ask.bytes ?? RECENT_BYTES)).filter((l) => l.includes(named));
  return ordered(distinct(lines.map(parsed).filter((e) => e && e.session === ask.session)));
}

// The last `bytes` of a shard, whole lines only: a line the window cut at its start is dropped, never half-read.
function tailOf(c, file, bytes) {
  const size = c.io.size(file) ?? 0;
  const got = c.io.readFrom(file, Math.max(0, size - bytes), bytes);
  const lines = String(got?.buffer?.toString("utf8") ?? "").split("\n");
  return size > bytes ? lines.slice(1) : lines;
}

const distinct = (events) => [...new Map(events.map((e) => [e.id, e])).values()];

const ordered = (events) => [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));

function parsed(line) {
  try { return line.trim() ? readable(JSON.parse(line)) : null; }
  catch { return null; }
}
