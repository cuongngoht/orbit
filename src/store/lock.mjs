// One writer at a time, for the files that are merged rather than replaced.
//
// Most of the store needs no lock at all: a lesson is one file, so two sessions
// writing two different lessons never meet. The index, the rollups and the state
// files are shared, and those go through here.
//
// mkdir is the lock because it is one atomic syscall on every filesystem this
// engine runs on -- NTFS included -- and needs no cleanup protocol to be correct.
// The owner is written INSIDE the directory afterwards, so acquiring stays one
// syscall and a torn owner file can only cost a worse error message.
//
// A lock left behind by a process that died is broken by mtime, and the break is
// RECORDED with whose it was. A lock that silently disappears teaches nobody
// anything the next time it happens.
//
// What this cannot do: a store on a synced folder (OneDrive, Dropbox, iCloud) is
// eventually consistent, so two machines can both see no lock and both take it.
// Saying so is the honest answer; store.mjs points ORBIT_LEARN_DIR at a local disk
// by default, and a conflict copy is reported as a finding when one shows up.
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { Blocked } from "../errors.mjs";

export const LOCK = ".lock";
export const OWNER = "owner.json";
export const BACKOFF = [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5000];
export const STALE_MS = 60000;

// `busy` is what a writer that could not get in is told, in words about ITS
// work; unset, it speaks of lessons, the first thing this lock guarded.
export function withLock(dir, fn, io, busy) {
  const lock = join(dir, LOCK);
  const token = acquire(lock, io, busy);
  try {
    return fn();
  } finally {
    release(lock, io, token);
  }
}

// The same lock around work that AWAITS -- a runtime being downloaded and
// unpacked -- which a plain withLock would release the moment the promise was
// made. `busy` is what the loser is told, in words about ITS work rather than
// about lessons. Such work can outlive STALE_MS, so its caller passes an io
// whose `staleMs` says how long it may take.
export async function withLockAsync(dir, fn, io, busy) {
  const lock = join(dir, LOCK);
  const token = acquire(lock, io, busy);
  try {
    return await fn();
  } finally {
    release(lock, io, token);
  }
}

function acquire(lock, io, busy) {
  for (const wait of io.backoff ?? BACKOFF) {
    const token = took(lock, io);
    if (token) return token;
    breakIfStale(lock, io);
    io.sleep(wait);
  }
  return lastAttempt(lock, io, busy);
}

// A lock directory that could not be made because the place REFUSES writes -- a sandbox, the
// file's permissions, a read-only disk -- is not another session holding it: waiting would only
// end in a sentence that sends somebody looking for a writer that does not exist.
const DENIED = ["EPERM", "EACCES", "EROFS"];

function refusedWrite(e, lock) {
  if (DENIED.includes(e?.code)) throw new Blocked(`${dirname(lock)} cannot be written here (${e.code}): a sandbox or the file's permissions refuse it, so nothing was written — this is not another session`);
  return false;
}

function took(lock, io) {
  try {
    io.mkdir(lock);
  } catch (e) {
    return refusedWrite(e, lock);
  }
  const token = randomUUID();
  io.write(join(lock, OWNER), JSON.stringify({ host: io.host, pid: io.pid, at: io.now(), token }));
  return token;
}

function breakIfStale(lock, io) {
  const at = io.mtime(lock);
  const age = at ? io.nowMs() - at : 0;
  if (age <= (io.staleMs ?? STALE_MS)) return;
  broken(lock, io, age, ownerOf(lock, io));
}

// Two waiters can judge the SAME stale lock, and the slower one must not remove
// the lock a third process took in between. So the lock is first moved aside --
// one atomic rename -- and removed only if what was moved is still the owner
// that was judged stale; anything else is put back.
function broken(lock, io, age, owner) {
  const aside = setAside(lock, io);
  if (!aside) return;
  if (aside !== lock && ownerOf(aside, io)?.token !== owner?.token) return restored(lock, aside, io);
  io.remove(aside);
  io.note({ kind: "lock-broken", say: `a lock held by ${describe(owner)} for ${Math.round(age / 1000)}s was broken — that process is gone` });
}

// An io with no rename can only remove in place, as it always has.
const setAside = (lock, io) => (io.rename ? renamedAside(lock, io) : lock);

function renamedAside(lock, io) {
  const aside = `${lock}.broken-${randomUUID()}`;
  try {
    io.rename(lock, aside);
    return aside;
  } catch {
    return null;
  }
}

// A lock taken again while this one was aside cannot be put back; its holder
// still believes it holds it, and saying so is all that is left to do.
function restored(lock, aside, io) {
  try {
    io.rename(aside, lock);
  } catch {
    io.note({ kind: "lock-lost", say: `${lock} was taken while a live lock was set aside at ${aside}` });
  }
}

function ownerOf(lock, io) {
  try {
    return JSON.parse(io.read(join(lock, OWNER)) ?? "null");
  } catch {
    return null;
  }
}

const describe = (owner) => (owner ? `${owner.host}/${owner.pid}` : "an unknown process");

const heldBy = (lock, io) => `another session is writing this project's lessons (${describe(ownerOf(lock, io))}) — try again in a moment`;

// Guarded, so a failure to let go can never mask the error that got us here.
function release(lock, io, token) {
  try {
    if (ownerOf(lock, io)?.token === token) io.remove(lock);
  } catch {
    io.note({ kind: "lock-stuck", say: `${lock} could not be removed; the next writer will break it` });
  }
}

function lastAttempt(lock, io, busy) {
  const token = took(lock, io);
  if (!token) throw new Blocked(busy ?? heldBy(lock, io));
  return token;
}
