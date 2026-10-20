// ONE poll per followed file, however many viewers watch it. A follower is acquired by key (the file it
// follows); the first viewer starts its timer, every viewer adds its listener, and the last viewer to leave
// clears the timer and forgets it. Nothing is followed that no viewer is watching.
//
//   createFollowers({ pollMs }) -> { acquire(key, make) -> lease, size() }
//   lease: { subject, refresh(), listen(fn), release() }
//   subject: { poll() -> batch | null }        null is "nothing new"; a batch goes to every listener
//
// This is the one module of the live core that owns a timer, and only while a viewer holds a lease: Orbit
// Control's pages and a terminal's `live watch` acquire here; the status line never does (it reads once).
//
// Polling, not fs.watch: the writers are other processes appending to a file, and a watch on a file is
// a one-shot `rename` on one platform, a coalesced directory event on another, and says on none how many
// bytes arrived -- a read would still be needed. A poll asks the file's SIZE (one stat) and reads only
// when it moved (src/store/follow.mjs), so a quiet task costs one stat every POLL_MS. A watch could be
// added later to poll sooner; it would change no contract.
export const POLL_MS = 500;

export function createFollowers(opts = {}) {
  const entries = new Map();
  const pollMs = opts.pollMs ?? POLL_MS;
  return { acquire: (key, make) => acquired(entries, pollMs, key, make), size: () => entries.size };
}

function acquired(entries, pollMs, key, make) {
  const entry = entries.get(key) ?? started(entries, pollMs, key, make);
  entry.clients += 1;
  return leaseOf(entries, key, entry);
}

function started(entries, pollMs, key, make) {
  const entry = { subject: make(), clients: 0, listeners: new Set(), timer: null };
  entry.timer = setInterval(() => ticked(entry), pollMs);
  entry.timer.unref?.();
  entries.set(key, entry);
  return entry;
}

// `refresh` polls NOW and hands what was new to the viewers already listening, so a viewer that joins
// next replays from a subject that is up to date and is never sent a line twice.
function leaseOf(entries, key, entry) {
  const mine = { fn: null, released: false };
  const listen = (fn) => listened(entry, mine, fn);
  return { subject: entry.subject, refresh: () => ticked(entry), listen, release: () => released(entries, key, entry, mine) };
}

function listened(entry, mine, fn) {
  mine.fn = fn;
  entry.listeners.add(fn);
}

function released(entries, key, entry, mine) {
  if (mine.released) return;
  Object.assign(mine, { released: true });
  entry.listeners.delete(mine.fn);
  entry.clients -= 1;
  if (entry.clients === 0) forgotten(entries, key, entry);
}

function forgotten(entries, key, entry) {
  clearInterval(entry.timer);
  if (entries.get(key) === entry) entries.delete(key);
}

function ticked(entry) {
  const batch = polled(entry.subject);
  if (batch === null) return;
  for (const fn of [...entry.listeners]) delivered(entry, fn, batch);
}

// A subject that throws (a journal from a newer engine, a disk that went away) is a batch that says so,
// and each viewer ends its own feed; an exception never escapes a timer.
function polled(subject) {
  try { return subject.poll(); }
  catch (e) { return { error: String(e?.message ?? e).slice(0, 300) }; }
}

function delivered(entry, fn, batch) {
  try { fn(batch); }
  catch { entry.listeners.delete(fn); }
}
