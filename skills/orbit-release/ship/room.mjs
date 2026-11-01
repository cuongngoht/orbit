// THE SHIP'S ROOM in the machine store: <storeRoot>/release/<shp-…>/ -- created on the first write, never on a read,
// every write held inside it and outside any repository, a document replaced whole or not at all. It keeps a ship's
// EVIDENCE -- the manifest frozen at its start, one document per action keyed by its task journal's own action id, the
// artifact, the verified patches, the release patch and bundle, the evidence a verdict rests on, and a pristine checkout
// of each release commit it judged (trees/) -- and never its state: where a ship stands is its task's journal, read
// through the task's door every time.
//
//   shipRoomOf(storeRoot, id) -> { id, dir, at(...parts), io }      newShipId(salt) -> "shp-<12 hex>"     SHIP_ID
//   docWritten(room, rel, value)    docRead(room, rel) -> value | null    shipsIn(storeRoot) -> [{ id, manifest }]
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Refused } from "../../../src/errors.mjs";
import { short } from "../../../src/hash.mjs";
import { contained, outsideRepositories } from "../../../src/project/boundary.mjs";
import { writeAtomic } from "../../../src/store/atomic.mjs";
import { guardedIo } from "../../../src/store/guard.mjs";
import { realIo } from "../../../src/store/io.mjs";

export const RELEASE_DIR = "release";

export const SHIP_ID = /^shp-[a-f0-9]{12}$/;

// How many ships a look reads, newest first: enough for any machine, bounded however many it keeps.
export const MAX_SHIPS = 200;

export const newShipId = (salt) => `shp-${short(`${salt}\u0000${Date.now()}\u0000${randomBytes(8).toString("hex")}`, 12)}`;

export function shipRoomOf(storeRoot, id) {
  if (!SHIP_ID.test(String(id))) throw new Refused(`a ship is named shp- and 12 hex characters, and ${id} is not`);
  const dir = outsideRepositories(contained(join(storeRoot, RELEASE_DIR), join(storeRoot, RELEASE_DIR, id)));
  return { id, dir, at: (...parts) => contained(dir, join(dir, ...parts)), io: guardedIo(dir, realIo()) };
}

export function docWritten(room, rel, value) {
  room.io.ensureDir(dirname(room.at(rel)));
  return writeAtomic(room.at(rel), `${JSON.stringify(value, null, 2)}\n`, room.io, false);
}

// A document of a room read only when it is a regular file no larger than it may be -- never a link to follow.
export function readRegular(file, max = 32 * 1024 * 1024) {
  const st = existsSync(file) ? lstatSync(file) : null;
  return st && st.isFile() && st.size <= max ? readFileSync(file) : null;
}

const jsonOf = (buf) => {
  try { return buf ? JSON.parse(buf.toString("utf8")) : null; }
  catch { return null; }
};

export const docRead = (room, rel, max) => jsonOf(readRegular(room.at(rel), max));

export const jsonAtFile = (file, max) => jsonOf(readRegular(file, max));

function listed(dir) {
  try { return readdirSync(dir).filter((n) => SHIP_ID.test(n)); }
  catch { return []; }
}

// The ships this store keeps, newest first by when each began -- read, never created.
export const shipsIn = (storeRoot) => listed(join(storeRoot, RELEASE_DIR)).map((id) => ({ id, manifest: docRead(shipRoomOf(storeRoot, id), "manifest.json") })).filter((s) => s.manifest).sort((a, b) => String(b.manifest.at).localeCompare(String(a.manifest.at))).slice(0, MAX_SHIPS);
