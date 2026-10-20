import { join } from 'node:path';
import { sha } from '../hash.mjs';
import { readState, writeState } from '../store/control.mjs';
import { withLock } from '../store/lock.mjs';
const fields = ['id', 'name', 'transport', 'scope', 'hostEnabled', 'status'];
export function observeExternal(rooms, io, host, scope, servers) {
  const id = sha(JSON.stringify([host, scope]));
  io.ensureDir(rooms.externalObservations);
  return withLock(rooms.externalObservations, () => writeState(io, join(rooms.externalObservations, `${id}.json`), { host, scope: sha(scope), observedAt: io.now(), servers: servers.map((s) => Object.fromEntries(fields.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]))) }), io);
}
export function externalObservations(rooms, io) {
  if (!rooms.externalObservations) return [];
  return io.list(rooms.externalObservations).filter((f) => /^[a-f0-9]{64}\.json$/.test(f)).map((f) => readState(io, join(rooms.externalObservations, f), {})).filter((d) => !d.unreadable && Array.isArray(d.servers));
}
export const qualifiedServers = (docs) => docs.flatMap((d) => d.servers.map((s) => ({ ...s, id: `${d.host}:${d.scope.slice(0, 16)}:${s.id}`, host: d.host, observedAt: d.observedAt })));
