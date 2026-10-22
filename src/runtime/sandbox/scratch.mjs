// A sandbox's SCRATCH room: where a file only a container client may read is made for ONE call and removed when the
// call ends (src/runtime/isolation/contract-v1.mjs `deps.scratch`) -- the values a container is handed, which never
// ride a command line and never the client's own environment.
//
// Every file is new (a path anything is already at is refused, so a link somebody planted is never followed),
// readable by this machine's user alone, and named at random, so two calls never share one. Removing touches only a
// file of this room.
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const inRoom = (room, path) => [`${room}/`, `${room}\\`].some((p) => String(path).startsWith(p)) && !String(path).slice(room.length + 1).match(/[\\/]/);

// -> { write(text) -> path, remove(path) }, over an io that has `writePrivate` (src/store/io.mjs).
export function createScratch(room, io) {
  return { write: (text) => io.writePrivate(join(room, `${randomBytes(12).toString("hex")}.env`), text), remove: (path) => (inRoom(room, path) ? io.removeFile(path) : null) };
}
