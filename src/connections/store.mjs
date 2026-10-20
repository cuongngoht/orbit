// WHERE connections live: one schema-stamped document in the machine store's
// control room (control/connections/connections.json) -- configuration a person
// made, shared by every project on this machine, and outside every repository.
// Written under a lock, atomically; a document from a newer Orbit is refused
// rather than overwritten (src/store/control.mjs).
import { join } from "node:path";
import { readState, writeState } from "../store/control.mjs";
import { withLock } from "../store/lock.mjs";

export const CONNECTIONS_SCHEMA = 1;

export function connectionStore(rooms, io) {
  const file = join(rooms.connections, "connections.json");
  const read = () => readState(io, file, { connections: [] }, CONNECTIONS_SCHEMA);
  return { file, vaultDir: join(rooms.connections, "vault"), list: () => read().connections ?? [], get: (id) => (read().connections ?? []).find((c) => c.id === id) ?? null, change: (fn) => changed(rooms, io, file, read, fn), unreadable: () => read().unreadable ?? null };
}

// fn(list) -> the new list. The one write door.
function changed(rooms, io, file, read, fn) {
  io.ensureDir(rooms.connections);
  return withLock(rooms.connections, () => writeState(io, file, { connections: fn(read().connections ?? []) }, CONNECTIONS_SCHEMA), io);
}
