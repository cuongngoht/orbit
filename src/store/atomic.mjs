// Replace a file, or leave the old one intact. Never a half-written one.
//
// Write to a temporary name, then rename over the target: rename is atomic on
// POSIX, and Node maps it to MoveFileEx(REPLACE_EXISTING) on Windows, which is
// atomic too but throws EPERM or EBUSY while an antivirus or a search indexer has
// the file open. That is transient, so the rename is retried before giving up.
//
// The backup is a COPY, not a rename. Renaming the old file out of the way would
// leave a window with no file at the target at all, and a reader landing in that
// window sees a store that lost a lesson.
//
// There is no fsync. A power cut losing the last lesson written is acceptable --
// the evidence it was derived from is still in the store, and the next
// `analyse` derives it again. Paying for durability the data does not need would
// be cost with no matching risk.
import { Blocked, Refused } from "../errors.mjs";

// About two seconds in all (0.0.2): three sessions seating one project at once on a busy Windows runner held one
// another's files open longer than the first 210 ms, and a seat that could have finished was BLOCKED.
export const RENAME_BACKOFF = [10, 40, 160, 640, 1280];
export const BAK = ".bak";

export function writeAtomic(file, text, io, keepBackup = true) {
  const tmp = `${file}.tmp-${io.pid}`;
  try { return replaced(file, tmp, text, io, keepBackup); }
  finally { discardTemporary(tmp, io); }
}

function replaced(file, tmp, text, io, keepBackup) {
  written(tmp, text, io);
  if (keepBackup) backup(file, io);
  return renamed(tmp, file, io);
}

function discardTemporary(tmp, io) {
  try { if (io.exists(tmp)) io.removeFile(tmp); }
  catch { /* Cleanup must not hide the original publication error. */ }
}

function written(tmp, text, io) {
  try {
    io.write(tmp, text);
  } catch (e) {
    if (e instanceof Refused) throw e;
    throw new Blocked(`${tmp} could not be written — ${e.message}`);
  }
}

function backup(file, io) {
  if (!io.exists(file)) return;
  io.copy(file, `${file}${BAK}`);
}

function renamed(tmp, file, io) {
  for (const wait of RENAME_BACKOFF) {
    if (moved(tmp, file, io)) return file;
    io.sleep(wait);
  }
  return lost(tmp, file, io);
}

function moved(tmp, file, io) {
  try {
    io.rename(tmp, file);
  } catch {
    return false;
  }
  return true;
}

// A DIRECTORY moved into place, retried the same way. Nothing is removed when
// it fails: the source is still where it was, whole.
export function moveRetried(from, to, io) {
  for (const wait of RENAME_BACKOFF) {
    if (moved(from, to, io)) return to;
    io.sleep(wait);
  }
  throw new Blocked(`${to} could not be put in place — another program is holding it or ${from} open`);
}

function lost(tmp, file, io) {
  io.removeFile(tmp);
  throw new Blocked(`${file} could not be replaced — another program is holding it open`);
}
