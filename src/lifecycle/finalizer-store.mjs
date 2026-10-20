import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha } from '../hash.mjs';
import { readState, writeState } from '../store/control.mjs';
import { withLock } from '../store/lock.mjs';
import { Refused } from '../errors.mjs';
export const LEASE_MS = 60_000;
export function finalizerStore(dir, io) {
  const files = () => io.list(dir).filter((n) => /^[a-f0-9]{64}\.json$/.test(n));
  const read = (id) => readState(io, fileOf(dir, id), { state: 'absent' });
  const write = (id, doc) => writeState(io, fileOf(dir, id), doc);
  return { enqueue: (session, lines) => locked(dir, io, () => enqueued({ files, read, write }, session, lines, io)), pending: () => files().map((f) => ({ id: f.slice(0, -5), ...read(f.slice(0, -5)) })).filter((d) => d.state !== 'completed' && !d.unreadable).sort((a, b) => a.revision - b.revision), claim: (id) => locked(dir, io, () => claimed(read, write, id, io)), complete: (id, token) => locked(dir, io, () => completed(read, write, id, token)) };
}
const fileOf = (dir, id) => /^[a-f0-9]{64}$/.test(id) ? join(dir, `${id}.json`) : invalid();
const invalid = () => { throw new Refused('invalid finalizer operation'); };
function locked(dir, io, fn) {
  io.ensureDir(dir);
  return withLock(dir, fn, { ...io, backoff: [5, 10, 20] });
}
function enqueued(port, session, lines, io) {
  const id = sha(JSON.stringify([session, lines]));
  if (port.read(id).state !== 'absent') return id;
  if (port.files().length >= 1024) throw new Refused('finalizer checkpoint limit reached');
  port.write(id, { state: 'pending', session, lines, revision: lines.length, at: io.now() });
  return id;
}
function claimed(read, write, id, io) {
  const doc = read(id);
  if (doc.unreadable || doc.state === 'absent' || doc.state === 'completed' || (doc.state === 'leased' && doc.until > io.nowMs())) return null;
  const next = { ...doc, state: 'leased', token: randomUUID(), until: io.nowMs() + LEASE_MS };
  write(id, next);
  return next;
}
function completed(read, write, id, token) {
  const current = read(id);
  if (current.state !== 'leased' || current.token !== token) return false;
  write(id, { state: 'completed', session: current.session, at: current.at });
  return true;
}
