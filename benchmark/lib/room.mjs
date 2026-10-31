// THE ROOM a benchmark run keeps in the machine store, beside the project's own rooms: <storeRoot>/benchmark/<bnr-…>/.
// It is created on the first write and never on a read, every write is held inside it and outside any repository
// (src/store/guard.mjs), and a document is replaced whole or not at all (src/store/atomic.mjs). What it keeps is the
// run's EVIDENCE -- the manifest frozen once, the frozen case, the subject's checkout, the runner's own store, one
// document per action keyed by the task journal's own action id, what each round left -- and never the run's state:
// where a run stands is the bench task's journal, read through its door.
//
//   roomOf(storeRoot, runId) -> { dir, at(...parts) }       newRunId(salt) -> "bnr-<12 hex>"
//   docWritten(room, rel, value)    docRead(room, rel) -> value | null    readRegular(file, max) -> Buffer | null
//   BENCH_DIR
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Refused } from "../../src/errors.mjs";
import { short } from "../../src/hash.mjs";
import { contained, outsideRepositories } from "../../src/project/boundary.mjs";
import { writeAtomic } from "../../src/store/atomic.mjs";
import { guardedIo } from "../../src/store/guard.mjs";
import { realIo } from "../../src/store/io.mjs";

export const BENCH_DIR = "benchmark";

export const RUN_ID = /^bnr-[a-f0-9]{12}$/;

export const newRunId = (salt) => `bnr-${short(`${salt}\u0000${Date.now()}\u0000${randomBytes(8).toString("hex")}`, 12)}`;

export function roomOf(storeRoot, runId) {
  if (!RUN_ID.test(String(runId))) throw new Refused(`a run is named bnr- and 12 hex characters, and ${runId} is not`);
  const dir = outsideRepositories(contained(join(storeRoot, BENCH_DIR), join(storeRoot, BENCH_DIR, runId)));
  return { id: runId, dir, at: (...parts) => contained(dir, join(dir, ...parts)), io: guardedIo(dir, realIo()) };
}

export function docWritten(room, rel, value) {
  room.io.ensureDir(dirname(room.at(rel)));
  return writeAtomic(room.at(rel), `${JSON.stringify(value, null, 2)}\n`, room.io, false);
}

// A file of the room read only when it is a regular file -- never a link, a pipe or a device -- and no larger than it
// may be. Anything a container wrote is read this way and no other: what it left is data, never a path to follow.
export function readRegular(file, max) {
  const st = existsSync(file) ? lstatSync(file) : null;
  return st && st.isFile() && st.size <= max ? readFileSync(file) : null;
}

const jsonOf = (buf) => {
  try { return buf ? JSON.parse(buf.toString("utf8")) : null; }
  catch { return null; }
};

export const docRead = (room, rel, max = 32 * 1024 * 1024) => jsonOf(readRegular(room.at(rel), max));

export const madeDir = (room, ...parts) => ((dir) => (room.io.ensureDir(dir), dir))(room.at(...parts));
